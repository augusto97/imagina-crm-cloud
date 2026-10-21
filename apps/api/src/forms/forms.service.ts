import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleDestroy,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    brandingSchema,
    buildPublicFormItems,
    defaultFormConfig,
    formConfigSchema,
    formItemVisible,
    isEffectivelyReadOnly,
    isEmptyAnswer,
    isFormFieldType,
    jsonbKeyForField,
    tenantFormatSchema,
    validateFieldValue,
    type BillingStatus,
    type CreateFormInput,
    type Field,
    type FormConfig,
    type FormDto,
    type PublicFormMeta,
    type SubmitFormInput,
    type SubmitFormResult,
    type UpdateFormInput,
    readStoreListMarker,
    addDaysYmd,
    formatEmailFieldValue,
    formFileAllowed,
    resolveTimeZone,
    zonedInstant,
    type FormFieldItem,
} from '@imagina-base/shared';
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { attachments, formPendingSubmissions, forms, tenants, type FormPendingRow, type FormRow } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { IncidentHub } from '../incidents/incident-hub';
import { BillingService } from '../billing/billing.service';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { senderName, type PortalEmailBrand } from '../portal/portal-email';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { CaptchaService } from './captcha.service';
import { formConfirmEmail, formCopyEmail, type FormAnswerLine } from './form-email';

/** El sistema crea el registro: no hay persona del equipo detrás del envío. */
const SYSTEM_ACTOR = { userId: 0, role: 'admin' as const };

/** Menos de esto entre cargar y enviar es un robot (una persona tarda más). */
const MIN_FILL_MS = 2500;
/** El sello de carga vale un día: un formulario abierto desde ayer se puede mandar. */
const STAMP_TTL_MS = 24 * 3600 * 1000;
/** Comprobante de un archivo subido: alcanza para completar el resto del formulario. */
const UPLOAD_TOKEN_TTL_S = 6 * 3600;
/** Archivos subidos que nadie envió se borran pasado este tiempo. */
const ORPHAN_AFTER_S = 24 * 3600;
const PENDING_UPLOADS_KEY = 'formupl:pending';
/** Tope de archivos por formulario público (aunque el campo permita más). */
const MAX_FILES_PER_FIELD = 10;

/**
 * Frenos del endpoint público. Por IP —una persona no manda 10 respuestas
 * por minuto— y por formulario, compartidos entre nodos (Redis). El token
 * del formulario vive en el HTML de un sitio público: cualquiera lo tiene.
 */
const SUBMIT_LIMITS = [
    { scope: 'ip', window: 60, max: 8 },
    { scope: 'ip', window: 3600, max: 60 },
    { scope: 'form', window: 60, max: 60 },
    { scope: 'form', window: 3600, max: 2000 },
] as const;
const UPLOAD_LIMITS = [
    { scope: 'ip', window: 600, max: 30 },
    { scope: 'form', window: 3600, max: 400 },
] as const;
/**
 * Presupuesto de BYTES subidos: además de cuántos archivos, cuánto pesan. Sin
 * esto 30 archivos de 20 MB por IP cada 10 minutos llenaban el almacenamiento
 * del plan de la empresa en un rato.
 */
export const UPLOAD_BYTE_LIMITS = [
    { scope: 'ip', window: 600, max: 60 * 1024 * 1024 },
    { scope: 'form', window: 3600, max: 1024 * 1024 * 1024 },
] as const;

/** v0.1.290 — el enlace para confirmar el correo vale 48 horas. */
export const CONFIRM_TTL_MS = 48 * 3600 * 1000;
/**
 * Correos a QUIEN RESPONDE (confirmación y copia): un formulario público no
 * puede ser un cañón de correos hacia direcciones ajenas. Por dirección y por
 * IP, en Redis (compartido entre nodos).
 */
export const RESPONDENT_MAIL_LIMITS = [
    { scope: 'email', window: 3600, max: 3 },
    { scope: 'ip', window: 3600, max: 10 },
] as const;

/** `ana@gmail.com` → `an***@gmail.com` (para decir a dónde salió el correo). */
function maskEmail(email: string): string {
    const [local = '', domain = ''] = email.split('@');
    return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/** Resultado del enlace de confirmación (lo dibuja el controller con la marca). */
export interface ConfirmOutcome {
    status: 'confirmed' | 'invalid' | 'closed' | 'failed';
    title: string;
    message: string;
    brand: { company: string; accent: string; logoUrl: string | null } | null;
    continueUrl: string | null;
}

const notFound = () => new NotFoundException({ code: 'not_found', message: 'Este formulario no existe', data: { status: 404 } });

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400, ...extra } });
}

/**
 * ¿El formulario ya pasó su fecha de cierre? Vale hasta el final de ese día
 * en la ZONA HORARIA de la empresa (antes, en UTC: en Colombia cerraba a las
 * 7 p. m. del día elegido).
 */
export function pastCloseDate(closesAt: string | null, timeZone: string, now = new Date()): boolean {
    if (!closesAt || !/^\d{4}-\d{2}-\d{2}$/.test(closesAt)) return false;
    const end = zonedInstant(addDaysYmd(closesAt, 1), timeZone);
    return now.getTime() >= end.getTime();
}

interface ResolvedForm {
    row: FormRow;
    config: FormConfig;
    readOnly: boolean;
    tenantSettings: Record<string, unknown>;
    tenantName: string;
    timeZone: string;
}

