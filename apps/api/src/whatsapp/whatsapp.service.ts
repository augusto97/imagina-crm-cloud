import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
    WHATSAPP_DIRECTION_OPTIONS,
    WHATSAPP_FIELD_ROLES,
    WHATSAPP_FIELD_ROLE_META,
    WHATSAPP_STATUS_OPTIONS,
    buildWhatsappTemplateComponents,
    jsonbKeyForField,
    readWhatsappConnectionConfig,
    readWhatsappListFields,
    renderWhatsappTemplate,
    resolveTitleFieldId,
    suggestWhatsappFields,
    whatsappCountryOf,
    whatsappIdVariants,
    whatsappRecipient,
    whatsappStatusFromMeta,
    whatsappStatusWanted,
    waWebHookEventsFor,
    sameWaWebEvents,
    nextWhatsappStatus,
    whatsappTemplateManagerUrl,
    whatsappWindowClosesAt,
    whatsappWindowOpen,
    writeWhatsappListFields,
    validateFieldValue,
    isWhatsappProvider,
    type Field,
    type FieldType,
    type List,
    type UpdateWhatsappConfigInput,
    type WhatsappConnectionDetail,
    type WhatsappEventInfo,
    type WhatsappFieldRole,
    type WhatsappListColumns,
    type WhatsappListFields,
    type WhatsappRecordInfo,
    type WhatsappSendInput,
    type WhatsappSendResult,
    type WhatsappStatus,
    type WhatsappTemplate,
    type WhatsappTestSendInput,
    type WhatsappProvider,
    type WhatsappWebState,
    type Role,
} from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityService } from '../activity/activity.service';
import { AiFieldsService } from '../ai-fields/ai-fields.service';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { applyMergeTags, labelResolverFor, regionalFormatterFor, type LabelFieldLike } from '../automations/merge-tags';
import { recordLinkFor, recordTokenValue } from '../qr/qr-runtime';
import { devPrivateEgressAllowed, safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { redactValues } from '../connectors/connection-parts';
import { ConnectionUnusableError, ConnectorsService } from '../connectors/connectors.service';
import { planModuleOff } from '../billing/plan-module-gate';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { activity, connections, lists, records, whatsappContacts, whatsappHooks, whatsappTemplates, type WhatsappTemplateRowDb } from '../db/schema';
import { PublicBusyError } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub } from '../incidents/incident-hub';
import { andWhere, hiddenFieldsFor, listRowInScope, listScopeWhere, type AclExtras } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readTenantFormat } from '../tenancy/tenant-format';
import {
    graphBase,
    isSystemicMetaError,
    metaErrorText,
    parseMetaError,
    parseSendResponse,
    parseSubscribedApps,
    parseTemplatesPage,
    sendRequest,
    shownUrl,
    subscribeAppRequest,
    subscribedAppsRequest,
    templatePayload,
    templatesRequest,
    textPayload,
    whatsappCreds,
    type MetaError,
    type WhatsappCreds,
} from './whatsapp-graph';
import { parseMetaWebhook, verifyMetaSignature, type InboundMessage, type StatusUpdate } from './whatsapp-webhook';
import {
    isSystemicWaWebError,
    isSystemicWaWebFailure,
    missingWaWebAbilities,
    parseWaWebAccount,
    parseWaWebError,
    parseWaWebHook,
    parseWaWebHookActive,
    parseWaWebHookCreated,
    parseWaWebHookEvents,
    parseWaWebSend,
    verifyWaWebSignature,
    waWebAccountRequest,
    waWebAccountStatusLabel,
    waWebCreateHookRequest,
    waWebCreds,
    waWebDeleteHookRequest,
    waWebErrorText,
    waWebHookRequest,
    waWebSendRequest,
    waWebUpdateHookEventsRequest,
    type WaWebCreds,
    type WaWebPayload,
} from './whatsapp-web';
import { encryptSecret } from '../common/secret-box';

/**
 * D3 — WhatsApp oficial (Meta WhatsApp Cloud API).
 *
 * Reglas que no son opcionales:
 * - La conversación NO se guarda. En el registro queda el ÚLTIMO mensaje en
 *   sus columnas (texto, dirección, hora, nombre del perfil) y el estado del
 *   último envío; la actividad anota «llegó un mensaje» / «se envió la
 *   plantilla X» SIN el texto. Lo único propio del canal (`whatsapp_contacts`)
 *   es cuándo escribió por última vez cada contacto (la ventana de 24 h) y el
 *   id del último envío (para atarle su estado).
 * - Un aviso de Meta se acepta sólo con la firma correcta (HMAC del cuerpo
 *   CRUDO con la clave secreta de la app) y se procesa una sola vez: Meta
 *   reintenta durante días.
 * - Texto libre sólo dentro de la ventana de 24 h; fuera, una plantilla.
 * - Cada empresa usa SU cuenta: credenciales cifradas en su conexión.
 */

/** Quien pide desde la interfaz. */
export interface WhatsappActor extends AclExtras {
    userId: number;
    role: Role;
}

/** Un motivo legible por el que no se puede mandar (el controller lo vuelve 400). */
export class WhatsappSendError extends Error {
    constructor(
        message: string,
        readonly code = 'whatsapp_send',
    ) {
        super(message);
    }
}

export const WHATSAPP_WINDOW_CLOSED = 'La ventana de 24 h está cerrada: usa una plantilla.';

const SYSTEM_ACTOR = { userId: 0, role: 'admin' as const };
const SEND_TIMEOUT_MS = 15_000;
/**
 * Un mensaje ya procesado se recuerda 2 días: los reintentos de Meta y de WAS
 * llegan en minutos u horas (sólo si no se les contestó). v0.1.391 — antes era
 * una semana: con muchas empresas, millones de claves en Redis para nada. Los
 * estados no necesitan recordarse: aplicarlos dos veces no cambia nada.
 */
const DEDUP_TTL_S = 2 * 24 * 3600;
/** v0.1.391 — Cuánto vale lo que se sabe de una URL de avisos (la conexión, el secreto, qué necesita). */
const HOOK_CTX_TTL_MS = 60_000;
/** Varios mensajes del mismo contacto en este rato quedan en UNA línea de la actividad. */
const ACTIVITY_GROUP_MS = 30 * 60_000;

const seenKey = (tenantId: number, id: string): string => `wa:seen:${tenantId}:${id}`;

interface ConnRow {
    id: number;
    name: string;
    provider: string;
    config: Record<string, unknown>;
    ownerUserId: number | null;
    visibility: string;
}

/** Un envío ya armado (lo que se va a mandar), listo para ejecutarse. */
export interface PreparedSend {
    tenantId: number;
    /** v0.1.389 — la oficial de Meta o la versión nueva de Imagina WAS. */
    provider: WhatsappProvider;
    connection: { id: number; name: string; ownerUserId: number | null };
    /** Meta (null en Imagina WAS). */
    creds: WhatsappCreds | null;
    /** Imagina WAS (null en Meta). */
    web: { creds: WaWebCreds; payload: WaWebPayload } | null;
    kind: 'template' | 'text' | 'media';
    to: string;
    payload: Record<string, unknown>;
    text: string;
    template: { name: string; language: string } | null;
}

/** Resultado de un envío ejecutado. */
interface Executed {
    ok: boolean;
    wamid: string | null;
    status: number | null;
    body: string;
    /** El motivo en palabras (si no salió). */
    errorText: string | null;
    /** El motivo es de la CONEXIÓN (clave, número desconectado…), no del destinatario. */
    systemic: boolean;
    /** Código del error (Meta: número; Imagina WAS: texto), para el historial. */
    errorCode: string | number | null;
    /** Error de red (no llegó al servidor). */
    network: string | null;
}

/** Las cabeceras de un aviso: Meta firma con una, Imagina WAS con otras. */
export interface WhatsappHookHeaders {
    meta?: string;
    web?: string;
    timestamp?: string;
    event?: string;
}

/** Lo que guarda la conexión de Imagina WAS sobre sus avisos (`config.whatsapp_web`). */
interface WebHookState {
    hook_id: number | null;
    hook_url: string | null;
    error: string | null;
    /** v0.1.391 — los avisos suscritos (null = los de antes: todos). */
    events?: string[] | null;
}

/** Lo que se escribió en un registro (para las pantallas abiertas y los campos con IA). */
interface ChannelWrite {
    listId: number;
    recordId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

/** v0.1.391 — Qué necesita escuchar una conexión (ver `WhatsappListening`). */
interface HookNeeds {
    inbound: boolean;
    statuses: boolean;
    statusLists: string[];
}

/** v0.1.391 — Lo que se sabe de una URL de avisos (en memoria un rato). */
interface HookContext {
    token: string;
    tenantId: number;
    connectionId: number;
    verifyToken: string;
    provider: WhatsappProvider;
    /** Con qué se verifica la firma ('' = no hay). */
    secret: string;
    accountId: number | null;
    needs: HookNeeds;
    /** Versión de la empresa al leerlo: si cambió algo, se vuelve a leer. */
    ver: number;
    loadedAt: number;
}

function readWebHookState(config: Record<string, unknown>): WebHookState {
    const raw = config.whatsapp_web;
    const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const id = Number(r.hook_id);
    return {
        hook_id: Number.isInteger(id) && id > 0 ? id : null,
        hook_url: typeof r.hook_url === 'string' && r.hook_url !== '' ? r.hook_url : null,
        error: typeof r.error === 'string' && r.error !== '' ? r.error : null,
        events: Array.isArray(r.events) ? r.events.filter((e): e is string => typeof e === 'string') : null,
    };
}

/** Lo que un webhook de Meta encola por mensaje o estado. */
export type WhatsappJob =
    | { kind: 'message'; tenantId: number; connectionId: number; message: Omit<InboundMessage, 'at'> & { at: string } }
    | { kind: 'status'; tenantId: number; connectionId: number; status: Omit<StatusUpdate, 'at'> & { at: string } }
    | { kind: 'templates'; tenantId: number; connectionId: number };

/** Cola de avisos (la arma `WhatsappQueue`; sin ella se procesa en el acto). */
export interface WhatsappJobSink {
    add(job: WhatsappJob, dedupId: string | null): Promise<void>;
}

/** «WhatsApp (Ventas)», o el nombre tal cual si ya empieza con «WhatsApp» (no «WhatsApp (WhatsApp…)»). */
function whatsappConnLabel(name: string): string {
    return /^whatsapp\b/i.test(name.trim()) ? name.trim() : `WhatsApp (${name})`;
}

@Injectable()
export class WhatsappService {
    private readonly logger = new Logger(WhatsappService.name);
    private sink: WhatsappJobSink | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: Pick<Redis, 'set' | 'del'>,
        private readonly connectors: ConnectorsService,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly dispatcher: AutomationDispatcher,
        private readonly audit: AuditService,
        @Optional() private readonly recordsSvc?: RecordsService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly aiFields?: AiFieldsService,
        @Optional() private readonly cache?: PublicCacheService,
    ) {
        // v0.1.389 — Imagina WAS: al conectar se registran solos los avisos; al
        // borrar la conexión se sacan (si no, seguirían llamando a una URL muerta).
        this.connectors.onAfterKeyConnect(async (tenantId, connectionId, key) => {
            if (key === 'whatsapp_web') await this.ensureWebHook(tenantId, connectionId, false);
        });
        this.connectors.onBeforeRemove((tenantId, connectionId) => this.forgetWebHook(tenantId, connectionId));
    }

    setSink(sink: WhatsappJobSink | null): void {
        this.sink = sink;
    }

    private get graph() {
        return graphBase(this.env);
    }

    // ── URL de avisos ───────────────────────────────────────────────────

