import { randomBytes } from 'node:crypto';
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
} from '@imagina-base/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { forms, tenants, type FormRow } from '../db/schema';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';

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

const notFound = () => new NotFoundException({ code: 'not_found', message: 'Este formulario no existe', data: { status: 404 } });

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400, ...extra } });
}

/** ¿El formulario ya pasó su fecha de cierre? (vale hasta el final de ese día). */
function pastCloseDate(closesAt: string | null, now = new Date()): boolean {
    if (!closesAt) return false;
    const end = Date.parse(`${closesAt}T23:59:59.999Z`);
    return Number.isFinite(end) && now.getTime() > end;
}

interface ResolvedForm {
    row: FormRow;
    config: FormConfig;
    readOnly: boolean;
    tenantSettings: Record<string, unknown>;
    tenantName: string;
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
    ) {}

    onModuleInit(): void {
        // Archivos subidos a un formulario que nunca se envió: no tienen que
        // quedar ocupando espacio. Cada nodo barre; ZREM decide quién borra.
        this.sweeper = setInterval(() => {
            this.sweepOrphanUploads().catch((err: unknown) => {
                this.logger.warn(`Barrido de archivos de formularios: ${String(err)}`);
            });
        }, 20 * 60 * 1000);
        this.sweeper.unref?.();
    }

    onModuleDestroy(): void {
        if (this.sweeper) clearInterval(this.sweeper);
    }

    // ─────────────────────────── Administración ───────────────────────────

    private toDto(row: FormRow): FormDto {
        return {
            id: row.id,
            list_id: row.listId,
            name: row.name,
            enabled: row.enabled,
            config: readConfig(row.config),
            public_path: `/api/v1/public/f/${row.token}`,
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
        return rows.map((r) => this.toDto(r));
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<FormDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return this.toDto(await this.load(tenantId, list.id, id));
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
        return this.toDto(row!);
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
        return this.toDto(row!);
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
    private async resolve(token: string): Promise<ResolvedForm> {
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
        if (!hit || !hit.form.enabled || hit.archivedAt !== null) throw notFound();
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
        };
    }

    /** null = recibe respuestas; si no, el motivo que ve el visitante. */
    private closedReason(f: ResolvedForm): string | null {
        const s = f.config.settings;
        if (f.readOnly) return s.closed_message;
        if (pastCloseDate(s.closes_at)) return s.closed_message;
        if (s.max_submissions !== null && f.row.submissionsCount >= s.max_submissions) return s.closed_message;
        return null;
    }

    /** CSP `frame-ancestors` de la página: los sitios que pueden insertarlo. */
    async pageInfo(token: string): Promise<{ title: string; allowed_domains: string[]; meta: PublicFormMeta } | null> {
        let f: ResolvedForm;
        try {
            f = await this.resolve(token);
        } catch {
            return null;
        }
        const meta = await this.buildMeta(f);
        return { title: meta.title || f.row.name, allowed_domains: f.config.settings.allowed_domains, meta };
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
        };
    }

    /** Sube UN archivo para un campo de archivos del formulario. */
    async upload(
        token: string,
        ip: string,
        part: { filename: string; mimetype: string; file: Readable & { truncated?: boolean } },
    ): Promise<{ token: string; name: string; size: number }> {
        const f = await this.resolve(token);
        if (this.closedReason(f)) throw new ForbiddenException({ code: 'form_closed', message: f.config.settings.closed_message, data: { status: 403 } });
        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const fileIds = new Set(fields.filter((x) => x.type === 'file').map((x) => x.id));
        if (!f.config.items.some((i) => i.type === 'field' && fileIds.has(i.field_id))) {
            throw badRequest('no_file_field', 'Este formulario no pide archivos.');
        }
        await this.enforce(UPLOAD_LIMITS, f.row.id, ip, 'archivos');
        const dto = await this.files.upload(f.row.tenantId, 0, part.filename || 'archivo', part.mimetype || 'application/octet-stream', part.file);
        if (part.file.truncated) {
            await this.files.remove(f.row.tenantId, dto.id).catch(() => undefined);
            throw badRequest('file_too_large', 'El archivo es demasiado grande.');
        }
        if (!dto.external && this.billing) {
            try {
                await this.billing.assertCanUpload(f.row.tenantId, 0);
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
        const { data, errors, attachmentIds } = this.collect(f, byId, input);
        if (Object.keys(errors).length > 0) {
            throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors });
        }

        let created;
        try {
            created = await this.records.create(f.row.tenantId, SYSTEM_ACTOR, String(f.row.listId), { data });
        } catch (err) {
            // Lo que el visitante puede corregir (un dato inválido) vuelve con
            // su motivo; lo demás —el plan lleno, un campo obligatorio de la
            // lista que el formulario no pregunta— es de la empresa, no de él.
            if (err instanceof HttpException && err.getStatus() === 400) {
                const body = err.getResponse() as { data?: { errors?: Record<string, string> } };
                const recErrors = body.data?.errors ?? {};
                const mapped = mapRecordErrors(f.config, fields, recErrors);
                if (Object.keys(mapped).length > 0) throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors: mapped });
            }
            this.logger.warn(`Formulario ${f.row.id}: no se pudo guardar la respuesta: ${err instanceof Error ? err.message : String(err)}`);
            throw new HttpException(
                {
                    code: 'form_unavailable',
                    message: 'No pudimos recibir tu respuesta en este momento. Prueba de nuevo más tarde.',
                    data: { status: 503 },
                },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }

        await this.tenantDb
            .withTenant(f.row.tenantId, (tx) =>
                tx
                    .update(forms)
                    .set({ submissionsCount: sql`${forms.submissionsCount} + 1`, lastSubmittedAt: new Date() })
                    .where(and(eq(forms.tenantId, f.row.tenantId), eq(forms.id, f.row.id))),
            )
            .catch(() => undefined);
        if (attachmentIds.length > 0) {
            await this.redis
                .zrem(PENDING_UPLOADS_KEY, ...attachmentIds.map((id) => `${f.row.tenantId}:${id}`))
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
        return { ok: true, redirect_url: f.config.settings.redirect_url };
    }

    private checkStamp(formId: number, stamp: string): void {
        const [tsRaw, sig] = stamp.split('.');
        const ts = Number(tsRaw);
        if (!sig || !Number.isFinite(ts) || !this.files.verifyParts(sig, 'formstamp', formId, ts)) {
            throw badRequest('form_stale', 'La página del formulario venció: recárgala y vuelve a enviar.');
        }
        const age = Date.now() - ts;
        if (age > STAMP_TTL_MS) throw badRequest('form_stale', 'La página del formulario venció: recárgala y vuelve a enviar.');
        if (age < MIN_FILL_MS) throw badRequest('form_too_fast', 'Espera un momento y vuelve a enviar.');
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
    return formConfigSchema.parse({
        settings: config.settings,
        items: unique.map((i) => (i.show_if && !inForm.has(i.show_if.field_id) ? { ...i, show_if: null } : i)),
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