@Injectable()
export class FormsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(FormsService.name);
    private sweeper: NodeJS.Timeout | null = null;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly files: FilesService,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly dispatcher: AutomationDispatcher,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly billing?: BillingService,
        // v0.1.285 (ADR-S44) — una respuesta que no se pudo guardar avisa a la empresa.
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly domains?: DomainsService,
        // v0.1.290 — verificación anti-robots y correos a quien responde.
        @Optional() private readonly captcha?: CaptchaService,
        @Optional() private readonly mail?: MailService,
    ) {}

    onModuleInit(): void {
        // Archivos subidos a un formulario que nunca se envió: no tienen que
        // quedar ocupando espacio. Cada nodo barre; ZREM decide quién borra.
        // v0.1.290 — y las respuestas que nadie confirmó en 48 h (con sus archivos).
        this.sweeper = setInterval(() => {
            this.sweepOrphanUploads().catch((err: unknown) => {
                this.logger.warn(`Barrido de archivos de formularios: ${String(err)}`);
            });
            this.sweepExpiredPending().catch((err: unknown) => {
                this.logger.warn(`Barrido de respuestas sin confirmar: ${String(err)}`);
            });
        }, 20 * 60 * 1000);
        this.sweeper.unref?.();
    }

    onModuleDestroy(): void {
        if (this.sweeper) clearInterval(this.sweeper);
    }

    // ─────────────────────────── Administración ───────────────────────────

    private toDto(row: FormRow, base?: string): FormDto {
        const path = `/api/v1/public/f/${row.token}`;
        return {
            id: row.id,
            list_id: row.listId,
            name: row.name,
            enabled: row.enabled,
            config: readConfig(row.config),
            public_path: path,
            ...(base ? { public_url: `${base}${path}`, public_origin: base } : {}),
            submissions_count: row.submissionsCount,
            last_submitted_at: row.lastSubmittedAt ? row.lastSubmittedAt.toISOString() : null,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    async list(tenantId: number, listIdOrSlug: string): Promise<FormDto[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(forms)
                .where(and(eq(forms.tenantId, tenantId), eq(forms.listId, list.id)))
                .orderBy(asc(forms.id)),
        );
        const base = await this.publicBase(tenantId);
        return rows.map((r) => this.toDto(r, base));
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<FormDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return this.toDto(await this.load(tenantId, list.id, id), await this.publicBase(tenantId));
    }

    /**
     * El origen por el que se comparte el formulario: el dominio propio de la
     * empresa si lo tiene y RESPONDE (ADR-S17), si no el de la plataforma.
     */
    private async publicBase(tenantId: number): Promise<string | undefined> {
        if (!this.domains) return undefined;
        try {
            return await this.domains.baseUrlFor(tenantId, 'app');
        } catch {
            return undefined;
        }
    }

    private async load(tenantId: number, listId: number, id: number): Promise<FormRow> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(forms)
                .where(and(eq(forms.tenantId, tenantId), eq(forms.listId, listId), eq(forms.id, id)))
                .limit(1),
        );
        if (!row) throw notFound();
        return row;
    }

    async create(tenantId: number, userId: number, listIdOrSlug: string, input: CreateFormInput): Promise<FormDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        if (readStoreListMarker(list.settings)) {
            throw badRequest(
                'store_managed',
                'Esta lista la maneja tu tienda online: los registros nuevos llegan desde ahí, no desde un formulario.',
            );
        }
        const fields = await this.fields.listByListId(tenantId, list.id);
        const config = sanitizeConfig(input.config ?? defaultFormConfig(list.name, fields), fields);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(forms)
                .values({
                    tenantId,
                    listId: list.id,
                    name: input.name,
                    token: newToken(),
                    enabled: false,
                    config: config as unknown as Record<string, unknown>,
                    createdBy: userId > 0 ? userId : null,
                })
                .returning(),
        );
        return this.toDto(row!, await this.publicBase(tenantId));
    }

    async update(tenantId: number, listIdOrSlug: string, id: number, input: UpdateFormInput): Promise<FormDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.load(tenantId, list.id, id);
        const patch: Partial<typeof forms.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.enabled !== undefined) {
            if (input.enabled && readStoreListMarker(list.settings)) {
                throw badRequest('store_managed', 'Esta lista la maneja tu tienda online: no puede recibir respuestas de un formulario.');
            }
            patch.enabled = input.enabled;
        }
        if (input.config !== undefined) {
            const fields = await this.fields.listByListId(tenantId, list.id);
            patch.config = sanitizeConfig(input.config, fields) as unknown as Record<string, unknown>;
        }
        if (input.regenerate_token) patch.token = newToken();
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(forms).set(patch).where(and(eq(forms.tenantId, tenantId), eq(forms.id, current.id))).returning(),
        );
        return this.toDto(row!, await this.publicBase(tenantId));
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number): Promise<{ name: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.load(tenantId, list.id, id);
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(forms).where(and(eq(forms.tenantId, tenantId), eq(forms.id, current.id))),
        );
        return { name: current.name };
    }

    /** Los formularios de una lista para el selector del disparador. */
    async summaries(tenantId: number, listId: number): Promise<Array<{ id: number; name: string; enabled: boolean }>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: forms.id, name: forms.name, enabled: forms.enabled })
                .from(forms)
                .where(and(eq(forms.tenantId, tenantId), eq(forms.listId, listId)))
                .orderBy(asc(forms.id)),
        );
        return rows;
    }

    // ─────────────────────────── Público ───────────────────────────

    /**
     * Token → formulario, por la conexión base (todavía no se conoce la
     * empresa). Un token mal formado, desconocido o un formulario sin
     * publicar dan el MISMO 404: a quien prueba direcciones no se le
     * confirma nada.
     */
    private async resolve(token: string, opts: { allowDisabled?: boolean } = {}): Promise<ResolvedForm> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound();
        const [hit] = await this.db
            .select({
                form: forms,
                status: tenants.status,
                archivedAt: tenants.archivedAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
                tenantSettings: tenants.settings,
                tenantName: tenants.name,
            })
            .from(forms)
            .innerJoin(tenants, eq(tenants.id, forms.tenantId))
            .where(eq(forms.token, token))
            .limit(1);
        // v0.1.290 — una respuesta enviada mientras estaba publicado se puede
        // confirmar aunque después lo hayan despublicado (`allowDisabled`).
        if (!hit || (!hit.form.enabled && !opts.allowDisabled) || hit.archivedAt !== null) throw notFound();
        return {
            row: hit.form,
            config: readConfig(hit.form.config),
            readOnly: isEffectivelyReadOnly({
                status: hit.status as BillingStatus,
                archived_at: hit.archivedAt,
                subscription_ends_at: hit.subscriptionEndsAt,
                paid_until: hit.paidUntil,
            }),
            tenantSettings: (hit.tenantSettings as Record<string, unknown> | null) ?? {},
            tenantName: hit.tenantName,
            timeZone: resolveTimeZone(
                ((hit.tenantSettings as Record<string, unknown> | null)?.format as { timezone?: unknown } | undefined)?.timezone,
            ),
        };
    }

    /** null = recibe respuestas; si no, el motivo que ve el visitante. */
    private closedReason(f: ResolvedForm): string | null {
        const s = f.config.settings;
        if (f.readOnly) return s.closed_message;
        if (pastCloseDate(s.closes_at, f.timeZone)) return s.closed_message;
        if (s.max_submissions !== null && f.row.submissionsCount >= s.max_submissions) return s.closed_message;
        return null;
    }

    /**
     * CSP `frame-ancestors` de la página (los sitios que pueden insertarlo) y,
     * v0.1.290, el proveedor de captcha cuyos dominios entran a la CSP.
     */
    async pageInfo(
        token: string,
    ): Promise<{ title: string; allowed_domains: string[]; meta: PublicFormMeta; captcha: PublicFormMeta['captcha'] } | null> {
        let f: ResolvedForm;
        try {
            f = await this.resolve(token);
        } catch {
            return null;
        }
        const meta = await this.buildMeta(f);
        return { title: meta.title || f.row.name, allowed_domains: f.config.settings.allowed_domains, meta, captcha: meta.captcha ?? null };
    }

    async meta(token: string): Promise<PublicFormMeta> {
        return this.buildMeta(await this.resolve(token));
    }

    private async buildMeta(f: ResolvedForm): Promise<PublicFormMeta> {
        const { row, config } = f;
        const fields = await this.fields.listByListId(row.tenantId, row.listId);
        const branding = brandingSchema.safeParse(f.tenantSettings.branding ?? {});
        const b = branding.success ? branding.data : brandingSchema.parse({});
        const format = tenantFormatSchema.safeParse(f.tenantSettings.format ?? {});
        const ts = Date.now();
        const keys = config.settings.captcha && this.captcha ? await this.captcha.resolve(row.tenantId, f.tenantSettings) : null;
        return {
            title: config.settings.title || row.name,
            description: config.settings.description,
            submit_label: config.settings.submit_label || 'Enviar',
            success_title: config.settings.success_title,
            success_message: config.settings.success_message,
            redirect_url: config.settings.redirect_url,
            allow_another: config.settings.allow_another,
            allow_prefill: config.settings.allow_prefill,
            accent_color: config.settings.accent_color ?? b.primary_color ?? '#0e7490',
            logo_url:
                config.settings.show_logo && b.logo_file_id !== null
                    ? this.files.signedUrl(row.tenantId, b.logo_file_id, 3600)
                    : null,
            company: b.app_name || f.tenantName,
            number_format: format.success ? format.data.number_format : 'comma_dot',
            items: buildPublicFormItems(config, fields),
            closed: this.closedReason(f),
            stamp: `${ts}.${this.files.signParts('formstamp', row.id, ts)}`,
            max_upload_bytes: this.env.MAX_UPLOAD_BYTES,
            captcha: keys ? { provider: keys.provider, site_key: keys.siteKey } : null,
            confirm_email: config.settings.confirm_email,
        };
    }

    /**
     * Sube UN archivo para una pregunta de archivos del formulario. Exige el
     * sello de la página (como el envío: no se sube nada sin haberla cargado),
     * que el archivo sea de un tipo que esa pregunta acepta (y nunca un
     * programa), y respeta el presupuesto de archivos y de BYTES por IP y por
     * formulario. El archivo queda «pendiente» —fuera de la cuota del plan—
     * hasta que llega con su respuesta; si nunca llega, el barrido lo borra.
     */
    async upload(
        token: string,
        ip: string,
        input: { stamp: string; field: string },
        part: { filename: string; mimetype: string; file: Readable & { truncated?: boolean } },
    ): Promise<{ token: string; name: string; size: number }> {
        const f = await this.resolve(token);
        if (this.closedReason(f)) throw new ForbiddenException({ code: 'form_closed', message: f.config.settings.closed_message, data: { status: 403 } });
        this.checkStamp(f.row.id, input.stamp, { minFill: false });
        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const fileIds = new Set(fields.filter((x) => x.type === 'file').map((x) => x.id));
        const item = f.config.items.find(
            (i): i is FormFieldItem => i.type === 'field' && fileIds.has(i.field_id) && !i.hidden && String(i.field_id) === input.field,
        );
        if (!item) throw badRequest('no_file_field', 'Esta pregunta no pide archivos.');
        const filename = part.filename || 'archivo';
        const mime = part.mimetype || 'application/octet-stream';
        const allowed = formFileAllowed(item.accept, filename, mime);
        if (!allowed.ok) {
            part.file.resume();
            throw badRequest('file_type_not_allowed', allowed.reason);
        }
        await this.enforce(UPLOAD_LIMITS, f.row.id, ip, 'archivos');
        await this.enforceBytes(f.row.id, ip);
        const dto = await this.files.upload(f.row.tenantId, 0, filename, mime, part.file);
        if (part.file.truncated) {
            await this.files.remove(f.row.tenantId, dto.id).catch(() => undefined);
            throw badRequest('file_too_large', 'El archivo es demasiado grande.');
        }
        await this.addBytes(f.row.id, ip, dto.size_bytes);
        // Pendiente hasta que llegue la respuesta: no ocupa la cuota del plan
        // (si no, cinco archivos sin enviar trababan las subidas del equipo).
        await this.tenantDb
            .withTenant(f.row.tenantId, (tx) =>
                tx
                    .update(attachments)
                    .set({ pendingFormId: f.row.id })
                    .where(and(eq(attachments.tenantId, f.row.tenantId), eq(attachments.id, dto.id))),
            )
            .catch(() => undefined);
        if (!dto.external && this.billing) {
            try {
                await this.billing.assertCanUpload(f.row.tenantId, dto.size_bytes);
            } catch {
                await this.files.remove(f.row.tenantId, dto.id).catch(() => undefined);
                throw badRequest('storage_full', 'No se pudo recibir el archivo en este momento.');
            }
        }
        const exp = Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL_S;
        await this.redis
            .zadd(PENDING_UPLOADS_KEY, Date.now() + ORPHAN_AFTER_S * 1000, `${f.row.tenantId}:${dto.id}`)
            .catch(() => undefined);
        const sig = this.files.signParts('formupload', f.row.tenantId, f.row.id, dto.id, exp);
        return { token: `${dto.id}.${exp}.${sig}`, name: dto.title, size: dto.size_bytes };
    }

    /** Recibe una respuesta: valida, crea el registro y avisa a las automatizaciones. */
    async submit(token: string, ip: string, input: SubmitFormInput): Promise<SubmitFormResult> {
        const f = await this.resolve(token);
        const closed = this.closedReason(f);
        if (closed) throw new ForbiddenException({ code: 'form_closed', message: closed, data: { status: 403 } });

        // Robots: el campo trampa lleno se "acepta" sin guardar nada (no se
        // le avisa al robot que lo detectamos); el sello tiene que ser de
        // este formulario y de hace más de unos segundos.
        if (input.hp && input.hp.trim() !== '') return { ok: true, redirect_url: f.config.settings.redirect_url };
        this.checkStamp(f.row.id, input.stamp);
        await this.enforce(SUBMIT_LIMITS, f.row.id, ip, 'respuestas');

        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const byId = new Map(fields.map((x) => [x.id, x]));
        // v0.1.290 — el servidor valida TODO el formulario, también las páginas
        // que el navegador pudo saltarse: las páginas son sólo cómo se muestra.
        const { data, errors, attachmentIds } = this.collect(f, byId, input);
        const s = f.config.settings;
        const emailKey = s.respondent_email_field_id !== null ? jsonbKeyForField(s.respondent_email_field_id) : null;
        const respondentEmail = emailKey && typeof data[emailKey] === 'string' ? (data[emailKey] as string) : null;
        // Doble opt-in: sin correo no hay a quién pedirle la confirmación.
        if (s.confirm_email && emailKey && !respondentEmail) {
            const item = f.config.items.find((i) => i.type === 'field' && i.field_id === s.respondent_email_field_id);
            if (item && !errors[item.id]) errors[item.id] = 'Necesitamos tu correo para confirmar la respuesta.';
        }
        if (Object.keys(errors).length > 0) {
            throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors });
        }

        // v0.1.290 — verificación anti-robots. Va DESPUÉS de revisar las
        // respuestas: un dato mal escrito no le quema el token a la persona.
        await this.checkCaptcha(f, input.captcha, ip);

        if (s.confirm_email && respondentEmail) {
            return this.holdForConfirmation(f, data, attachmentIds, respondentEmail, ip);
        }

        await this.finalize(f, fields, data, attachmentIds);
        if (s.send_copy && respondentEmail) this.sendCopyLater(f, fields, data, respondentEmail, ip);
        return { ok: true, redirect_url: f.config.settings.redirect_url };
    }

    /**
     * Crea el registro de una respuesta ya validada (envío directo o al
     * confirmar el correo): reserva el lugar del cupo, crea, saca los archivos
     * de "pendientes" y avisa a las automatizaciones.
     */
    private async finalize(
        f: ResolvedForm,
        fields: Field[],
        data: Record<string, unknown>,
        attachmentIds: number[],
    ): Promise<{ id: number; data: Record<string, unknown> }> {
        // Cupo: se RESERVA el lugar antes de crear el registro con un UPDATE
        // condicional (antes se contaba y se sumaba después: dos envíos a la
        // vez pasaban los dos el último lugar).
        if (!(await this.reserveSlot(f))) {
            throw new ForbiddenException({ code: 'form_closed', message: f.config.settings.closed_message, data: { status: 403 } });
        }

        let created;
        try {
            created = await this.records.create(f.row.tenantId, SYSTEM_ACTOR, String(f.row.listId), { data });
        } catch (err) {
            await this.releaseSlot(f);
            // Lo que el visitante puede corregir (un dato inválido) vuelve con
            // su motivo; lo demás —el plan lleno, un campo obligatorio de la
            // lista que el formulario no pregunta— es de la empresa, no de él.
            if (err instanceof HttpException && err.getStatus() === 400) {
                const body = err.getResponse() as { data?: { errors?: Record<string, string> } };
                const recErrors = body.data?.errors ?? {};
                const mapped = mapRecordErrors(f.config, fields, recErrors);
                if (Object.keys(mapped).length > 0) throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors: mapped });
            }
            const reason = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Formulario ${f.row.id}: no se pudo guardar la respuesta: ${reason}`);
            // Antes sólo quedaba en el log: la empresa perdía respuestas sin enterarse.
            this.incidents?.report({
                tenantId: f.row.tenantId,
                key: `form:${f.row.id}`,
                source: 'form',
                sourceId: f.row.id,
                listId: f.row.listId,
                ownerId: f.row.createdBy ?? null,
                title: `El formulario «${f.row.name}» está perdiendo respuestas`,
                message: `Alguien lo envió y no se pudo guardar: ${reason} A quien lo llenó le dijimos que pruebe más tarde.`,
            });
            throw new HttpException(
                {
                    code: 'form_unavailable',
                    message: 'No pudimos recibir tu respuesta en este momento. Prueba de nuevo más tarde.',
                    data: { status: 503 },
                },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }

        this.incidents?.resolve(f.row.tenantId, `form:${f.row.id}`);
        if (attachmentIds.length > 0) {
            await this.redis
                .zrem(PENDING_UPLOADS_KEY, ...attachmentIds.map((id) => `${f.row.tenantId}:${id}`))
                .catch(() => undefined);
            // Llegaron con su respuesta: desde ahora cuentan para el plan.
            await this.tenantDb
                .withTenant(f.row.tenantId, (tx) =>
                    tx
                        .update(attachments)
                        .set({ pendingFormId: null })
                        .where(and(eq(attachments.tenantId, f.row.tenantId), inArray(attachments.id, attachmentIds))),
                )
                .catch(() => undefined);
        }
        this.dispatcher.dispatch({
            tenantId: f.row.tenantId,
            listId: f.row.listId,
            recordId: created.id,
            trigger: 'form_submitted',
            after: created.data,
            form: { id: f.row.id, name: f.row.name },
        });
        return { id: created.id, data: created.data };
    }

    // ─────────────────── Captcha (v0.1.290) ───────────────────

    /**
     * Si el formulario pide verificación anti-robots, el token tiene que ser
     * válido y usarse UNA vez. Sin llaves en la empresa ni en la plataforma
     * (las quitaron después de activarlo), el formulario sigue recibiendo
     * respuestas —con la trampa, el sello y los límites— y la empresa se
     * entera por Problemas en vez de quedarse sin respuestas.
     */
    private async checkCaptcha(f: ResolvedForm, token: string | undefined, ip: string): Promise<void> {
        if (!f.config.settings.captcha || !this.captcha) return;
        const keys = await this.captcha.resolve(f.row.tenantId, f.tenantSettings);
        const incidentKey = `form-captcha:${f.row.id}`;
        if (!keys) {
            this.incidents?.report({
                tenantId: f.row.tenantId,
                key: incidentKey,
                source: 'form',
                sourceId: f.row.id,
                listId: f.row.listId,
                ownerId: f.row.createdBy ?? null,
                title: `El formulario «${f.row.name}» pide verificación anti-robots pero no hay llaves`,
                message:
                    'Las respuestas siguen llegando sin la verificación. Carga las llaves en Ajustes → Portal y formularios (o pídele al operador que las cargue en la plataforma), o apaga la opción en el formulario.',
            });
            return;
        }
        this.incidents?.resolve(f.row.tenantId, incidentKey);
        const verdict = await this.captcha.verify(keys, token, ip);
        if (verdict.ok) return;
        if (verdict.reason === 'unavailable') {
            throw new HttpException(
                {
                    code: 'captcha_unavailable',
                    message: 'No pudimos comprobar la verificación en este momento. Prueba de nuevo en un rato.',
                    data: { status: 503 },
                },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        throw badRequest(
            'captcha_failed',
            verdict.reason === 'reused'
                ? 'La verificación ya se usó. Complétala de nuevo para enviar.'
                : 'Completa la verificación para enviar.',
        );
    }

    // ─────────────────── Confirmación del correo (v0.1.290) ───────────────────

    /**
     * Doble opt-in: guarda la respuesta YA validada como pendiente y le manda a
     * la persona el enlace para confirmarla. Ni registro, ni automatizaciones,
     * ni cupo hasta que confirme. Los archivos quedan con la respuesta (fuera
     * del barrido de huérfanos) y se borran con ella si vence.
     */
    private async holdForConfirmation(
        f: ResolvedForm,
        data: Record<string, unknown>,
        attachmentIds: number[],
        email: string,
        ip: string,
    ): Promise<SubmitFormResult> {
        if (!this.mail) {
            throw new HttpException(
                { code: 'form_unavailable', message: 'No pudimos recibir tu respuesta en este momento. Prueba de nuevo más tarde.', data: { status: 503 } },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        if (!(await this.allowRespondentMail(email, ip))) {
            throw new HttpException(
                {
                    code: 'rate_limited',
                    message: 'Ya enviamos varios correos de confirmación a esta dirección. Revisa tu bandeja (y la carpeta de spam) o prueba en un rato.',
                    data: { status: 429 },
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const token = randomBytes(24).toString('base64url');
        const [pending] = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
            tx
                .insert(formPendingSubmissions)
                .values({
                    tenantId: f.row.tenantId,
                    formId: f.row.id,
                    tokenHash: hashToken(token),
                    email,
                    data,
                    attachmentIds,
                    ip: ip.slice(0, 64),
                    expiresAt: new Date(Date.now() + CONFIRM_TTL_MS),
                })
                .returning({ id: formPendingSubmissions.id }),
        );
        // Los archivos esperan con la respuesta: el barrido de huérfanos (24 h)
        // no los tiene que borrar antes de que venza la confirmación (48 h).
        if (attachmentIds.length > 0) {
            await this.redis
                .zrem(PENDING_UPLOADS_KEY, ...attachmentIds.map((id) => `${f.row.tenantId}:${id}`))
                .catch(() => undefined);
        }

        const base = (await this.publicBase(f.row.tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, '');
        const brand = await this.emailBrand(f, base);
        const message = formConfirmEmail(brand, `${base}/api/v1/public/f/confirm/${token}`, {
            formTitle: f.config.settings.title || f.row.name,
        });
        try {
            await this.mail.sendNow({
                tenantId: f.row.tenantId,
                to: email,
                subject: message.subject,
                text: message.text,
                html: message.html,
                ...(brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
            });
        } catch (err) {
            // Sin el correo la respuesta no se puede confirmar nunca: se descarta
            // la pendiente (los archivos vuelven al barrido) y se dice.
            await this.tenantDb
                .withTenant(f.row.tenantId, (tx) => tx.delete(formPendingSubmissions).where(eq(formPendingSubmissions.id, pending!.id)))
                .catch(() => undefined);
            if (attachmentIds.length > 0) {
                await this.redis
                    .zadd(PENDING_UPLOADS_KEY, ...attachmentIds.flatMap((id) => [Date.now() + ORPHAN_AFTER_S * 1000, `${f.row.tenantId}:${id}`]))
                    .catch(() => undefined);
            }
            const reason = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Formulario ${f.row.id}: el correo de confirmación no salió: ${reason}`);
            this.incidents?.report({
                tenantId: f.row.tenantId,
                key: `form-confirm:${f.row.id}`,
                source: 'form',
                sourceId: f.row.id,
                listId: f.row.listId,
                ownerId: f.row.createdBy ?? null,
                title: `El formulario «${f.row.name}» no puede mandar el correo de confirmación`,
                message: `Alguien respondió y no le pudimos mandar el enlace para confirmar: ${reason} Mientras tanto esas respuestas se pierden. Revisa el correo de la empresa en Ajustes → Correo, o apaga «Confirmar el correo» en el formulario.`,
            });
            throw new HttpException(
                {
                    code: 'form_unavailable',
                    message: 'No pudimos enviarte el correo para confirmar tu respuesta. Prueba de nuevo más tarde.',
                    data: { status: 503 },
                },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        this.incidents?.resolve(f.row.tenantId, `form-confirm:${f.row.id}`);
        return { ok: true, redirect_url: null, pending_confirmation: true, email_hint: maskEmail(email) };
    }

    /** ¿El enlace de confirmación existe y sigue vigente? (sin consumirlo) */
    async peekConfirmation(token: string): Promise<{ ok: boolean; brand: ConfirmOutcome['brand'] }> {
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, brand: null };
        const [row] = await this.db
            .select({ formId: formPendingSubmissions.formId, tenantId: formPendingSubmissions.tenantId })
            .from(formPendingSubmissions)
            .where(and(eq(formPendingSubmissions.tokenHash, hashToken(token)), gt(formPendingSubmissions.expiresAt, new Date())))
            .limit(1);
        if (!row) return { ok: false, brand: null };
        const f = await this.resolveById(row.formId);
        return { ok: true, brand: f ? this.noticeBrand(f) : null };
    }

    /**
     * Abre el enlace del correo: consume la pendiente (UN solo uso: el DELETE
     * … RETURNING es atómico, dos clics a la vez no crean dos registros) y
     * recién ahí crea el registro, corre «Cuando se envía un formulario» y
     * cuenta para el cupo.
     */
    async confirm(token: string): Promise<ConfirmOutcome> {
        const invalid: ConfirmOutcome = {
            status: 'invalid',
            title: 'Este enlace ya no sirve',
            message: 'Ya se usó o venció (vale 48 horas). Si ya lo abriste antes, tu respuesta quedó registrada; si no, vuelve a completar el formulario.',
            brand: null,
            continueUrl: null,
        };
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return invalid;
        const [pending] = await this.db
            .delete(formPendingSubmissions)
            .where(and(eq(formPendingSubmissions.tokenHash, hashToken(token)), gt(formPendingSubmissions.expiresAt, new Date())))
            .returning();
        if (!pending) return invalid;

        const f = await this.resolveById(pending.formId);
        if (!f) {
            await this.discardFiles(pending);
            return invalid;
        }
        const brand = this.noticeBrand(f);
        // La empresa dejó de recibir respuestas (solo-lectura, fecha o cupo):
        // la respuesta no entra, y se dice con su mensaje.
        const closed = this.closedReason(f);
        if (closed) {
            await this.discardFiles(pending);
            return { status: 'closed', title: 'El formulario ya no recibe respuestas', message: closed, brand, continueUrl: null };
        }
        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const attachmentIds = (pending.attachmentIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
        try {
            await this.finalize(f, fields, pending.data, attachmentIds);
        } catch (err) {
            if (err instanceof ForbiddenException) {
                await this.discardFiles(pending);
                return { status: 'closed', title: 'El formulario ya no recibe respuestas', message: f.config.settings.closed_message, brand, continueUrl: null };
            }
            // Algo de la empresa (el plan lleno, un campo nuevo obligatorio): la
            // pendiente vuelve a quedar como estaba, así el mismo enlace sirve
            // para reintentar cuando lo arreglen.
            await this.db
                .insert(formPendingSubmissions)
                .values({
                    tenantId: pending.tenantId,
                    formId: pending.formId,
                    tokenHash: pending.tokenHash,
                    email: pending.email,
                    data: pending.data,
                    attachmentIds: pending.attachmentIds,
                    ip: pending.ip,
                    expiresAt: pending.expiresAt,
                })
                .onConflictDoNothing()
                .catch(() => undefined);
            return {
                status: 'failed',
                title: 'No pudimos guardar tu respuesta',
                message: 'Algo falló de nuestro lado. Prueba abrir el mismo enlace de nuevo en un rato.',
                brand,
                continueUrl: null,
            };
        }
        if (f.config.settings.send_copy) this.sendCopyLater(f, fields, pending.data, pending.email, pending.ip ?? '');
        return {
            status: 'confirmed',
            title: '¡Listo! Tu respuesta quedó confirmada',
            message: f.config.settings.success_message || 'Recibimos tu respuesta.',
            brand,
            continueUrl: f.config.settings.redirect_url,
        };
    }

    /** Borra las respuestas sin confirmar que vencieron, con sus archivos. */
    async sweepExpiredPending(now = new Date()): Promise<number> {
        const doomed = await this.db
            .delete(formPendingSubmissions)
            .where(
                inArray(
                    formPendingSubmissions.id,
                    this.db
                        .select({ id: formPendingSubmissions.id })
                        .from(formPendingSubmissions)
                        .where(lt(formPendingSubmissions.expiresAt, now))
                        .limit(200),
                ),
            )
            .returning();
        for (const p of doomed) await this.discardFiles(p);
        return doomed.length;
    }

    private async discardFiles(p: Pick<FormPendingRow, 'tenantId' | 'attachmentIds'>): Promise<void> {
        for (const id of p.attachmentIds ?? []) {
            if (Number.isInteger(id) && id > 0) await this.files.remove(p.tenantId, id).catch(() => undefined);
        }
    }

    /** Formulario por id (el de una respuesta pendiente), con el estado de su empresa. */
    private async resolveById(formId: number): Promise<ResolvedForm | null> {
        const [hit] = await this.db.select({ token: forms.token }).from(forms).where(eq(forms.id, formId)).limit(1);
        if (!hit) return null;
        try {
            return await this.resolve(hit.token, { allowDisabled: true });
        } catch {
            return null;
        }
    }

    private noticeBrand(f: ResolvedForm): NonNullable<ConfirmOutcome['brand']> {
        const parsed = brandingSchema.safeParse(f.tenantSettings.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return {
            company: b.app_name || f.tenantName,
            accent: f.config.settings.accent_color ?? b.primary_color ?? '#0e7490',
            logoUrl: b.logo_file_id !== null ? this.files.signedUrl(f.row.tenantId, b.logo_file_id, 3600) : null,
        };
    }

    /** La marca de la empresa para los correos (logo por URL absoluta firmada). */
    private async emailBrand(f: ResolvedForm, base: string): Promise<PortalEmailBrand> {
        const parsed = brandingSchema.safeParse(f.tenantSettings.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return {
            name: b.app_name ?? f.tenantName,
            color: f.config.settings.accent_color ?? b.primary_color,
            logoUrl: b.logo_file_id !== null ? `${base}${this.files.signedUrl(f.row.tenantId, b.logo_file_id, 30 * 24 * 3600)}` : null,
        };
    }

    /** Freno a los correos hacia quien responde (por dirección y por IP). */
    private async allowRespondentMail(email: string, ip: string): Promise<boolean> {
        const now = Math.floor(Date.now() / 1000);
        for (const { scope, window, max } of RESPONDENT_MAIL_LIMITS) {
            const who = scope === 'email' ? `email:${email.toLowerCase()}` : `ip:${ip}`;
            const key = `formmail:${window}:${Math.floor(now / window)}:${who}`;
            try {
                const res = await this.redis.multi().incr(key).expire(key, window).exec();
                if (Number(res?.[0]?.[1] ?? 0) > max) return false;
            } catch {
                return true;
            }
        }
        return true;
    }

    /**
     * Copia de las respuestas a quien respondió. No demora la respuesta del
     * envío ni la tumba si el correo falla: es una cortesía.
     */
    private sendCopyLater(f: ResolvedForm, fields: Field[], data: Record<string, unknown>, email: string, ip: string): void {
        void this.sendCopy(f, fields, data, email, ip).catch((err: unknown) =>
            this.logger.warn(`Formulario ${f.row.id}: la copia a ${maskEmail(email)} no salió: ${err instanceof Error ? err.message : String(err)}`),
        );
    }

    private async sendCopy(f: ResolvedForm, fields: Field[], data: Record<string, unknown>, email: string, ip: string): Promise<boolean> {
        if (!this.mail) return false;
        if (!(await this.allowRespondentMail(email, ip))) return false;
        const answers = await this.answerLines(f, fields, data);
        const base = (await this.publicBase(f.row.tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, '');
        const brand = await this.emailBrand(f, base);
        const message = formCopyEmail(brand, { formTitle: f.config.settings.title || f.row.name, answers });
        await this.mail.sendNow({
            tenantId: f.row.tenantId,
            to: email,
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
        });
        return true;
    }

    /** Las respuestas como las lee una persona: la pregunta y el valor legible (etiquetas, Sí/No, formato de la empresa). */
    private async answerLines(f: ResolvedForm, fields: Field[], data: Record<string, unknown>): Promise<FormAnswerLine[]> {
        const byId = new Map(fields.map((x) => [x.id, x]));
        const format = tenantFormatSchema.safeParse(f.tenantSettings.format ?? {});
        const fmt = { ...(format.success ? format.data : tenantFormatSchema.parse({})), timezone: f.timeZone };
        // Los archivos se muestran por su nombre (una sola consulta).
        const fileIds = f.config.items.flatMap((i) => {
            if (i.type !== 'field' || byId.get(i.field_id)?.type !== 'file') return [];
            const v = data[jsonbKeyForField(i.field_id)];
            return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
        });
        const names = new Map<number, string>();
        if (fileIds.length > 0) {
            const rows = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
                tx
                    .select({ id: attachments.id, title: attachments.filename })
                    .from(attachments)
                    .where(and(eq(attachments.tenantId, f.row.tenantId), inArray(attachments.id, fileIds))),
            );
            for (const r of rows) names.set(r.id, r.title);
        }
        const out: FormAnswerLine[] = [];
        for (const item of f.config.items) {
            if (item.type !== 'field' || item.hidden) continue;
            const field = byId.get(item.field_id);
            if (!field) continue;
            const key = jsonbKeyForField(field.id);
            if (!(key in data)) continue;
            const value = data[key];
            const answer =
                field.type === 'file'
                    ? (Array.isArray(value) ? value : []).map((id) => names.get(Number(id)) ?? 'archivo').join(', ')
                    : formatEmailFieldValue(field, value, fmt);
            out.push({ question: item.label.trim() || field.label, answer });
        }
        return out;
    }

    private checkStamp(formId: number, stamp: string, opts: { minFill?: boolean } = {}): void {
        const [tsRaw, sig] = (stamp ?? '').split('.');
        const ts = Number(tsRaw);
        if (!sig || !Number.isFinite(ts) || !this.files.verifyParts(sig, 'formstamp', formId, ts)) {
            throw badRequest('form_stale', 'La página del formulario venció: recárgala y vuelve a enviar.');
        }
        const age = Date.now() - ts;
        if (age > STAMP_TTL_MS) throw badRequest('form_stale', 'La página del formulario venció: recárgala y vuelve a enviar.');
        if (opts.minFill !== false && age < MIN_FILL_MS) throw badRequest('form_too_fast', 'Espera un momento y vuelve a enviar.');
    }

    /** Reserva un lugar del cupo (o sólo cuenta, si no hay cupo). false = lleno. */
    private async reserveSlot(f: ResolvedForm): Promise<boolean> {
        const max = f.config.settings.max_submissions;
        const rows = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
            tx
                .update(forms)
                .set({ submissionsCount: sql`${forms.submissionsCount} + 1`, lastSubmittedAt: new Date() })
                .where(
                    and(
                        eq(forms.tenantId, f.row.tenantId),
                        eq(forms.id, f.row.id),
                        ...(max !== null ? [sql`${forms.submissionsCount} < ${max}`] : []),
                    ),
                )
                .returning({ id: forms.id }),
        );
        return rows.length > 0;
    }

    /** Devuelve el lugar reservado cuando el registro no se pudo crear. */
    private async releaseSlot(f: ResolvedForm): Promise<void> {
        await this.tenantDb
            .withTenant(f.row.tenantId, (tx) =>
                tx
                    .update(forms)
                    .set({ submissionsCount: sql`greatest(${forms.submissionsCount} - 1, 0)` })
                    .where(and(eq(forms.tenantId, f.row.tenantId), eq(forms.id, f.row.id))),
            )
            .catch(() => undefined);
    }

    /** Presupuesto de bytes por IP y por formulario (Redis caído → no frena). */
    private async enforceBytes(formId: number, ip: string): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        for (const { scope, window, max } of UPLOAD_BYTE_LIMITS) {
            const who = scope === 'ip' ? `ip:${ip}:${formId}` : `form:${formId}`;
            const key = `formrl:bytes:${window}:${Math.floor(now / window)}:${who}`;
            let used = 0;
            try {
                used = Number((await this.redis.get(key)) ?? 0);
            } catch {
                return;
            }
            if (used >= max) {
                throw new HttpException(
                    {
                        code: 'rate_limited',
                        message: 'Se subieron demasiados archivos en poco tiempo. Espera un rato y vuelve a intentar.',
                        data: { status: 429 },
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
    }

    private async addBytes(formId: number, ip: string, bytes: number): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        for (const { scope, window } of UPLOAD_BYTE_LIMITS) {
            const who = scope === 'ip' ? `ip:${ip}:${formId}` : `form:${formId}`;
            const key = `formrl:bytes:${window}:${Math.floor(now / window)}:${who}`;
            await this.redis
                .multi()
                .incrby(key, Math.max(0, Math.trunc(bytes)))
                .expire(key, window)
                .exec()
                .catch(() => undefined);
        }
    }

    /**
     * Arma `data` SÓLO con las preguntas del formulario que están a la vista
     * con estas respuestas: una clave que no es del formulario, o de una
     * pregunta escondida por su condición, se ignora — un visitante no
     * puede escribir columnas que el formulario no pregunta.
     */
    private collect(
        f: ResolvedForm,
        byId: Map<number, Field>,
        input: SubmitFormInput,
    ): { data: Record<string, unknown>; errors: Record<string, string>; attachmentIds: number[] } {
        const items = f.config.items;
        const values = input.values;
        const data: Record<string, unknown> = {};
        const errors: Record<string, string> = {};
        const attachmentIds: number[] = [];
        for (const item of items) {
            if (item.type !== 'field') continue;
            const field = byId.get(item.field_id);
            if (!field || !isFormFieldType(field.type)) continue;
            const key = String(field.id);
            if (!item.hidden && !formItemVisible(item, items, values)) continue;
            if (item.hidden && !f.config.settings.allow_prefill) continue;

            let raw: unknown = values[key];
            if (field.type === 'file') {
                const tokens = input.uploads[key] ?? [];
                const ids: number[] = [];
                for (const t of tokens.slice(0, MAX_FILES_PER_FIELD)) {
                    const id = this.verifyUpload(f, t);
                    if (id === null) {
                        errors[item.id] = 'Uno de los archivos venció: vuelve a subirlo.';
                        break;
                    }
                    ids.push(id);
                }
                raw = ids.length > 0 ? ids : null;
                attachmentIds.push(...ids);
            }
            const required = (item.required || field.is_required) && !item.hidden;
            if (required && isEmptyAnswer(raw)) {
                errors[item.id] = 'Esta pregunta es obligatoria.';
                continue;
            }
            if (isEmptyAnswer(raw) && field.type !== 'checkbox') continue;
            const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, raw);
            if (!res.ok) {
                // Un campo oculto con un valor de la dirección que no sirve no
                // es culpa del visitante: se descarta en silencio.
                if (!item.hidden) errors[item.id] = res.error;
                continue;
            }
            data[jsonbKeyForField(field.id)] = res.value;
        }
        return { data, errors, attachmentIds };
    }

    private verifyUpload(f: ResolvedForm, token: string): number | null {
        const [idRaw, expRaw, sig] = token.split('.');
        const id = Number(idRaw);
        const exp = Number(expRaw);
        if (!sig || !Number.isInteger(id) || !Number.isInteger(exp)) return null;
        if (exp < Math.floor(Date.now() / 1000)) return null;
        return this.files.verifyParts(sig, 'formupload', f.row.tenantId, f.row.id, id, exp) ? id : null;
    }

    /** Ventanas fijas en Redis, por IP y por formulario. Redis caído → no frena. */
    private async enforce(
        limits: ReadonlyArray<{ scope: 'ip' | 'form'; window: number; max: number }>,
        formId: number,
        ip: string,
        what: string,
    ): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        for (const { scope, window, max } of limits) {
            const who = scope === 'ip' ? `ip:${ip}:${formId}` : `form:${formId}`;
            const key = `formrl:${what}:${window}:${Math.floor(now / window)}:${who}`;
            let count: number;
            try {
                const res = await this.redis.multi().incr(key).expire(key, window).exec();
                count = Number(res?.[0]?.[1] ?? 0);
            } catch {
                return;
            }
            if (count > max) {
                throw new HttpException(
                    {
                        code: 'rate_limited',
                        message: 'Recibimos demasiados envíos seguidos. Espera un momento y vuelve a intentar.',
                        data: { status: 429 },
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
    }

    /** Borra los archivos subidos a formularios que nadie llegó a enviar. */
    async sweepOrphanUploads(now = Date.now()): Promise<number> {
        const due = await this.redis.zrangebyscore(PENDING_UPLOADS_KEY, 0, now, 'LIMIT', 0, 200);
        let removed = 0;
        for (const member of due) {
            // Sólo el nodo que lo saca de la cola lo borra.
            if ((await this.redis.zrem(PENDING_UPLOADS_KEY, member)) !== 1) continue;
            const [tenantRaw, idRaw] = member.split(':');
            const tenantId = Number(tenantRaw);
            const id = Number(idRaw);
            if (!Number.isInteger(tenantId) || !Number.isInteger(id)) continue;
            await this.files.remove(tenantId, id).catch(() => undefined);
            removed++;
        }
        return removed;
    }
}

function newToken(): string {
    return randomBytes(18).toString('base64url');
}

function readConfig(raw: unknown): FormConfig {
    const parsed = formConfigSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : formConfigSchema.parse({});
}

/**
 * Deja en el diseño sólo preguntas sobre campos que existen en ESTA lista y
 * se pueden preguntar, una vez cada uno, y condiciones que apuntan a un
 * campo del formulario. Un campo borrado o convertido a un tipo que no se
 * pregunta desaparece del formulario en vez de romperlo.
 */
export function sanitizeConfig(config: FormConfig, fields: ReadonlyArray<{ id: number; type: string }>): FormConfig {
    const askable = new Set(fields.filter((f) => isFormFieldType(f.type)).map((f) => f.id));
    const typeOf = new Map(fields.map((f) => [f.id, f.type]));
    const seen = new Set<number>();
    const items = config.items.filter((i) => {
        if (i.type !== 'field') return true;
        if (!askable.has(i.field_id) || seen.has(i.field_id)) return false;
        seen.add(i.field_id);
        return true;
    });
    const inForm = new Set(items.flatMap((i) => (i.type === 'field' ? [i.field_id] : [])));
    const seenIds = new Set<string>();
    const unique = items.filter((i) => (seenIds.has(i.id) ? false : (seenIds.add(i.id), true)));

    // v0.1.290 — el correo de quien responde: una pregunta de tipo email que
    // esté en el formulario. Sin ella, ni confirmación ni copia.
    const s = config.settings;
    const emailId =
        s.respondent_email_field_id !== null && inForm.has(s.respondent_email_field_id) && typeOf.get(s.respondent_email_field_id) === 'email'
            ? s.respondent_email_field_id
            : null;
    const confirm = s.confirm_email && emailId !== null;
    const settings = {
        ...s,
        respondent_email_field_id: emailId,
        confirm_email: confirm,
        send_copy: s.send_copy && emailId !== null,
    };

    return formConfigSchema.parse({
        settings,
        items: unique.map((i) => {
            // Un salto de página nunca tiene condición propia.
            if (i.type === 'page_break') return { ...i, show_if: null };
            let out = i.show_if && !inForm.has(i.show_if.field_id) ? { ...i, show_if: null } : i;
            // Doble opt-in: sin el correo no hay a quién pedirle la confirmación,
            // así que esa pregunta queda obligatoria, visible y sin condición
            // (si no, la respuesta no podría guardarse nunca).
            if (confirm && out.type === 'field' && out.field_id === emailId) {
                out = { ...out, required: true, hidden: false, show_if: null };
            }
            return out;
        }),
    });
}

/** Errores del alta (por slug) → la pregunta del formulario que los causó. */
function mapRecordErrors(config: FormConfig, fields: Field[], errors: Record<string, string>): Record<string, string> {
    const bySlug = new Map(fields.map((f) => [f.slug, f.id]));
    const out: Record<string, string> = {};
    for (const [slug, msg] of Object.entries(errors)) {
        const fieldId = bySlug.get(slug);
        const item = config.items.find((i) => i.type === 'field' && i.field_id === fieldId && !i.hidden);
        if (item) out[item.id] = msg;
    }
    return out;
}