    hookUrl(token: string): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/whatsapp/${token}`;
    }

    /** El token de la URL de avisos (y el de verificación) de una conexión. Se crea la primera vez. */
    async ensureHook(tenantId: number, connectionId: number): Promise<{ token: string; verifyToken: string; lastHookAt: Date | null }> {
        const read = async () =>
            (
                await this.db
                    .select({ token: whatsappHooks.token, verifyToken: whatsappHooks.verifyToken, lastHookAt: whatsappHooks.lastHookAt })
                    .from(whatsappHooks)
                    .where(eq(whatsappHooks.connectionId, connectionId))
                    .limit(1)
            )[0];
        const existing = await read();
        if (existing) return existing;
        await this.db
            .insert(whatsappHooks)
            .values({ token: randomBytes(24).toString('base64url'), tenantId, connectionId, verifyToken: randomBytes(18).toString('base64url') })
            .onConflictDoNothing();
        const created = await read();
        if (!created) throw new Error('No se pudo crear la URL de avisos.');
        return created;
    }

    /**
     * Verificación GET de Meta (`hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`):
     * se devuelve el `challenge` tal cual sólo si el token coincide. Token de
     * URL desconocido → 404 opaco.
     */
    async verifyChallenge(token: string, query: Record<string, unknown>): Promise<string> {
        const hook = await this.hookContext(token);
        if (!hook) throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        const mode = String(query['hub.mode'] ?? '');
        const given = String(query['hub.verify_token'] ?? '');
        const challenge = String(query['hub.challenge'] ?? '');
        if (mode !== 'subscribe' || given === '' || given !== hook.verifyToken) {
            throw new ForbiddenException({ code: 'verify_token_mismatch', message: 'El token de verificación no coincide.', data: { status: 403 } });
        }
        return challenge.slice(0, 200);
    }

    // ── Qué escucha cada conexión (v0.1.391) ────────────────────────────

    private ns(tenantId: number): string {
        return `wa:${tenantId}`;
    }

    /**
     * Cambió algo de lo que escucha la empresa (la lista de entrada, las
     * columnas de estado, una conexión): lo que está en memoria se vuelve a
     * leer, también en los otros servidores.
     */
    private changed(tenantId: number): void {
        this.cache?.bump(this.ns(tenantId));
    }

    /**
     * Qué necesita escuchar la conexión. Los mensajes que te escriben, sólo si
     * caen en una lista viva (sin lista no disparan nada); entregado/leído,
     * sólo si alguna lista muestra el estado del último envío.
     */
    private async needsInTx(tx: Tx, tenantId: number, config: Record<string, unknown>): Promise<HookNeeds> {
        const cfg = readWhatsappConnectionConfig(config);
        const inboundId = cfg.inbound_list_id ?? 0;
        const rows = await tx
            .select({ id: lists.id, name: lists.name, settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), isNull(lists.deletedAt), sql`(${lists.settings} ? 'whatsapp' OR ${lists.id} = ${inboundId})`));
        const statusLists = rows
            .filter((r) => {
                const f = readWhatsappListFields(r.settings);
                return f.status !== null || f.status_detail !== null;
            })
            .map((r) => r.name);
        return { inbound: inboundId > 0 && rows.some((r) => r.id === inboundId), statuses: statusLists.length > 0, statusLists };
    }

    /** Lo que se sabe de una URL de avisos: la conexión, con qué se firma y qué necesita. */
    private async loadHookContext(token: string): Promise<HookContext | null> {
        const [row] = await this.db
            .select({ token: whatsappHooks.token, tenantId: whatsappHooks.tenantId, connectionId: whatsappHooks.connectionId, verifyToken: whatsappHooks.verifyToken })
            .from(whatsappHooks)
            .where(eq(whatsappHooks.token, token))
            .limit(1);
        if (!row) return null;
        // v0.1.338 (ADR-S87) — plan sin «Integraciones»: la URL responde como
        // una desconocida (nada se borra; vuelve al cambiar de plan).
        if (await planModuleOff(this.db, row.tenantId, 'integrations')) return null;
        const ver = this.cache?.version(this.ns(row.tenantId)) ?? 0;
        const out = await this.tenantDb.withTenant(row.tenantId, async (tx) => {
            const conn = await this.connRow(tx, row.tenantId, row.connectionId);
            if (!conn) return null;
            const needs = await this.needsInTx(tx, row.tenantId, conn.config);
            let secret = '';
            let accountId: number | null = null;
            try {
                const creds = await this.connectors.integrationCredsInTx(tx, row.tenantId, row.connectionId);
                if (creds && isWhatsappProvider(creds.provider)) {
                    secret = creds.creds.signingSecret ?? '';
                    accountId = creds.provider === 'whatsapp_web' ? waWebCreds(creds.creds).accountId : null;
                }
            } catch (err) {
                if (!(err instanceof ConnectionUnusableError)) throw err;
                this.reportConnection(row.tenantId, row.connectionId, conn, err.message);
            }
            return { provider: conn.provider as WhatsappProvider, needs, secret, accountId };
        });
        if (!out) return null;
        return { ...row, ...out, ver, loadedAt: Date.now() };
    }

    /**
     * v0.1.391 — Cada aviso que llega necesita esto. Antes eran 3-4 consultas
     * a la base por aviso; ahora se lee una vez por minuto (o cuando algo
     * cambia) y se reusa.
     */
    private async hookContext(token: string, fresh = false): Promise<HookContext | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const cache = this.cache;
        if (!cache) return this.loadHookContext(token);
        const key = `wa-hook:${token}`;
        const read = async (): Promise<HookContext | null> => {
            try {
                return await cache.get(key, HOOK_CTX_TTL_MS, () => this.loadHookContext(token), 15_000);
            } catch (err) {
                if (err instanceof PublicBusyError) {
                    throw new ServiceUnavailableException({ code: 'busy', message: 'Ocupado, reintenta en unos segundos.', data: { status: 503 } });
                }
                throw err;
            }
        };
        if (fresh) cache.invalidate(key);
        let ctx = await read();
        if (ctx && ctx.ver !== cache.version(this.ns(ctx.tenantId))) {
            cache.invalidate(key);
            ctx = await read();
        }
        return ctx;
    }

    /** `lastHookAt` se guarda como mucho una vez por minuto (antes, en cada aviso). */
    private readonly hookTouched = new Map<string, number>();

    private touchHook(token: string): void {
        const now = Date.now();
        if ((this.hookTouched.get(token) ?? 0) > now - 60_000) return;
        if (this.hookTouched.size > 20_000) this.hookTouched.clear();
        this.hookTouched.set(token, now);
        void this.db
            .update(whatsappHooks)
            .set({ lastHookAt: new Date(now) })
            .where(eq(whatsappHooks.token, token))
            .catch(() => undefined);
    }

    private verifyHook(ctx: HookContext, rawBody: string, sig: WhatsappHookHeaders): boolean {
        if (ctx.secret === '') return false;
        return ctx.provider === 'whatsapp_cloud' ? verifyMetaSignature(ctx.secret, rawBody, sig.meta) : verifyWaWebSignature(ctx.secret, rawBody, sig.web, sig.timestamp);
    }

    /**
     * POST de Meta o de Imagina WAS. Firma mala → 401; token desconocido → 404
     * opaco. Lo que trae se ENCOLA (Meta corta si no se le contesta rápido y
     * reintenta), con un id por mensaje/estado para no procesar dos veces el
     * mismo aviso. v0.1.391 — Lo que nada usa se descarta aquí mismo, sin
     * cola ni base.
     */
    async receive(token: string, rawBody: string, headers: WhatsappHookHeaders | string | undefined): Promise<void> {
        // Un texto suelto es la firma de Meta (`X-Hub-Signature-256`), como antes de v0.1.389.
        const sig: WhatsappHookHeaders = typeof headers === 'object' && headers !== null ? headers : { meta: headers };
        let ctx = await this.hookContext(token);
        if (!ctx) throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        // Firma que no coincide: puede ser un secreto nuevo (se registró el aviso de nuevo). Se
        // vuelve a leer UNA vez, y como mucho cada 5 s por URL (una firma falsa no carga la base).
        if (!this.verifyHook(ctx, rawBody, sig) && ctx.loadedAt < Date.now() - 5_000) {
            ctx = await this.hookContext(token, true);
            if (!ctx) throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        }
        if (!this.verifyHook(ctx, rawBody, sig)) {
            throw new UnauthorizedException({ code: 'bad_signature', message: 'Firma inválida', data: { status: 401 } });
        }
        this.touchHook(token);
        let body: unknown;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return;
        }
        const hook = { tenantId: ctx.tenantId, connectionId: ctx.connectionId };
        if (ctx.provider === 'whatsapp_web') {
            await this.receiveWeb(hook, ctx.accountId, ctx.needs, body, sig.event);
            return;
        }
        const parsed = parseMetaWebhook(body);
        const jobs: Array<{ job: WhatsappJob; dedup: string | null }> = [];
        // Meta: los mensajes se procesan siempre (abren la ventana de 24 h para el texto libre).
        for (const m of parsed.messages) {
            jobs.push({
                job: { kind: 'message', tenantId: hook.tenantId, connectionId: hook.connectionId, message: { ...m, at: m.at.toISOString() } },
                dedup: `m-${m.id}`,
            });
        }
        for (const st of parsed.statuses) {
            const status = whatsappStatusFromMeta(st.status);
            // Meta manda todos los estados (no se pueden elegir): los que nada muestra, fuera.
            if (!status || !whatsappStatusWanted(status, ctx.needs.statuses)) continue;
            jobs.push({
                job: { kind: 'status', tenantId: hook.tenantId, connectionId: hook.connectionId, status: { ...st, at: st.at.toISOString() } },
                dedup: `s-${st.id}-${st.status}`,
            });
        }
        if (parsed.templateChanges > 0) {
            jobs.push({ job: { kind: 'templates', tenantId: hook.tenantId, connectionId: hook.connectionId }, dedup: null });
        }
        await this.enqueue(jobs);
    }

    private async enqueue(jobs: Array<{ job: WhatsappJob; dedup: string | null }>): Promise<void> {
        for (const { job, dedup } of jobs) {
            if (this.sink) await this.sink.add(job, dedup);
            else await this.process(job).catch((err: unknown) => this.logger.warn(`Aviso de WhatsApp: ${String(err)}`));
        }
    }

    /**
     * v0.1.389 — Imagina WAS: los avisos son de TODO el espacio de trabajo
     * (todos sus números). Cada conexión registró el suyo y atiende sólo los
     * de SU número; el de otro número lo atiende la conexión de ese número.
     */
    private async receiveWeb(
        hook: { tenantId: number; connectionId: number },
        ownAccount: number | null,
        needs: HookNeeds,
        body: unknown,
        headerEvent: string | undefined,
    ): Promise<void> {
        const parsed = parseWaWebHook(body, headerEvent);
        if (parsed.accountId !== null && ownAccount !== null && parsed.accountId !== ownAccount) return;
        const jobs: Array<{ job: WhatsappJob; dedup: string }> = [];
        // v0.1.391 — Si nada usa los mensajes que te escriben, ni se encolan (WAS ya
        // no debería mandarlos: esto cubre el rato hasta que se actualiza el aviso).
        if (parsed.message && needs.inbound) {
            const m = parsed.message;
            jobs.push({
                job: { kind: 'message', tenantId: hook.tenantId, connectionId: hook.connectionId, message: { ...m, at: m.at.toISOString() } },
                dedup: `m-${m.id}`,
            });
        }
        if (parsed.status) {
            const st = parsed.status;
            // «canceled» se lee como «failed»: para el registro las dos son «no salió».
            const status = st.status === 'canceled' ? 'failed' : st.status;
            const mapped = whatsappStatusFromMeta(status);
            if (mapped && whatsappStatusWanted(mapped, needs.statuses)) {
                jobs.push({
                    job: {
                        kind: 'status',
                        tenantId: hook.tenantId,
                        connectionId: hook.connectionId,
                        status: {
                            phoneNumberId: st.phoneNumberId,
                            id: st.id,
                            status,
                            recipientId: st.recipientId,
                            errors: st.errors,
                            detail: st.errors[0]?.message ?? null,
                            systemic: isSystemicWaWebFailure(st.failureReason),
                            at: st.at.toISOString(),
                        },
                    },
                    dedup: `s-${st.id}-${status}`,
                });
            }
        }
        await this.enqueue(jobs);
    }

    /**
     * Con qué se verifica un aviso: la clave secreta de la app (Meta) o el
     * secreto que dio Imagina WAS al registrar el aviso. Null si no hay o no
     * se puede leer.
     */
    private async hookAuthOf(tenantId: number, connectionId: number): Promise<{ provider: WhatsappProvider; secret: string; accountId: number | null } | null> {
        try {
            const out = await this.tenantDb.withTenant(tenantId, (tx) => this.connectors.integrationCredsInTx(tx, tenantId, connectionId));
            if (!out || !isWhatsappProvider(out.provider)) return null;
            const secret = out.creds.signingSecret ?? '';
            if (secret === '') return null;
            return { provider: out.provider, secret, accountId: out.provider === 'whatsapp_web' ? waWebCreds(out.creds).accountId : null };
        } catch (err) {
            if (err instanceof ConnectionUnusableError) {
                this.reportConnection(tenantId, connectionId, null, err.message);
                return null;
            }
            throw err;
        }
    }

    /** Procesa un aviso encolado. */
    async process(job: WhatsappJob): Promise<void> {
        if (job.kind === 'message') {
            await this.handleInbound(job.tenantId, job.connectionId, { ...job.message, at: new Date(job.message.at) });
        } else if (job.kind === 'status') {
            await this.handleStatus(job.tenantId, job.connectionId, { ...job.status, at: new Date(job.status.at) });
        } else {
            await this.syncTemplates(job.tenantId, job.connectionId).catch((err: unknown) => this.logger.warn(`Plantillas de WhatsApp: ${String(err)}`));
        }
    }

    // ── Conexiones ──────────────────────────────────────────────────────

    private async connRow(tx: Tx, tenantId: number, id: number): Promise<ConnRow | null> {
        const [row] = await tx
            .select({
                id: connections.id,
                name: connections.name,
                provider: connections.provider,
                config: connections.config,
                ownerUserId: connections.ownerUserId,
                visibility: connections.visibility,
            })
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)))
            .limit(1);
        return row && isWhatsappProvider(row.provider) ? (row as ConnRow) : null;
    }

    /**
     * La conexión de un aviso. La URL de avisos se configura por APP en Meta:
     * si la empresa conectó varios números de la misma app, todos los avisos
     * llegan a la misma URL — se enrutan por el número que los recibió.
     */
    private async resolveConnection(tx: Tx, tenantId: number, hookConnectionId: number, phoneNumberId: string): Promise<ConnRow | null> {
        const own = await this.connRow(tx, tenantId, hookConnectionId);
        // Meta identifica el número por su `phone_number_id`; Imagina WAS, por el id de la cuenta.
        const idOf = (r: { provider: string; config: unknown }): string =>
            String(((r.config as Record<string, unknown>).fields as Record<string, unknown> | undefined)?.[r.provider === 'whatsapp_web' ? 'account' : 'phone_number_id'] ?? '');
        if (own && (phoneNumberId === '' || idOf(own) === phoneNumberId)) return own;
        const provider = own?.provider ?? 'whatsapp_cloud';
        const rows = await tx
            .select({
                id: connections.id,
                name: connections.name,
                provider: connections.provider,
                config: connections.config,
                ownerUserId: connections.ownerUserId,
                visibility: connections.visibility,
            })
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.provider, provider)));
        const hit = rows.find((r) => idOf(r) === phoneNumberId);
        return (hit as ConnRow | undefined) ?? null;
    }

    private reportConnection(tenantId: number, connectionId: number, row: Pick<ConnRow, 'name' | 'ownerUserId'> | null, message: string): void {
        this.incidents?.report({
            tenantId,
            key: `connection:${connectionId}`,
            source: 'connection',
            sourceId: connectionId,
            ownerId: row?.ownerUserId ?? null,
            title: `La conexión de WhatsApp «${row?.name ?? `#${connectionId}`}» dejó de funcionar`,
            message,
        });
        void this.tenantDb
            .withTenant(tenantId, (tx) =>
                tx
                    .update(connections)
                    .set({ lastCheckAt: new Date(), lastCheckOk: false, lastCheckError: message.slice(0, 500) })
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId))),
            )
            .catch(() => undefined);
    }

    /** Volvió a andar: se cierra el problema y el aviso de la pantalla de la conexión. */
    private connectionWorks(tenantId: number, connectionId: number): void {
        this.incidents?.resolve(tenantId, `connection:${connectionId}`);
        void this.tenantDb
            .withTenant(tenantId, (tx) =>
                tx
                    .update(connections)
                    .set({ lastCheckAt: new Date(), lastCheckOk: true, lastCheckError: null })
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId), eq(connections.lastCheckOk, false))),
            )
            .catch(() => undefined);
    }

    // ── Panel de la conexión ────────────────────────────────────────────

    async connectionDetail(tenantId: number, actor: WhatsappActor, connectionId: number): Promise<WhatsappConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (editable.provider === 'whatsapp_web') return this.webConnectionDetail(tenantId, actor, connectionId);
        if (editable.provider !== 'whatsapp_cloud') throw this.notWhatsapp();
        const hook = await this.ensureHook(tenantId, connectionId);
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).find((c) => c.id === connectionId);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.connRow(tx, tenantId, connectionId);
            if (!row) throw this.notWhatsapp();
            const cfg = readWhatsappConnectionConfig(row.config);
            const f = (row.config.fields ?? {}) as Record<string, string>;
            const templates = await tx
                .select()
                .from(whatsappTemplates)
                .where(and(eq(whatsappTemplates.tenantId, tenantId), eq(whatsappTemplates.connectionId, connectionId)))
                .orderBy(asc(whatsappTemplates.name), asc(whatsappTemplates.language));
            const allLists = await tx
                .select({ id: lists.id, name: lists.name })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), isNull(lists.deletedAt)))
                .orderBy(asc(lists.name));
            const [totals] = await tx
                .select({
                    contacts: sql<number>`count(*)::int`,
                    open: sql<number>`count(*) FILTER (WHERE ${whatsappContacts.lastInboundAt} > now() - interval '24 hours')::int`,
                })
                .from(whatsappContacts)
                .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.connectionId, connectionId)));
            const [lastErr] = await tx
                .select({ error: connections.lastCheckError, ok: connections.lastCheckOk })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1);
            const needs = await this.needsInTx(tx, tenantId, row.config);
            return { row, cfg, f, templates, allLists, totals, lastErr, needs };
        });
        const inbound = out.cfg.inbound_list_id ? await this.listColumns(tenantId, String(out.cfg.inbound_list_id)).catch(() => null) : null;
        // ¿La app está suscrita a la cuenta? (best-effort: si Meta no contesta, no se sabe).
        let subscribed: boolean | null = null;
        let subscribeError: string | null = null;
        try {
            const creds = await this.credsFor(tenantId, connectionId);
            const req = subscribedAppsRequest(this.graph, creds);
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, timeoutMs: 6_000 });
            const err = parseMetaError(res.status, res.body ?? '');
            if (err) subscribeError = metaErrorText(err);
            else subscribed = parseSubscribedApps(res.body ?? '');
        } catch (err) {
            subscribeError = err instanceof Error ? err.message : String(err);
        }
        const syncedAt = out.templates.reduce<Date | null>((acc, t) => (acc === null || t.syncedAt > acc ? t.syncedAt : acc), null);
        return {
            provider: 'whatsapp_cloud',
            web: null,
            connection: {
                id: out.row.id,
                name: out.row.name,
                phone_number_id: out.f.phone_number_id ?? '',
                waba_id: out.f.waba_id ?? '',
                display_phone: out.f.display_phone || null,
                verified_name: out.f.verified_name || null,
                quality_rating: out.f.quality_rating || null,
                can_edit: true,
                secret_state: visible?.secret_state ?? 'ok',
                has_app_secret: visible?.has_signing_secret ?? false,
            },
            webhook: {
                url: this.hookUrl(hook.token),
                verify_token: hook.verifyToken,
                last_hook_at: hook.lastHookAt ? hook.lastHookAt.toISOString() : null,
                subscribed,
                subscribe_error: subscribeError,
            },
            config: out.cfg,
            inbound_columns: inbound,
            lists: out.allLists,
            templates: out.templates.map(toTemplateDto),
            templates_synced_at: syncedAt ? syncedAt.toISOString() : null,
            template_manager_url: whatsappTemplateManagerUrl(out.f.waba_id ?? ''),
            totals: { contacts: Number(out.totals?.contacts ?? 0), open_windows: Number(out.totals?.open ?? 0) },
            last_error: out.lastErr?.ok === false ? (out.lastErr.error ?? null) : null,
            listening: { inbound: out.needs.inbound, statuses: out.needs.statuses, status_lists: out.needs.statusLists, events: null },
        };
    }

    async updateConfig(tenantId: number, actor: WhatsappActor, connectionId: number, input: UpdateWhatsappConfigInput): Promise<WhatsappConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (!isWhatsappProvider(editable.provider)) throw this.notWhatsapp();
        if (input.inbound_list_id !== null) {
            // La lista tiene que ser de la empresa y estar viva (lanza 404 si no).
            const list = await this.lists.get(tenantId, String(input.inbound_list_id));
            if (input.fields) await this.saveListFields(tenantId, actor, list, input.fields);
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ config: connections.config })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1);
            const config = { ...((row?.config ?? {}) as Record<string, unknown>), whatsapp: { inbound_list_id: input.inbound_list_id, create_contacts: input.create_contacts } };
            await tx.update(connections).set({ config, updatedAt: new Date() }).where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'whatsapp.config',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: editable.name,
                meta: { inbound_list_id: input.inbound_list_id, create_contacts: input.create_contacts },
            });
        });
        // v0.1.391 — Cambió qué mensajes se usan: el panel (abajo) ajusta los avisos de WAS.
        this.changed(tenantId);
        return this.connectionDetail(tenantId, actor, connectionId);
    }

    /**
     * Suscribe la app de Meta a la cuenta de WhatsApp Business (sin esto Meta
     * no manda los avisos de ESA cuenta) y, con `override`, le dice que los
     * mande a esta URL — el paso que si no hay que hacer a mano en Meta.
     */
    async subscribeApp(tenantId: number, actor: WhatsappActor, connectionId: number, override: boolean): Promise<WhatsappConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (editable.provider === 'whatsapp_web') {
            // v0.1.389 — Imagina WAS: «registrar de nuevo» los avisos.
            const state = await this.ensureWebHook(tenantId, connectionId, true);
            if (state.error) throw new BadRequestException({ code: 'whatsapp_subscribe_failed', message: state.error, data: { status: 400 } });
            await this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'whatsapp.subscribe',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: editable.name,
                meta: { provider: 'whatsapp_web' },
            });
            return this.connectionDetail(tenantId, actor, connectionId);
        }
        if (editable.provider !== 'whatsapp_cloud') throw this.notWhatsapp();
        const creds = await this.credsFor(tenantId, connectionId);
        const hook = await this.ensureHook(tenantId, connectionId);
        const req = subscribeAppRequest(this.graph, creds, override ? { callbackUrl: this.hookUrl(hook.token), verifyToken: hook.verifyToken } : undefined);
        let error: string | null = null;
        try {
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, body: req.body, captureBody: true, timeoutMs: 20_000 });
            const err = parseMetaError(res.status, res.body ?? '');
            if (err) error = metaErrorText(err);
        } catch (err) {
            error = `No pudimos comunicarnos con Meta (${redactValues(err instanceof Error ? err.message : String(err), [creds.token, creds.appSecret])}).`;
        }
        if (error) throw new BadRequestException({ code: 'whatsapp_subscribe_failed', message: error, data: { status: 400 } });
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'whatsapp.subscribe',
            targetType: 'connection',
            targetId: connectionId,
            targetLabel: editable.name,
            meta: { override },
        });
        return this.connectionDetail(tenantId, actor, connectionId);
    }

    // ── Imagina WAS (v0.1.389) ──────────────────────────────────────────

    /** Las credenciales de una conexión de Imagina WAS (lanza si no lo es o no se pueden leer). */
    private async webCredsFor(tenantId: number, connectionId: number): Promise<WaWebCreds> {
        const out = await this.tenantDb.withTenant(tenantId, (tx) => this.connectors.integrationCredsInTx(tx, tenantId, connectionId));
        if (!out || out.provider !== 'whatsapp_web') throw this.notWhatsapp();
        return waWebCreds(out.creds);
    }

    private async saveWebHookState(tenantId: number, connectionId: number, state: WebHookState, secret?: string): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ config: connections.config, secrets: connections.secrets })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1);
            if (!row) return;
            const config = { ...((row.config ?? {}) as Record<string, unknown>), whatsapp_web: { ...state } };
            const patch: Record<string, unknown> = { config, updatedAt: new Date() };
            if (secret !== undefined) {
                // El secreto de los avisos, cifrado como el resto de las credenciales.
                patch.secrets = { ...((row.secrets ?? {}) as Record<string, string>), signing_secret: encryptSecret(secret, this.env.SECRETS_KEY) };
            }
            await tx.update(connections).set(patch).where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)));
        });
    }

    /**
     * Deja registrados en Imagina WAS los avisos de la conexión (estado de cada
     * envío y mensajes entrantes) hacia la URL de esta app. Idempotente: si el
     * aviso existe, sigue activo y apunta aquí, no hace nada; si no, lo crea (y
     * borra el anterior). Imagina WAS da el secreto de la firma UNA vez, al
     * crearlo: se guarda cifrado. Un fallo no lanza: queda a la vista.
     */
    async ensureWebHook(tenantId: number, connectionId: number, force = false): Promise<WebHookState> {
        // Uno a la vez por conexión: dos ajustes a la vez podrían registrar dos avisos.
        const prev = this.hookLocks.get(connectionId) ?? Promise.resolve();
        const run = prev.catch(() => undefined).then(() => this.ensureWebHookNow(tenantId, connectionId, force));
        const tail = run.catch(() => undefined);
        this.hookLocks.set(connectionId, tail);
        try {
            return await run;
        } finally {
            if (this.hookLocks.get(connectionId) === tail) this.hookLocks.delete(connectionId);
        }
    }

    private readonly hookLocks = new Map<number, Promise<unknown>>();

    private async ensureWebHookNow(tenantId: number, connectionId: number, force: boolean): Promise<WebHookState> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.connRow(tx, tenantId, connectionId));
        if (!row || row.provider !== 'whatsapp_web') return { hook_id: null, hook_url: null, error: null };
        let creds: WaWebCreds;
        try {
            creds = await this.webCredsFor(tenantId, connectionId);
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return { ...readWebHookState(row.config), error };
        }
        const prev = readWebHookState(row.config);
        const hook = await this.ensureHook(tenantId, connectionId);
        const url = this.hookUrl(hook.token);
        const save = async (state: WebHookState, secret?: string): Promise<WebHookState> => {
            await this.saveWebHookState(tenantId, connectionId, state, secret).catch(() => undefined);
            return state;
        };
        // Sólo en desarrollo (DEV_ALLOW_PRIVATE_EGRESS) se acepta http, para probar contra un WAS local.
        if (!/^https:\/\//i.test(url) && !devPrivateEgressAllowed()) {
            return save({ ...prev, error: 'Los avisos necesitan que esta app esté publicada con https (APP_BASE_URL): sin ellos los mensajes salen igual, pero no sabremos si se entregaron ni recibiremos los de tus clientes.' });
        }
        const call = async (req: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, body: req.body, captureBody: true, maxCaptureBytes: 64 * 1024, timeoutMs: 12_000 });
            return { status: res.status, body: res.body ?? '' };
        };
        // v0.1.391 — Sólo los avisos que algo usa (ver `needsInTx`).
        const needs = await this.tenantDb.withTenant(tenantId, (tx) => this.needsInTx(tx, tenantId, row.config));
        const desired = waWebHookEventsFor(needs);
        try {
            const hasSecret = (await this.hookAuthOf(tenantId, connectionId)) !== null;
            if (prev.hook_id !== null && prev.hook_url === url && hasSecret && !force) {
                const got = await call(waWebHookRequest(creds, prev.hook_id));
                const active = parseWaWebHookActive(got.status, got.body);
                if (active === true) {
                    const current = parseWaWebHookEvents(got.status, got.body) ?? prev.events ?? null;
                    if (current !== null && sameWaWebEvents(current, desired)) {
                        const stale = prev.error !== null || !prev.events || !sameWaWebEvents(prev.events, desired);
                        return stale ? save({ ...prev, error: null, events: desired }) : prev;
                    }
                    // Cambió lo que se usa: se ajustan los avisos (el secreto no cambia).
                    const upd = await call(waWebUpdateHookEventsRequest(creds, prev.hook_id, desired));
                    if (upd.status >= 200 && upd.status < 300) return save({ ...prev, error: null, events: desired });
                    // Si no se pudo cambiar, se registra de nuevo (abajo).
                }
                if (active === null) return prev;
            }
            if (prev.hook_id !== null) await call(waWebDeleteHookRequest(creds, prev.hook_id)).catch(() => undefined);
            // El nombre lleva el dominio de esta app (no la marca: puede ser white-label).
            const created = await call(waWebCreateHookRequest(creds, url, `${new URL(url).host} · ${row.name}`.slice(0, 128), desired));
            const err = parseWaWebError(created.status, created.body);
            if (err) {
                const text =
                    err.code === 'missing_ability'
                        ? 'La clave no tiene el permiso webhooks.manage (avisos): márcalo en tu panel de WhatsApp (API Keys) y vuelve a registrar los avisos. Sin ellos los mensajes salen igual, pero no sabremos si se entregaron ni recibiremos los de tus clientes.'
                        : `No pudimos registrar los avisos en WAS: ${waWebErrorText(err)}`;
                return save({ hook_id: null, hook_url: null, error: text, events: null });
            }
            const parsed = parseWaWebHookCreated(created.body);
            if (!parsed) return save({ hook_id: null, hook_url: null, error: 'WAS creó el aviso pero no devolvió su secreto: vuelve a registrarlo.', events: null });
            const state = await save({ hook_id: parsed.id, hook_url: url, error: null, events: desired }, parsed.secret);
            // Secreto nuevo: lo que estaba en memoria se vuelve a leer.
            this.changed(tenantId);
            return state;
        } catch (err) {
            const message = redactValues(err instanceof Error ? err.message : String(err), [creds.key]);
            return save({ ...prev, error: `No pudimos comunicarnos con el servidor de WhatsApp para registrar los avisos (${message}).` });
        }
    }

    /**
     * v0.1.391 — Deja los avisos de una conexión de Imagina WAS en lo que se
     * usa. Sin llamar a WAS si ya están así (lo guardado coincide). Devuelve si
     * hubo que ajustarlos.
     */
    async syncWebHookEvents(tenantId: number, connectionId: number): Promise<boolean> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.connRow(tx, tenantId, connectionId));
        if (!row || row.provider !== 'whatsapp_web') return false;
        const prev = readWebHookState(row.config);
        const needs = await this.tenantDb.withTenant(tenantId, (tx) => this.needsInTx(tx, tenantId, row.config));
        const desired = waWebHookEventsFor(needs);
        if (prev.hook_id !== null && prev.error === null && prev.events && sameWaWebEvents(prev.events, desired)) return false;
        await this.ensureWebHook(tenantId, connectionId, false);
        return true;
    }

    /**
     * Todas las conexiones de Imagina WAS de una empresa (cambió algo que
     * afecta a todas). En segundo plano: quien guardó no espera a WAS.
     */
    private resyncTenantWebHooks(tenantId: number): Promise<void> {
        this.changed(tenantId);
        return (async () => {
            const rows = await this.db
                .select({ id: connections.id })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.provider, 'whatsapp_web')));
            for (const r of rows) await this.syncWebHookEvents(tenantId, r.id).catch(() => undefined);
        })().catch((err: unknown) => this.logger.warn(`Avisos de WhatsApp: ${String(err)}`));
    }

    /**
     * v0.1.391 — La revisión de cada hora: cada conexión de Imagina WAS queda
     * suscrita sólo a lo que usa (una lista que se borró, una columna de
     * estado que se sacó…). Sin cambios no se llama a WAS.
     */
    async reconcileWebHooks(): Promise<number> {
        const rows = await this.db
            .select({ id: connections.id, tenantId: connections.tenantId })
            .from(connections)
            .where(eq(connections.provider, 'whatsapp_web'));
        let n = 0;
        for (const r of rows) {
            if (await this.syncWebHookEvents(r.tenantId, r.id).catch(() => false)) n++;
        }
        return n;
    }

    /** Al borrar la conexión: se saca el aviso de Imagina WAS (si no, seguiría llamando a una URL muerta). */
    private async forgetWebHook(tenantId: number, connectionId: number): Promise<void> {
        this.changed(tenantId);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.connRow(tx, tenantId, connectionId));
        if (!row || row.provider !== 'whatsapp_web') return;
        const state = readWebHookState(row.config);
        if (state.hook_id === null) return;
        const creds = await this.webCredsFor(tenantId, connectionId);
        const req = waWebDeleteHookRequest(creds, state.hook_id);
        await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, timeoutMs: 10_000 });
    }

    /** Panel de una conexión de Imagina WAS: el número y su estado, la clave, los avisos y la lista de entrada. */
    private async webConnectionDetail(tenantId: number, actor: WhatsappActor, connectionId: number): Promise<WhatsappConnectionDetail> {
        // Mantiene los avisos registrados (un GET si ya están; los crea si faltan).
        const hookState = await this.ensureWebHook(tenantId, connectionId, false);
        const hook = await this.ensureHook(tenantId, connectionId);
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).find((c) => c.id === connectionId);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.connRow(tx, tenantId, connectionId);
            if (!row) throw this.notWhatsapp();
            const cfg = readWhatsappConnectionConfig(row.config);
            const f = (row.config.fields ?? {}) as Record<string, string>;
            const allLists = await tx
                .select({ id: lists.id, name: lists.name })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), isNull(lists.deletedAt)))
                .orderBy(asc(lists.name));
            const [totals] = await tx
                .select({ contacts: sql<number>`count(*)::int` })
                .from(whatsappContacts)
                .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.connectionId, connectionId)));
            const [lastErr] = await tx
                .select({ error: connections.lastCheckError, ok: connections.lastCheckOk })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1);
            const needs = await this.needsInTx(tx, tenantId, row.config);
            return { row, cfg, f, allLists, totals, lastErr, needs };
        });
        const inbound = out.cfg.inbound_list_id ? await this.listColumns(tenantId, String(out.cfg.inbound_list_id)).catch(() => null) : null;
        // El número como está AHORA en Imagina WAS (best-effort).
        let account: WhatsappWebState['account'] = null;
        let accountError: string | null = null;
        let server = '';
        try {
            const creds = await this.webCredsFor(tenantId, connectionId);
            server = creds.server;
            if (creds.accountId === null) accountError = 'La conexión no tiene un número elegido: actualízala y elige el número.';
            else {
                const req = waWebAccountRequest(creds, creds.accountId);
                const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, maxCaptureBytes: 64 * 1024, timeoutMs: 8_000 });
                const err = parseWaWebError(res.status, res.body ?? '');
                if (err) accountError = waWebErrorText(err);
                else {
                    const a = parseWaWebAccount(res.body ?? '');
                    if (a) {
                        account = {
                            id: a.id,
                            phone: a.phone,
                            name: a.name,
                            status: a.status,
                            status_label: waWebAccountStatusLabel(a),
                            status_reason: a.statusReason,
                            banned_until: a.bannedUntil,
                            enabled: a.enabled,
                        };
                    }
                }
            }
        } catch (err) {
            accountError = err instanceof Error ? err.message : String(err);
        }
        const abilities = (out.f.abilities ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        return {
            provider: 'whatsapp_web',
            web: {
                server,
                workspace: out.f.workspace || null,
                account,
                account_error: accountError,
                abilities,
                missing_abilities: abilities.length > 0 ? missingWaWebAbilities(abilities) : [],
                hook: { registered: hookState.hook_id !== null && hookState.error === null, error: hookState.error },
            },
            connection: {
                id: out.row.id,
                name: out.row.name,
                phone_number_id: '',
                waba_id: '',
                display_phone: out.f.account_phone || account?.phone || null,
                verified_name: out.f.account_name || account?.name || null,
                quality_rating: null,
                can_edit: true,
                secret_state: visible?.secret_state ?? 'ok',
                has_app_secret: hookState.hook_id !== null,
            },
            webhook: {
                url: this.hookUrl(hook.token),
                verify_token: '',
                last_hook_at: hook.lastHookAt ? hook.lastHookAt.toISOString() : null,
                subscribed: hookState.hook_id !== null && hookState.error === null,
                subscribe_error: hookState.error,
            },
            config: out.cfg,
            inbound_columns: inbound,
            lists: out.allLists,
            templates: [],
            templates_synced_at: null,
            template_manager_url: '',
            totals: { contacts: Number(out.totals?.contacts ?? 0), open_windows: 0 },
            last_error: out.lastErr?.ok === false ? (out.lastErr.error ?? null) : null,
            listening: {
                inbound: out.needs.inbound,
                statuses: out.needs.statuses,
                status_lists: out.needs.statusLists,
                events: hookState.hook_id !== null ? (hookState.events ?? null) : null,
            },
        };
    }

    private async credsFor(tenantId: number, connectionId: number): Promise<WhatsappCreds> {
        const out = await this.tenantDb.withTenant(tenantId, (tx) => this.connectors.integrationCredsInTx(tx, tenantId, connectionId));
        if (!out || out.provider !== 'whatsapp_cloud') throw this.notWhatsapp();
        return whatsappCreds(out.creds);
    }

    private notWhatsapp(): NotFoundException {
        return new NotFoundException({ code: 'connection_not_found', message: 'Conexión de WhatsApp no encontrada', data: { status: 404 } });
    }

    // ── Plantillas ──────────────────────────────────────────────────────

    /** «Actualizar plantillas» (con permiso de editar la conexión). */
    async refreshTemplates(tenantId: number, actor: WhatsappActor, connectionId: number): Promise<WhatsappTemplate[]> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (editable.provider !== 'whatsapp_cloud') throw this.notWhatsapp();
        const result = await this.syncTemplates(tenantId, connectionId);
        if (result.error) throw new BadRequestException({ code: 'whatsapp_templates_failed', message: result.error, data: { status: 400 } });
        return this.templatesOf(tenantId, connectionId, false);
    }

    /**
     * Trae TODAS las plantillas de la cuenta (paginando) y reemplaza la copia.
     * Una que ya no está en Meta se borra de la copia.
     */
    async syncTemplates(tenantId: number, connectionId: number): Promise<{ count: number; error: string | null }> {
        let creds: WhatsappCreds;
        let row: ConnRow | null = null;
        try {
            row = await this.tenantDb.withTenant(tenantId, (tx) => this.connRow(tx, tenantId, connectionId));
            if (!row) return { count: 0, error: 'La conexión ya no existe.' };
            creds = await this.credsFor(tenantId, connectionId);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (err instanceof ConnectionUnusableError) this.reportConnection(tenantId, connectionId, row, message);
            return { count: 0, error: message };
        }
        const all: ReturnType<typeof parseTemplatesPage>['templates'] = [];
        let after: string | null = null;
        for (let page = 0; page < 20; page++) {
            const req = templatesRequest(this.graph, creds, after);
            let res: { status: number; body?: string };
            try {
                res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, maxCaptureBytes: 4 * 1024 * 1024, timeoutMs: 20_000 });
            } catch (err) {
                return { count: 0, error: `No pudimos comunicarnos con Meta (${redactValues(err instanceof Error ? err.message : String(err), [creds.token, creds.appSecret])}).` };
            }
            const err = parseMetaError(res.status, res.body ?? '');
            if (err) {
                const text = metaErrorText(err);
                if (isSystemicMetaError(err)) this.reportConnection(tenantId, connectionId, row, text);
                return { count: 0, error: text };
            }
            const parsed = parseTemplatesPage(res.body ?? '');
            all.push(...parsed.templates);
            after = parsed.after;
            if (!after) break;
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const now = new Date();
            const keep = new Set(all.map((t) => `${t.name}|${t.language}`));
            const existing = await tx
                .select({ id: whatsappTemplates.id, name: whatsappTemplates.name, language: whatsappTemplates.language })
                .from(whatsappTemplates)
                .where(and(eq(whatsappTemplates.tenantId, tenantId), eq(whatsappTemplates.connectionId, connectionId)));
            const gone = existing.filter((e) => !keep.has(`${e.name}|${e.language}`)).map((e) => e.id);
            if (gone.length > 0) await tx.delete(whatsappTemplates).where(and(eq(whatsappTemplates.tenantId, tenantId), inArray(whatsappTemplates.id, gone)));
            for (const t of all) {
                await tx
                    .insert(whatsappTemplates)
                    .values({
                        tenantId,
                        connectionId,
                        metaId: t.metaId,
                        name: t.name,
                        language: t.language,
                        category: t.category,
                        status: t.status,
                        parameterFormat: t.parameterFormat,
                        components: t.components,
                        rejectedReason: t.rejectedReason,
                        syncedAt: now,
                    })
                    .onConflictDoUpdate({
                        target: [whatsappTemplates.connectionId, whatsappTemplates.name, whatsappTemplates.language],
                        set: {
                            metaId: t.metaId,
                            category: t.category,
                            status: t.status,
                            parameterFormat: t.parameterFormat,
                            components: t.components,
                            rejectedReason: t.rejectedReason,
                            syncedAt: now,
                        },
                    });
            }
        });
        this.connectionWorks(tenantId, connectionId);
        return { count: all.length, error: null };
    }

    async templatesOf(tenantId: number, connectionId: number, approvedOnly: boolean): Promise<WhatsappTemplate[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(whatsappTemplates)
                .where(
                    and(
                        eq(whatsappTemplates.tenantId, tenantId),
                        eq(whatsappTemplates.connectionId, connectionId),
                        ...(approvedOnly ? [eq(whatsappTemplates.status, 'APPROVED')] : []),
                    ),
                )
                .orderBy(asc(whatsappTemplates.name), asc(whatsappTemplates.language)),
        );
        return rows.map(toTemplateDto);
    }

    /** Las plantillas aprobadas de las conexiones que la persona puede usar (editor de automatizaciones). */
    async usableConnections(
        tenantId: number,
        actor: WhatsappActor,
    ): Promise<Array<{ id: number; provider: WhatsappProvider; name: string; display_phone: string | null; templates: WhatsappTemplate[] }>> {
        const conns = (await this.connectors.list(tenantId, actor.userId, actor.role)).filter((c) => isWhatsappProvider(c.integration_key));
        const out = [];
        for (const c of conns) {
            const provider = c.integration_key as WhatsappProvider;
            out.push({
                id: c.id,
                provider,
                name: c.name,
                display_phone: c.account_label,
                templates: provider === 'whatsapp_cloud' ? await this.templatesOf(tenantId, c.id, true) : [],
            });
        }
        return out;
    }

    /** Refresco periódico de las plantillas de todas las empresas (conexión base: sin RLS). */
    async syncAllTemplates(): Promise<number> {
        const rows = await this.db
            .select({ id: connections.id, tenantId: connections.tenantId })
            .from(connections)
            .where(eq(connections.provider, 'whatsapp_cloud'));
        let n = 0;
        for (const r of rows) {
            const res = await this.syncTemplates(r.tenantId, r.id).catch(() => ({ count: 0, error: 'falló' }));
            if (!res.error) n++;
        }
        return n;
    }

    // ── Columnas de la lista ────────────────────────────────────────────

    async listColumns(tenantId: number, listIdOrSlug: string): Promise<WhatsappListColumns> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        return columnsOf(list, fields);
    }

    async updateListColumns(tenantId: number, actor: WhatsappActor, listIdOrSlug: string, mapping: WhatsappListFields): Promise<WhatsappListColumns> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.saveListFields(tenantId, actor, list, mapping);
        return this.listColumns(tenantId, String(list.id));
    }

    private async saveListFields(tenantId: number, actor: WhatsappActor, list: List, mapping: WhatsappListFields): Promise<void> {
        const fields = await this.fields.listByListId(tenantId, list.id);
        // Sólo campos de ESTA lista y de un tipo que sirva para cada columna.
        const clean = {} as WhatsappListFields;
        for (const role of WHATSAPP_FIELD_ROLES) {
            const id = mapping[role];
            const f = id ? fields.find((x) => x.id === id) : undefined;
            if (id && !f) throw new BadRequestException({ code: 'whatsapp_field_invalid', message: `El campo elegido para «${WHATSAPP_FIELD_ROLE_META[role].label}» no es de esta lista.`, data: { status: 400 } });
            if (f && !WHATSAPP_FIELD_ROLE_META[role].types.includes(f.type)) {
                throw new BadRequestException({ code: 'whatsapp_field_type', message: `«${f.label}» no sirve para «${WHATSAPP_FIELD_ROLE_META[role].label}».`, data: { status: 400 } });
            }
            clean[role] = f ? f.id : null;
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{whatsapp}', ${JSON.stringify(writeWhatsappListFields(clean))}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'whatsapp.columns',
                targetType: 'list',
                targetId: list.id,
                targetLabel: list.name,
                meta: { fields: clean },
            });
        });
        this.realtime.lists(tenantId);
        // v0.1.391 — Mostrar (o dejar de mostrar) el estado del envío cambia qué avisos se usan.
        const resync = this.resyncTenantWebHooks(tenantId);
        if (this.env.NODE_ENV === 'test') await resync;
    }

    /** «Preparar columnas»: crea en la lista las que falten y guarda el mapeo. */
    async setupListColumns(tenantId: number, actor: WhatsappActor, listIdOrSlug: string): Promise<WhatsappListColumns> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.fields.listByListId(tenantId, list.id);
        const mapping = { ...suggestWhatsappFields(current) } as WhatsappListFields;
        const saved = readWhatsappListFields(list.settings);
        for (const role of WHATSAPP_FIELD_ROLES) {
            if (saved[role] && current.some((f) => f.id === saved[role])) mapping[role] = saved[role];
        }
        for (const role of WHATSAPP_FIELD_ROLES) {
            if (mapping[role]) continue;
            const meta = WHATSAPP_FIELD_ROLE_META[role];
            const config =
                role === 'direction'
                    ? { options: Object.values(WHATSAPP_DIRECTION_OPTIONS).map((o) => ({ value: o.value, label: o.label, color: o.color })) }
                    : role === 'status'
                      ? { options: Object.values(WHATSAPP_STATUS_OPTIONS).map((o) => ({ value: o.value, label: o.label, color: o.color })) }
                      : undefined;
            const created = await this.fields.create(tenantId, String(list.id), {
                label: meta.create.label,
                slug: current.some((f) => f.slug === meta.slug) ? undefined : meta.slug,
                type: meta.create.type as FieldType,
                ...(config ? { config } : {}),
            } as never);
            mapping[role] = created.id;
        }
        await this.saveListFields(tenantId, actor, list, mapping);
        return this.listColumns(tenantId, String(list.id));
    }

    // ── Escribir en el registro ─────────────────────────────────────────

    /**
     * Escribe el canal en las columnas mapeadas del registro (las que sigan
     * existiendo). Cada valor pasa por el validador del campo: si la persona
     * cambió las opciones de «Estado», ese valor se saltea en vez de romper.
     * Sin diff en la actividad: el texto no queda en el historial (la entrada
     * propia «whatsapp» la escribe quien llama).
     */
    async writeChannelInTx(
        tx: Tx,
        tenantId: number,
        listId: number,
        recordId: number,
        values: Partial<Record<WhatsappFieldRole, unknown>>,
        /** v0.1.391 — lo que quien llama ya leyó en esta transacción (no se vuelve a leer). */
        pre?: { settings: unknown; fields: Field[] },
    ): Promise<ChannelWrite | null> {
        let settings: unknown = pre?.settings;
        if (!pre) {
            const [list] = await tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId), isNull(lists.deletedAt)))
                .limit(1);
            if (!list) return null;
            settings = list.settings;
        }
        const mapping = readWhatsappListFields(settings);
        const ids = WHATSAPP_FIELD_ROLES.filter((r) => r in values).map((r) => mapping[r]).filter((id): id is number => id !== null);
        if (ids.length === 0) return null;
        const fieldRows = pre?.fields ?? (await this.fields.listByListIdWithinTx(tx, tenantId, listId));
        const record = await this.recordsRepo.findByIdForUpdate(tx, tenantId, listId, recordId);
        if (!record) return null;
        const before = record.data as Record<string, unknown>;
        const after = { ...before };
        for (const role of WHATSAPP_FIELD_ROLES) {
            if (!(role in values)) continue;
            const fieldId = mapping[role];
            const field = fieldId ? fieldRows.find((f) => f.id === fieldId) : undefined;
            if (!field) continue;
            const key = jsonbKeyForField(field.id);
            const raw = channelValue(role, values[role], field);
            if (raw === null) {
                delete after[key];
                continue;
            }
            const v = validateFieldValue({ type: field.type as FieldType, config: field.config, is_required: false }, raw);
            if (v.ok) after[key] = v.value;
        }
        if (JSON.stringify(before) === JSON.stringify(after)) return null;
        const updated = await this.recordsRepo.updateData(tx, tenantId, listId, recordId, after, 0);
        if (!updated) return null;
        return { listId, recordId, before, after: updated.data as Record<string, unknown> };
    }

    /** Después de escribir: pantallas abiertas y campos con IA (sin disparar automatizaciones). */
    private afterWrite(tenantId: number, write: ChannelWrite | null): void {
        if (!write) return;
        this.emitRecords(tenantId, write.listId);
        void this.aiFields
            ?.onChange({ tenantId, listId: write.listId, recordId: write.recordId, before: write.before, after: write.after, kind: 'updated', actorId: 0 })
            .catch(() => undefined);
    }

    private readonly pendingEmits = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * v0.1.391 — Una ráfaga de mensajes (o de estados tras un envío masivo)
     * avisa a las pantallas abiertas UNA vez por segundo: antes, cada pestaña
     * con la lista abierta la recargaba por cada mensaje.
     */
    private emitRecords(tenantId: number, listId: number): void {
        if (this.env.NODE_ENV === 'test') {
            this.realtime.records(tenantId, listId);
            return;
        }
        const key = `${tenantId}:${listId}`;
        if (this.pendingEmits.has(key)) return;
        const timer = setTimeout(() => {
            this.pendingEmits.delete(key);
            this.realtime.records(tenantId, listId);
        }, 1_000);
        timer.unref?.();
        this.pendingEmits.set(key, timer);
    }

    // ── Mensajes entrantes ──────────────────────────────────────────────

    /**
     * Un mensaje de un contacto: abre (o renueva) su ventana de 24 h, busca el
     * registro por teléfono en la lista de entrada (o lo crea), escribe el
     * último mensaje y corre «Cuando llega un mensaje de WhatsApp». Un mensaje
     * ya procesado (Meta reintenta) no se procesa dos veces.
     */
    async handleInbound(tenantId: number, hookConnectionId: number, msg: InboundMessage): Promise<'duplicate' | 'ignored' | 'processed'> {
        const first = await this.redis.set(seenKey(tenantId, `m:${msg.id}`), '1', 'EX', DEDUP_TTL_S, 'NX');
        if (first === null) return 'duplicate';
        // v0.1.391 — Un cliente que manda 3 mensajes seguidos: se procesan de a uno.
        // En paralelo, ninguno encontraba el registro y cada uno creaba el suyo.
        const lockKey = `wa:lock:${tenantId}:${hookConnectionId}:${msg.waId}`;
        let locked = false;
        for (let i = 0; i < 100 && !locked; i++) {
            locked = (await this.redis.set(lockKey, '1', 'PX', 15_000, 'NX')) !== null;
            if (!locked) await new Promise((r) => setTimeout(r, 50));
        }
        try {
            return await this.handleInboundOnce(tenantId, hookConnectionId, msg);
        } catch (err) {
            // Que el reintento de la cola lo vuelva a intentar.
            await this.redis.del(seenKey(tenantId, `m:${msg.id}`)).catch(() => undefined);
            throw err;
        } finally {
            if (locked) await this.redis.del(lockKey).catch(() => undefined);
        }
    }

    /**
     * v0.1.391 — Antes, 6-8 transacciones por mensaje; ahora, con el contacto
     * ya en la lista, UNA: la conexión, la ventana, la lista, el contacto, sus
     * columnas y la actividad. Crear un contacto nuevo suma la del alta.
     */
    private async handleInboundOnce(tenantId: number, hookConnectionId: number, msg: InboundMessage): Promise<'ignored' | 'processed'> {
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const conn = await this.resolveConnection(tx, tenantId, hookConnectionId, msg.phoneNumberId);
            if (!conn) return null;
            await tx
                .insert(whatsappContacts)
                .values({ tenantId, connectionId: conn.id, phone: msg.waId, profileName: msg.profileName, lastInboundAt: msg.at })
                .onConflictDoUpdate({
                    target: [whatsappContacts.connectionId, whatsappContacts.phone],
                    set: {
                        // Un aviso viejo que llega tarde no achica la ventana.
                        lastInboundAt: sql`GREATEST(${whatsappContacts.lastInboundAt}, ${msg.at.toISOString()}::timestamptz)`,
                        ...(msg.profileName ? { profileName: msg.profileName } : {}),
                        updatedAt: new Date(),
                    },
                });
            const cfg = readWhatsappConnectionConfig(conn.config);
            if (!cfg.inbound_list_id) return { conn, cfg, list: null };
            const [list] = await tx
                .select({ id: lists.id, name: lists.name, settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, cfg.inbound_list_id), isNull(lists.deletedAt)))
                .limit(1);
            if (!list) return { conn, cfg, list: null };
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const mapping = effectiveMapping(list.settings, fields);
            if (!mapping.phone) return { conn, cfg, list, fields, mapping, recordId: null, done: null };
            const recordId = await findByPhone(tx, tenantId, list.id, mapping.phone, msg.waId);
            const done = recordId !== null ? await this.recordInboundInTx(tx, tenantId, conn, list, recordId, msg, fields) : null;
            return { conn, cfg, list, fields, mapping, recordId, done };
        });
        if (!prep) return 'ignored';
        const { conn, cfg, list } = prep;
        if (!list || !prep.mapping || !prep.fields) return 'processed';
        if (!prep.mapping.phone) {
            this.logger.warn(`WhatsApp: la lista ${list.id} no tiene campo de teléfono para encontrar al contacto.`);
            return 'processed';
        }
        const phone = `+${msg.waId}`;
        let recordId = prep.recordId;
        let done = prep.done;
        if (recordId === null) {
            if (!cfg.create_contacts || !this.recordsSvc) return 'processed';
            const fields = prep.fields;
            const data: Record<string, unknown> = { [jsonbKeyForField(prep.mapping.phone)]: phone };
            const titleId = resolveTitleFieldId(fields, list.settings);
            const titleField = titleId ? fields.find((f) => f.id === titleId) : undefined;
            if (titleField && titleField.id !== prep.mapping.phone && (titleField.type === 'text' || titleField.type === 'long_text')) {
                data[jsonbKeyForField(titleField.id)] = msg.profileName ?? phone;
            }
            try {
                const created = await this.recordsSvc.create(tenantId, SYSTEM_ACTOR, String(list.id), { data }, { lenientRequired: true });
                recordId = created.id;
            } catch (err) {
                this.logger.warn(`WhatsApp: no se pudo crear el contacto en la lista ${list.id}: ${String(err)}`);
                this.incidents?.report({
                    tenantId,
                    key: `connection:${conn.id}:inbound`,
                    source: 'connection',
                    sourceId: conn.id,
                    listId: list.id,
                    ownerId: conn.ownerUserId,
                    title: `Un mensaje de WhatsApp no se pudo guardar en «${list.name}»`,
                    message: `Llegó un mensaje de un número nuevo y no se pudo crear su registro: ${err instanceof Error ? err.message : String(err)}`,
                });
                return 'processed';
            }
            const rid = recordId;
            done = await this.tenantDb.withTenant(tenantId, (tx) => this.recordInboundInTx(tx, tenantId, conn, list, rid, msg, fields));
        }
        if (recordId === null || !done) return 'processed';
        this.afterWrite(tenantId, done.write);
        this.incidents?.resolve(tenantId, `connection:${conn.id}:inbound`);
        const info: WhatsappEventInfo = {
            texto: msg.text,
            de: phone,
            nombre: msg.profileName ?? '',
            tipo: msg.type,
            conexion: conn.name,
            conexion_id: conn.id,
            mensaje_id: msg.id,
            fecha: msg.at.toISOString(),
        };
        this.dispatcher.dispatch({
            tenantId,
            listId: list.id,
            recordId,
            trigger: 'whatsapp_message_received',
            after: done.after,
            ...(done.write ? { before: done.write.before } : {}),
            whatsapp: info,
        });
        return 'processed';
    }

    /**
     * El mensaje en el registro: sus columnas y UNA línea de la actividad. Varios
     * mensajes seguidos del mismo contacto (30 min) suman en la misma línea
     * («escribió 5 mensajes»): con un cliente que conversa, una fila por mensaje
     * llenaba la actividad y la base sin decir nada nuevo.
     */
    private async recordInboundInTx(
        tx: Tx,
        tenantId: number,
        conn: Pick<ConnRow, 'id' | 'name'>,
        list: { id: number; settings: unknown },
        recordId: number,
        msg: InboundMessage,
        fields: Field[],
    ): Promise<{ write: ChannelWrite | null; after: Record<string, unknown> } | null> {
        const write = await this.writeChannelInTx(
            tx,
            tenantId,
            list.id,
            recordId,
            { message: msg.text, message_at: msg.at, direction: 'in', ...(msg.profileName ? { profile: msg.profileName } : {}) },
            { settings: list.settings, fields },
        );
        const [last] = await tx
            .select({ id: activity.id, action: activity.action, diff: activity.diff, createdAt: activity.createdAt })
            .from(activity)
            .where(and(eq(activity.tenantId, tenantId), eq(activity.recordId, recordId)))
            .orderBy(desc(activity.id))
            .limit(1);
        const lastWa = last && last.action === 'whatsapp' ? ((last.diff as Record<string, unknown>).whatsapp as Record<string, unknown> | undefined) : undefined;
        if (last && lastWa && lastWa.event === 'received' && lastWa.connection === conn.name && last.createdAt.getTime() > Date.now() - ACTIVITY_GROUP_MS) {
            const count = Math.max(1, Number(lastWa.count) || 1) + 1;
            await tx
                .update(activity)
                .set({ diff: { whatsapp: { ...lastWa, count, kind: msg.type, last_at: msg.at.toISOString() } } })
                .where(and(eq(activity.tenantId, tenantId), eq(activity.id, last.id)));
        } else {
            await this.activity.logInTx(tx, {
                tenantId,
                listId: list.id,
                recordId,
                userId: null,
                action: 'whatsapp',
                diff: { whatsapp: { event: 'received', kind: msg.type, connection: conn.name } },
            });
        }
        if (write) return { write, after: write.after };
        const row = await this.recordsRepo.findById(tx, tenantId, list.id, recordId);
        if (!row) return null;
        return { write: null, after: row.data as Record<string, unknown> };
    }

    // ── Estados de lo enviado ───────────────────────────────────────────

    async handleStatus(tenantId: number, hookConnectionId: number, st: StatusUpdate): Promise<'duplicate' | 'ignored' | 'processed'> {
        const incoming = whatsappStatusFromMeta(st.status);
        if (!incoming) return 'ignored';
        // v0.1.391 — Sin recordarlo en Redis: aplicar dos veces el mismo estado no
        // cambia nada (nunca retrocede) y cada clave ocupaba memoria 7 días.
        return this.handleStatusOnce(tenantId, hookConnectionId, st, incoming);
    }

    private async handleStatusOnce(tenantId: number, hookConnectionId: number, st: StatusUpdate, incoming: WhatsappStatus): Promise<'ignored' | 'processed'> {
        const firstError = st.errors[0];
        const metaErr: MetaError | null = firstError
            ? { status: 200, code: firstError.code, subcode: null, type: null, message: firstError.message || firstError.title, details: firstError.details }
            : null;
        // v0.1.389 — Imagina WAS ya trae el motivo en palabras (`detail`).
        const web = st.detail !== undefined;
        const detail =
            incoming === 'fallido'
                ? web
                    ? (st.detail ?? 'No se pudo entregar el mensaje.')
                    : metaErr
                      ? metaErrorText(metaErr)
                      : 'Meta no pudo entregar el mensaje.'
                : null;
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const conn = await this.resolveConnection(tx, tenantId, hookConnectionId, st.phoneNumberId);
            if (!conn) return null;
            const [contact] = await tx
                .select()
                .from(whatsappContacts)
                .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.connectionId, conn.id), eq(whatsappContacts.lastOutboundWamid, st.id)))
                .limit(1)
                .for('update');
            // Un estado de un envío viejo (ya hubo otro después) no toca nada.
            if (!contact) return { conn, write: null, changed: false };
            const next = nextWhatsappStatus((contact.lastOutboundStatus as WhatsappStatus | null) ?? null, incoming);
            if (next === null) return { conn, write: null, changed: false };
            await tx
                .update(whatsappContacts)
                .set({ lastOutboundStatus: next, lastOutboundError: next === 'fallido' ? detail : null, updatedAt: new Date() })
                .where(eq(whatsappContacts.id, contact.id));
            let write = null;
            if (contact.lastOutboundRecordId && contact.lastOutboundListId) {
                write = await this.writeChannelInTx(tx, tenantId, contact.lastOutboundListId, contact.lastOutboundRecordId, {
                    status: next,
                    status_detail: next === 'fallido' ? detail : null,
                });
            }
            return { conn, write, changed: true };
        });
        if (!out) return 'ignored';
        this.afterWrite(tenantId, out.write);
        if (incoming === 'fallido' && (web ? st.systemic === true : metaErr !== null && isSystemicMetaError(metaErr))) {
            this.reportConnection(tenantId, out.conn.id, out.conn, detail ?? 'No se pudo entregar el mensaje.');
        }
        return 'processed';
    }

    // ── Enviar ──────────────────────────────────────────────────────────

    /**
     * Arma un envío: credenciales, destinatario, ventana (texto libre) y
     * plantilla. Lanza `WhatsappSendError` con un motivo legible; NO manda nada.
     */
    async prepareSendInTx(
        tx: Tx,
        tenantId: number,
        args: {
            connectionId: number;
            kind: 'template' | 'text' | 'media';
            to: string;
            template?: string;
            language?: string;
            variables?: Record<string, string>;
            headerMedia?: string;
            headerFilename?: string;
            text?: string;
            previewUrl?: boolean;
            /** v0.1.389 — Imagina WAS: el archivo (enlace https) y su texto. */
            mediaUrl?: string;
            caption?: string;
        },
    ): Promise<PreparedSend> {
        const conn = await this.connRow(tx, tenantId, args.connectionId);
        if (!conn) throw new WhatsappSendError('La conexión de WhatsApp ya no existe: revisa la acción.', 'connection_missing');
        if (conn.provider === 'whatsapp_web') return this.prepareWebSendInTx(tx, tenantId, conn, args);
        if (args.kind === 'media') throw new WhatsappSendError('Con la API oficial de Meta los archivos van en el encabezado de una plantilla.', 'media_unsupported');
        let creds: WhatsappCreds;
        try {
            const out = await this.connectors.integrationCredsInTx(tx, tenantId, args.connectionId);
            if (!out) throw new WhatsappSendError('La conexión de WhatsApp ya no existe.', 'connection_missing');
            creds = whatsappCreds(out.creds);
        } catch (err) {
            if (err instanceof ConnectionUnusableError) {
                this.reportConnection(tenantId, conn.id, conn, err.message);
                throw new WhatsappSendError(err.message, 'connection_unusable');
            }
            throw err;
        }
        const fieldsCfg = (conn.config.fields ?? {}) as Record<string, string>;
        const dest = whatsappRecipient(args.to, whatsappCountryOf(fieldsCfg.display_phone));
        if (!dest.ok) {
            throw new WhatsappSendError(args.to.trim() === '' ? 'Falta el número de destino.' : `El número de destino no sirve: ${dest.error}`, 'bad_recipient');
        }
        const base = {
            tenantId,
            provider: 'whatsapp_cloud' as const,
            connection: { id: conn.id, name: conn.name, ownerUserId: conn.ownerUserId },
            creds,
            web: null,
            to: dest.digits,
        };
        if (args.kind === 'text') {
            const text = (args.text ?? '').trim();
            if (text === '') throw new WhatsappSendError('El mensaje está vacío.', 'empty');
            const variants = whatsappIdVariants(dest.digits);
            const [contact] = await tx
                .select({ lastInboundAt: whatsappContacts.lastInboundAt })
                .from(whatsappContacts)
                .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.connectionId, conn.id), inArray(whatsappContacts.phone, variants)))
                .orderBy(desc(whatsappContacts.lastInboundAt))
                .limit(1);
            if (!whatsappWindowOpen(contact?.lastInboundAt ?? null)) throw new WhatsappSendError(WHATSAPP_WINDOW_CLOSED, 'window_closed');
            return { ...base, kind: 'text', payload: textPayload(dest.digits, text, args.previewUrl === true), text, template: null };
        }
        const name = (args.template ?? '').trim();
        if (name === '') throw new WhatsappSendError('Elige la plantilla.', 'template_missing');
        const rows = await tx
            .select()
            .from(whatsappTemplates)
            .where(and(eq(whatsappTemplates.tenantId, tenantId), eq(whatsappTemplates.connectionId, conn.id), eq(whatsappTemplates.name, name)));
        const lang = (args.language ?? '').trim();
        const tpl = pickTemplate(rows, lang);
        if (!tpl) {
            throw new WhatsappSendError(
                `La plantilla «${name}»${lang ? ` (${lang})` : ''} no está en la cuenta: créala en Meta y toca «Actualizar plantillas».`,
                'template_missing',
            );
        }
        if (tpl.status !== 'APPROVED') {
            throw new WhatsappSendError(`La plantilla «${name}» (${tpl.language}) no está aprobada por Meta (estado: ${tpl.status || 'desconocido'}).`, 'template_not_approved');
        }
        const built = buildWhatsappTemplateComponents(tpl.components, tpl.parameterFormat, {
            variables: args.variables ?? {},
            header_media: args.headerMedia,
            header_filename: args.headerFilename,
        });
        if (!built.ok) throw new WhatsappSendError(`Plantilla «${name}»: ${built.error}`, 'template_params');
        const rendered = renderWhatsappTemplate(tpl.components, tpl.parameterFormat, args.variables ?? {});
        return {
            ...base,
            kind: 'template',
            payload: templatePayload(dest.digits, tpl.name, tpl.language, built.components),
            text: rendered.text,
            template: { name: tpl.name, language: tpl.language },
        };
    }

    /**
     * v0.1.389 — Imagina WAS: sin plantillas ni ventana de 24 h (es un número
     * vinculado). Texto o un archivo por enlace https. El número de destino se
     * completa con el indicativo del número de la empresa si viene sin él.
     */
    private prepareWebSendInTx(
        tx: Tx,
        tenantId: number,
        conn: ConnRow,
        args: Parameters<WhatsappService['prepareSendInTx']>[2],
    ): Promise<PreparedSend> {
        return (async () => {
            let creds: WaWebCreds;
            try {
                const out = await this.connectors.integrationCredsInTx(tx, tenantId, conn.id);
                if (!out) throw new WhatsappSendError('La conexión de WhatsApp ya no existe.', 'connection_missing');
                creds = waWebCreds(out.creds);
            } catch (err) {
                if (err instanceof ConnectionUnusableError) {
                    this.reportConnection(tenantId, conn.id, conn, err.message);
                    throw new WhatsappSendError(err.message, 'connection_unusable');
                }
                throw err;
            }
            if (creds.accountId === null) {
                throw new WhatsappSendError('La conexión no tiene un número elegido: actualízala en Integraciones y elige el número.', 'connection_unusable');
            }
            const fieldsCfg = (conn.config.fields ?? {}) as Record<string, string>;
            const dest = whatsappRecipient(args.to, whatsappCountryOf(fieldsCfg.account_phone));
            if (!dest.ok) {
                throw new WhatsappSendError(args.to.trim() === '' ? 'Falta el número de destino.' : `El número de destino no sirve: ${dest.error}`, 'bad_recipient');
            }
            const base = {
                tenantId,
                provider: 'whatsapp_web' as const,
                connection: { id: conn.id, name: conn.name, ownerUserId: conn.ownerUserId },
                creds: null,
                to: dest.digits,
                template: null,
            };
            if (args.kind === 'template') {
                throw new WhatsappSendError('WAS no usa plantillas: elige «Mensaje» o «Archivo».', 'template_unsupported');
            }
            if (args.kind === 'media') {
                const url = (args.mediaUrl ?? '').trim();
                if (url === '') throw new WhatsappSendError('Falta el enlace del archivo.', 'empty');
                if (!/^https:\/\//i.test(url)) throw new WhatsappSendError('El enlace del archivo tiene que empezar con https://', 'bad_media');
                const caption = (args.caption ?? '').trim();
                const payload: WaWebPayload = { kind: 'media', to: dest.digits, url, caption };
                const name = decodeURIComponent(url.split(/[?#]/)[0]!.split('/').pop() || 'archivo');
                return { ...base, kind: 'media', web: { creds, payload }, payload: { ...payload }, text: caption !== '' ? `[Archivo] ${name} · ${caption}` : `[Archivo] ${name}` };
            }
            const text = (args.text ?? '').trim();
            if (text === '') throw new WhatsappSendError('El mensaje está vacío.', 'empty');
            const payload: WaWebPayload = { kind: 'text', to: dest.digits, text: args.text ?? '' };
            return { ...base, kind: 'text', web: { creds, payload }, payload: { ...payload }, text };
        })();
    }

    /** Manda el envío (fuera de cualquier transacción si se puede). */
    async execute(p: PreparedSend): Promise<Executed> {
        if (p.web) return this.executeWeb(p, p.web.creds, p.web.payload);
        const creds = p.creds!;
        const req = sendRequest(this.graph, creds, p.payload);
        try {
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, body: req.body, captureBody: true, timeoutMs: SEND_TIMEOUT_MS });
            const body = res.body ?? '';
            const parsed = parseSendResponse(res.status, body);
            if (parsed.ok) return { ok: true, wamid: parsed.wamid, status: res.status, body, errorText: null, systemic: false, errorCode: null, network: null };
            return {
                ok: false,
                wamid: null,
                status: res.status,
                body,
                errorText: metaErrorText(parsed.error),
                systemic: isSystemicMetaError(parsed.error),
                errorCode: parsed.error.code,
                network: null,
            };
        } catch (err) {
            return {
                ok: false,
                wamid: null,
                status: null,
                body: '',
                errorText: null,
                systemic: false,
                errorCode: null,
                network: `No pudimos comunicarnos con Meta (${redactValues(err instanceof Error ? err.message : String(err), [creds.token, creds.appSecret])}).`,
            };
        }
    }

    private async executeWeb(p: PreparedSend, creds: WaWebCreds, payload: WaWebPayload): Promise<Executed> {
        const req = waWebSendRequest(creds, payload);
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
                maxCaptureBytes: 64 * 1024,
                timeoutMs: SEND_TIMEOUT_MS,
            });
            const body = res.body ?? '';
            const parsed = parseWaWebSend(res.status, body);
            if (parsed.ok) return { ok: true, wamid: parsed.id, status: res.status, body, errorText: null, systemic: false, errorCode: null, network: null };
            return {
                ok: false,
                wamid: null,
                status: res.status,
                body,
                errorText: waWebErrorText(parsed.error),
                systemic: isSystemicWaWebError(parsed.error),
                errorCode: parsed.error.code,
                network: null,
            };
        } catch (err) {
            return {
                ok: false,
                wamid: null,
                status: null,
                body: '',
                errorText: null,
                systemic: false,
                errorCode: null,
                network: `No pudimos comunicarnos con el servidor de WhatsApp (${redactValues(err instanceof Error ? err.message : String(err), [creds.key])}).`,
            };
        }
    }

    /** El motivo legible de un envío que no salió (y si es de la conexión, abre un problema). */
    failureText(p: PreparedSend, ex: Executed): string {
        if (ex.network) return ex.network;
        const text = ex.errorText ?? 'No se pudo enviar.';
        if (ex.systemic) this.reportConnection(p.tenantId, p.connection.id, { name: p.connection.name, ownerUserId: p.connection.ownerUserId }, text);
        return text;
    }

    /**
     * Lo que queda de un envío que SÍ salió: el contacto (último envío y su
     * estado) y, si hay registro, sus columnas y la actividad «se envió…».
     */
    async persistSentInTx(
        tx: Tx,
        p: PreparedSend,
        wamid: string,
        target: { listId: number | null; recordId: number | null; userId: number | null },
    ): Promise<{ listId: number; recordId: number; before: Record<string, unknown>; after: Record<string, unknown> } | null> {
        const now = new Date();
        await tx
            .insert(whatsappContacts)
            .values({
                tenantId: p.tenantId,
                connectionId: p.connection.id,
                phone: p.to,
                lastOutboundAt: now,
                lastOutboundWamid: wamid,
                lastOutboundStatus: 'enviado',
                lastOutboundError: null,
                lastOutboundListId: target.listId,
                lastOutboundRecordId: target.recordId,
            })
            .onConflictDoUpdate({
                target: [whatsappContacts.connectionId, whatsappContacts.phone],
                set: {
                    lastOutboundAt: now,
                    lastOutboundWamid: wamid,
                    lastOutboundStatus: 'enviado',
                    lastOutboundError: null,
                    lastOutboundListId: target.listId,
                    lastOutboundRecordId: target.recordId,
                    updatedAt: now,
                },
            });
        if (target.listId === null || target.recordId === null) return null;
        const write = await this.writeChannelInTx(tx, p.tenantId, target.listId, target.recordId, {
            message: p.text,
            message_at: now,
            direction: 'out',
            status: 'enviado',
            status_detail: null,
        });
        await this.activity.logInTx(tx, {
            tenantId: p.tenantId,
            listId: target.listId,
            recordId: target.recordId,
            userId: target.userId,
            action: 'whatsapp',
            diff: {
                whatsapp: {
                    event: 'sent',
                    kind: p.kind,
                    ...(p.template ? { template: p.template.name, language: p.template.language } : {}),
                    connection: p.connection.name,
                },
            },
        });
        return write;
    }

    /** Lo que se muestra de la petición (sin el token ni el `appsecret_proof`; la clave de Imagina WAS va en una cabecera que no se muestra). */
    shownRequest(p: PreparedSend): { url: string; body: string } {
        if (p.web) {
            const req = waWebSendRequest(p.web.creds, p.web.payload);
            return { url: req.url, body: req.body ?? '' };
        }
        const req = sendRequest(this.graph, p.creds!, p.payload);
        return { url: shownUrl(req.url), body: req.body ?? '' };
    }

    // ── Ficha del registro ──────────────────────────────────────────────

    private async recordFor(
        tenantId: number,
        actor: WhatsappActor,
        listIdOrSlug: string,
        recordId: number,
        action: 'view' | 'edit',
    ): Promise<{ list: List; fields: Field[]; data: Record<string, unknown> }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, recordId));
        if (!row || !listRowInScope(list.settings, actor, action, { id: row.id, createdBy: row.createdBy, data: row.data })) {
            throw new NotFoundException({ code: 'record_not_found', message: `Registro ${recordId} no encontrado`, data: { status: 404 } });
        }
        const fields = await this.fields.listByListId(tenantId, list.id);
        return { list, fields, data: row.data as Record<string, unknown> };
    }

    async recordInfo(tenantId: number, actor: WhatsappActor, listIdOrSlug: string, recordId: number): Promise<WhatsappRecordInfo> {
        const { list, fields, data } = await this.recordFor(tenantId, actor, listIdOrSlug, recordId, 'view');
        const phoneRaw = visiblePhone(list, fields, data, hiddenFieldsFor(list.settings, actor));
        const recipient = typeof phoneRaw === 'string' && phoneRaw.trim() !== '' ? phoneRaw.trim() : null;
        const conns = (await this.connectors.list(tenantId, actor.userId, actor.role)).filter((c) => isWhatsappProvider(c.integration_key));
        const canEdit = can({ role: actor.role, capabilities: actor.capabilities }, 'edit_records') || can({ role: actor.role, capabilities: actor.capabilities }, 'edit_own_records');
        let canSend = false;
        if (canEdit) {
            const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, recordId));
            canSend = row !== null && listRowInScope(list.settings, actor, 'edit', { id: row.id, createdBy: row.createdBy, data: row.data });
        }
        const out: WhatsappRecordInfo['connections'] = [];
        for (const c of conns) {
            const country = whatsappCountryOf(c.account_label?.split(' · ')[0] ?? null);
            const dest = recipient ? whatsappRecipient(recipient, country) : null;
            const variants = dest && dest.ok ? whatsappIdVariants(dest.digits) : [];
            const contact = variants.length
                ? (
                      await this.tenantDb.withTenant(tenantId, (tx) =>
                          tx
                              .select()
                              .from(whatsappContacts)
                              .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.connectionId, c.id), inArray(whatsappContacts.phone, variants)))
                              .orderBy(desc(whatsappContacts.updatedAt))
                              .limit(1),
                      )
                  )[0]
                : undefined;
            const provider = c.integration_key as WhatsappProvider;
            // v0.1.389 — Imagina WAS no tiene ventana de 24 h: el texto sale siempre.
            const web = provider === 'whatsapp_web';
            const closes = web ? null : whatsappWindowClosesAt(contact?.lastInboundAt ?? null);
            out.push({
                id: c.id,
                provider,
                name: c.name,
                display_phone: c.account_label,
                window_open: web ? true : whatsappWindowOpen(contact?.lastInboundAt ?? null),
                last_inbound_at: contact?.lastInboundAt ? contact.lastInboundAt.toISOString() : null,
                window_closes_at: closes ? closes.toISOString() : null,
                last_status: (contact?.lastOutboundStatus as WhatsappStatus | null) ?? null,
                last_status_detail: contact?.lastOutboundError ?? null,
                last_outbound_at: contact?.lastOutboundAt ? contact.lastOutboundAt.toISOString() : null,
                templates: web ? [] : await this.templatesOf(tenantId, c.id, true),
            });
        }
        const hasColumns = Object.values(readWhatsappListFields(list.settings)).some((v) => v !== null);
        const canSetup = can({ role: actor.role, capabilities: actor.capabilities }, 'manage_fields');
        return { connections: out, recipient, has_columns: hasColumns, can_send: canSend && out.length > 0, can_setup: canSetup };
    }

    /** Merge de variables contra un registro, SIN los campos ocultos para quien pide. */
    private async mergerFor(
        tenantId: number,
        list: List,
        fields: Field[],
        data: Record<string, unknown>,
        recordId: number,
        hidden: Set<string>,
    ): Promise<(s: string) => string> {
        const visible = fields.filter((f) => !hidden.has(f.slug));
        const bySlug = new Map<string, LabelFieldLike>(visible.map((f) => [f.slug, { type: f.type, config: f.config }]));
        const keyOf = new Map(visible.map((f) => [f.slug, jsonbKeyForField(f.id)]));
        const format = await readTenantFormat(this.tenantDb, tenantId);
        const labels = labelResolverFor(bySlug);
        const formatter = regionalFormatterFor(bySlug, format, format.timezone ?? 'UTC');
        // v0.1.344 — {{registro.enlace}} / {{registro.qr}} (la imagen del QR sirve de encabezado).
        const link = recordId > 0 ? await recordLinkFor(tenantId, list.slug, recordId) : '';
        const fv = (token: string): unknown => {
            const recordToken = recordTokenValue(token, link);
            if (recordToken !== undefined) return recordToken;
            const key = keyOf.get(token);
            return key ? data[key] : undefined;
        };
        return (s: string) => applyMergeTags(s, fv, recordId, undefined, labels, formatter);
    }

    /** «Enviar WhatsApp» desde la ficha (exige poder editar el registro). */
    async sendFromRecord(tenantId: number, actor: WhatsappActor, listIdOrSlug: string, recordId: number, input: WhatsappSendInput): Promise<WhatsappSendResult> {
        const { list, fields, data } = await this.recordFor(tenantId, actor, listIdOrSlug, recordId, 'edit');
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).some(
            (c) => c.id === input.connection_id && isWhatsappProvider(c.integration_key),
        );
        if (!visible) throw this.notWhatsapp();
        const hidden = hiddenFieldsFor(list.settings, actor);
        const merge = await this.mergerFor(tenantId, list, fields, data, recordId, hidden);
        // Un teléfono oculto para el rol no se usa por defecto: la respuesta lo mostraría.
        const phoneRaw = visiblePhone(list, fields, data, hidden);
        const to = (input.to ?? '').trim() !== '' ? merge(input.to!) : typeof phoneRaw === 'string' ? phoneRaw : '';
        const variables: Record<string, string> = {};
        for (const [k, v] of Object.entries(input.variables ?? {})) variables[k] = merge(v);
        return this.sendAndPersist(tenantId, {
            connectionId: input.connection_id,
            kind: input.kind,
            to,
            template: input.template,
            language: input.language,
            variables,
            headerMedia: input.header_media ? merge(input.header_media) : undefined,
            headerFilename: input.header_filename ? merge(input.header_filename) : undefined,
            text: input.kind !== 'media' && input.text ? merge(input.text) : undefined,
            previewUrl: input.preview_url,
            mediaUrl: input.media_url ? merge(input.media_url) : undefined,
            caption: input.kind === 'media' && input.text ? merge(input.text) : undefined,
            target: { listId: list.id, recordId, userId: actor.userId },
        });
    }

    /**
     * «Probar ahora» del editor: resuelve las variables contra un registro real
     * de la lista y manda DE VERDAD al número que se escribió. No escribe en el
     * registro (es una prueba a un número cualquiera).
     */
    async testSend(tenantId: number, actor: WhatsappActor, listIdOrSlug: string, input: WhatsappTestSendInput): Promise<WhatsappSendResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).find(
            (c) => c.id === input.connection_id && isWhatsappProvider(c.integration_key),
        );
        if (!visible) throw this.notWhatsapp();
        const fields = await this.fields.listByListId(tenantId, list.id);
        const sample = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (input.record_id) {
                const row = await this.recordsRepo.findById(tx, tenantId, list.id, input.record_id);
                return row && listRowInScope(list.settings, actor, 'view', { id: row.id, createdBy: row.createdBy, data: row.data }) ? row : null;
            }
            // Sin registro elegido, el último que la persona ALCANZA (rol propio, equipos y alcance de la lista).
            const [row] = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(andWhere(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), isNull(records.deletedAt)), listScopeWhere(list.settings, actor, 'view')))
                .orderBy(desc(records.id))
                .limit(1);
            return row ?? null;
        });
        const data = (sample?.data ?? {}) as Record<string, unknown>;
        const hidden = hiddenFieldsFor(list.settings, actor);
        const merge = await this.mergerFor(tenantId, list, fields, data, sample?.id ?? 0, hidden);
        const v = input.values as Record<string, unknown>;
        // v0.1.389 — Imagina WAS: los datos se llaman como en la versión anterior (message, url, caption).
        const web = visible.integration_key === 'whatsapp_web';
        const result = await this.sendAndPersist(tenantId, {
            connectionId: input.connection_id,
            kind: input.kind,
            to: input.to,
            template: str(v.template),
            language: str(v.language),
            variables: mergeVariables(v.variables, merge),
            headerMedia: str(v.header_media) ? merge(str(v.header_media)) : undefined,
            headerFilename: str(v.header_filename) ? merge(str(v.header_filename)) : undefined,
            text: str(v.text) ? merge(str(v.text)) : undefined,
            previewUrl: ['true', '1', 'si', 'sí'].includes(str(v.preview_url).toLowerCase()),
            ...(web
                ? {
                      text: input.kind === 'text' && str(v.message) ? merge(str(v.message)) : undefined,
                      mediaUrl: str(v.url) ? merge(str(v.url)) : undefined,
                      caption: str(v.caption) ? merge(str(v.caption)) : undefined,
                  }
                : {}),
            target: { listId: null, recordId: null, userId: actor.userId },
        });
        return { ...result, sample_record_id: sample?.id ?? null };
    }

    private async sendAndPersist(
        tenantId: number,
        args: Parameters<WhatsappService['prepareSendInTx']>[2] & { target: { listId: number | null; recordId: number | null; userId: number | null } },
    ): Promise<WhatsappSendResult> {
        let prepared: PreparedSend;
        try {
            prepared = await this.tenantDb.withTenant(tenantId, (tx) => this.prepareSendInTx(tx, tenantId, args));
        } catch (err) {
            if (err instanceof WhatsappSendError) {
                return { ok: false, message_id: null, to: args.to, text: '', status: null, error: err.message, request: null, response: null };
            }
            throw err;
        }
        const ex = await this.execute(prepared);
        const shown = this.shownRequest(prepared);
        const response = ex.status !== null ? { status: ex.status, body: redactValues(ex.body, [prepared.creds?.token ?? prepared.web?.creds.key ?? '']).slice(0, 4000) } : null;
        if (!ex.ok || !ex.wamid) {
            return { ok: false, message_id: null, to: `+${prepared.to}`, text: prepared.text, status: null, error: this.failureText(prepared, ex), request: shown, response };
        }
        const wamid = ex.wamid;
        const write = await this.tenantDb.withTenant(tenantId, (tx) => this.persistSentInTx(tx, prepared, wamid, args.target));
        this.afterWrite(tenantId, write);
        if (args.target.listId !== null) this.realtime.records(tenantId, args.target.listId);
        this.connectionWorks(tenantId, prepared.connection.id);
        return { ok: true, message_id: wamid, to: `+${prepared.to}`, text: prepared.text, status: 'enviado', error: null, request: shown, response };
    }

    // ── Acciones de automatización ──────────────────────────────────────

    /**
     * «Enviar plantilla de WhatsApp» / «Enviar mensaje de texto de WhatsApp»
     * dentro de la corrida (y su transacción). Con `realCall = false` (la
     * simulación de «Probar» paso a paso) arma TODO —destinatario, ventana,
     * plantilla y variables— y dice qué mandaría, sin mandar.
     */
    async runAutomationAction(
        tx: Tx,
        args: {
            tenantId: number;
            listId: number;
            recordId: number | null;
            connectionId: number;
            actionKey: string;
            values: Record<string, unknown>;
            merge: (s: string) => string;
            realCall: boolean;
        },
    ): Promise<{
        status: 'success' | 'failed' | 'skipped';
        message: string;
        details: Record<string, unknown>;
        write: { listId: number; recordId: number; before: Record<string, unknown>; after: Record<string, unknown> } | null;
    }> {
        const v = args.values;
        // v0.1.389 — Imagina WAS: «Enviar mensaje» / «Enviar archivo», con los
        // datos que ya usaba la versión anterior (recipient, message, url, caption).
        const conn = await this.connRow(tx, args.tenantId, args.connectionId);
        const web = conn?.provider === 'whatsapp_web';
        const kind: 'text' | 'template' | 'media' | null = web
            ? args.actionKey === 'send_text'
                ? 'text'
                : args.actionKey === 'send_media'
                  ? 'media'
                  : null
            : args.actionKey === 'send_text'
              ? 'text'
              : args.actionKey === 'send_template'
                ? 'template'
                : null;
        if (kind === null) return { status: 'failed', message: `La acción «${args.actionKey}» no existe en WhatsApp.`, details: {}, write: null };
        let prepared: PreparedSend;
        try {
            prepared = await this.prepareSendInTx(
                tx,
                args.tenantId,
                web
                    ? {
                          connectionId: args.connectionId,
                          kind,
                          to: args.merge(str(v.recipient)),
                          text: kind === 'text' ? args.merge(str(v.message)) : undefined,
                          mediaUrl: kind === 'media' ? args.merge(str(v.url)) : undefined,
                          caption: kind === 'media' ? args.merge(str(v.caption)) : undefined,
                      }
                    : {
                          connectionId: args.connectionId,
                          kind,
                          to: args.merge(str(v.to)),
                          template: args.merge(str(v.template)),
                          language: args.merge(str(v.language)),
                          variables: mergeVariables(v.variables, args.merge),
                          headerMedia: str(v.header_media) ? args.merge(str(v.header_media)) : undefined,
                          headerFilename: str(v.header_filename) ? args.merge(str(v.header_filename)) : undefined,
                          text: kind === 'text' ? args.merge(str(v.text)) : undefined,
                          previewUrl: ['true', '1', 'si', 'sí'].includes(str(v.preview_url).toLowerCase()),
                      },
            );
        } catch (err) {
            if (err instanceof WhatsappSendError) return { status: 'failed', message: err.message, details: { code: err.code }, write: null };
            throw err;
        }
        const label = kind === 'template' ? `la plantilla «${prepared.template?.name}»` : kind === 'media' ? 'el archivo' : 'el mensaje de texto';
        const request = this.shownRequest(prepared);
        if (!args.realCall) {
            return {
                status: 'success',
                message: `Mandaría ${label} por WhatsApp a +${prepared.to}.`,
                details: { _sim: 'would_run', text: prepared.text, request },
                write: null,
            };
        }
        const ex = await this.execute(prepared);
        if (!ex.ok || !ex.wamid) {
            return {
                status: 'failed',
                message: `${whatsappConnLabel(prepared.connection.name)}: ${this.failureText(prepared, ex)}`,
                details: { status: ex.status, ...(ex.errorCode !== null ? { error_code: ex.errorCode } : {}) },
                write: null,
            };
        }
        const write = await this.persistSentInTx(tx, prepared, ex.wamid, { listId: args.recordId !== null ? args.listId : null, recordId: args.recordId, userId: null });
        this.afterWrite(args.tenantId, write);
        this.connectionWorks(args.tenantId, prepared.connection.id);
        return {
            status: 'success',
            message: `${prepared.connection.name} → envió ${label} a +${prepared.to}.`,
            details: { message_id: ex.wamid, to: `+${prepared.to}`, ...(prepared.template ? { template: prepared.template.name } : {}) },
            write,
        };
    }
}

// ── Helpers puros ───────────────────────────────────────────────────────

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/**
 * Las variables de una plantilla vienen como objeto (`{"body.1": "{{nombre}}"}`)
 * o, desde el asistente, como el mismo objeto en texto JSON. Cada valor se
 * resuelve contra el registro.
 */
export function mergeVariables(raw: unknown, merge: (s: string) => string): Record<string, string> {
    let obj: unknown = raw;
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try {
            obj = JSON.parse(raw);
        } catch {
            obj = {};
        }
    }
    const out: Record<string, string> = {};
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return out;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (!/^(header|body|button)\.[A-Za-z0-9_]+$/.test(k)) continue;
        out[k] = merge(str(v));
    }
    return out;
}

/** La plantilla por nombre e idioma (sin idioma: la aprobada, prefiriendo español). */
export function pickTemplate(rows: WhatsappTemplateRowDb[], language: string): WhatsappTemplateRowDb | null {
    if (rows.length === 0) return null;
    if (language !== '') return rows.find((r) => r.language === language) ?? rows.find((r) => r.language.toLowerCase() === language.toLowerCase()) ?? null;
    const approved = rows.filter((r) => r.status === 'APPROVED');
    const pool = approved.length > 0 ? approved : rows;
    return pool.find((r) => r.language === 'es') ?? pool.find((r) => r.language.startsWith('es')) ?? pool[0] ?? null;
}

function toTemplateDto(r: WhatsappTemplateRowDb): WhatsappTemplate {
    return {
        id: r.id,
        meta_id: r.metaId,
        name: r.name,
        language: r.language,
        category: r.category,
        status: r.status,
        parameter_format: r.parameterFormat === 'NAMED' ? 'NAMED' : 'POSITIONAL',
        components: (r.components ?? []) as Array<Record<string, unknown>>,
        rejected_reason: r.rejectedReason,
        synced_at: r.syncedAt.toISOString(),
    };
}

/** Las columnas guardadas de la lista, con el teléfono sugerido si no se eligió. */
function effectiveMapping(settings: unknown, fields: Field[]): WhatsappListFields {
    const saved = readWhatsappListFields(settings);
    const alive = new Set(fields.map((f) => f.id));
    const out = {} as WhatsappListFields;
    for (const role of WHATSAPP_FIELD_ROLES) out[role] = saved[role] && alive.has(saved[role]) ? saved[role] : null;
    if (out.phone === null) out.phone = suggestWhatsappFields(fields).phone;
    return out;
}

function columnsOf(list: List, fields: Field[]): WhatsappListColumns {
    const saved = readWhatsappListFields(list.settings);
    const alive = new Set(fields.map((f) => f.id));
    const current = {} as WhatsappListFields;
    const candidates = {} as WhatsappListColumns['candidates'];
    for (const role of WHATSAPP_FIELD_ROLES) {
        current[role] = saved[role] && alive.has(saved[role]) ? saved[role] : null;
        candidates[role] = fields
            .filter((f) => WHATSAPP_FIELD_ROLE_META[role].types.includes(f.type))
            .map((f) => ({ id: f.id, label: f.label, type: f.type }));
    }
    return { list_id: list.id, list_name: list.name, fields: current, candidates };
}

/** El valor de una columna del canal en el tipo de su campo (o `null` para vaciarla). */
export function channelValue(role: WhatsappFieldRole, value: unknown, field: { type: string; config: Record<string, unknown> }): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (role === 'direction') {
        const opt = value === 'in' ? WHATSAPP_DIRECTION_OPTIONS.in : WHATSAPP_DIRECTION_OPTIONS.out;
        return field.type === 'select' ? opt.value : opt.label;
    }
    if (role === 'status') {
        const opt = WHATSAPP_STATUS_OPTIONS[value as WhatsappStatus];
        if (!opt) return null;
        return field.type === 'select' ? opt.value : opt.label;
    }
    if (role === 'message_at') {
        const d = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(d.getTime())) return null;
        return field.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
    }
    if (role === 'phone') return String(value);
    const text = String(value);
    return field.type === 'text' ? text.replace(/\s+/g, ' ').slice(0, 255) : text.slice(0, 4000);
}

/** El registro de la lista cuyo teléfono es ese número (cualquiera de sus formas). */
async function findByPhone(tx: Tx, tenantId: number, listId: number, phoneFieldId: number, waId: string): Promise<number | null> {
    const variants = whatsappIdVariants(waId);
    if (variants.length === 0) return null;
    const key = jsonbKeyForField(phoneFieldId);
    const [row] = await tx
        .select({ id: records.id })
        .from(records)
        .where(
            and(
                eq(records.tenantId, tenantId),
                eq(records.listId, listId),
                isNull(records.deletedAt),
                sql`regexp_replace(coalesce(${records.data} ->> ${key}, ''), '\\D', '', 'g') IN (${sql.join(
                    variants.map((v) => sql`${v}`),
                    sql`, `,
                )})`,
            ),
        )
        .orderBy(asc(records.id))
        .limit(1);
    return row?.id ?? null;
}

/** El teléfono del registro, salvo que el campo esté oculto para quien pide. */
function visiblePhone(list: List, fields: Field[], data: Record<string, unknown>, hidden: Set<string>): unknown {
    const mapping = effectiveMapping(list.settings, fields);
    if (!mapping.phone) return null;
    const field = fields.find((f) => f.id === mapping.phone);
    if (!field || hidden.has(field.slug)) return null;
    return data[jsonbKeyForField(field.id)];
}
