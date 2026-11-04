import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
    formEndingFor,
    formFlow,
    formRecallMap,
    formRecallText,
    formAnswerText,
    formatFormNumber,
    isFormConditionGroup,
    isFormCalcCondition,
    formCalcIsLive,
    formPaymentActive,
    formPaymentAmount,
    formCalcsForLogic,
    formCalcValues,
    withFormCalcValues,
    formEstimateMinutes,
    type FormCondition,
    FORM_JUMP_END,
    FORM_JUMP_ENDING_PREFIX,
    FORM_START_PAGE,
    type FormShowIf,
    isEmptyAnswer,
    isFormFieldType,
    effectiveFormDisplay,
    formAnswered,
    formRangeAccepts,
    formatRankingText,
    rankingTextOptions,
    FORM_MATRIX_ROW_TYPES,
    type PublicFormItem,
    jsonbKeyForField,
    tenantFormatSchema,
    validateFieldValue,
    type CreateFormInput,
    type Field,
    type FormConfig,
    type FormDto,
    type PublicFormMeta,
    type PublicFormOption,
    type SubmitFormInput,
    type SubmitFormResult,
    type PublicFormPaymentStatus,
    type UpdateFormInput,
    readMirrorListMarker,
    mirrorFromPlace,
    addDaysYmd,
    formatEmailFieldValue,
    formFileAllowed,
    resolveTimeZone,
    resolveTitleFieldId,
    zonedInstant,
    type FormFieldItem,
    buildPublicThemeCss,
    formConfigFileIds,
    publicThemeFileIds,
    publicThemePreloadFont,
    publicThemeView,
    readPublicTheme,
    readSavedPublicThemes,
    sanitizePublicCss,
    type PublicTheme,
    FORM_DRAFT_CODE_RE,
    FORM_DRAFT_MAX_BYTES,
    FORM_DRAFT_TTL_DAYS,
    type FormStatEventsInput,
    type FormStatsDto,
    type PublicFormDraft,
    type PublicFormEdit,
    type SaveFormDraftInput,
    type SaveFormDraftResult,
} from '@imagina-base/shared';
import { accessOf } from '../billing/tenant-access';
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { attachments, formDrafts, formPendingSubmissions, forms, lists, recordTemplates, records, tenants, type FormPendingRow, type FormRow, type PendingConsent } from '../db/schema';
import { listRowInScope, type AclSubject } from '../lists/list-acl';
import { configureFormEditRuntime, editLinkCode, editLinkUrl, parseEditCode, readEditLinks } from './form-edit-links';
import { RecordTemplatesService } from '../record-templates/record-templates.service';
import { DataConsentService, newWithdrawRef } from '../data-consent/data-consent.service';
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
import { TeamsService } from '../teams/teams.service';
import { CaptchaService } from './captcha.service';
import { formConfirmEmail, formCopyEmail, formDraftEmail, type FormAnswerLine } from './form-email';
import { FormStatsService, type FormStatsTarget } from './form-stats.service';
import { planModuleOff } from '../billing/plan-module-gate';
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { CollectionError, CollectionsService } from '../collections/collections.service';

/** v0.1.352 — Cuánto vale la página guardada de un formulario (y la de uno que no existe). */
const PAGE_CACHE_TTL_MS = 30_000;
const MISSING_CACHE_TTL_MS = 15_000;
const formCacheKey = (token: string): string => `form:${token}`;

/** Lo que necesita la página pública de un formulario (lo mismo para todas las visitas). */
export interface FormPageInfo {
    form_id: number;
    /** v0.1.358 — para las estadísticas (no viajan a la página). */
    tenant_id: number;
    time_zone: string;
    title: string;
    allowed_domains: string[];
    meta: PublicFormMeta;
    captcha: PublicFormMeta['captcha'];
    theme_css: string;
    body_classes: string[];
    preload_font: string | null;
}

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

/** v0.1.289 — el enlace para confirmar el correo vale 48 horas. */
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

/** v0.1.358 — A qué formulario y día suman las estadísticas. */
function statsTarget(f: ResolvedForm): FormStatsTarget {
    return { tenantId: f.row.tenantId, formId: f.row.id, timeZone: f.timeZone };
}

/**
 * v0.1.358 — Lo que se guarda de un avance: sólo las respuestas a preguntas
 * del formulario (no los archivos ni la firma: sus comprobantes vencen), y
 * sólo valores simples. Lo raro se descarta.
 */
function cleanDraftValues(config: FormConfig, fieldTypes: ReadonlyMap<number, string>, values: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set<number>();
    for (const i of config.items) {
        if (i.type === 'field') {
            if (fieldTypes.get(i.field_id) !== 'file' && i.display !== 'signature') allowed.add(i.field_id);
            if (i.other_field_id) allowed.add(i.other_field_id);
        } else if (i.type === 'matrix') {
            for (const r of i.rows) allowed.add(r.field_id);
        }
    }
    const simple = (v: unknown): boolean =>
        v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 10_000);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
        if (!allowed.has(Number(k))) continue;
        if (simple(v)) out[k] = v;
        else if (Array.isArray(v) && v.length <= 100 && v.every((x) => (typeof x === 'string' && x.length <= 500) || (typeof x === 'number' && Number.isFinite(x)))) out[k] = v;
    }
    return out;
}

/**
 * La autorización de tratamiento de datos (Ley 1581) aceptada con una
 * respuesta: qué versión del texto y desde dónde. Se registra como evidencia
 * ANTES de crear el registro (nunca hay datos guardados sin su prueba).
 */
interface AcceptedConsent {
    version: number;
    textHash: string;
    acceptedAt: Date;
    ip: string | null;
    userAgent: string | null;
    /** Enlace de retiro ya mandado por correo (respuesta confirmada por correo). */
    withdrawRef?: string | null;
}

/** Mensaje junto a la casilla cuando no se marcó. */
const CONSENT_REQUIRED_MESSAGE = 'Para enviar, acepta la autorización para el tratamiento de tus datos personales.';
/** Clave del error de la casilla (no choca con un id de ítem: esos no llevan «_»). */
export const CONSENT_ERROR_KEY = '__consent';

/** Resultado del enlace de confirmación (lo dibuja el controller con la marca). */
export interface ConfirmOutcome {
    status: 'confirmed' | 'invalid' | 'closed' | 'failed';
    title: string;
    message: string;
    brand: { company: string; accent: string; logoUrl: string | null; themeCss?: string; bodyClasses?: string[] } | null;
    continueUrl: string | null;
    /** v0.1.361 — Con cobro: el link para pagar (o por qué no se pudo armar). */
    payUrl?: string;
    payLabel?: string;
    /** El monto ya escrito con el formato de la empresa («150.000 COP»). */
    payAmountText?: string;
    payError?: string;
}

/** v0.1.351 — Las imágenes de un formulario se firman por un día (el vencimiento se redondea a la hora: el navegador las cachea). */
const FORM_IMAGE_TTL = 24 * 3600;
/** Tipos de imagen que un formulario puede mostrar (nada de SVG: puede llevar script). */
const FORM_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

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

/** v0.1.351 — Quién guarda (para el CSS propio, que es sólo de administradores). */
export interface FormActor {
    isAdmin: boolean;
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
        // v0.1.289 — verificación anti-robots y correos a quien responde.
        @Optional() private readonly captcha?: CaptchaService,
        @Optional() private readonly mail?: MailService,
        // Autorización de tratamiento de datos personales (Ley 1581).
        @Optional() private readonly dataConsent?: DataConsentService,
        // C6 — el registro de una respuesta puede salir de una plantilla.
        @Optional() private readonly recordTemplates?: RecordTemplatesService,
        // C1 — opciones de las preguntas «Equipo».
        @Optional() private readonly teams?: TeamsService,
        // v0.1.352 (ADR-S95) — la página pública se arma una vez y vale unos segundos.
        @Optional() cache?: PublicCacheService,
        // v0.1.358 — estadísticas (visitas, empezados, enviados…).
        @Optional() private readonly stats?: FormStatsService,
        // v0.1.361 — cobrar al enviar con la conexión de cobro de la empresa.
        @Optional() private readonly collections?: CollectionsService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    private readonly pcache: PublicCacheLike;

    /** C1 — Los equipos (id y nombre) sólo si el formulario pregunta un campo «Equipo». */
    private async teamOptions(tenantId: number, fields: ReadonlyArray<{ type: string }>): Promise<PublicFormOption[]> {
        if (!this.teams || !fields.some((f) => f.type === 'team')) return [];
        const infos = await this.tenantDb.withTenant(tenantId, (tx) => this.teams!.infos(tx, tenantId));
        return [...infos.values()]
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            .map((t) => ({ value: String(t.id), label: t.name }));
    }

