import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
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
    nextWhatsappStatus,
    whatsappTemplateManagerUrl,
    whatsappWindowClosesAt,
    whatsappWindowOpen,
    writeWhatsappListFields,
    validateFieldValue,
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
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { redactValues } from '../connectors/connection-parts';
import { ConnectionUnusableError, ConnectorsService } from '../connectors/connectors.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { connections, lists, records, whatsappContacts, whatsappHooks, whatsappTemplates, type WhatsappTemplateRowDb } from '../db/schema';
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
/** Meta reintenta un aviso durante días: un mensaje ya procesado se recuerda una semana. */
const DEDUP_TTL_S = 7 * 24 * 3600;

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
    connection: { id: number; name: string; ownerUserId: number | null };
    creds: WhatsappCreds;
    kind: 'template' | 'text';
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
    error: MetaError | null;
    /** Error de red (no llegó a Meta). */
    network: string | null;
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
    ) {}

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
        const hook = await this.hookByToken(token);
        if (!hook) throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        const mode = String(query['hub.mode'] ?? '');
        const given = String(query['hub.verify_token'] ?? '');
        const challenge = String(query['hub.challenge'] ?? '');
        if (mode !== 'subscribe' || given === '' || given !== hook.verifyToken) {
            throw new ForbiddenException({ code: 'verify_token_mismatch', message: 'El token de verificación no coincide.', data: { status: 403 } });
        }
        return challenge.slice(0, 200);
    }

    private async hookByToken(token: string): Promise<{ token: string; tenantId: number; connectionId: number; verifyToken: string } | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const [row] = await this.db
            .select({ token: whatsappHooks.token, tenantId: whatsappHooks.tenantId, connectionId: whatsappHooks.connectionId, verifyToken: whatsappHooks.verifyToken })
            .from(whatsappHooks)
            .where(eq(whatsappHooks.token, token))
            .limit(1);
        return row ?? null;
    }

    /**
     * POST de Meta. Firma mala → 401; token desconocido → 404 opaco. Lo que
     * trae se ENCOLA (Meta corta si no se le contesta rápido y reintenta), con
     * un id por mensaje/estado para no procesar dos veces el mismo aviso.
     */
    async receive(token: string, rawBody: string, signature: string | undefined): Promise<void> {
        const hook = await this.hookByToken(token);
        if (!hook) throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        const appSecret = await this.appSecretOf(hook.tenantId, hook.connectionId);
        if (appSecret === null || !verifyMetaSignature(appSecret, rawBody, signature)) {
            throw new UnauthorizedException({ code: 'bad_signature', message: 'Firma inválida', data: { status: 401 } });
        }
        await this.db.update(whatsappHooks).set({ lastHookAt: new Date() }).where(eq(whatsappHooks.token, token));
        let body: unknown;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return;
        }
        const parsed = parseMetaWebhook(body);
        const jobs: Array<{ job: WhatsappJob; dedup: string | null }> = [];
        for (const m of parsed.messages) {
            jobs.push({
                job: { kind: 'message', tenantId: hook.tenantId, connectionId: hook.connectionId, message: { ...m, at: m.at.toISOString() } },
                dedup: `m-${m.id}`,
            });
        }
        for (const s of parsed.statuses) {
            jobs.push({
                job: { kind: 'status', tenantId: hook.tenantId, connectionId: hook.connectionId, status: { ...s, at: s.at.toISOString() } },
                dedup: `s-${s.id}-${s.status}`,
            });
        }
        if (parsed.templateChanges > 0) {
            jobs.push({ job: { kind: 'templates', tenantId: hook.tenantId, connectionId: hook.connectionId }, dedup: null });
        }
        for (const { job, dedup } of jobs) {
            if (this.sink) await this.sink.add(job, dedup);
            else await this.process(job).catch((err: unknown) => this.logger.warn(`Aviso de WhatsApp: ${String(err)}`));
        }
    }

    /** La clave secreta de la app de la conexión (null si no hay o no se puede leer). */
    private async appSecretOf(tenantId: number, connectionId: number): Promise<string | null> {
        try {
            const out = await this.tenantDb.withTenant(tenantId, (tx) => this.connectors.integrationCredsInTx(tx, tenantId, connectionId));
            if (!out || out.provider !== 'whatsapp_cloud') return null;
            const secret = out.creds.signingSecret ?? '';
            return secret !== '' ? secret : null;
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
        return row && row.provider === 'whatsapp_cloud' ? (row as ConnRow) : null;
    }

    /**
     * La conexión de un aviso. La URL de avisos se configura por APP en Meta:
     * si la empresa conectó varios números de la misma app, todos los avisos
     * llegan a la misma URL — se enrutan por el número que los recibió.
     */
    private async resolveConnection(tx: Tx, tenantId: number, hookConnectionId: number, phoneNumberId: string): Promise<ConnRow | null> {
        const own = await this.connRow(tx, tenantId, hookConnectionId);
        const ownPhone = own ? String((own.config.fields as Record<string, unknown> | undefined)?.phone_number_id ?? '') : '';
        if (own && (phoneNumberId === '' || ownPhone === phoneNumberId)) return own;
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
            .where(and(eq(connections.tenantId, tenantId), eq(connections.provider, 'whatsapp_cloud')));
        const hit = rows.find((r) => String(((r.config as Record<string, unknown>).fields as Record<string, unknown> | undefined)?.phone_number_id ?? '') === phoneNumberId);
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
            return { row, cfg, f, templates, allLists, totals, lastErr };
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
        };
    }

    async updateConfig(tenantId: number, actor: WhatsappActor, connectionId: number, input: UpdateWhatsappConfigInput): Promise<WhatsappConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (editable.provider !== 'whatsapp_cloud') throw this.notWhatsapp();
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
        return this.connectionDetail(tenantId, actor, connectionId);
    }

    /**
     * Suscribe la app de Meta a la cuenta de WhatsApp Business (sin esto Meta
     * no manda los avisos de ESA cuenta) y, con `override`, le dice que los
     * mande a esta URL — el paso que si no hay que hacer a mano en Meta.
     */
    async subscribeApp(tenantId: number, actor: WhatsappActor, connectionId: number, override: boolean): Promise<WhatsappConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
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
    async usableConnections(tenantId: number, actor: WhatsappActor): Promise<Array<{ id: number; name: string; display_phone: string | null; templates: WhatsappTemplate[] }>> {
        const conns = (await this.connectors.list(tenantId, actor.userId, actor.role)).filter((c) => c.integration_key === 'whatsapp_cloud');
        const out = [];
        for (const c of conns) {
            out.push({ id: c.id, name: c.name, display_phone: c.account_label, templates: await this.templatesOf(tenantId, c.id, true) });
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
    ): Promise<{ listId: number; recordId: number; before: Record<string, unknown>; after: Record<string, unknown> } | null> {
        const [list] = await tx
            .select({ settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId), isNull(lists.deletedAt)))
            .limit(1);
        if (!list) return null;
        const mapping = readWhatsappListFields(list.settings);
        const ids = WHATSAPP_FIELD_ROLES.filter((r) => r in values).map((r) => mapping[r]).filter((id): id is number => id !== null);
        if (ids.length === 0) return null;
        const fieldRows = await this.fields.listByListIdWithinTx(tx, tenantId, listId);
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
    private afterWrite(tenantId: number, write: { listId: number; recordId: number; before: Record<string, unknown>; after: Record<string, unknown> } | null): void {
        if (!write) return;
        this.realtime.records(tenantId, write.listId);
        void this.aiFields
            ?.onChange({ tenantId, listId: write.listId, recordId: write.recordId, before: write.before, after: write.after, kind: 'updated', actorId: 0 })
            .catch(() => undefined);
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
        try {
            return await this.handleInboundOnce(tenantId, hookConnectionId, msg);
        } catch (err) {
            // Que el reintento de la cola lo vuelva a intentar.
            await this.redis.del(seenKey(tenantId, `m:${msg.id}`)).catch(() => undefined);
            throw err;
        }
    }

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
            return conn;
        });
        if (!prep) return 'ignored';
        const conn = prep;
        const cfg = readWhatsappConnectionConfig(conn.config);
        if (!cfg.inbound_list_id) return 'processed';
        let list: List;
        try {
            list = await this.lists.get(tenantId, String(cfg.inbound_list_id));
        } catch {
            return 'processed';
        }
        const fields = await this.fields.listByListId(tenantId, list.id);
        const mapping = effectiveMapping(list, fields);
        if (!mapping.phone) {
            this.logger.warn(`WhatsApp: la lista ${list.id} no tiene campo de teléfono para encontrar al contacto.`);
            return 'processed';
        }
        const phone = `+${msg.waId}`;
        let recordId = await this.tenantDb.withTenant(tenantId, (tx) => findByPhone(tx, tenantId, list.id, mapping.phone!, msg.waId));
        if (recordId === null && cfg.create_contacts && this.recordsSvc) {
            const data: Record<string, unknown> = { [jsonbKeyForField(mapping.phone)]: phone };
            const titleId = resolveTitleFieldId(fields, list.settings);
            const titleField = titleId ? fields.find((f) => f.id === titleId) : undefined;
            if (titleField && titleField.id !== mapping.phone && (titleField.type === 'text' || titleField.type === 'long_text')) {
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
        }
        if (recordId === null) return 'processed';
        const rid = recordId;
        const write = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const w = await this.writeChannelInTx(tx, tenantId, list.id, rid, {
                message: msg.text,
                message_at: msg.at,
                direction: 'in',
                ...(msg.profileName ? { profile: msg.profileName } : {}),
            });
            await this.activity.logInTx(tx, {
                tenantId,
                listId: list.id,
                recordId: rid,
                userId: null,
                action: 'whatsapp',
                diff: { whatsapp: { event: 'received', kind: msg.type, connection: conn.name } },
            });
            return w;
        });
        this.afterWrite(tenantId, write);
        this.realtime.records(tenantId, list.id);
        this.incidents?.resolve(tenantId, `connection:${conn.id}:inbound`);
        const after =
            write?.after ??
            ((await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, rid)))?.data as Record<string, unknown> | undefined) ??
            {};
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
            recordId: rid,
            trigger: 'whatsapp_message_received',
            after,
            ...(write ? { before: write.before } : {}),
            whatsapp: info,
        });
        return 'processed';
    }

    // ── Estados de lo enviado ───────────────────────────────────────────

    async handleStatus(tenantId: number, hookConnectionId: number, st: StatusUpdate): Promise<'duplicate' | 'ignored' | 'processed'> {
        const incoming = whatsappStatusFromMeta(st.status);
        if (!incoming) return 'ignored';
        const first = await this.redis.set(seenKey(tenantId, `s:${st.id}:${incoming}`), '1', 'EX', DEDUP_TTL_S, 'NX');
        if (first === null) return 'duplicate';
        try {
            return await this.handleStatusOnce(tenantId, hookConnectionId, st, incoming);
        } catch (err) {
            await this.redis.del(seenKey(tenantId, `s:${st.id}:${incoming}`)).catch(() => undefined);
            throw err;
        }
    }

    private async handleStatusOnce(tenantId: number, hookConnectionId: number, st: StatusUpdate, incoming: WhatsappStatus): Promise<'ignored' | 'processed'> {
        const firstError = st.errors[0];
        const metaErr: MetaError | null = firstError
            ? { status: 200, code: firstError.code, subcode: null, type: null, message: firstError.message || firstError.title, details: firstError.details }
            : null;
        const detail = incoming === 'fallido' ? (metaErr ? metaErrorText(metaErr) : 'Meta no pudo entregar el mensaje.') : null;
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
        if (incoming === 'fallido' && metaErr && isSystemicMetaError(metaErr)) {
            this.reportConnection(tenantId, out.conn.id, out.conn, detail ?? metaErrorText(metaErr));
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
            kind: 'template' | 'text';
            to: string;
            template?: string;
            language?: string;
            variables?: Record<string, string>;
            headerMedia?: string;
            headerFilename?: string;
            text?: string;
            previewUrl?: boolean;
        },
    ): Promise<PreparedSend> {
        const conn = await this.connRow(tx, tenantId, args.connectionId);
        if (!conn) throw new WhatsappSendError('La conexión de WhatsApp ya no existe: revisa la acción.', 'connection_missing');
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
        const base = { tenantId, connection: { id: conn.id, name: conn.name, ownerUserId: conn.ownerUserId }, creds, to: dest.digits };
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

    /** Manda el envío a Meta (fuera de cualquier transacción si se puede). */
    async execute(p: PreparedSend): Promise<Executed> {
        const req = sendRequest(this.graph, p.creds, p.payload);
        try {
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, body: req.body, captureBody: true, timeoutMs: SEND_TIMEOUT_MS });
            const body = res.body ?? '';
            const parsed = parseSendResponse(res.status, body);
            if (parsed.ok) return { ok: true, wamid: parsed.wamid, status: res.status, body, error: null, network: null };
            return { ok: false, wamid: null, status: res.status, body, error: parsed.error, network: null };
        } catch (err) {
            return {
                ok: false,
                wamid: null,
                status: null,
                body: '',
                error: null,
                network: `No pudimos comunicarnos con Meta (${redactValues(err instanceof Error ? err.message : String(err), [p.creds.token, p.creds.appSecret])}).`,
            };
        }
    }

    /** El motivo legible de un envío que no salió (y si es de la conexión, abre un problema). */
    failureText(p: PreparedSend, ex: Executed): string {
        if (ex.network) return ex.network;
        const err = ex.error!;
        const text = metaErrorText(err);
        if (isSystemicMetaError(err)) this.reportConnection(p.tenantId, p.connection.id, { name: p.connection.name, ownerUserId: p.connection.ownerUserId }, text);
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

    /** Lo que se muestra de la petición (sin el token ni el `appsecret_proof`). */
    shownRequest(p: PreparedSend): { url: string; body: string } {
        const req = sendRequest(this.graph, p.creds, p.payload);
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
        const conns = (await this.connectors.list(tenantId, actor.userId, actor.role)).filter((c) => c.integration_key === 'whatsapp_cloud');
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
            const closes = whatsappWindowClosesAt(contact?.lastInboundAt ?? null);
            out.push({
                id: c.id,
                name: c.name,
                display_phone: c.account_label,
                window_open: whatsappWindowOpen(contact?.lastInboundAt ?? null),
                last_inbound_at: contact?.lastInboundAt ? contact.lastInboundAt.toISOString() : null,
                window_closes_at: closes ? closes.toISOString() : null,
                last_status: (contact?.lastOutboundStatus as WhatsappStatus | null) ?? null,
                last_status_detail: contact?.lastOutboundError ?? null,
                last_outbound_at: contact?.lastOutboundAt ? contact.lastOutboundAt.toISOString() : null,
                templates: await this.templatesOf(tenantId, c.id, true),
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
        const fv = (token: string): unknown => {
            const key = keyOf.get(token);
            return key ? data[key] : undefined;
        };
        void list;
        return (s: string) => applyMergeTags(s, fv, recordId, undefined, labels, formatter);
    }

    /** «Enviar WhatsApp» desde la ficha (exige poder editar el registro). */
    async sendFromRecord(tenantId: number, actor: WhatsappActor, listIdOrSlug: string, recordId: number, input: WhatsappSendInput): Promise<WhatsappSendResult> {
        const { list, fields, data } = await this.recordFor(tenantId, actor, listIdOrSlug, recordId, 'edit');
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).some(
            (c) => c.id === input.connection_id && c.integration_key === 'whatsapp_cloud',
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
            text: input.text ? merge(input.text) : undefined,
            previewUrl: input.preview_url,
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
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).some(
            (c) => c.id === input.connection_id && c.integration_key === 'whatsapp_cloud',
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
        const response = ex.status !== null ? { status: ex.status, body: redactValues(ex.body, [prepared.creds.token]).slice(0, 4000) } : null;
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
        const kind = args.actionKey === 'send_text' ? 'text' : args.actionKey === 'send_template' ? 'template' : null;
        if (kind === null) return { status: 'failed', message: `La acción «${args.actionKey}» no existe en WhatsApp.`, details: {}, write: null };
        let prepared: PreparedSend;
        try {
            prepared = await this.prepareSendInTx(tx, args.tenantId, {
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
            });
        } catch (err) {
            if (err instanceof WhatsappSendError) return { status: 'failed', message: err.message, details: { code: err.code }, write: null };
            throw err;
        }
        const label = kind === 'template' ? `plantilla «${prepared.template?.name}»` : 'mensaje de texto';
        const request = this.shownRequest(prepared);
        if (!args.realCall) {
            return {
                status: 'success',
                message: `Mandaría la ${label} por WhatsApp a +${prepared.to}.`,
                details: { _sim: 'would_run', text: prepared.text, request },
                write: null,
            };
        }
        const ex = await this.execute(prepared);
        if (!ex.ok || !ex.wamid) {
            return {
                status: 'failed',
                message: `WhatsApp (${prepared.connection.name}): ${this.failureText(prepared, ex)}`,
                details: { status: ex.status, ...(ex.error?.code ? { meta_code: ex.error.code } : {}) },
                write: null,
            };
        }
        const write = await this.persistSentInTx(tx, prepared, ex.wamid, { listId: args.recordId !== null ? args.listId : null, recordId: args.recordId, userId: null });
        this.afterWrite(args.tenantId, write);
        this.connectionWorks(args.tenantId, prepared.connection.id);
        return {
            status: 'success',
            message: `${prepared.connection.name} → envió la ${label} a +${prepared.to}.`,
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
function effectiveMapping(list: List, fields: Field[]): WhatsappListFields {
    const saved = readWhatsappListFields(list.settings);
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
    const mapping = effectiveMapping(list, fields);
    if (!mapping.phone) return null;
    const field = fields.find((f) => f.id === mapping.phone);
    if (!field || hidden.has(field.slug)) return null;
    return data[jsonbKeyForField(field.id)];
}