    onModuleInit(): void {
        // v0.1.360 — el motor de automatizaciones arma `{{formulario.<id>.enlace}}` con esto.
        configureFormEditRuntime({
            sign: (tenantId, formId, recordId, exp, version) => this.editSig(tenantId, formId, recordId, exp, version),
            linkBase: async (tenantId) => (await this.publicBase(tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, ''),
        });
        // Archivos subidos a un formulario que nunca se envió: no tienen que
        // quedar ocupando espacio. Cada nodo barre; ZREM decide quién borra.
        // v0.1.289 — y las respuestas que nadie confirmó en 48 h (con sus archivos).
        this.sweeper = setInterval(() => {
            this.sweepOrphanUploads().catch((err: unknown) => {
                this.logger.warn(`Barrido de archivos de formularios: ${String(err)}`);
            });
            this.sweepExpiredPending().catch((err: unknown) => {
                this.logger.warn(`Barrido de respuestas sin confirmar: ${String(err)}`);
            });
            this.sweepExpiredDrafts().catch((err: unknown) => {
                this.logger.warn(`Barrido de avances guardados: ${String(err)}`);
            });
        }, 20 * 60 * 1000);
        this.sweeper.unref?.();
    }

    onModuleDestroy(): void {
        if (this.sweeper) clearInterval(this.sweeper);
        configureFormEditRuntime(null);
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

    async create(tenantId: number, userId: number, listIdOrSlug: string, input: CreateFormInput, actor: FormActor = { isAdmin: true }): Promise<FormDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const mirror = readMirrorListMarker(list.settings);
        if (mirror) {
            throw badRequest(
                'store_managed',
                `Esta lista viene ${mirrorFromPlace(mirror)}: los registros nuevos llegan desde ahí, no desde un formulario.`,
            );
        }
        const fields = await this.fields.listByListId(tenantId, list.id);
        const config = sanitizeConfig(input.config ?? defaultFormConfig(list.name, fields), fields);
        await this.assertTemplate(tenantId, list.id, config.settings.record_template_id);
        await this.assertPayment(tenantId, config);
        // v0.1.351 — un formulario nuevo nace con el tema por defecto de la empresa (si eligió uno).
        const def = await this.defaultTheme(tenantId);
        if (!config.settings.theme && def) config.settings.theme = def;
        await this.assertDesign(tenantId, config, def?.custom_css ?? '', actor);
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

    async update(tenantId: number, listIdOrSlug: string, id: number, input: UpdateFormInput, actor: FormActor = { isAdmin: true }): Promise<FormDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.load(tenantId, list.id, id);
        const patch: Partial<typeof forms.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.enabled !== undefined) {
            const mirror = input.enabled ? readMirrorListMarker(list.settings) : null;
            if (mirror) {
                throw badRequest('store_managed', `Esta lista viene ${mirrorFromPlace(mirror)}: no puede recibir respuestas de un formulario.`);
            }
            patch.enabled = input.enabled;
        }
        if (input.config !== undefined) {
            const fields = await this.fields.listByListId(tenantId, list.id);
            const clean = sanitizeConfig(input.config, fields);
            await this.assertTemplate(tenantId, list.id, clean.settings.record_template_id);
            await this.assertPayment(tenantId, clean);
            const prev = readPublicTheme(((current.config as Record<string, unknown>)?.settings as Record<string, unknown> | undefined)?.theme ?? {});
            await this.assertDesign(tenantId, clean, prev.custom_css, actor);
            patch.config = clean as unknown as Record<string, unknown>;
        }
        if (input.regenerate_token) patch.token = newToken();
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(forms).set(patch).where(and(eq(forms.tenantId, tenantId), eq(forms.id, current.id))).returning(),
        );
        this.forgetPage(current.token, row?.token);
        return this.toDto(row!, await this.publicBase(tenantId));
    }

    /**
     * v0.1.361 — La conexión con la que cobra el formulario tiene que ser una
     * conexión de cobro DEL EQUIPO de esta empresa (una privada es de una
     * persona; una de otra empresa, nunca). Wompi sólo cobra en pesos.
     */
    private async assertPayment(tenantId: number, config: FormConfig): Promise<void> {
        const pay = config.settings.payment;
        if (pay.connection_id === null) return;
        const team = this.collections ? await this.collections.teamConnections(tenantId) : [];
        const conn = team.find((c) => c.id === pay.connection_id);
        if (!conn) {
            throw badRequest('form_payment_connection', 'Elige una conexión de cobro del equipo (Mercado Pago o Wompi) en Ajustes → Integraciones.');
        }
        if (conn.provider === 'wompi') pay.currency = 'COP';
    }

    /**
     * v0.1.351 (ADR-S94) — El diseño que se guarda: (a) el CSS propio sólo lo
     * cambia un ADMIN — se acepta igual si es el que ya tenía o el de un tema
     * guardado de la empresa (aplicar un tema hecho por un admin lo puede
     * cualquiera) — y queda guardado ya limpio; (b) cada imagen (portada,
     * fondo, panel, ítems y opciones) tiene que ser un archivo de ESTA empresa
     * y una imagen que se muestra sin ejecutar nada (nada de SVG).
     */
    private async assertDesign(tenantId: number, config: FormConfig, previousCss: string, actor: FormActor): Promise<void> {
        const theme = config.settings.theme;
        if (theme) {
            const css = sanitizePublicCss(theme.custom_css).css;
            if (css !== sanitizePublicCss(previousCss).css && css !== '' && !actor.isAdmin) {
                const saved = await this.savedThemes(tenantId);
                if (!saved.some((t) => sanitizePublicCss(t.theme.custom_css).css === css)) {
                    throw new ForbiddenException({
                        code: 'custom_css_admin_only',
                        message: 'El CSS propio lo agrega un administrador de la empresa.',
                        data: { status: 403 },
                    });
                }
            }
            theme.custom_css = css;
        }
        const ids = [...new Set([...(theme ? publicThemeFileIds(theme) : []), ...formConfigFileIds(config)])];
        await this.assertImages(tenantId, ids);
    }

    /** Las imágenes tienen que ser archivos de la empresa y de un tipo que se muestra sin riesgo. */
    async assertImages(tenantId: number, ids: number[]): Promise<void> {
        if (ids.length === 0) return;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: attachments.id, mime: attachments.mime })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, ids))),
        );
        const ok = new Set(rows.filter((r) => FORM_IMAGE_MIMES.has(r.mime.toLowerCase())).map((r) => r.id));
        const bad = ids.filter((id) => !ok.has(id));
        if (bad.length > 0) {
            throw badRequest('invalid_image', 'Una de las imágenes no se puede usar: sube una imagen PNG, JPG, GIF o WebP.', { file_ids: bad });
        }
    }

    /** El tema con el que nacen los formularios nuevos (null = el clásico). */
    private async defaultTheme(tenantId: number): Promise<PublicTheme | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        );
        const st = (row?.settings ?? {}) as Record<string, unknown>;
        const id = typeof st.public_theme_default === 'string' ? st.public_theme_default : null;
        if (!id) return null;
        const hit = readSavedPublicThemes(st.public_themes).find((t) => t.id === id);
        return hit ? hit.theme : null;
    }

    /** Los temas guardados de la empresa (Ajustes del diseño → Mis temas). */
    private async savedThemes(tenantId: number) {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        );
        return readSavedPublicThemes((row?.settings as Record<string, unknown> | null)?.public_themes);
    }

    /** C6 — la plantilla elegida tiene que ser una plantilla de REGISTRO de esta lista. */
    private async assertTemplate(tenantId: number, listId: number, templateId: number | null | undefined): Promise<void> {
        if (templateId === null || templateId === undefined) return;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: recordTemplates.id })
                .from(recordTemplates)
                .where(
                    and(
                        eq(recordTemplates.tenantId, tenantId),
                        eq(recordTemplates.id, templateId),
                        eq(recordTemplates.listId, listId),
                        eq(recordTemplates.kind, 'record'),
                    ),
                )
                .limit(1),
        );
        if (!row) throw badRequest('template_not_found', 'La plantilla elegida no existe en esta lista.');
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number): Promise<{ name: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.load(tenantId, list.id, id);
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(forms).where(and(eq(forms.tenantId, tenantId), eq(forms.id, current.id))),
        );
        this.forgetPage(current.token);
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
                plan: tenants.plan,
                trialEndsAt: tenants.trialEndsAt,
                tenantSettings: tenants.settings,
                tenantName: tenants.name,
            })
            .from(forms)
            .innerJoin(tenants, eq(tenants.id, forms.tenantId))
            // Papelera: con la lista borrada el formulario no existe (404) y
            // vuelve al restaurarla. Conexión base: el filtro va a mano.
            .innerJoin(lists, and(eq(lists.id, forms.listId), isNull(lists.deletedAt)))
            .where(eq(forms.token, token))
            .limit(1);
        // v0.1.289 — una respuesta enviada mientras estaba publicado se puede
        // confirmar aunque después lo hayan despublicado (`allowDisabled`).
        if (!hit || (!hit.form.enabled && !opts.allowDisabled) || hit.archivedAt !== null) throw notFound();
        // v0.1.338 (ADR-S87) — plan sin «Formularios públicos»: el mismo 404 opaco
        // (el formulario se conserva y vuelve al cambiar de plan).
        if (await planModuleOff(this.db, hit.form.tenantId, 'forms')) throw notFound();
        return {
            row: hit.form,
            config: readConfig(hit.form.config),
            // v0.1.338 — pausada también cuenta (no tiene acceso completo).
            readOnly: accessOf(hit).state !== 'full',
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
     * v0.1.289, el proveedor de captcha cuyos dominios entran a la CSP.
     */
    async pageInfo(token: string): Promise<FormPageInfo | null> {
        let f: ResolvedForm;
        try {
            f = await this.resolve(token);
        } catch {
            return null;
        }
        // v0.1.352 — el sello anti-robots ya no viaja en la página (así se puede
        // guardar en caché): el visitante lo pide al empezar a completarla.
        const meta = { ...(await this.buildMeta(f)), stamp: '' };
        const look = this.themeLook(f);
        return {
            form_id: f.row.id,
            tenant_id: f.row.tenantId,
            time_zone: f.timeZone,
            title: meta.title || f.row.name,
            allowed_domains: f.config.settings.allowed_domains,
            meta,
            captcha: meta.captcha ?? null,
            theme_css: look.css,
            body_classes: look.classes,
            preload_font: look.preload,
        };
    }

    /**
     * v0.1.351 (ADR-S94) — El diseño de la página: el tema del formulario (o
     * el clásico), con el acento del formulario / la marca y sus imágenes
     * firmadas. El CSS propio sale ya limpio de `buildPublicThemeCss`.
     */
    private themeLook(f: ResolvedForm): { theme: PublicTheme; css: string; classes: string[]; preload: string | null } {
        const theme = readPublicTheme(f.config.settings.theme ?? {});
        const branding = brandingSchema.safeParse(f.tenantSettings.branding ?? {});
        const accent = f.config.settings.accent_color ?? (branding.success ? branding.data.primary_color : null) ?? '#0e7490';
        const sign = (id: number | null): string | null => (id === null ? null : this.files.signedUrl(f.row.tenantId, id, FORM_IMAGE_TTL));
        const css = buildPublicThemeCss(theme, {
            accent,
            images: {
                cover: sign(theme.cover.file_id),
                split: sign(theme.split.file_id),
                background: theme.background.kind === 'image' ? sign(theme.background.file_id) : null,
            },
        });
        return { theme, css, classes: publicThemeView(theme).classes, preload: publicThemePreloadFont(theme) };
    }

    /**
     * v0.1.352 (ADR-S95) — La página del formulario, guardada unos segundos:
     * una página con miles de visitas consulta la base una vez cada medio
     * minuto, no una por visita. Lo que no existe también se recuerda (menos
     * tiempo), así una dirección inventada no consulta en cada intento. Lanza
     * `PublicBusyError` si la fila de armados está llena.
     */
    cachedPageInfo(token: string): Promise<FormPageInfo | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Promise.resolve(null);
        return this.pcache.get(formCacheKey(token), PAGE_CACHE_TTL_MS, () => this.pageInfo(token), MISSING_CACHE_TTL_MS);
    }

    /**
     * Los datos del formulario en JSON, con un sello recién hecho. Lo fijo sale
     * de la caché; el sello se firma en el momento.
     */
    async meta(token: string): Promise<PublicFormMeta> {
        const info = await this.cachedPageInfo(token);
        if (!info) throw notFound();
        return { ...info.meta, stamp: this.newStamp(info.form_id) };
    }

    /**
     * v0.1.352 — El sello anti-robots, a pedido: el visitante lo pide cuando
     * empieza a completar el formulario (no al cargarlo), así la página se
     * guarda en caché y las visitas que sólo miran no llegan al servidor.
     */
    async stamp(token: string): Promise<{ stamp: string }> {
        const info = await this.cachedPageInfo(token);
        if (!info) throw notFound();
        return { stamp: this.newStamp(info.form_id) };
    }

    // ─────────────────── v0.1.358 — Estadísticas ───────────────────

    /**
     * Los eventos que manda la página (lo vi, empecé, llegué a un paso, me
     * fui). Sale de la caché de la página: una visita no consulta la base. Un
     * token desconocido no cuenta nada (y no se le dice nada a quien prueba).
     */
    async recordEvents(token: string, ip: string, input: FormStatEventsInput): Promise<void> {
        if (!this.stats) return;
        const info = await this.cachedPageInfo(token).catch(() => null);
        if (!info) return;
        await this.stats.record({ tenantId: info.tenant_id, formId: info.form_id, timeZone: info.time_zone }, ip, input.events);
    }

    /** Las estadísticas de un formulario para el equipo (últimos `days` días). */
    async statsFor(tenantId: number, listIdOrSlug: string, id: number, days: number): Promise<FormStatsDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.load(tenantId, list.id, id);
        const [tenant] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const timeZone = resolveTimeZone(((tenant?.settings as Record<string, unknown> | null)?.format as { timezone?: unknown } | undefined)?.timezone);
        if (!this.stats) {
            throw new HttpException({ code: 'stats_unavailable', message: 'Las estadísticas no están disponibles.', data: { status: 503 } }, HttpStatus.SERVICE_UNAVAILABLE);
        }
        const out = await this.stats.summary({ tenantId, formId: row.id, timeZone }, days);
        return { ...out, all_time_submits: row.submissionsCount };
    }

    // ─────────────────── v0.1.358 — Guardar el avance ───────────────────

    /**
     * «Guardar y seguir después»: guarda lo que la persona lleva y le manda
     * el enlace para volver. Con el código de un enlace que ya tenía, actualiza
     * ESE (sin otro correo). Exige el sello de la página (sin haberla cargado
     * no se guarda nada) y frena por correo y por IP como los demás correos a
     * quien responde.
     */
    async saveDraft(token: string, ip: string, input: SaveFormDraftInput): Promise<SaveFormDraftResult> {
        const f = await this.resolve(token);
        if (!f.config.settings.save_progress.email) {
            throw new ForbiddenException({ code: 'draft_disabled', message: 'Este formulario no guarda el avance.', data: { status: 403 } });
        }
        const closed = this.closedReason(f);
        if (closed) throw new ForbiddenException({ code: 'form_closed', message: closed, data: { status: 403 } });
        const expiresAt = new Date(Date.now() + FORM_DRAFT_TTL_DAYS * 86_400_000);
        // Robots: el campo trampa lleno se "acepta" sin guardar ni mandar nada.
        if (input.hp && input.hp.trim() !== '') {
            return { ok: true, code: randomBytes(32).toString('base64url'), email_sent: true, expires_at: expiresAt.toISOString() };
        }
        this.checkStamp(f.row.id, input.stamp, { minFill: false });
        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const values = cleanDraftValues(f.config, new Map(fields.map((x) => [x.id, x.type])), input.values);
        if (Buffer.byteLength(JSON.stringify(values)) > FORM_DRAFT_MAX_BYTES) {
            throw new HttpException(
                { code: 'draft_too_large', message: 'Hay demasiado texto para guardarlo. Envía el formulario o acorta alguna respuesta.', data: { status: 413 } },
                HttpStatus.PAYLOAD_TOO_LARGE,
            );
        }
        if (input.code && FORM_DRAFT_CODE_RE.test(input.code)) {
            const updated = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
                tx
                    .update(formDrafts)
                    .set({ values, page: input.page, expiresAt, updatedAt: new Date() })
                    .where(and(eq(formDrafts.tokenHash, hashToken(input.code!)), eq(formDrafts.formId, f.row.id), gt(formDrafts.expiresAt, new Date())))
                    .returning({ id: formDrafts.id }),
            );
            if (updated.length > 0) return { ok: true, code: input.code, email_sent: false, expires_at: expiresAt.toISOString() };
        }
        if (!this.mail) {
            throw new HttpException(
                { code: 'form_unavailable', message: 'No pudimos guardar tu avance en este momento. Prueba de nuevo más tarde.', data: { status: 503 } },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        if (!(await this.allowRespondentMail(input.email, ip))) {
            throw new HttpException(
                {
                    code: 'rate_limited',
                    message: 'Ya enviamos varios correos a esta dirección. Revisa tu bandeja (y la carpeta de spam) o prueba en un rato.',
                    data: { status: 429 },
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const code = randomBytes(32).toString('base64url');
        const [draft] = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
            tx
                .insert(formDrafts)
                .values({ tenantId: f.row.tenantId, formId: f.row.id, tokenHash: hashToken(code), email: input.email, values, page: input.page, expiresAt })
                .returning({ id: formDrafts.id }),
        );
        const base = (await this.publicBase(f.row.tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, '');
        const brand = await this.emailBrand(f, base);
        const message = formDraftEmail(brand, `${base}/api/v1/public/f/${f.row.token}?seguir=${code}`, {
            formTitle: f.config.settings.title || f.row.name,
            days: FORM_DRAFT_TTL_DAYS,
        });
        try {
            await this.mail.sendNow({
                tenantId: f.row.tenantId,
                to: input.email,
                subject: message.subject,
                text: message.text,
                html: message.html,
                ...(brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
            });
        } catch (err) {
            // Sin el correo el enlace no le llega a nadie: no se guarda.
            await this.tenantDb.withTenant(f.row.tenantId, (tx) => tx.delete(formDrafts).where(eq(formDrafts.id, draft!.id))).catch(() => undefined);
            this.logger.warn(`Formulario ${f.row.id}: el correo para seguir después no salió: ${err instanceof Error ? err.message : String(err)}`);
            throw new HttpException(
                { code: 'form_unavailable', message: 'No pudimos enviarte el correo. Prueba de nuevo más tarde.', data: { status: 503 } },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        return { ok: true, code, email_sent: true, expires_at: expiresAt.toISOString() };
    }

    /** El avance de un enlace «seguir después» (404 opaco si no existe, venció o es de otro formulario). */
    async loadDraft(token: string, code: string): Promise<PublicFormDraft> {
        if (!FORM_DRAFT_CODE_RE.test(code)) throw notFound();
        const f = await this.resolve(token);
        if (!f.config.settings.save_progress.email) throw notFound();
        const [row] = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
            tx
                .select({ values: formDrafts.values, page: formDrafts.page, expiresAt: formDrafts.expiresAt })
                .from(formDrafts)
                .where(and(eq(formDrafts.tokenHash, hashToken(code)), eq(formDrafts.formId, f.row.id), gt(formDrafts.expiresAt, new Date())))
                .limit(1),
        );
        if (!row) throw notFound();
        return { values: (row.values ?? {}) as Record<string, unknown>, page: row.page, expires_at: row.expiresAt.toISOString() };
    }

    /** Al enviar, el avance ya no hace falta (best-effort). */
    private async dropDraft(f: ResolvedForm, code: string): Promise<void> {
        if (!FORM_DRAFT_CODE_RE.test(code)) return;
        await this.tenantDb
            .withTenant(f.row.tenantId, (tx) => tx.delete(formDrafts).where(and(eq(formDrafts.tokenHash, hashToken(code)), eq(formDrafts.formId, f.row.id))))
            .catch(() => undefined);
    }

    // ─────────────── v0.1.360 — Actualizar un registro con el formulario ───────────────

    /** La firma de un enlace para actualizar (HMAC, recortada a 32 hexadecimales). */
    private editSig(tenantId: number, formId: number, recordId: number, exp: number, version: number): string {
        return this.files.signParts('formedit', tenantId, formId, recordId, exp, version).slice(0, 32);
    }

    /**
     * El registro de un código válido (firma de ESTE formulario y su versión
     * vigente, sin vencer) o null. La firma se compara en tiempo constante.
     */
    private verifyEdit(f: ResolvedForm, code: string): number | null {
        const parsed = parseEditCode(code);
        if (!parsed) return null;
        const want = this.editSig(f.row.tenantId, f.row.id, parsed.recordId, parsed.exp, f.config.settings.edit_links.version);
        const a = Buffer.from(parsed.sig, 'utf8');
        const b = Buffer.from(want, 'utf8');
        return a.length === b.length && timingSafeEqual(a, b) ? parsed.recordId : null;
    }

    /** Al actualizar no importa el cupo (no suma una respuesta); sí la fecha de cierre y el solo-lectura. */
    private editClosedReason(f: ResolvedForm): string | null {
        const s = f.config.settings;
        if (f.readOnly || pastCloseDate(s.closes_at, f.timeZone)) return s.closed_message;
        return null;
    }

    /** El registro a actualizar: de la lista del formulario y fuera de la papelera. */
    private async editableRecord(f: ResolvedForm, recordId: number): Promise<{ id: number; data: Record<string, unknown>; createdBy: number } | null> {
        const [row] = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
            tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, f.row.tenantId), eq(records.listId, f.row.listId), eq(records.id, recordId), isNull(records.deletedAt)))
                .limit(1),
        );
        return row ? { id: row.id, data: (row.data ?? {}) as Record<string, unknown>, createdBy: row.createdBy } : null;
    }

    /** Un enlace para actualizar que ya no sirve (vencido, de otra versión o roto). */
    private editExpired(): HttpException {
        return new HttpException(
            {
                code: 'form_edit_expired',
                message: 'Este enlace para actualizar tus datos ya no sirve. Pide uno nuevo a quien te lo envió.',
                data: { status: 410 },
            },
            HttpStatus.GONE,
        );
    }

    /**
     * Lo que la página necesita para actualizar un registro: lo que tiene hoy
     * en las preguntas del formulario (y el nombre de sus archivos). Sólo las
     * preguntas del formulario: nada más del registro sale de aquí.
     */
    async loadEdit(token: string, code: string): Promise<PublicFormEdit> {
        const f = await this.resolve(token);
        if (!f.config.settings.edit_links.enabled) throw notFound();
        const recordId = this.verifyEdit(f, code);
        if (recordId === null) throw this.editExpired();
        const closed = this.editClosedReason(f);
        if (closed) throw new ForbiddenException({ code: 'form_closed', message: closed, data: { status: 403 } });
        const rec = await this.editableRecord(f, recordId);
        if (!rec) throw this.editExpired();
        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const typeOf = new Map(fields.map((x) => [x.id, x.type]));
        const values: Record<string, unknown> = {};
        const fileIds = new Map<number, number[]>();
        const take = (fieldId: number): void => {
            const v = rec.data[jsonbKeyForField(fieldId)];
            if (v === undefined || v === null) return;
            if (typeOf.get(fieldId) === 'file') {
                const ids = (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, MAX_FILES_PER_FIELD);
                if (ids.length) fileIds.set(fieldId, ids);
                return;
            }
            values[String(fieldId)] = v;
        };
        for (const i of f.config.items) {
            if (i.type === 'field') {
                take(i.field_id);
                if (i.other_field_id) take(i.other_field_id);
            } else if (i.type === 'matrix') {
                for (const r of i.rows) take(r.field_id);
            }
        }
        const files: Record<string, string[]> = {};
        const allIds = [...fileIds.values()].flat();
        if (allIds.length) {
            const rows = await this.tenantDb.withTenant(f.row.tenantId, (tx) =>
                tx
                    .select({ id: attachments.id, title: attachments.filename })
                    .from(attachments)
                    .where(and(eq(attachments.tenantId, f.row.tenantId), inArray(attachments.id, allIds))),
            );
            const titleOf = new Map(rows.map((r) => [r.id, r.title]));
            for (const [fieldId, ids] of fileIds) {
                const names = ids.map((id) => titleOf.get(id)).filter((t): t is string => typeof t === 'string');
                if (names.length) files[String(fieldId)] = names;
            }
        }
        const exp = Number(code.split('.')[1]);
        return { values, files, expires_at: new Date(exp * 1000).toISOString() };
    }

    /**
     * Guarda los cambios de un enlace para actualizar: mismas reglas que un
     * envío (sello, campo trampa, frenos, la autorización de datos), pero
     * actualiza el registro del enlace con lo que preguntó el formulario. No
     * pide captcha (el enlace firmado ya es la credencial), no cuenta para el
     * cupo ni para las estadísticas, y no confirma por correo (el enlace llegó
     * al correo de la persona).
     */
    private async submitEdit(f: ResolvedForm, ip: string, input: SubmitFormInput, meta: { userAgent?: string | null }): Promise<SubmitFormResult> {
        if (!f.config.settings.edit_links.enabled) throw notFound();
        const recordId = this.verifyEdit(f, input.edit ?? '');
        if (recordId === null) throw this.editExpired();
        const closed = this.editClosedReason(f);
        if (closed) throw new ForbiddenException({ code: 'form_closed', message: closed, data: { status: 403 } });
        if (input.hp && input.hp.trim() !== '') return { ok: true, redirect_url: null, updated: true };
        this.checkStamp(f.row.id, input.stamp);
        await this.enforce(SUBMIT_LIMITS, f.row.id, ip, 'respuestas');
        const rec = await this.editableRecord(f, recordId);
        if (!rec) throw this.editExpired();

        const fields = await this.fields.listByListId(f.row.tenantId, f.row.listId);
        const byId = new Map(fields.map((x) => [x.id, x]));
        const { data, errors, attachmentIds, calcs } = this.collect(f, byId, input, { existing: rec.data });
        const consent = await this.consentFor(f);
        if (consent && input.consent !== true) errors[CONSENT_ERROR_KEY] = CONSENT_REQUIRED_MESSAGE;
        if (Object.keys(errors).length > 0) throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors });

        // Ley 1581 — la prueba se guarda antes que los cambios, ya atada al registro.
        let evidenceId: number | null = null;
        if (consent && this.dataConsent) {
            const version = await this.dataConsent.acceptedVersion(f.row.tenantId, input.consent_version, consent);
            const ev = await this.dataConsent.recordForm(f.row.tenantId, {
                version: version.version,
                textHash: version.textHash,
                formId: f.row.id,
                formName: f.config.settings.title || f.row.name,
                listId: f.row.listId,
                recordId: rec.id,
                ...(await this.subjectOf(f, fields, { ...rec.data, ...data })),
                acceptedAt: new Date(),
                ip: ip || null,
                userAgent: meta.userAgent ?? null,
            });
            evidenceId = ev.id;
        }

        try {
            if (Object.keys(data).length > 0) {
                await this.records.update(f.row.tenantId, SYSTEM_ACTOR, String(f.row.listId), rec.id, { data });
            }
        } catch (err) {
            if (evidenceId !== null && this.dataConsent) await this.dataConsent.discard(f.row.tenantId, evidenceId);
            if (err instanceof HttpException && err.getStatus() === 400) {
                const body = err.getResponse() as { data?: { errors?: Record<string, string> } };
                const mapped = mapRecordErrors(f.config, fields, body.data?.errors ?? {});
                if (Object.keys(mapped).length > 0) throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors: mapped });
            }
            this.logger.warn(`Formulario ${f.row.id}: no se pudieron guardar los cambios del registro ${rec.id}: ${err instanceof Error ? err.message : String(err)}`);
            throw new HttpException(
                { code: 'form_unavailable', message: 'No pudimos guardar tus cambios en este momento. Prueba de nuevo más tarde.', data: { status: 503 } },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        await this.claimUploads(f, attachmentIds);
        return { ok: true, redirect_url: null, updated: true, ...(Object.keys(calcs).length ? { calcs } : {}) };
    }

    /** Los archivos llegaron con su respuesta: dejan de ser «pendientes» y cuentan para el plan. */
    private async claimUploads(f: ResolvedForm, attachmentIds: number[]): Promise<void> {
        if (attachmentIds.length === 0) return;
        await this.redis.zrem(PENDING_UPLOADS_KEY, ...attachmentIds.map((id) => `${f.row.tenantId}:${id}`)).catch(() => undefined);
        await this.tenantDb
            .withTenant(f.row.tenantId, (tx) =>
                tx
                    .update(attachments)
                    .set({ pendingFormId: null })
                    .where(and(eq(attachments.tenantId, f.row.tenantId), inArray(attachments.id, attachmentIds))),
            )
            .catch(() => undefined);
    }

    /**
     * El enlace para que alguien actualice un registro con este formulario
     * (la ficha lo copia). Lo pide quien puede EDITAR ese registro: el enlace
     * deja cambiar lo que el formulario pregunta.
     */
    async createEditLink(tenantId: number, actor: AclSubject, listIdOrSlug: string, formId: number, recordId: number): Promise<{ url: string; expires_at: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.load(tenantId, list.id, formId);
        const config = readConfig(row.config);
        if (!row.enabled) {
            throw new HttpException(
                { code: 'form_not_published', message: 'Publica el formulario para poder mandar enlaces.', data: { status: 409 } },
                HttpStatus.CONFLICT,
            );
        }
        if (!config.settings.edit_links.enabled) {
            throw new HttpException(
                { code: 'form_edit_links_off', message: 'Activa «Enlaces para actualizar» en los ajustes del formulario.', data: { status: 409 } },
                HttpStatus.CONFLICT,
            );
        }
        const [rec] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, recordId), isNull(records.deletedAt)))
                .limit(1),
        );
        if (!rec || !listRowInScope(list.settings as Record<string, unknown>, actor, 'edit', { id: rec.id, createdBy: rec.createdBy, data: rec.data })) {
            throw new NotFoundException({ code: 'record_not_found', message: `Registro ${recordId} no encontrado`, data: { status: 404 } });
        }
        const { code, expiresAt } = editLinkCode((t, fid, rid, exp, v) => this.editSig(t, fid, rid, exp, v), tenantId, row.id, rec.id, config.settings.edit_links);
        const base = (await this.publicBase(tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, '');
        return { url: editLinkUrl(base, row.token, code), expires_at: expiresAt.toISOString() };
    }

    /** Los formularios publicados de la lista que aceptan enlaces para actualizar (para la ficha). */
    async editLinkForms(tenantId: number, listIdOrSlug: string): Promise<Array<{ id: number; name: string; title: string; days: number }>> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: forms.id, name: forms.name, config: forms.config })
                .from(forms)
                .where(and(eq(forms.tenantId, tenantId), eq(forms.listId, list.id), eq(forms.enabled, true)))
                .orderBy(asc(forms.id)),
        );
        const out: Array<{ id: number; name: string; title: string; days: number }> = [];
        for (const r of rows) {
            const links = readEditLinks(r.config);
            if (!links) continue;
            const title = readConfig(r.config).settings.title;
            out.push({ id: r.id, name: r.name, title: title || r.name, days: links.days });
        }
        return out;
    }

    /** Los avances vencidos se borran (conexión base, de a 500). */
    async sweepExpiredDrafts(now = new Date()): Promise<number> {
        const gone = await this.db
            .delete(formDrafts)
            .where(inArray(formDrafts.id, this.db.select({ id: formDrafts.id }).from(formDrafts).where(lt(formDrafts.expiresAt, now)).limit(500)))
            .returning({ id: formDrafts.id });
        return gone.length;
    }

    private newStamp(formId: number): string {
        const ts = Date.now();
        return `${ts}.${this.files.signParts('formstamp', formId, ts)}`;
    }

    /** Lo que cambió del formulario: la página guardada deja de valer en todos los servidores. */
    private forgetPage(...tokens: Array<string | null | undefined>): void {
        for (const t of tokens) if (t) this.pcache.invalidate(formCacheKey(t));
    }

    private async buildMeta(f: ResolvedForm): Promise<PublicFormMeta> {
        const { row, config } = f;
        const fields = await this.fields.listByListId(row.tenantId, row.listId);
        const branding = brandingSchema.safeParse(f.tenantSettings.branding ?? {});
        const b = branding.success ? branding.data : brandingSchema.parse({});
        const format = tenantFormatSchema.safeParse(f.tenantSettings.format ?? {});
        const keys = config.settings.captcha && this.captcha ? await this.captcha.resolve(row.tenantId, f.tenantSettings) : null;
        const consent = await this.consentFor(f);
        return {
            title: config.settings.title || row.name,
            description: config.settings.description,
            submit_label: config.settings.submit_label || 'Enviar',
            success_title: config.settings.success_title,
            success_message: config.settings.success_message,
            redirect_url: config.settings.redirect_url,
            allow_another: config.settings.allow_another,
            allow_prefill: config.settings.allow_prefill,
            accent_color: config.settings.theme?.colors.accent ?? config.settings.accent_color ?? b.primary_color ?? '#0e7490',
            logo_url:
                config.settings.show_logo && b.logo_file_id !== null
                    ? this.files.signedUrl(row.tenantId, b.logo_file_id, 3600)
                    : null,
            company: b.app_name || f.tenantName,
            number_format: format.success ? format.data.number_format : 'comma_dot',
            items: buildPublicFormItems(config, fields, await this.teamOptions(row.tenantId, fields), {
                imageUrl: (id) => this.files.signedUrl(row.tenantId, id, FORM_IMAGE_TTL),
            }),
            closed: this.closedReason(f),
            stamp: this.newStamp(row.id),
            max_upload_bytes: this.env.MAX_UPLOAD_BYTES,
            captcha: keys ? { provider: keys.provider, site_key: keys.siteKey } : null,
            confirm_email: config.settings.confirm_email,
            data_consent: consent ? DataConsentService.toPublic(consent) : null,
            theme: publicThemeView(readPublicTheme(config.settings.theme ?? {})),
            jumps: config.settings.jumps.map((j) => ({ from: j.from, when: j.when, to: j.to })),
            endings: config.settings.endings.map((e) => ({ id: e.id, title: e.title, message: e.message, redirect_url: e.redirect_url, when: e.when })),
            recall: formRecallMap(config, fields),
            layout: config.settings.layout,
            welcome: config.settings.welcome.enabled
                ? {
                      title: config.settings.welcome.title,
                      message: config.settings.welcome.message,
                      button_label: config.settings.welcome.button_label || 'Empezar',
                      image_url: config.settings.welcome.file_id !== null ? this.files.signedUrl(row.tenantId, config.settings.welcome.file_id, FORM_IMAGE_TTL) : null,
                      minutes: config.settings.welcome.show_time ? formEstimateMinutes(config) : null,
                  }
                : null,
            // v0.1.357 — lo que vale cada respuesta viaja sólo si la página lo
            // necesita mientras se responde; si no, el resultado llega al enviar.
            calcs: formCalcsForLogic(config).map((c, idx) => ({
                key: c.key,
                name: config.settings.calcs[idx]?.name ?? '',
                start: c.start,
                parts: formCalcIsLive(config, c.key) ? [...(c.parts ?? [])] : null,
            })),
            // v0.1.358 — guardar el avance (en el dispositivo / con un enlace al correo).
            save_progress:
                config.settings.save_progress.device || config.settings.save_progress.email ? { ...config.settings.save_progress } : null,
            // v0.1.360 — acepta enlaces para actualizar un registro (la página pide los datos aparte).
            edit_links: config.settings.edit_links.enabled ? { message: config.settings.edit_links.message } : null,
            // v0.1.361 — cobrar al enviar (de dónde sale el monto, para mostrar el total).
            payment: formPaymentActive(config)
                ? {
                      source: config.settings.payment.source,
                      amount: config.settings.payment.source === 'fixed' ? config.settings.payment.amount : null,
                      calc_key: config.settings.payment.source === 'calc' ? config.settings.payment.calc_key : null,
                      field_id: config.settings.payment.source === 'field' ? config.settings.payment.field_id : null,
                      min: config.settings.payment.source === 'field' ? config.settings.payment.min : null,
                      max: config.settings.payment.source === 'field' ? config.settings.payment.max : null,
                      currency: config.settings.payment.currency,
                      after: config.settings.payment.after,
                      button_label: config.settings.payment.button_label || 'Ir a pagar',
                  }
                : null,
        };
    }

    /**
     * La autorización de datos que pide ESTE formulario: la versión vigente de
     * la empresa, si la empresa la activó y el formulario no la apagó.
     */
    private async consentFor(f: ResolvedForm) {
        if (!this.dataConsent || !f.config.settings.data_consent) return null;
        return this.dataConsent.active(f.row.tenantId, f.tenantSettings);
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
    async submit(token: string, ip: string, input: SubmitFormInput, meta: { userAgent?: string | null } = {}): Promise<SubmitFormResult> {
        const f = await this.resolve(token);
        // v0.1.360 — con un enlace para actualizar, se actualiza ESE registro.
        if (input.edit) return this.submitEdit(f, ip, input, meta);
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
        // v0.1.289 — el servidor valida TODO el formulario, también las páginas
        // que el navegador pudo saltarse: las páginas son sólo cómo se muestra.
        const { data, errors, attachmentIds, endingId, calcs } = this.collect(f, byId, input);
        const s = f.config.settings;
        // v0.1.361 — cobrar al enviar: el monto lo decide el servidor.
        const payAmount = this.paymentAmountFor(f, data, calcs, errors);
        const emailKey = s.respondent_email_field_id !== null ? jsonbKeyForField(s.respondent_email_field_id) : null;
        const respondentEmail = emailKey && typeof data[emailKey] === 'string' ? (data[emailKey] as string) : null;
        // Doble opt-in: sin correo no hay a quién pedirle la confirmación.
        if (s.confirm_email && emailKey && !respondentEmail) {
            const item = f.config.items.find((i) => i.type === 'field' && i.field_id === s.respondent_email_field_id);
            if (item && !errors[item.id]) errors[item.id] = 'Necesitamos tu correo para confirmar la respuesta.';
        }
        // Ley 1581: sin la casilla marcada no se recibe nada. Lo decide el
        // servidor (la casilla del navegador es sólo la pantalla).
        const consent = await this.consentFor(f);
        if (consent && input.consent !== true) errors[CONSENT_ERROR_KEY] = CONSENT_REQUIRED_MESSAGE;
        if (Object.keys(errors).length > 0) {
            throw badRequest('form_invalid', 'Revisa las respuestas marcadas.', { errors });
        }

        // v0.1.289 — verificación anti-robots. Va DESPUÉS de revisar las
        // respuestas: un dato mal escrito no le quema el token a la persona.
        await this.checkCaptcha(f, input.captcha, ip);

        // La versión que la persona VIO (la página pudo cargarse antes de un
        // cambio del texto), con cuándo y desde dónde la aceptó.
        const accepted: AcceptedConsent | null =
            consent && this.dataConsent
                ? {
                      ...(await this.dataConsent.acceptedVersion(f.row.tenantId, input.consent_version, consent)),
                      acceptedAt: new Date(),
                      ip: ip || null,
                      userAgent: meta.userAgent ?? null,
                  }
                : null;

        let result: SubmitFormResult;
        if (s.confirm_email && respondentEmail) {
            result = await this.holdForConfirmation(f, data, attachmentIds, respondentEmail, ip, accepted, endingId);
        } else {
            const created = await this.finalize(f, fields, data, attachmentIds, accepted);
            if (s.send_copy && respondentEmail) this.sendCopyLater(f, fields, data, respondentEmail, ip, created.withdrawRef);
            result = { ok: true, redirect_url: this.endingRedirect(f, endingId), ending_id: endingId, ...(Object.keys(calcs).length ? { calcs } : {}) };
            if (payAmount > 0) Object.assign(result, await this.chargeFor(f, fields, created.id, data, payAmount, respondentEmail));
        }
        // v0.1.358 — cuenta para las estadísticas (y el avance guardado ya no hace falta).
        void this.stats?.recordSubmit(statsTarget(f), input.elapsed_ms);
        if (input.draft) void this.dropDraft(f, input.draft);
        return result;
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
        consent: AcceptedConsent | null = null,
    ): Promise<{ id: number; data: Record<string, unknown>; withdrawRef: string | null }> {
        // Cupo: se RESERVA el lugar antes de crear el registro con un UPDATE
        // condicional (antes se contaba y se sumaba después: dos envíos a la
        // vez pasaban los dos el último lugar).
        if (!(await this.reserveSlot(f))) {
            throw new ForbiddenException({ code: 'form_closed', message: f.config.settings.closed_message, data: { status: 403 } });
        }

        // Ley 1581 — la prueba de la autorización se guarda ANTES que los
        // datos: si después el registro no se puede crear, se descarta.
        let evidence: { id: number; withdrawRef: string | null } | null = null;
        if (consent && this.dataConsent) {
            try {
                evidence = await this.dataConsent.recordForm(f.row.tenantId, {
                    version: consent.version,
                    textHash: consent.textHash,
                    formId: f.row.id,
                    formName: f.config.settings.title || f.row.name,
                    listId: f.row.listId,
                    recordId: null,
                    ...(await this.subjectOf(f, fields, data)),
                    acceptedAt: consent.acceptedAt,
                    ip: consent.ip,
                    userAgent: consent.userAgent,
                    ...(consent.withdrawRef !== undefined ? { withdrawRef: consent.withdrawRef } : {}),
                });
            } catch (err) {
                await this.releaseSlot(f);
                this.logger.warn(`Formulario ${f.row.id}: no se pudo guardar la autorización de datos: ${err instanceof Error ? err.message : String(err)}`);
                throw new HttpException(
                    {
                        code: 'form_unavailable',
                        message: 'No pudimos recibir tu respuesta en este momento. Prueba de nuevo más tarde.',
                        data: { status: 503 },
                    },
                    HttpStatus.SERVICE_UNAVAILABLE,
                );
            }
        }

        let created: { id: number; data: Record<string, unknown> };
        try {
            // C6 — con plantilla, el registro nace con sus valores, subtareas y
            // checklists (lo que respondió la persona pisa la plantilla). Si la
            // plantilla ya no existe, alta normal: la respuesta no se pierde.
            const templateId = f.config.settings.record_template_id;
            created =
                templateId && this.recordTemplates
                    ? await this.recordTemplates
                          .createFromTemplate(f.row.tenantId, SYSTEM_ACTOR, String(f.row.listId), { template_id: templateId, data })
                          .then((r) => r.record)
                          .catch(async (err: unknown) => {
                              if ((err as { status?: number }).status === 404 && (err as { response?: { code?: string } }).response?.code === 'template_not_found') {
                                  this.logger.warn(`Formulario ${f.row.id}: la plantilla ${templateId} ya no existe; alta sin plantilla.`);
                                  return this.records.create(f.row.tenantId, SYSTEM_ACTOR, String(f.row.listId), { data });
                              }
                              throw err;
                          })
                    : await this.records.create(f.row.tenantId, SYSTEM_ACTOR, String(f.row.listId), { data });
        } catch (err) {
            await this.releaseSlot(f);
            if (evidence && this.dataConsent) await this.dataConsent.discard(f.row.tenantId, evidence.id);
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
        if (evidence && this.dataConsent) {
            const ev = evidence;
            await this.dataConsent.linkRecord(f.row.tenantId, ev.id, created.id).catch((err: unknown) =>
                this.logger.warn(`Formulario ${f.row.id}: la autorización ${ev.id} no quedó atada al registro: ${String(err)}`),
            );
        }
        await this.claimUploads(f, attachmentIds);
        this.dispatcher.dispatch({
            tenantId: f.row.tenantId,
            listId: f.row.listId,
            recordId: created.id,
            trigger: 'form_submitted',
            after: created.data,
            form: { id: f.row.id, name: f.row.name },
        });
        return { id: created.id, data: created.data, withdrawRef: evidence?.withdrawRef ?? null };
    }

    /**
     * Quién es el titular de una respuesta (snapshot para la evidencia): el
     * correo de quien responde (o la primera pregunta de correo) y el título
     * del registro.
     */
    private async subjectOf(f: ResolvedForm, fields: Field[], data: Record<string, unknown>): Promise<{ email: string | null; name: string | null }> {
        const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
        const s = f.config.settings;
        let email = s.respondent_email_field_id !== null ? str(data[jsonbKeyForField(s.respondent_email_field_id)]) : null;
        if (!email) {
            for (const field of fields) {
                if (field.type !== 'email') continue;
                email = str(data[jsonbKeyForField(field.id)]);
                if (email) break;
            }
        }
        let name: string | null = null;
        try {
            const list = await this.lists.get(f.row.tenantId, String(f.row.listId));
            const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
            if (titleId !== null) name = str(data[jsonbKeyForField(titleId)]);
        } catch {
            name = null;
        }
        return { email, name };
    }

    // ─────────────────── Captcha (v0.1.289) ───────────────────

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

    // ─────────────────── Confirmación del correo (v0.1.289) ───────────────────

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
        consent: AcceptedConsent | null = null,
        endingId: string | null = null,
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
        // La autorización aceptada al ENVIAR espera con la respuesta y se
        // registra al confirmar (con estos datos). Su enlace de retiro ya va
        // en el correo: retirarla antes de confirmar descarta la respuesta.
        const pendingConsent: PendingConsent | null = consent
            ? {
                  version: consent.version,
                  text_hash: consent.textHash,
                  accepted_at: consent.acceptedAt.toISOString(),
                  ip: consent.ip,
                  user_agent: consent.userAgent?.slice(0, 400) ?? null,
                  withdraw_ref: newWithdrawRef(),
              }
            : null;
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
                    consent: pendingConsent,
                    endingId,
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
            withdrawUrl:
                pendingConsent?.withdraw_ref && this.dataConsent
                    ? this.dataConsent.withdrawUrl(base, f.row.tenantId, pendingConsent.withdraw_ref)
                    : null,
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
        // La autorización se registra AHORA, con los datos del envío original.
        const pc = pending.consent ?? null;
        const accepted: AcceptedConsent | null = pc
            ? {
                  version: pc.version,
                  textHash: pc.text_hash,
                  acceptedAt: new Date(pc.accepted_at),
                  ip: pc.ip,
                  userAgent: pc.user_agent,
                  withdrawRef: pc.withdraw_ref,
              }
            : null;
        let withdrawRef: string | null = null;
        let createdId = 0;
        try {
            const created = await this.finalize(f, fields, pending.data, attachmentIds, accepted);
            withdrawRef = created.withdrawRef;
            createdId = created.id;
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
                    consent: pending.consent,
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
        if (f.config.settings.send_copy) this.sendCopyLater(f, fields, pending.data, pending.email, pending.ip ?? '', withdrawRef);
        // v0.1.356 — la pantalla final que le tocó al enviar, con sus respuestas recordadas.
        const ending = pending.endingId ? f.config.settings.endings.find((e) => e.id === pending.endingId) : undefined;
        const message = ending ? ending.message || ending.title : f.config.settings.success_message || 'Recibimos tu respuesta.';
        // v0.1.361 — con cobro, el link se arma al confirmar (sólo entonces existe el registro).
        const answers: Record<string, unknown> = Object.fromEntries(
            Object.entries(pending.data).filter(([k]) => /^f\d+$/.test(k)).map(([k, v]) => [k.slice(1), v]),
        );
        const calcs = formCalcValues(formCalcsForLogic(f.config), answers, (key) => key in answers);
        const payAmount = createdId ? this.paymentAmountFor(f, pending.data, calcs, {}) : 0;
        const charge = payAmount > 0 ? await this.chargeFor(f, fields, createdId, pending.data, payAmount, pending.email) : {};
        return {
            status: 'confirmed',
            title: '¡Listo! Tu respuesta quedó confirmada',
            message: this.recallServer(f, fields, pending.data, message),
            brand,
            continueUrl: this.endingRedirect(f, ending?.id ?? null),
            ...(charge.payment
                ? {
                      payUrl: charge.payment.url,
                      payLabel: charge.payment.button_label,
                      payAmountText: `${formatFormNumber(charge.payment.amount, this.numberFormatOf(f))} ${charge.payment.currency}`,
                  }
                : {}),
            ...(charge.payment_error ? { payError: charge.payment_error } : {}),
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

    /**
     * El titular retiró su autorización de datos ANTES de confirmar la
     * respuesta (enlace del correo): la respuesta se descarta con sus
     * archivos — sin autorización no se guarda nada.
     */
    async discardPending(tenantId: number, pendingId: number): Promise<void> {
        const gone = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .delete(formPendingSubmissions)
                .where(and(eq(formPendingSubmissions.tenantId, tenantId), eq(formPendingSubmissions.id, pendingId)))
                .returning(),
        );
        for (const p of gone) await this.discardFiles(p);
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
        const look = this.themeLook(f);
        return {
            company: b.app_name || f.tenantName,
            accent: f.config.settings.theme?.colors.accent ?? f.config.settings.accent_color ?? b.primary_color ?? '#0e7490',
            logoUrl: b.logo_file_id !== null ? this.files.signedUrl(f.row.tenantId, b.logo_file_id, 3600) : null,
            themeCss: look.css,
            bodyClasses: look.classes,
        };
    }

    /** La marca de la empresa para los correos (logo por URL absoluta firmada). */
    private async emailBrand(f: ResolvedForm, base: string): Promise<PortalEmailBrand> {
        const parsed = brandingSchema.safeParse(f.tenantSettings.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return {
            name: b.app_name ?? f.tenantName,
            color: f.config.settings.theme?.colors.accent ?? f.config.settings.accent_color ?? b.primary_color,
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
    private sendCopyLater(
        f: ResolvedForm,
        fields: Field[],
        data: Record<string, unknown>,
        email: string,
        ip: string,
        withdrawRef: string | null = null,
    ): void {
        void this.sendCopy(f, fields, data, email, ip, withdrawRef).catch((err: unknown) =>
            this.logger.warn(`Formulario ${f.row.id}: la copia a ${maskEmail(email)} no salió: ${err instanceof Error ? err.message : String(err)}`),
        );
    }

    private async sendCopy(
        f: ResolvedForm,
        fields: Field[],
        data: Record<string, unknown>,
        email: string,
        ip: string,
        withdrawRef: string | null = null,
    ): Promise<boolean> {
        if (!this.mail) return false;
        if (!(await this.allowRespondentMail(email, ip))) return false;
        const answers = await this.answerLines(f, fields, data);
        const base = (await this.publicBase(f.row.tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, '');
        const brand = await this.emailBrand(f, base);
        const message = formCopyEmail(brand, {
            formTitle: f.config.settings.title || f.row.name,
            answers,
            withdrawUrl: withdrawRef && this.dataConsent ? this.dataConsent.withdrawUrl(base, f.row.tenantId, withdrawRef) : null,
        });
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
        // Con cupo, la página guardada puede pasar a «cerrado»: que se vea ya.
        if (max !== null) this.forgetPage(f.row.token);
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
     *
     * v0.1.355 — Recorre las MISMAS preguntas públicas que ve el visitante
     * (`buildPublicFormItems`): la escala, el deslizador, el «Sí / No», el
     * ordenar, el «Otro» y la matriz se revisan con lo que se le mostró.
     */
    private collect(
        f: ResolvedForm,
        byId: Map<number, Field>,
        input: SubmitFormInput,
        /**
         * v0.1.360 — actualizar un registro: `existing` = lo que el registro
         * tiene hoy. Una pregunta que se mostró y quedó vacía BORRA el valor (la
         * persona lo vio y lo quitó); un archivo o firma sin subir otro se queda
         * como estaba; una pregunta oculta nunca se escribe (decide la lógica con
         * el valor del registro, no con el de la dirección); lo de una página que
         * no recorrió no se toca.
         */
        edit?: { existing: Record<string, unknown> },
    ): { data: Record<string, unknown>; errors: Record<string, string>; attachmentIds: number[]; endingId: string | null; calcs: Record<string, number> } {
        const pub = buildPublicFormItems(f.config, [...byId.values()]);
        // Una pregunta oculta sin «completar desde la dirección» no se guarda:
        // tampoco decide saltos, pantallas finales ni puntaje.
        const values: Record<string, unknown> = { ...input.values };
        if (edit) {
            for (const i of pub) {
                if (i.type !== 'field' || !i.hidden) continue;
                const cur = edit.existing[jsonbKeyForField(Number(i.key))];
                if (cur === undefined || cur === null) delete values[i.key];
                else values[i.key] = cur;
            }
        } else if (!f.config.settings.allow_prefill) for (const i of pub) if (i.type === 'field' && i.hidden) delete values[i.key];
        // v0.1.356 — el camino por las páginas (con los saltos): una pregunta de
        // una página que la persona no recorrió no se pide ni se guarda, aunque
        // el navegador mande lo que había escrito antes de cambiar de rumbo.
        // v0.1.357 — con los cálculos (un salto puede mirar el puntaje).
        const flow = formFlow(pub, values, f.config.settings.jumps, formCalcsForLogic(f.config));
        const data: Record<string, unknown> = {};
        const errors: Record<string, string> = {};
        const attachmentIds: number[] = [];
        const put = (field: Field, raw: unknown): string | null => {
            const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, raw);
            if (!res.ok) return res.error;
            data[jsonbKeyForField(field.id)] = res.value;
            return null;
        };
        const clear = (field: Field): void => {
            data[jsonbKeyForField(field.id)] = null;
        };
        for (const item of pub) {
            if (item.type === 'matrix') {
                if (!flow.shown(item.id)) continue;
                this.collectMatrix(item, byId, values, put, errors, edit ? clear : undefined);
                continue;
            }
            if (item.type !== 'field') continue;
            const field = byId.get(Number(item.key));
            if (!field || !isFormFieldType(field.type)) continue;
            const key = item.key;
            if (!item.hidden && !flow.shown(item.id)) continue;
            if (item.hidden && (edit || !f.config.settings.allow_prefill)) continue;

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
                // v0.1.360 — al actualizar, sin archivos nuevos quedan los que tenía.
                if (edit && ids.length === 0) {
                    if (item.required && !formAnswered(item.display, edit.existing[jsonbKeyForField(field.id)]) && !errors[item.id]) {
                        errors[item.id] = 'Esta pregunta es obligatoria.';
                    }
                    continue;
                }
            }
            // v0.1.355 — las formas propias se leen como las dibujó la página.
            if (item.display === 'yes_no') raw = raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null;
            if (item.required && !formAnswered(item.display, raw)) {
                errors[item.id] = 'Esta pregunta es obligatoria.';
                continue;
            }
            if (item.display === 'yes_no') {
                if (raw === null) {
                    if (edit) clear(field);
                    continue;
                }
            } else if (isEmptyAnswer(raw) && field.type !== 'checkbox') {
                if (edit) {
                    clear(field);
                    if (item.other) {
                        const target = byId.get(Number(item.other.key));
                        if (target) clear(target);
                    }
                }
                continue;
            }

            if ((item.display === 'scale' || item.display === 'slider') && item.range) {
                if (!formRangeAccepts(item.display, item.range, raw)) {
                    if (!item.hidden) errors[item.id] = item.display === 'scale' ? 'Elige uno de los valores de la escala.' : 'Ese valor está fuera del rango.';
                    continue;
                }
                raw = Number(raw);
            }
            if (item.display === 'ranking' && item.ranking) {
                const order = rankingOrder(raw, item.ranking.map((o) => o.value));
                if (!order) {
                    if (!item.hidden) errors[item.id] = 'Ordena todas las opciones.';
                    continue;
                }
                raw = field.type === 'multi_select' ? order : formatRankingText(order, field.type === 'long_text');
            }
            const err = put(field, raw);
            if (err) {
                // Un campo oculto con un valor de la dirección que no sirve no
                // es culpa del visitante: se descarta en silencio.
                if (!item.hidden) errors[item.id] = err;
                continue;
            }
            // v0.1.355 — «Otro»: lo que escribió va a su campo de texto, sólo si eligió esa opción.
            if (item.other) {
                const chosen = Array.isArray(raw) ? raw.map(String).includes(item.other.value) : String(raw) === item.other.value;
                const target = byId.get(Number(item.other.key));
                if (chosen && target) {
                    const text = values[item.other.key];
                    if (typeof text !== 'string' || text.trim() === '') errors[item.id] = 'Escribe cuál.';
                    else {
                        const otherErr = put(target, text.trim());
                        if (otherErr) errors[item.id] = otherErr;
                    }
                } else if (!chosen && target && edit) clear(target);
            }
        }
        // v0.1.357 — el resultado de cada cálculo, en su campo si se eligió uno.
        for (const c of f.config.settings.calcs) {
            if (c.save_field_id === null) continue;
            const target = byId.get(c.save_field_id);
            const v = flow.calcs[c.key];
            if (target && typeof v === 'number') put(target, v);
        }
        // v0.1.356 — la pantalla final que le toca (la decide el servidor con lo que aceptó).
        const ending = formEndingFor(f.config.settings.endings, pub, values, flow);
        return { data, errors, attachmentIds, endingId: ending?.id ?? null, calcs: flow.calcs };
    }

    /**
     * v0.1.356 — `{{nombre}}` en un texto que arma el servidor (la página de
     * confirmación): con lo que quedó guardado de la respuesta (claves `f{id}`).
     */
    private recallServer(f: ResolvedForm, fields: Field[], data: Record<string, unknown>, text: string): string {
        if (!text.includes('{{')) return text;
        const recall = formRecallMap(f.config, fields);
        const answers: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) if (/^f\d+$/.test(k)) answers[k.slice(1)] = v;
        // v0.1.357 — `{{puntaje}}`: lo que quedó guardado son justo las respuestas que contaron.
        const values = withFormCalcValues(answers, formCalcValues(formCalcsForLogic(f.config), answers, (key) => key in answers));
        const pub = buildPublicFormItems(f.config, fields);
        const fmt = tenantFormatSchema.safeParse(f.tenantSettings.format ?? {});
        const nf = fmt.success ? fmt.data.number_format : 'comma_dot';
        const fmtNum = (n: number): string => formatFormNumber(n, nf);
        return formRecallText(text, (slug) => (recall[slug] ? formAnswerText(pub, recall[slug]!, values, fmtNum) : ''));
    }

    /**
     * v0.1.361 — El monto a cobrar con lo que respondió la persona (0 = no se
     * cobra). Un monto escrito fuera del mínimo o el máximo es un error de la
     * pregunta, como cualquier otro.
     */
    private paymentAmountFor(f: ResolvedForm, data: Record<string, unknown>, calcs: Record<string, number>, errors: Record<string, string>): number {
        if (!formPaymentActive(f.config)) return 0;
        const p = f.config.settings.payment;
        const fieldValue = p.source === 'field' && p.field_id !== null ? data[jsonbKeyForField(p.field_id)] : undefined;
        const out = formPaymentAmount(p, { calcs, fieldValue });
        if ('error' in out) {
            const item = f.config.items.find((i) => i.type === 'field' && i.field_id === p.field_id);
            const nf = this.numberFormatOf(f);
            if (item && !errors[item.id]) {
                errors[item.id] =
                    out.error === 'below_min'
                        ? `El monto mínimo es ${formatFormNumber(p.min ?? 0, nf)}.`
                        : `El monto máximo es ${formatFormNumber(p.max ?? 0, nf)}.`;
            }
            return 0;
        }
        return out.amount;
    }

    /** El formato de números de la empresa (para los montos que se le escriben a la persona). */
    private numberFormatOf(f: ResolvedForm): 'comma_dot' | 'dot_comma' | 'space_comma' {
        const fmt = tenantFormatSchema.safeParse(f.tenantSettings.format ?? {});
        return fmt.success ? fmt.data.number_format : 'comma_dot';
    }

    /**
     * v0.1.361 — Arma el link de pago de una respuesta ya guardada. Si no se
     * puede (la conexión se borró, el proveedor no responde), la respuesta NO
     * se pierde: se le dice a la persona y se avisa a la empresa.
     */
    private async chargeFor(
        f: ResolvedForm,
        fields: Field[],
        recordId: number,
        data: Record<string, unknown>,
        amount: number,
        email: string | null,
    ): Promise<Pick<SubmitFormResult, 'payment' | 'payment_error'>> {
        const p = f.config.settings.payment;
        const incidentKey = `form-payment:${f.row.id}`;
        const fail = (reason: string): Pick<SubmitFormResult, 'payment_error'> => {
            this.incidents?.report({
                tenantId: f.row.tenantId,
                key: incidentKey,
                source: 'form',
                sourceId: f.row.id,
                listId: f.row.listId,
                ownerId: f.row.createdBy ?? null,
                title: `El formulario «${f.row.name}» no pudo armar el pago`,
                message: `Alguien envió el formulario y no se pudo crear su link de pago: ${reason} La respuesta quedó guardada; a la persona le dijimos que se pondrán en contacto.`,
            });
            return { payment_error: 'Recibimos tu respuesta, pero no pudimos preparar el pago en este momento. Te contactaremos para completarlo.' };
        };
        if (!this.collections || p.connection_id === null) return fail('el formulario no tiene una conexión de cobro.');
        const title = (this.recallServer(f, fields, data, p.title || f.config.settings.title || f.row.name).trim() || 'Pago').slice(0, 200);
        const base = (await this.publicBase(f.row.tenantId)) ?? this.env.APP_BASE_URL.replace(/\/+$/, '');
        const pagePath = `/api/v1/public/f/${f.row.token}`;
        try {
            const out = await this.collections.createForForm(f.row.tenantId, {
                formId: f.row.id,
                connectionId: p.connection_id,
                listId: f.row.listId,
                recordId,
                title,
                amount,
                currency: p.currency,
                payerEmail: email,
                expiresDays: p.expires_days,
                returnUrlFor: (ref) => `${base}${pagePath}?pago=${encodeURIComponent(ref)}`,
            });
            this.incidents?.resolve(f.row.tenantId, incidentKey);
            return {
                payment: {
                    url: out.url,
                    amount: out.amount,
                    currency: out.currency,
                    after: p.after,
                    button_label: p.button_label || 'Ir a pagar',
                },
            };
        } catch (err) {
            const reason = err instanceof CollectionError ? err.message : 'falló algo de nuestro lado.';
            if (!(err instanceof CollectionError)) this.logger.warn(`Formulario ${f.row.id}: link de pago: ${err instanceof Error ? err.message : String(err)}`);
            return fail(reason);
        }
    }

    /**
     * v0.1.361 — Cómo quedó el pago al volver del checkout (`?pago=<referencia>`).
     * Sólo de un link que armó ESTE formulario; desconocido = 404 opaco.
     */
    async paymentStatus(token: string, reference: string): Promise<PublicFormPaymentStatus> {
        const f = await this.resolve(token);
        if (!this.collections) throw notFound();
        const out = await this.collections.formPaymentStatus(f.row.tenantId, f.row.id, reference);
        if (!out) throw notFound();
        return out;
    }

    /** v0.1.356 — Adónde lleva una pantalla final (o el formulario, sin pantalla propia). */
    private endingRedirect(f: ResolvedForm, endingId: string | null): string | null {
        const e = endingId ? f.config.settings.endings.find((x) => x.id === endingId) : undefined;
        return e ? e.redirect_url : f.config.settings.redirect_url;
    }

    /** v0.1.355 — Una matriz: cada fila es un campo; sólo se aceptan las columnas que se mostraron. */
    private collectMatrix(
        item: Extract<PublicFormItem, { type: 'matrix' }>,
        byId: Map<number, Field>,
        values: Record<string, unknown>,
        put: (field: Field, raw: unknown) => string | null,
        errors: Record<string, string>,
        /** v0.1.360 — al actualizar, una fila sin respuesta borra su valor. */
        clear?: (field: Field) => void,
    ): void {
        let missing = false;
        for (const row of item.rows) {
            const field = byId.get(row.field_id);
            if (!field || !(FORM_MATRIX_ROW_TYPES as readonly string[]).includes(field.type)) continue;
            const raw = values[row.key];
            const allowed = row.values.filter((v): v is string | number => v !== null);
            if (isEmptyAnswer(raw)) {
                missing = true;
                clear?.(field);
                continue;
            }
            let picked: unknown;
            if (item.multiple) {
                const list = Array.isArray(raw) ? raw : [raw];
                const hits = list.map((v) => allowed.find((a) => String(a) === String(v)));
                if (hits.some((h) => h === undefined)) {
                    errors[item.id] = `${row.label}: esa respuesta no está en la tabla.`;
                    continue;
                }
                picked = hits;
            } else {
                const hit = allowed.find((a) => String(a) === String(raw));
                if (hit === undefined) {
                    errors[item.id] = `${row.label}: esa respuesta no está en la tabla.`;
                    continue;
                }
                picked = hit;
            }
            const err = put(field, picked);
            if (err) errors[item.id] = `${row.label}: ${err}`;
        }
        if (missing && item.required && !errors[item.id]) errors[item.id] = 'Responde todas las filas.';
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

/**
 * v0.1.355 — El orden que mandó el visitante, si es una permutación EXACTA de
 * las opciones (todas, una vez cada una). Si no, null.
 */
function rankingOrder(raw: unknown, options: readonly string[]): string[] | null {
    if (!Array.isArray(raw) || raw.length !== options.length) return null;
    const order = raw.map(String);
    if (new Set(order).size !== order.length) return null;
    return order.every((v) => options.includes(v)) ? order : null;
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
/** v0.1.357 — Tipos cuya respuesta se puede multiplicar en un cálculo (un número). */
const CALC_NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'rating', 'duration']);
/** v0.1.357 — Tipos de campo donde se puede guardar el resultado de un cálculo. */
const CALC_SAVE_TYPES = new Set(['number', 'currency', 'percent']);

/**
 * v0.1.361 — El monto del cobro sale de algo que existe en ESTE formulario: un
 * cálculo suyo o una pregunta de número o moneda que pregunta. Lo que no
 * existe se suelta (el cobro queda sin efecto hasta que se elija otra cosa).
 */
function cleanPayment(
    pay: FormConfig['settings']['payment'],
    inForm: ReadonlySet<number>,
    typeOf: ReadonlyMap<number, string>,
    calcKeys: ReadonlySet<string>,
): FormConfig['settings']['payment'] {
    const fieldOk = pay.field_id !== null && inForm.has(pay.field_id) && ['number', 'currency'].includes(typeOf.get(pay.field_id) ?? '');
    const min = pay.min;
    const max = pay.max;
    const swap = min !== null && max !== null && min > max;
    return {
        ...pay,
        calc_key: pay.calc_key !== null && calcKeys.has(pay.calc_key) ? pay.calc_key : null,
        field_id: fieldOk ? pay.field_id : null,
        min: swap ? max : min,
        max: swap ? min : max,
        title: pay.title.trim(),
        button_label: pay.button_label.trim(),
    };
}

export function sanitizeConfig(
    config: FormConfig,
    fields: ReadonlyArray<{ id: number; type: string; slug?: string; config?: Record<string, unknown> }>,
): FormConfig {
    const askable = new Set(fields.filter((f) => isFormFieldType(f.type)).map((f) => f.id));
    const typeOf = new Map(fields.map((f) => [f.id, f.type]));
    const fieldConfig = new Map(fields.map((f) => [f.id, f.config ?? {}]));
    // Cada campo se pregunta UNA vez: como pregunta o como fila de una matriz.
    const seen = new Set<number>();
    const firstPass = config.items.flatMap((i): FormConfig['items'] => {
        if (i.type === 'matrix') {
            const rows = i.rows.filter((r) => {
                const t = typeOf.get(r.field_id);
                if (!t || !askable.has(r.field_id) || !(FORM_MATRIX_ROW_TYPES as readonly string[]).includes(t) || seen.has(r.field_id)) return false;
                seen.add(r.field_id);
                return true;
            });
            const colSeen = new Set<string>();
            const columns = i.columns.filter((c) => (colSeen.has(c.value) ? false : (colSeen.add(c.value), true)));
            return [{ ...i, rows, columns }];
        }
        if (i.type !== 'field') return [i];
        if (!askable.has(i.field_id) || seen.has(i.field_id)) return [];
        seen.add(i.field_id);
        // v0.1.355 — una forma que el tipo no admite vuelve a la de siempre; la
        // firma sólo recibe imágenes.
        const type = typeOf.get(i.field_id) ?? '';
        const multiple = type === 'multi_select' || (type === 'team' && fieldConfig.get(i.field_id)?.multiple === true);
        const display = effectiveFormDisplay(i.display, type, multiple);
        return [
            {
                ...i,
                display,
                accept: display === 'signature' ? 'images' : i.accept,
                ranking_options: rankingTextOptions(i.ranking_options),
            },
        ];
    });
    // v0.1.355 — el campo donde va el «Otro» tiene que ser de texto, de esta
    // lista y no estar preguntado aparte (si no, se escribiría dos veces).
    const items = firstPass.map((i) => {
        if (i.type !== 'field' || i.other_field_id === null) return i;
        const t = typeOf.get(i.other_field_id);
        const ok =
            (typeOf.get(i.field_id) === 'select' || typeOf.get(i.field_id) === 'multi_select') &&
            i.other_option !== null &&
            (t === 'text' || t === 'long_text') &&
            !seen.has(i.other_field_id);
        if (!ok) return { ...i, other_field_id: null };
        seen.add(i.other_field_id);
        return i;
    });
    // Las condiciones pueden depender de una pregunta o de una fila de una matriz.
    const inForm = new Set(items.flatMap((i) => (i.type === 'field' ? [i.field_id] : i.type === 'matrix' ? i.rows.map((r) => r.field_id) : [])));
    const seenIds = new Set<string>();
    const unique = items.filter((i) => (seenIds.has(i.id) ? false : (seenIds.add(i.id), true)));

    // v0.1.289 — el correo de quien responde: una pregunta de tipo email que
    // esté en el formulario. Sin ella, ni confirmación ni copia.
    const s = config.settings;
    const emailId =
        s.respondent_email_field_id !== null && inForm.has(s.respondent_email_field_id) && typeOf.get(s.respondent_email_field_id) === 'email'
            ? s.respondent_email_field_id
            : null;
    const confirm = s.confirm_email && emailId !== null;

    // v0.1.356 — saltos y pantallas finales: sólo hacia páginas que existen y
    // están más adelante, con condiciones sobre preguntas del formulario.
    const pageOf = new Map<string, number>();
    let page = 0;
    const breaks: string[] = [];
    for (const i of unique) {
        if (i.type === 'page_break') {
            page++;
            breaks.push(i.id);
        }
        pageOf.set(i.id, page);
    }
    const pageIndex = (key: string): number => (key === FORM_START_PAGE ? 0 : breaks.indexOf(key) + 1);
    const emailItem = emailId !== null ? unique.find((i) => i.type === 'field' && i.field_id === emailId) : undefined;
    const emailPage = emailItem ? (pageOf.get(emailItem.id) ?? 0) : -1;
    // v0.1.357 — cálculos: nombre único que no choca con el de un campo (si
    // no, `{{nombre}}` sería ambiguo), cada parte sobre una pregunta del
    // formulario, el factor sólo en respuestas numéricas, y el resultado sólo
    // se guarda en un campo numérico que el formulario NO pregunta.
    const slugs = new Set(fields.map((f) => f.slug).filter((x): x is string => typeof x === 'string' && x !== ''));
    const calcKeys = new Set<string>();
    const calcIds = new Set<string>();
    const savedTo = new Set<number>();
    const calcs = s.calcs.flatMap((c) => {
        if (calcIds.has(c.id) || calcKeys.has(c.key) || slugs.has(c.key)) return [];
        calcIds.add(c.id);
        calcKeys.add(c.key);
        const partSeen = new Set<number>();
        const parts = c.parts
            .filter((p) => inForm.has(p.field_id) && (partSeen.has(p.field_id) ? false : (partSeen.add(p.field_id), true)))
            .map((p) => ({ ...p, multiplier: CALC_NUMERIC_TYPES.has(typeOf.get(p.field_id) ?? '') ? p.multiplier : null }));
        const sid = c.save_field_id;
        const save = sid !== null && CALC_SAVE_TYPES.has(typeOf.get(sid) ?? '') && !seen.has(sid) && !savedTo.has(sid) ? sid : null;
        if (save !== null) savedTo.add(save);
        return [{ ...c, parts, save_field_id: save }];
    });
    const endingIds = new Set<string>();
    const endings = s.endings
        .filter((e) => (endingIds.has(e.id) ? false : (endingIds.add(e.id), true)))
        .map((e) => ({ ...e, when: cleanShowIf(e.when, inForm, calcKeys) }));
    const jumpIds = new Set<string>();
    const jumps = s.jumps.filter((j) => {
        if (jumpIds.has(j.id)) return false;
        const from = pageIndex(j.from);
        if (from < 0 || (j.from !== FORM_START_PAGE && !breaks.includes(j.from))) return false;
        let to: number;
        if (j.to === FORM_JUMP_END) to = Infinity;
        else if (j.to.startsWith(FORM_JUMP_ENDING_PREFIX)) {
            if (!endingIds.has(j.to.slice(FORM_JUMP_ENDING_PREFIX.length))) return false;
            to = Infinity;
        } else {
            if (!breaks.includes(j.to)) return false;
            to = pageIndex(j.to);
            if (to <= from) return false;
        }
        // Una condición que dependía de preguntas que ya no están no se vuelve «siempre».
        if (j.when && cleanShowIf(j.when, inForm, calcKeys) === null) return false;
        // Con confirmación por correo, ningún salto puede saltarse la pregunta del correo.
        if (confirm && emailPage > from && to > emailPage) return false;
        jumpIds.add(j.id);
        return true;
    }).map((j) => ({ ...j, when: cleanShowIf(j.when, inForm, calcKeys) }));

    const settings = {
        ...s,
        respondent_email_field_id: emailId,
        confirm_email: confirm,
        send_copy: s.send_copy && emailId !== null,
        jumps,
        endings,
        calcs,
        payment: cleanPayment(s.payment, inForm, typeOf, calcKeys),
    };

    return formConfigSchema.parse({
        settings,
        items: unique.map((i) => {
            // Un salto de página nunca tiene condición propia.
            if (i.type === 'page_break') return { ...i, show_if: null };
            let out = { ...i, show_if: cleanShowIf(i.show_if, inForm) };
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

/**
 * v0.1.356 — Quita de una condición (o grupo) las reglas sobre campos que el
 * formulario ya no pregunta. Sin reglas, no queda condición.
 */
function cleanShowIf(c: FormShowIf | null, inForm: ReadonlySet<number>, calcKeys: ReadonlySet<string> = new Set()): FormShowIf | null {
    if (!c) return null;
    // v0.1.357 — una regla sobre un cálculo sólo vale en saltos y pantallas
    // finales (quien llama pasa los cálculos que existen; en «Mostrar sólo
    // si…» no pasa ninguno, así se quitan).
    const keep = (r: FormCondition): boolean => (isFormCalcCondition(r) ? calcKeys.has(r.calc) : inForm.has(r.field_id));
    if (!isFormConditionGroup(c)) return keep(c) ? c : null;
    const rules = c.rules.filter(keep);
    // Una sola regla se guarda suelta, igual que en el editor.
    return rules.length > 1 ? { match: c.match, rules } : (rules[0] ?? null);
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
