import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
    SMS_FIELD_ROLES,
    SMS_FIELD_ROLE_META,
    SMS_MAX_SEGMENTS,
    SMS_PROVIDER_META,
    SMS_STATUS_OPTIONS,
    finalSmsText,
    isSmsProvider,
    isWithinCommercialHours,
    jsonbKeyForField,
    maskSmsPhone,
    nextCommercialSendTime,
    nextSmsStatus,
    readSmsListFields,
    resolveTitleFieldId,
    smsRecipient,
    smsSegments,
    suggestSmsFields,
    validateFieldValue,
    writeSmsListFields,
    type Field,
    type FieldType,
    type List,
    type Role,
    type SmsBatchStatus,
    type SmsBulkInput,
    type SmsBulkPreview,
    type SmsBulkResult,
    type SmsConnectionDetail,
    type SmsConnectionSummary,
    type SmsEncoding,
    type SmsFieldRole,
    type SmsListColumns,
    type SmsListFields,
    type SmsMessageDto,
    type SmsProviderKey,
    type SmsRecordInfo,
    type SmsSegmentInfo,
    type SmsSendInput,
    type SmsSendResult,
    type SmsStatus,
    type SmsTestSendInput,
} from '@imagina-base/shared';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { AiFieldsService } from '../ai-fields/ai-fields.service';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { applyMergeTags, labelResolverFor, regionalFormatterFor, type LabelFieldLike } from '../automations/merge-tags';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { redactValues } from '../connectors/connection-parts';
import { ConnectionUnusableError, ConnectorsService } from '../connectors/connectors.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { connections, lists, records, smsHooks, smsMessages, type SmsMessageRowDb } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub } from '../incidents/incident-hub';
import { andWhere, hiddenFieldsFor, listRowInScope, listScopeWhere, type AclExtras } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readTenantFormat } from '../tenancy/tenant-format';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { SMS_PROVIDERS, infobipBase, smsBases, smsSecretsOf, type SmsCreds, type SmsDlrRequest, type SmsHttpRequest, type SmsSendOutcome } from './sms-providers';

/**
 * v0.1.332 (ADR-S82) — SMS con la cuenta de cada empresa.
 *
 * Reglas que no son opcionales:
 * - El TEXTO no se guarda: vive en `sms_messages.body` sólo mientras el mensaje
 *   espera (programado por el horario o en la cola de un envío masivo) y se
 *   borra al mandarse. En el registro quedan la fecha y el estado del último
 *   SMS (sus columnas); la actividad anota «se envió un SMS a +57 300…» sin el
 *   texto, con el mismo criterio que WhatsApp.
 * - Escribir el estado en el registro NO pasa por `RecordChangeHub` ni dispara
 *   automatizaciones: una automatización «cuando se actualiza el registro →
 *   mandar SMS» si no se llamaría a sí misma para siempre.
 * - Un aviso de entrega sólo mueve un SMS que mandamos nosotros por ESA
 *   conexión, y un estado sólo avanza (`nextSmsStatus`).
 * - Fallar en voz alta: un envío que no salió queda «fallido» con el motivo del
 *   proveedor; una credencial rechazada o el saldo agotado abren un Problema
 *   que se cierra solo cuando la conexión vuelve a mandar.
 */

export interface SmsActor extends AclExtras {
    userId: number;
    role: Role;
}

/** Un motivo legible por el que no se puede mandar. */
export class SmsSendError extends Error {
    constructor(
        message: string,
        readonly code = 'sms_send',
    ) {
        super(message);
    }
}

interface ConnInfo {
    id: number;
    name: string;
    provider: SmsProviderKey;
    ownerUserId: number | null;
    accountLabel: string | null;
    creds: SmsCreds;
}

/** Un SMS listo para salir. */
interface Prepared {
    conn: ConnInfo;
    to: string;
    text: string;
    seg: SmsSegmentInfo;
    sender: string;
}

interface Executed {
    outcome: SmsSendOutcome;
    request: SmsHttpRequest;
    response: { status: number; body: string } | null;
}

interface WriteResult {
    listId: number;
    recordId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

const SEND_TIMEOUT_MS = 15_000;
/** Un SMS «enviando» más de esto se dio por cortado (el proceso se cayó en el medio). */
const STUCK_MS = 10 * 60_000;
/** Onurix: se pregunta el estado durante 3 días. */
const POLL_WINDOW_MS = 3 * 24 * 3600_000;

function reference(): string {
    return `s${randomBytes(9).toString('hex')}`;
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function isTrue(v: unknown): boolean {
    return v === true || ['true', '1', 'si', 'sí', 'yes'].includes(str(v).trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** «el martes 3 de noviembre a las 07:00» en la zona de la empresa. */
export function formatScheduled(at: Date, timeZone: string): string {
    const day = new Intl.DateTimeFormat('es-CO', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
    const p = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const h = p.find((x) => x.type === 'hour')?.value ?? '00';
    const m = p.find((x) => x.type === 'minute')?.value ?? '00';
    return `el ${day} a las ${h}:${m}`;
}

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);
    /** Despierta a la cola (la arma `SmsQueue`; sin ella se manda en el acto). */
    private kicker: (() => void) | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly connectors: ConnectorsService,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly aiFields?: AiFieldsService,
    ) {}

    setKicker(fn: (() => void) | null): void {
        this.kicker = fn;
    }

    private get bases() {
        return smsBases(this.env);
    }

    // ── URL de avisos ───────────────────────────────────────────────────

    hookUrl(token: string): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/sms/${token}`;
    }

    async ensureHook(tenantId: number, connectionId: number): Promise<{ token: string; lastHookAt: Date | null }> {
        const read = async () =>
            (await this.db.select({ token: smsHooks.token, lastHookAt: smsHooks.lastHookAt }).from(smsHooks).where(eq(smsHooks.connectionId, connectionId)).limit(1))[0];
        const existing = await read();
        if (existing) return existing;
        await this.db.insert(smsHooks).values({ token: randomBytes(24).toString('base64url'), tenantId, connectionId }).onConflictDoNothing();
        const created = await read();
        if (!created) throw new Error('No se pudo crear la URL de avisos.');
        return created;
    }

    private async hookByToken(token: string): Promise<{ token: string; tenantId: number; connectionId: number } | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const [row] = await this.db
            .select({ token: smsHooks.token, tenantId: smsHooks.tenantId, connectionId: smsHooks.connectionId })
            .from(smsHooks)
            .where(eq(smsHooks.token, token))
            .limit(1);
        return row ?? null;
    }

    // ── Conexiones ──────────────────────────────────────────────────────

    /** La conexión de SMS con su credencial (lanza `SmsSendError` con el motivo). */
    private async connInTx(tx: Tx, tenantId: number, connectionId: number | null): Promise<ConnInfo> {
        if (!connectionId) throw new SmsSendError('La conexión de SMS ya no existe: revisa la configuración.', 'connection_missing');
        const [row] = await tx
            .select({ id: connections.id, name: connections.name, provider: connections.provider, ownerUserId: connections.ownerUserId, config: connections.config })
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
            .limit(1);
        if (!row || !isSmsProvider(row.provider)) throw new SmsSendError('La conexión de SMS ya no existe: revisa la configuración.', 'connection_missing');
        let out;
        try {
            out = await this.connectors.integrationCredsInTx(tx, tenantId, connectionId);
        } catch (err) {
            if (err instanceof ConnectionUnusableError) {
                this.reportConnection(tenantId, row.id, row, err.message);
                throw new SmsSendError(err.message, 'connection_unusable');
            }
            throw err;
        }
        if (!out) throw new SmsSendError('La conexión de SMS ya no existe.', 'connection_missing');
        const fields = { ...out.creds.fields };
        if (row.provider === 'sms_infobip') fields.base_url = infobipBase(fields.base_url ?? '');
        const cfg = (row.config ?? {}) as Record<string, unknown>;
        return {
            id: row.id,
            name: row.name,
            provider: row.provider,
            ownerUserId: row.ownerUserId,
            accountLabel: typeof cfg.account_label === 'string' ? cfg.account_label : null,
            creds: { secret: out.creds.secret, fields },
        };
    }

    private reportConnection(tenantId: number, connectionId: number, row: { name: string; ownerUserId: number | null } | null, message: string): void {
        this.incidents?.report({
            tenantId,
            key: `connection:${connectionId}`,
            source: 'connection',
            sourceId: connectionId,
            ownerId: row?.ownerUserId ?? null,
            title: `La conexión de SMS «${row?.name ?? `#${connectionId}`}» dejó de funcionar`,
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

    /** Volvió a mandar: se cierra el problema y el aviso de la pantalla de la conexión. */
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

    private summaryOf(c: { id: number; name: string; integration_key: string | null; account_label: string | null; fields?: Record<string, string> }): SmsConnectionSummary {
        const provider = c.integration_key as SmsProviderKey;
        const f = c.fields ?? {};
        return {
            id: c.id,
            name: c.name,
            provider,
            account_label: c.account_label,
            sender: (f.from ?? f.sender ?? '').trim(),
            default_country: (f.default_country ?? '').trim() || 'CO',
        };
    }

    /** Las conexiones de SMS que la persona puede usar (editor y ficha). */
    async usableConnections(tenantId: number, actor: SmsActor): Promise<SmsConnectionSummary[]> {
        const conns = (await this.connectors.list(tenantId, actor.userId, actor.role)).filter((c) => isSmsProvider(c.integration_key));
        if (conns.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connections.id, config: connections.config })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), inArray(connections.id, conns.map((c) => c.id)))),
        );
        const fieldsOf = new Map(rows.map((r) => [r.id, ((r.config as Record<string, unknown>).fields ?? {}) as Record<string, string>]));
        return conns.map((c) => this.summaryOf({ ...c, fields: fieldsOf.get(c.id) }));
    }

    private notSms(): NotFoundException {
        return new NotFoundException({ code: 'connection_not_found', message: 'Conexión de SMS no encontrada', data: { status: 404 } });
    }

    // ── Preparar y mandar ───────────────────────────────────────────────

    private prepare(conn: ConnInfo, args: { to: string; message: string; sender?: string; stripAccents: boolean }): Prepared {
        if (args.to.trim() === '') throw new SmsSendError('Falta el número de destino.', 'bad_recipient');
        const dest = smsRecipient(args.to, conn.creds.fields.default_country);
        if (!dest.ok) throw new SmsSendError(`El número de destino no sirve: ${dest.error}`, 'bad_recipient');
        const text = finalSmsText(args.message, args.stripAccents);
        if (text === '') throw new SmsSendError('El mensaje está vacío.', 'empty');
        const seg = smsSegments(text);
        if (seg.segments > SMS_MAX_SEGMENTS) {
            throw new SmsSendError(`El mensaje es demasiado largo: ocuparía ${seg.segments} SMS y el máximo es ${SMS_MAX_SEGMENTS}.`, 'too_long');
        }
        return { conn, to: dest.e164, text, seg, sender: (args.sender ?? '').trim() };
    }

    private async callbackFor(tenantId: number, conn: ConnInfo): Promise<string | null> {
        if (SMS_PROVIDER_META[conn.provider].delivery !== 'auto') return null;
        const hook = await this.ensureHook(tenantId, conn.id);
        return this.hookUrl(hook.token);
    }

    private buildRequest(p: Prepared, ref: string, callbackUrl: string | null): SmsHttpRequest {
        return SMS_PROVIDERS[p.conn.provider].buildSend(
            { to: p.to, text: p.text, sender: p.sender, unicode: p.seg.encoding === 'ucs2', segments: p.seg.segments, callbackUrl, reference: ref },
            p.conn.creds,
            this.bases,
        );
    }

    /** Manda al proveedor. Nunca lanza: un error de red es un fallo con el motivo. */
    private async execute(p: Prepared, ref: string, callbackUrl: string | null): Promise<Executed> {
        const req = this.buildRequest(p, ref, callbackUrl);
        try {
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, body: req.body, captureBody: true, timeoutMs: SEND_TIMEOUT_MS });
            const body = res.body ?? '';
            return { outcome: SMS_PROVIDERS[p.conn.provider].parseSend(res.status, body), request: req, response: { status: res.status, body } };
        } catch (err) {
            const message = redactValues(err instanceof Error ? err.message : String(err), smsSecretsOf(p.conn.creds));
            return {
                outcome: { ok: false, error: `No pudimos comunicarnos con ${SMS_PROVIDER_META[p.conn.provider].label} (${message}).`, systemic: false, code: 'network' },
                request: req,
                response: null,
            };
        }
    }

    private shown(p: Prepared, ex: Executed): Pick<SmsSendResult, 'request' | 'response'> {
        const hide = smsSecretsOf(p.conn.creds);
        return {
            request: { method: ex.request.method, url: redactValues(ex.request.url, hide), body: redactValues(ex.request.body ?? '', hide) },
            response: ex.response ? { status: ex.response.status, body: redactValues(ex.response.body, hide).slice(0, 4000) } : null,
        };
    }

    private async insertMessageInTx(
        tx: Tx,
        tenantId: number,
        p: Prepared,
        ref: string,
        opts: {
            status: SmsStatus;
            source: string;
            listId: number | null;
            recordId: number | null;
            userId: number | null;
            batchId?: string | null;
            automationId?: number | null;
            respectHours?: boolean;
            sendAfter?: Date | null;
            keepBody?: boolean;
        },
    ): Promise<number> {
        const [row] = await tx
            .insert(smsMessages)
            .values({
                tenantId,
                connectionId: p.conn.id,
                provider: p.conn.provider,
                listId: opts.listId,
                recordId: opts.recordId,
                userId: opts.userId && opts.userId > 0 ? opts.userId : null,
                source: opts.source,
                batchId: opts.batchId ?? null,
                automationId: opts.automationId ?? null,
                toPhone: p.to,
                body: opts.keepBody ? p.text : null,
                sender: p.sender || null,
                segments: p.seg.segments,
                encoding: p.seg.encoding,
                status: opts.status,
                reference: ref,
                respectHours: opts.respectHours === true,
                sendAfter: opts.sendAfter ?? null,
                claimedAt: opts.status === 'enviando' ? new Date() : null,
                attempts: opts.status === 'enviando' ? 1 : 0,
            })
            .returning({ id: smsMessages.id });
        return row!.id;
    }

    /** Lo que quedó de un envío: estado, id del proveedor, sin el texto. */
    private async applyOutcomeInTx(tx: Tx, tenantId: number, id: number, p: Prepared, ex: Executed): Promise<SmsStatus> {
        const now = new Date();
        const o = ex.outcome;
        const status: SmsStatus = o.ok ? o.status : 'fallido';
        await tx
            .update(smsMessages)
            .set({
                status,
                error: o.ok ? null : o.error.slice(0, 1000),
                providerMessageId: o.ok ? (o.providerId ? o.providerId.slice(0, 160) : null) : null,
                segments: o.ok && o.segments ? o.segments : p.seg.segments,
                body: null,
                sentAt: o.ok ? now : null,
                deliveredAt: o.ok && o.status === 'entregado' ? now : null,
                nextPollAt: o.ok && p.conn.provider === 'sms_onurix' && o.providerId && o.status !== 'entregado' ? new Date(now.getTime() + 5 * 60_000) : null,
                updatedAt: now,
            })
            .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.id, id)));
        return status;
    }

    private afterOutcome(tenantId: number, p: Prepared, ex: Executed): void {
        const o = ex.outcome;
        if (o.ok) this.connectionWorks(tenantId, p.conn.id);
        else if (o.systemic) this.reportConnection(tenantId, p.conn.id, { name: p.conn.name, ownerUserId: p.conn.ownerUserId }, o.error);
    }

    // ── Escribir en el registro ─────────────────────────────────────────

    /**
     * Escribe la fecha y el estado del último SMS en las columnas mapeadas del
     * registro (las que sigan existiendo). Cada valor pasa por el validador del
     * campo; sin diff en la actividad (la entrada propia «sms» la escribe quien
     * llama).
     */
    async writeRecordInTx(
        tx: Tx,
        tenantId: number,
        listId: number,
        recordId: number,
        values: { status?: SmsStatus; at?: Date | null },
    ): Promise<WriteResult | null> {
        const [list] = await tx
            .select({ settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId), isNull(lists.deletedAt)))
            .limit(1);
        if (!list) return null;
        const mapping = readSmsListFields(list.settings);
        const wants: Array<{ role: SmsFieldRole; value: unknown }> = [];
        if (values.status && mapping.last_status) wants.push({ role: 'last_status', value: values.status });
        if (values.at !== undefined && mapping.last_at) wants.push({ role: 'last_at', value: values.at });
        if (wants.length === 0) return null;
        const fieldRows = await this.fields.listByListIdWithinTx(tx, tenantId, listId);
        const record = await this.recordsRepo.findByIdForUpdate(tx, tenantId, listId, recordId);
        if (!record) return null;
        const before = record.data as Record<string, unknown>;
        const after = { ...before };
        for (const w of wants) {
            const field = fieldRows.find((f) => f.id === mapping[w.role]);
            if (!field) continue;
            const key = jsonbKeyForField(field.id);
            const raw = columnValue(w.role, w.value, field);
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

    private afterWrite(tenantId: number, write: WriteResult | null): void {
        if (!write) return;
        this.realtime.records(tenantId, write.listId);
        void this.aiFields
            ?.onChange({ tenantId, listId: write.listId, recordId: write.recordId, before: write.before, after: write.after, kind: 'updated', actorId: 0 })
            .catch(() => undefined);
    }

    private async logInTx(
        tx: Tx,
        tenantId: number,
        target: { listId: number; recordId: number; userId: number | null },
        p: Prepared,
        event: 'sent' | 'scheduled' | 'failed',
        extra: { scheduled_for?: string; error?: string } = {},
    ): Promise<void> {
        await this.activity.logInTx(tx, {
            tenantId,
            listId: target.listId,
            recordId: target.recordId,
            userId: target.userId && target.userId > 0 ? target.userId : null,
            action: 'sms',
            diff: {
                sms: {
                    event,
                    // `phone` (no `to`): una entrada con `to` se leería como un cambio de campo.
                    phone: maskSmsPhone(p.to),
                    segments: p.seg.segments,
                    connection: p.conn.name,
                    provider: p.conn.provider,
                    ...(extra.scheduled_for ? { scheduled_for: extra.scheduled_for } : {}),
                    ...(extra.error ? { error: extra.error.slice(0, 300) } : {}),
                },
            },
        });
    }

    // ── Envío en el acto (ficha, prueba, agenda) ────────────────────────

    /**
     * Manda un SMS fuera de cualquier transacción: inserta el envío («enviando»),
     * llama al proveedor y deja el resultado. Con `respectHours` fuera de la
     * franja de la Ley 2300 queda PROGRAMADO (con el texto) y sale solo.
     */
    async sendNow(
        tenantId: number,
        args: {
            connectionId: number;
            to: string;
            message: string;
            sender?: string;
            stripAccents: boolean;
            respectHours: boolean;
            source: 'manual' | 'test' | 'booking';
            target: { listId: number | null; recordId: number | null; userId: number | null };
        },
    ): Promise<SmsSendResult> {
        let prepared: Prepared;
        let scheduled: Date | null = null;
        let id: number;
        const ref = reference();
        let callbackUrl: string | null = null;
        try {
            const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const conn = await this.connInTx(tx, tenantId, args.connectionId);
                const p = this.prepare(conn, { to: args.to, message: args.message, sender: args.sender, stripAccents: args.stripAccents });
                const tz = (await readTenantFormatInTx(tx, tenantId)) ?? null;
                const now = new Date();
                if (args.respectHours && !isWithinCommercialHours(now, tz)) {
                    const when = nextCommercialSendTime(now, tz);
                    const mid = await this.insertMessageInTx(tx, tenantId, p, ref, {
                        status: 'programado',
                        source: args.source,
                        listId: args.target.listId,
                        recordId: args.target.recordId,
                        userId: args.target.userId,
                        respectHours: true,
                        sendAfter: when,
                        keepBody: true,
                    });
                    let write: WriteResult | null = null;
                    if (args.target.listId !== null && args.target.recordId !== null) {
                        write = await this.writeRecordInTx(tx, tenantId, args.target.listId, args.target.recordId, { status: 'programado' });
                        await this.logInTx(tx, tenantId, { listId: args.target.listId, recordId: args.target.recordId, userId: args.target.userId }, p, 'scheduled', {
                            scheduled_for: when.toISOString(),
                        });
                    }
                    return { p, mid, when, write };
                }
                const mid = await this.insertMessageInTx(tx, tenantId, p, ref, {
                    status: 'enviando',
                    source: args.source,
                    listId: args.target.listId,
                    recordId: args.target.recordId,
                    userId: args.target.userId,
                });
                return { p, mid, when: null as Date | null, write: null as WriteResult | null };
            });
            prepared = out.p;
            id = out.mid;
            scheduled = out.when;
            if (scheduled) {
                this.afterWrite(tenantId, out.write);
                return {
                    ok: true,
                    status: 'programado',
                    message_id: id,
                    provider_message_id: null,
                    to: prepared.to,
                    text: prepared.text,
                    segments: prepared.seg.segments,
                    encoding: prepared.seg.encoding,
                    scheduled_for: scheduled.toISOString(),
                    error: null,
                    request: null,
                    response: null,
                };
            }
        } catch (err) {
            if (err instanceof SmsSendError) {
                return { ok: false, status: null, message_id: null, provider_message_id: null, to: args.to, text: '', segments: 0, encoding: 'gsm7', scheduled_for: null, error: err.message, request: null, response: null };
            }
            throw err;
        }
        callbackUrl = await this.callbackFor(tenantId, prepared.conn);
        const ex = await this.execute(prepared, ref, callbackUrl);
        const write = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const status = await this.applyOutcomeInTx(tx, tenantId, id, prepared, ex);
            if (args.target.listId === null || args.target.recordId === null) return null;
            const w = await this.writeRecordInTx(tx, tenantId, args.target.listId, args.target.recordId, { status, ...(ex.outcome.ok ? { at: new Date() } : {}) });
            await this.logInTx(
                tx,
                tenantId,
                { listId: args.target.listId, recordId: args.target.recordId, userId: args.target.userId },
                prepared,
                ex.outcome.ok ? 'sent' : 'failed',
                ex.outcome.ok ? {} : { error: ex.outcome.error },
            );
            return w;
        });
        this.afterWrite(tenantId, write);
        if (args.target.listId !== null) this.realtime.records(tenantId, args.target.listId);
        this.afterOutcome(tenantId, prepared, ex);
        const o = ex.outcome;
        return {
            ok: o.ok,
            status: o.ok ? o.status : 'fallido',
            message_id: id,
            provider_message_id: o.ok ? o.providerId : null,
            to: prepared.to,
            text: prepared.text,
            segments: o.ok && o.segments ? o.segments : prepared.seg.segments,
            encoding: prepared.seg.encoding,
            scheduled_for: null,
            error: o.ok ? null : o.error,
            ...this.shown(prepared, ex),
        };
    }

    // ── Ficha del registro ──────────────────────────────────────────────

    private async recordFor(
        tenantId: number,
        actor: SmsActor,
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

    async recordInfo(tenantId: number, actor: SmsActor, listIdOrSlug: string, recordId: number): Promise<SmsRecordInfo> {
        const { list, fields, data } = await this.recordFor(tenantId, actor, listIdOrSlug, recordId, 'view');
        const hidden = hiddenFieldsFor(list.settings, actor);
        const phoneRaw = visiblePhone(list, fields, data, hidden);
        const recipient = typeof phoneRaw === 'string' && phoneRaw.trim() !== '' ? phoneRaw.trim() : null;
        const conns = await this.usableConnections(tenantId, actor);
        const canEdit = can({ role: actor.role, capabilities: actor.capabilities }, 'edit_records') || can({ role: actor.role, capabilities: actor.capabilities }, 'edit_own_records');
        let canSend = false;
        if (canEdit) {
            const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, recordId));
            canSend = row !== null && listRowInScope(list.settings, actor, 'edit', { id: row.id, createdBy: row.createdBy, data: row.data });
        }
        const [last] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ status: smsMessages.status, createdAt: smsMessages.createdAt, sentAt: smsMessages.sentAt, error: smsMessages.error, connectionId: smsMessages.connectionId })
                .from(smsMessages)
                .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.recordId, recordId), eq(smsMessages.listId, list.id)))
                .orderBy(desc(smsMessages.id))
                .limit(1),
        );
        const hasColumns = Object.values(readSmsListFields(list.settings)).some((v) => v !== null);
        return {
            connections: conns,
            recipient,
            last: last
                ? {
                      status: last.status as SmsStatus,
                      at: (last.sentAt ?? last.createdAt).toISOString(),
                      error: last.error,
                      connection: conns.find((c) => c.id === last.connectionId)?.name ?? null,
                  }
                : null,
            has_columns: hasColumns,
            can_send: canSend && conns.length > 0,
            can_setup: can({ role: actor.role, capabilities: actor.capabilities }, 'manage_fields'),
        };
    }

    /** Merge de variables contra un registro, SIN los campos ocultos para quien pide. */
    private async mergerFor(tenantId: number, fields: Field[], data: Record<string, unknown>, recordId: number, hidden: Set<string>): Promise<(s: string) => string> {
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
        return (s: string) => applyMergeTags(s, fv, recordId, undefined, labels, formatter);
    }

    private async assertUsable(tenantId: number, actor: SmsActor, connectionId: number): Promise<void> {
        const ok = (await this.connectors.list(tenantId, actor.userId, actor.role)).some((c) => c.id === connectionId && isSmsProvider(c.integration_key));
        if (!ok) throw this.notSms();
    }

    /** «Enviar SMS» desde la ficha (exige poder editar el registro). */
    async sendFromRecord(tenantId: number, actor: SmsActor, listIdOrSlug: string, recordId: number, input: SmsSendInput): Promise<SmsSendResult> {
        const { list, fields, data } = await this.recordFor(tenantId, actor, listIdOrSlug, recordId, 'edit');
        await this.assertUsable(tenantId, actor, input.connection_id);
        const hidden = hiddenFieldsFor(list.settings, actor);
        const merge = await this.mergerFor(tenantId, fields, data, recordId, hidden);
        const phoneRaw = visiblePhone(list, fields, data, hidden);
        const to = (input.to ?? '').trim() !== '' ? merge(input.to!) : typeof phoneRaw === 'string' ? phoneRaw : '';
        return this.sendNow(tenantId, {
            connectionId: input.connection_id,
            to,
            message: merge(input.message),
            sender: input.sender,
            stripAccents: input.strip_accents,
            respectHours: input.respect_hours,
            source: 'manual',
            target: { listId: list.id, recordId, userId: actor.userId },
        });
    }

    /**
     * La vista previa del diálogo «Enviar SMS»: el texto REAL (variables del
     * registro resueltas, sin lo oculto para quien mira), el destino y cuántos
     * SMS ocupa. No manda nada.
     */
    async previewFromRecord(tenantId: number, actor: SmsActor, listIdOrSlug: string, recordId: number, input: SmsSendInput): Promise<SmsSendResult> {
        const { list, fields, data } = await this.recordFor(tenantId, actor, listIdOrSlug, recordId, 'view');
        await this.assertUsable(tenantId, actor, input.connection_id);
        const hidden = hiddenFieldsFor(list.settings, actor);
        const merge = await this.mergerFor(tenantId, fields, data, recordId, hidden);
        const phoneRaw = visiblePhone(list, fields, data, hidden);
        const to = (input.to ?? '').trim() !== '' ? merge(input.to!) : typeof phoneRaw === 'string' ? phoneRaw : '';
        const message = merge(input.message);
        const base: SmsSendResult = { ok: false, status: null, message_id: null, provider_message_id: null, to, text: message, segments: 0, encoding: 'gsm7', scheduled_for: null, error: null, request: null, response: null, simulated: true };
        try {
            const p = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const conn = await this.connInTx(tx, tenantId, input.connection_id);
                return this.prepare(conn, { to, message, sender: input.sender ? merge(input.sender) : '', stripAccents: input.strip_accents });
            });
            const tz = (await readTenantFormat(this.tenantDb, tenantId)).timezone ?? null;
            const now = new Date();
            const scheduled = input.respect_hours && !isWithinCommercialHours(now, tz) ? nextCommercialSendTime(now, tz).toISOString() : null;
            return { ...base, ok: true, to: p.to, text: p.text, segments: p.seg.segments, encoding: p.seg.encoding, scheduled_for: scheduled };
        } catch (err) {
            if (err instanceof SmsSendError) {
                const text = finalSmsText(message, input.strip_accents);
                const seg = smsSegments(text);
                return { ...base, text, segments: seg.segments, encoding: seg.encoding, error: err.message };
            }
            throw err;
        }
    }

    /**
     * «Probar ahora» del editor: resuelve las variables contra un registro real
     * de la lista y dice qué saldría. Sólo con `send` («Enviarme una prueba»)
     * manda DE VERDAD al número que se escribe, sin tocar el registro.
     */
    async testSend(tenantId: number, actor: SmsActor, listIdOrSlug: string, input: SmsTestSendInput): Promise<SmsSendResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.assertUsable(tenantId, actor, input.connection_id);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const sample = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (input.record_id) {
                const row = await this.recordsRepo.findById(tx, tenantId, list.id, input.record_id);
                return row && listRowInScope(list.settings, actor, 'view', { id: row.id, createdBy: row.createdBy, data: row.data }) ? row : null;
            }
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
        const merge = await this.mergerFor(tenantId, fields, data, sample?.id ?? 0, hidden);
        const v = input.values as Record<string, unknown>;
        const message = merge(str(v.message));
        const sender = merge(str(v.sender));
        const strip = isTrue(v.strip_accents);
        if (!input.send) {
            // Sin mandar: el destino resuelto, el texto final y la petición que saldría.
            try {
                const p = await this.tenantDb.withTenant(tenantId, async (tx) => {
                    const conn = await this.connInTx(tx, tenantId, input.connection_id);
                    return this.prepare(conn, { to: merge(str(v.to)), message, sender, stripAccents: strip });
                });
                const req = this.buildRequest(p, reference(), await this.callbackFor(tenantId, p.conn));
                const hide = smsSecretsOf(p.conn.creds);
                const tz = (await readTenantFormat(this.tenantDb, tenantId)).timezone ?? null;
                const now = new Date();
                const scheduled = isTrue(v.respect_hours) && !isWithinCommercialHours(now, tz) ? nextCommercialSendTime(now, tz).toISOString() : null;
                return {
                    ok: true,
                    status: null,
                    message_id: null,
                    provider_message_id: null,
                    to: p.to,
                    text: p.text,
                    segments: p.seg.segments,
                    encoding: p.seg.encoding,
                    scheduled_for: scheduled,
                    error: null,
                    request: { method: req.method, url: redactValues(req.url, hide), body: redactValues(req.body ?? '', hide) },
                    response: null,
                    sample_record_id: sample?.id ?? null,
                    simulated: true,
                };
            } catch (err) {
                if (err instanceof SmsSendError) {
                    return { ok: false, status: null, message_id: null, provider_message_id: null, to: str(v.to), text: message, segments: 0, encoding: 'gsm7', scheduled_for: null, error: err.message, request: null, response: null, sample_record_id: sample?.id ?? null, simulated: true };
                }
                throw err;
            }
        }
        const to = (input.to ?? '').trim();
        if (to === '') throw new BadRequestException({ code: 'sms_test_to', message: 'Escribe tu número para mandarte la prueba.', data: { status: 400 } });
        const result = await this.sendNow(tenantId, {
            connectionId: input.connection_id,
            to,
            message,
            sender,
            stripAccents: strip,
            respectHours: false,
            source: 'test',
            target: { listId: null, recordId: null, userId: actor.userId },
        });
        return { ...result, sample_record_id: sample?.id ?? null };
    }

    // ── Envío a una selección ───────────────────────────────────────────

    private async bulkPlan(
        tenantId: number,
        actor: SmsActor,
        listIdOrSlug: string,
        input: SmsBulkInput,
    ): Promise<{
        list: List;
        conn: ConnInfo;
        items: Array<{ recordId: number; title: string; p: Prepared | null; reason: string | null }>;
        scheduledFor: Date | null;
    }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.assertUsable(tenantId, actor, input.connection_id);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const hidden = hiddenFieldsFor(list.settings, actor);
        const titleId = resolveTitleFieldId(fields, list.settings);
        const titleKey = titleId ? jsonbKeyForField(titleId) : null;
        const ids = [...new Set(input.record_ids)];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), isNull(records.deletedAt), inArray(records.id, ids))),
        );
        const conn = await this.tenantDb.withTenant(tenantId, async (tx) => {
            try {
                return await this.connInTx(tx, tenantId, input.connection_id);
            } catch (err) {
                if (err instanceof SmsSendError) throw new BadRequestException({ code: err.code, message: err.message, data: { status: 400 } });
                throw err;
            }
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const items: Array<{ recordId: number; title: string; p: Prepared | null; reason: string | null }> = [];
        for (const id of ids) {
            const row = byId.get(id);
            if (!row || !listRowInScope(list.settings, actor, 'edit', { id: row.id, createdBy: row.createdBy, data: row.data })) {
                items.push({ recordId: id, title: `#${id}`, p: null, reason: 'No puedes editar este registro.' });
                continue;
            }
            const data = row.data as Record<string, unknown>;
            const title = titleKey && typeof data[titleKey] === 'string' && (data[titleKey] as string).trim() !== '' ? (data[titleKey] as string) : `#${id}`;
            const phone = visiblePhone(list, fields, data, hidden);
            if (typeof phone !== 'string' || phone.trim() === '') {
                items.push({ recordId: id, title, p: null, reason: 'No tiene teléfono.' });
                continue;
            }
            const merge = await this.mergerFor(tenantId, fields, data, id, hidden);
            try {
                const p = this.prepare(conn, { to: phone, message: merge(input.message), sender: input.sender ? merge(input.sender) : '', stripAccents: input.strip_accents });
                items.push({ recordId: id, title, p, reason: null });
            } catch (err) {
                if (err instanceof SmsSendError) items.push({ recordId: id, title, p: null, reason: err.message });
                else throw err;
            }
        }
        let scheduledFor: Date | null = null;
        if (input.respect_hours) {
            const tz = (await readTenantFormat(this.tenantDb, tenantId)).timezone ?? null;
            const now = new Date();
            if (!isWithinCommercialHours(now, tz)) scheduledFor = nextCommercialSendTime(now, tz);
        }
        return { list, conn, items, scheduledFor };
    }

    async bulkPreview(tenantId: number, actor: SmsActor, listIdOrSlug: string, input: SmsBulkInput): Promise<SmsBulkPreview> {
        const plan = await this.bulkPlan(tenantId, actor, listIdOrSlug, input);
        const ok = plan.items.filter((i) => i.p !== null);
        return {
            total: plan.items.length,
            sendable: ok.length,
            missing: plan.items.filter((i) => i.p === null).slice(0, 50).map((i) => ({ record_id: i.recordId, title: i.title, reason: i.reason ?? '' })),
            segments_total: ok.reduce((a, i) => a + i.p!.seg.segments, 0),
            sample: ok.slice(0, 3).map((i) => ({ record_id: i.recordId, title: i.title, to: i.p!.to, text: i.p!.text, segments: i.p!.seg.segments })),
            scheduled_for: plan.scheduledFor ? plan.scheduledFor.toISOString() : null,
            ucs2: ok.filter((i) => i.p!.seg.encoding === 'ucs2').length,
        };
    }

    /**
     * Envía a una selección: cada destinatario queda «en cola» (o «programado»
     * por el horario) y la cola los manda al ritmo de la conexión. El resultado
     * por fila se consulta con `batchStatus`.
     */
    async bulkSend(tenantId: number, actor: SmsActor, listIdOrSlug: string, input: SmsBulkInput): Promise<SmsBulkResult> {
        const plan = await this.bulkPlan(tenantId, actor, listIdOrSlug, input);
        const ok = plan.items.filter((i) => i.p !== null);
        if (ok.length === 0) {
            throw new BadRequestException({ code: 'sms_bulk_empty', message: 'Ninguno de los registros elegidos tiene un teléfono válido.', data: { status: 400 } });
        }
        const batchId = `b${randomBytes(10).toString('hex')}`;
        const status: SmsStatus = plan.scheduledFor ? 'programado' : 'en_cola';
        const writes: WriteResult[] = [];
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            for (const it of ok) {
                await this.insertMessageInTx(tx, tenantId, it.p!, reference(), {
                    status,
                    source: 'bulk',
                    listId: plan.list.id,
                    recordId: it.recordId,
                    userId: actor.userId,
                    batchId,
                    respectHours: input.respect_hours,
                    sendAfter: plan.scheduledFor,
                    keepBody: true,
                });
                const w = await this.writeRecordInTx(tx, tenantId, plan.list.id, it.recordId, { status });
                if (w) writes.push(w);
            }
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'sms.bulk',
                targetType: 'list',
                targetId: plan.list.id,
                targetLabel: plan.list.name,
                meta: { connection_id: plan.conn.id, queued: ok.length, skipped: plan.items.length - ok.length, batch_id: batchId },
            });
        });
        // Las columnas «en cola» son del sistema: un solo aviso de realtime para la lista.
        if (writes.length > 0) this.realtime.records(tenantId, plan.list.id);
        this.kick();
        return {
            batch_id: batchId,
            queued: ok.length,
            skipped: plan.items.length - ok.length,
            scheduled_for: plan.scheduledFor ? plan.scheduledFor.toISOString() : null,
        };
    }

    async batchStatus(tenantId: number, actor: SmsActor, listIdOrSlug: string, batchId: string): Promise<SmsBatchStatus> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        if (!/^b[0-9a-f]{20}$/.test(batchId)) throw new NotFoundException({ code: 'not_found', message: 'Envío no encontrado', data: { status: 404 } });
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(smsMessages)
                .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.batchId, batchId), eq(smsMessages.listId, list.id)))
                .orderBy(asc(smsMessages.id)),
        );
        if (rows.length === 0) throw new NotFoundException({ code: 'not_found', message: 'Envío no encontrado', data: { status: 404 } });
        // Sólo quien lo mandó o quien administra la lista ve el detalle.
        const own = rows[0]!.userId === actor.userId;
        if (!own && !can({ role: actor.role, capabilities: actor.capabilities }, 'manage_lists')) {
            throw new NotFoundException({ code: 'not_found', message: 'Envío no encontrado', data: { status: 404 } });
        }
        const fields = await this.fields.listByListId(tenantId, list.id);
        const titleId = resolveTitleFieldId(fields, list.settings);
        const titleKey = titleId ? jsonbKeyForField(titleId) : null;
        const recIds = rows.map((r) => r.recordId).filter((x): x is number => x !== null);
        const recs = recIds.length
            ? await this.tenantDb.withTenant(tenantId, (tx) =>
                  tx.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.tenantId, tenantId), inArray(records.id, recIds))),
              )
            : [];
        const titleOf = new Map(recs.map((r) => [r.id, titleKey ? str((r.data as Record<string, unknown>)[titleKey]) : '']));
        const counts: Partial<Record<SmsStatus, number>> = {};
        for (const r of rows) counts[r.status as SmsStatus] = (counts[r.status as SmsStatus] ?? 0) + 1;
        return {
            batch_id: batchId,
            total: rows.length,
            counts,
            rows: rows.map((r) => ({
                id: r.id,
                record_id: r.recordId,
                title: (r.recordId !== null ? titleOf.get(r.recordId) : '') || (r.recordId !== null ? `#${r.recordId}` : ''),
                to: r.toPhone,
                status: r.status as SmsStatus,
                error: r.error,
                segments: r.segments,
            })),
            done: rows.every((r) => r.status !== 'en_cola' && r.status !== 'enviando'),
        };
    }

    // ── La cola: programados, masivos y lo que quedó a medias ───────────

    kick(): void {
        if (this.kicker) this.kicker();
        else void this.drain({ maxMs: 20_000 }).catch((err: unknown) => this.logger.warn(`Cola de SMS: ${String(err)}`));
    }

    /**
     * Toma los SMS que tienen que salir (en cola, o programados cuya hora llegó)
     * con `FOR UPDATE SKIP LOCKED` —dos nodos nunca toman el mismo— y los manda
     * al ritmo de cada conexión. Devuelve cuántos procesó.
     */
    async drain(opts: { maxMs?: number; now?: Date } = {}): Promise<number> {
        const started = Date.now();
        const maxMs = opts.maxMs ?? 55_000;
        let done = 0;
        for (;;) {
            const claimed = await this.db.execute<{ id: number; tenant_id: number; connection_id: number | null }>(sql`
                UPDATE ${smsMessages} SET status = 'enviando', claimed_at = now(), attempts = attempts + 1, updated_at = now()
                WHERE id IN (
                    SELECT id FROM ${smsMessages}
                    WHERE status = 'en_cola' OR (status = 'programado' AND send_after <= ${(opts.now ?? new Date()).toISOString()}::timestamptz)
                    ORDER BY id
                    LIMIT 40
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, tenant_id, connection_id
            `);
            const rows = (claimed as unknown as { rows?: Array<{ id: number; tenant_id: number; connection_id: number | null }> }).rows ?? (claimed as unknown as Array<{ id: number; tenant_id: number; connection_id: number | null }>);
            if (!rows || rows.length === 0) break;
            // En el orden en que se pidieron (el RETURNING no garantiza orden).
            rows.sort((a, b) => Number(a.id) - Number(b.id));
            const groups = new Map<string, Array<{ id: number; tenantId: number }>>();
            for (const r of rows) {
                const k = `${r.tenant_id}:${r.connection_id ?? 0}`;
                const g = groups.get(k) ?? [];
                g.push({ id: Number(r.id), tenantId: Number(r.tenant_id) });
                groups.set(k, g);
            }
            await Promise.all(
                [...groups.values()].map(async (g) => {
                    for (let i = 0; i < g.length; i++) {
                        const it = g[i]!;
                        const pause = await this.processClaimed(it.tenantId, it.id, opts.now).catch((err: unknown) => {
                            this.logger.warn(`SMS ${it.id}: ${String(err)}`);
                            return 0;
                        });
                        done++;
                        if (pause > 0 && i < g.length - 1) await sleep(pause);
                    }
                }),
            );
            if (Date.now() - started > maxMs) {
                // Lo que quede lo toma el próximo tic (o el próximo empujón).
                this.kicker?.();
                break;
            }
        }
        return done;
    }

    /** Manda UN SMS ya reclamado. Devuelve la pausa (ms) hasta el siguiente de su conexión. */
    private async processClaimed(tenantId: number, id: number, nowArg?: Date): Promise<number> {
        const now = nowArg ?? new Date();
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select().from(smsMessages).where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.id, id))).limit(1);
            if (!row || row.status !== 'enviando') return null;
            const fail = async (reason: string, status: SmsStatus = 'fallido') => {
                await tx.update(smsMessages).set({ status, error: reason, body: null, updatedAt: new Date() }).where(eq(smsMessages.id, id));
                if (row.listId !== null && row.recordId !== null) {
                    const w = await this.writeRecordInTx(tx, tenantId, row.listId, row.recordId, { status });
                    return { kind: 'done' as const, write: w };
                }
                return { kind: 'done' as const, write: null };
            };
            if (await tenantIsReadOnly(tx, tenantId)) return fail('La empresa está en solo-lectura: el SMS no se mandó.', 'cancelado');
            if (row.recordId !== null) {
                const [rec] = await tx.select({ deletedAt: records.deletedAt }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.id, row.recordId))).limit(1);
                if (!rec || rec.deletedAt !== null) return fail('El registro está en la papelera: el SMS no se mandó.', 'cancelado');
            }
            if (row.respectHours) {
                const tz = (await readTenantFormatInTx(tx, tenantId)) ?? null;
                if (!isWithinCommercialHours(now, tz)) {
                    // Un masivo largo que se pasó de las 7:00 p. m.: lo que falta espera a la franja siguiente.
                    await tx
                        .update(smsMessages)
                        .set({ status: 'programado', sendAfter: nextCommercialSendTime(now, tz), claimedAt: null, updatedAt: new Date() })
                        .where(eq(smsMessages.id, id));
                    return { kind: 'rescheduled' as const };
                }
            }
            let conn: ConnInfo;
            try {
                conn = await this.connInTx(tx, tenantId, row.connectionId);
            } catch (err) {
                if (err instanceof SmsSendError) return fail(err.message);
                throw err;
            }
            const text = row.body ?? '';
            if (text.trim() === '') return fail('El SMS no tenía texto.');
            const seg = smsSegments(text);
            const p: Prepared = { conn, to: row.toPhone, text, seg, sender: row.sender ?? '' };
            return { kind: 'send' as const, p, row };
        });
        if (!prep) return 0;
        if (prep.kind === 'done') {
            this.afterWrite(tenantId, prep.write);
            return 0;
        }
        if (prep.kind === 'rescheduled') return 0;
        const { p, row } = prep;
        const callbackUrl = await this.callbackFor(tenantId, p.conn);
        const ex = await this.execute(p, row.reference, callbackUrl);
        const write = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const status = await this.applyOutcomeInTx(tx, tenantId, id, p, ex);
            if (row.listId === null || row.recordId === null) return null;
            const w = await this.writeRecordInTx(tx, tenantId, row.listId, row.recordId, { status, ...(ex.outcome.ok ? { at: new Date() } : {}) });
            await this.logInTx(tx, tenantId, { listId: row.listId, recordId: row.recordId, userId: row.userId }, p, ex.outcome.ok ? 'sent' : 'failed', ex.outcome.ok ? {} : { error: ex.outcome.error });
            return w;
        });
        this.afterWrite(tenantId, write);
        this.afterOutcome(tenantId, p, ex);
        const rate = Number(p.conn.creds.fields.rate);
        const perSecond = Number.isFinite(rate) && rate > 0 ? Math.min(50, Math.max(0.2, rate)) : SMS_PROVIDER_META[p.conn.provider].rate;
        return Math.round(1000 / perSecond);
    }

    /**
     * Un SMS «enviando» hace más de 10 minutos: el proceso se cayó en el medio.
     * NO se reintenta (podría haber salido y llegaría dos veces): queda fallido
     * con el motivo, para revisarlo en el panel del proveedor.
     */
    async recoverStuck(now = new Date()): Promise<number> {
        const rows = await this.db
            .select({ id: smsMessages.id, tenantId: smsMessages.tenantId, listId: smsMessages.listId, recordId: smsMessages.recordId })
            .from(smsMessages)
            .where(and(eq(smsMessages.status, 'enviando'), lt(smsMessages.claimedAt, new Date(now.getTime() - STUCK_MS))))
            .limit(200);
        for (const r of rows) {
            const write = await this.tenantDb.withTenant(r.tenantId, async (tx) => {
                await tx
                    .update(smsMessages)
                    .set({ status: 'fallido', body: null, error: 'Se interrumpió el envío y no se sabe si salió: revísalo en el panel de tu proveedor de SMS.', updatedAt: new Date() })
                    .where(and(eq(smsMessages.id, r.id), eq(smsMessages.status, 'enviando')));
                return r.listId !== null && r.recordId !== null ? this.writeRecordInTx(tx, r.tenantId, r.listId, r.recordId, { status: 'fallido' }) : null;
            });
            this.afterWrite(r.tenantId, write);
        }
        return rows.length;
    }

    /** Onurix no avisa: se pregunta el estado de lo enviado (con espera creciente). */
    async pollStatuses(now = new Date()): Promise<number> {
        const rows = await this.db
            .select({ id: smsMessages.id, tenantId: smsMessages.tenantId, connectionId: smsMessages.connectionId, providerMessageId: smsMessages.providerMessageId, sentAt: smsMessages.sentAt, provider: smsMessages.provider })
            .from(smsMessages)
            .where(and(isNotNull(smsMessages.nextPollAt), lt(smsMessages.nextPollAt, now), eq(smsMessages.status, 'enviado')))
            .orderBy(asc(smsMessages.nextPollAt))
            .limit(100);
        let n = 0;
        for (const r of rows) {
            const provider = isSmsProvider(r.provider) ? SMS_PROVIDERS[r.provider] : null;
            const age = r.sentAt ? now.getTime() - r.sentAt.getTime() : POLL_WINDOW_MS + 1;
            const next = age > POLL_WINDOW_MS ? null : new Date(now.getTime() + (age < 3600_000 ? 5 * 60_000 : age < 6 * 3600_000 ? 30 * 60_000 : 3 * 3600_000));
            if (!provider?.buildStatusPoll || !provider.parseStatusPoll || !r.providerMessageId) {
                await this.db.update(smsMessages).set({ nextPollAt: null }).where(eq(smsMessages.id, r.id));
                continue;
            }
            let update = null;
            try {
                const conn = await this.tenantDb.withTenant(r.tenantId, (tx) => this.connInTx(tx, r.tenantId, r.connectionId));
                const req = provider.buildStatusPoll(r.providerMessageId, conn.creds, this.bases);
                const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, timeoutMs: 10_000 });
                update = provider.parseStatusPoll(res.status, res.body ?? '');
            } catch {
                update = null;
            }
            if (update && (await this.applyDelivery(r.tenantId, { id: r.id }, update.status, update.error))) n++;
            await this.db
                .update(smsMessages)
                .set({ nextPollAt: update && update.status !== 'enviado' ? null : next })
                .where(eq(smsMessages.id, r.id));
        }
        return n;
    }

    /** Un barrido completo (lo corre el tic de cada minuto). */
    async tick(): Promise<void> {
        await this.recoverStuck().catch((err: unknown) => this.logger.warn(`SMS colgados: ${String(err)}`));
        await this.drain().catch((err: unknown) => this.logger.warn(`Cola de SMS: ${String(err)}`));
        await this.pollStatuses().catch((err: unknown) => this.logger.warn(`Estados de SMS: ${String(err)}`));
    }

    // ── Avisos de entrega ───────────────────────────────────────────────

    /**
     * El aviso de entrega de un proveedor. Token desconocido → 404 opaco;
     * firma de Twilio mala → 401. Un aviso SÓLO mueve un SMS que mandamos
     * nosotros por ESTA conexión, y el estado sólo avanza.
     */
    async receive(token: string, req: Omit<SmsDlrRequest, 'url'>): Promise<{ ok: true; updated: number }> {
        const hook = await this.hookByToken(token);
        if (!hook) throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        const full: SmsDlrRequest = { ...req, url: this.hookUrl(hook.token) };
        let conn: ConnInfo;
        try {
            conn = await this.tenantDb.withTenant(hook.tenantId, (tx) => this.connInTx(tx, hook.tenantId, hook.connectionId));
        } catch {
            throw new NotFoundException({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
        }
        const provider = SMS_PROVIDERS[conn.provider];
        const updates = provider.parseDeliveryReport(full);
        // La comprobación de URL de BulkGate (un GET sin datos) se contesta 200.
        if (updates.length === 0) {
            await this.db.update(smsHooks).set({ lastHookAt: new Date() }).where(eq(smsHooks.token, token));
            return { ok: true, updated: 0 };
        }
        if (!provider.verifyDeliveryReport(full, conn.creds)) {
            throw new UnauthorizedException({ code: 'bad_signature', message: 'Firma inválida', data: { status: 401 } });
        }
        await this.db.update(smsHooks).set({ lastHookAt: new Date() }).where(eq(smsHooks.token, token));
        let updated = 0;
        for (const u of updates) {
            const ids = u.providerIds.filter((x) => x !== '').map((x) => x.slice(0, 160));
            const ref = u.reference && /^[A-Za-z0-9_-]{4,32}$/.test(u.reference) ? u.reference : null;
            if (ids.length === 0 && !ref) continue;
            const [msg] = await this.tenantDb.withTenant(hook.tenantId, (tx) =>
                tx
                    .select({ id: smsMessages.id })
                    .from(smsMessages)
                    .where(
                        and(
                            eq(smsMessages.tenantId, hook.tenantId),
                            eq(smsMessages.connectionId, hook.connectionId),
                            or(...[...(ids.length ? [inArray(smsMessages.providerMessageId, ids)] : []), ...(ref ? [eq(smsMessages.reference, ref)] : [])]),
                        ),
                    )
                    .limit(1),
            );
            if (!msg) continue;
            if (await this.applyDelivery(hook.tenantId, msg, u.status, u.error)) updated++;
        }
        return { ok: true, updated };
    }

    /** Avanza el estado de un SMS y, si es el último del registro, su columna. */
    private async applyDelivery(tenantId: number, msg: { id: number }, incoming: SmsStatus, error: string | null): Promise<boolean> {
        const write = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select().from(smsMessages).where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.id, msg.id))).limit(1).for('update');
            if (!row) return { changed: false, write: null };
            const next = nextSmsStatus(row.status as SmsStatus, incoming);
            if (next === null) return { changed: false, write: null };
            const now = new Date();
            await tx
                .update(smsMessages)
                .set({
                    status: next,
                    error: next === 'fallido' ? (error ?? 'El proveedor no pudo entregarlo.').slice(0, 1000) : row.error,
                    deliveredAt: next === 'entregado' ? now : row.deliveredAt,
                    nextPollAt: next === 'entregado' || next === 'fallido' ? null : row.nextPollAt,
                    updatedAt: now,
                })
                .where(eq(smsMessages.id, row.id));
            if (row.listId === null || row.recordId === null) return { changed: true, write: null };
            // Sólo el ÚLTIMO SMS del registro manda en su columna.
            const [newer] = await tx
                .select({ id: smsMessages.id })
                .from(smsMessages)
                .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.recordId, row.recordId), gt(smsMessages.id, row.id)))
                .limit(1);
            if (newer) return { changed: true, write: null };
            return { changed: true, write: await this.writeRecordInTx(tx, tenantId, row.listId, row.recordId, { status: next }) };
        });
        this.afterWrite(tenantId, write.write);
        return write.changed;
    }

    // ── Automatizaciones ────────────────────────────────────────────────

    /**
     * «Enviar SMS» dentro de la corrida (y su transacción). Con «Respetar el
     * horario» fuera de la franja queda PROGRAMADO y la corrida termina bien
     * («sale el martes a las 07:00»). Con `realCall = false` (simulación de
     * «Probar» paso a paso) arma todo y dice qué mandaría.
     */
    async runAutomationAction(
        tx: Tx,
        args: {
            tenantId: number;
            listId: number;
            recordId: number | null;
            connectionId: number;
            automationId: number | null;
            values: Record<string, unknown>;
            merge: (s: string) => string;
            realCall: boolean;
        },
    ): Promise<{ status: 'success' | 'failed' | 'skipped'; message: string; details: Record<string, unknown>; write: WriteResult | null }> {
        const v = args.values;
        let p: Prepared;
        try {
            const conn = await this.connInTx(tx, args.tenantId, args.connectionId);
            p = this.prepare(conn, { to: args.merge(str(v.to)), message: args.merge(str(v.message)), sender: args.merge(str(v.sender)), stripAccents: isTrue(v.strip_accents) });
        } catch (err) {
            if (err instanceof SmsSendError) return { status: 'failed', message: err.message, details: { code: err.code }, write: null };
            throw err;
        }
        const tz = (await readTenantFormatInTx(tx, args.tenantId)) ?? null;
        const now = new Date();
        const outside = isTrue(v.respect_hours) && !isWithinCommercialHours(now, tz);
        const when = outside ? nextCommercialSendTime(now, tz) : null;
        const label = `${p.seg.segments === 1 ? '1 SMS' : `${p.seg.segments} SMS`} a ${p.to}`;
        if (!args.realCall) {
            const req = this.buildRequest(p, reference(), null);
            const hide = smsSecretsOf(p.conn.creds);
            return {
                status: 'success',
                message: when ? `Programaría ${label} para ${formatScheduled(when, tz ?? 'America/Bogota')} (horario de la Ley 2300).` : `Mandaría ${label}.`,
                details: { _sim: 'would_run', text: p.text, segments: p.seg.segments, encoding: p.seg.encoding, request: { method: req.method, url: redactValues(req.url, hide), body: redactValues(req.body ?? '', hide) } },
                write: null,
            };
        }
        const target = { listId: args.recordId !== null ? args.listId : null, recordId: args.recordId };
        const ref = reference();
        if (when) {
            await this.insertMessageInTx(tx, args.tenantId, p, ref, {
                status: 'programado',
                source: 'automation',
                listId: target.listId,
                recordId: target.recordId,
                userId: null,
                automationId: args.automationId,
                respectHours: true,
                sendAfter: when,
                keepBody: true,
            });
            let write: WriteResult | null = null;
            if (target.listId !== null && target.recordId !== null) {
                write = await this.writeRecordInTx(tx, args.tenantId, target.listId, target.recordId, { status: 'programado' });
                await this.logInTx(tx, args.tenantId, { listId: target.listId, recordId: target.recordId, userId: null }, p, 'scheduled', { scheduled_for: when.toISOString() });
            }
            this.afterWrite(args.tenantId, write);
            return {
                status: 'success',
                message: `${p.conn.name} → ${label} programado para ${formatScheduled(when, tz ?? 'America/Bogota')} (horario de la Ley 2300).`,
                details: { scheduled_for: when.toISOString(), segments: p.seg.segments },
                write,
            };
        }
        const id = await this.insertMessageInTx(tx, args.tenantId, p, ref, {
            status: 'enviando',
            source: 'automation',
            listId: target.listId,
            recordId: target.recordId,
            userId: null,
            automationId: args.automationId,
        });
        const ex = await this.execute(p, ref, await this.callbackFor(args.tenantId, p.conn));
        const status = await this.applyOutcomeInTx(tx, args.tenantId, id, p, ex);
        let write: WriteResult | null = null;
        if (target.listId !== null && target.recordId !== null) {
            write = await this.writeRecordInTx(tx, args.tenantId, target.listId, target.recordId, { status, ...(ex.outcome.ok ? { at: new Date() } : {}) });
            await this.logInTx(tx, args.tenantId, { listId: target.listId, recordId: target.recordId, userId: null }, p, ex.outcome.ok ? 'sent' : 'failed', ex.outcome.ok ? {} : { error: ex.outcome.error });
        }
        this.afterWrite(args.tenantId, write);
        this.afterOutcome(args.tenantId, p, ex);
        if (!ex.outcome.ok) {
            return { status: 'failed', message: `SMS (${p.conn.name}): ${ex.outcome.error}`, details: { code: ex.outcome.code, message_id: id }, write };
        }
        return {
            status: 'success',
            message: `${p.conn.name} → envió ${label}.`,
            details: { message_id: id, provider_message_id: ex.outcome.providerId, segments: ex.outcome.segments ?? p.seg.segments },
            write,
        };
    }

    // ── Columnas de la lista ────────────────────────────────────────────

    async listColumns(tenantId: number, listIdOrSlug: string): Promise<SmsListColumns> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        return columnsOf(list, fields);
    }

    async updateListColumns(tenantId: number, actor: SmsActor, listIdOrSlug: string, mapping: SmsListFields): Promise<SmsListColumns> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.saveListFields(tenantId, actor, list, mapping);
        return this.listColumns(tenantId, String(list.id));
    }

    private async saveListFields(tenantId: number, actor: SmsActor, list: List, mapping: SmsListFields): Promise<void> {
        const fields = await this.fields.listByListId(tenantId, list.id);
        const clean = {} as SmsListFields;
        for (const role of SMS_FIELD_ROLES) {
            const id = mapping[role];
            const f = id ? fields.find((x) => x.id === id) : undefined;
            if (id && !f) throw new BadRequestException({ code: 'sms_field_invalid', message: `El campo elegido para «${SMS_FIELD_ROLE_META[role].label}» no es de esta lista.`, data: { status: 400 } });
            if (f && !SMS_FIELD_ROLE_META[role].types.includes(f.type)) {
                throw new BadRequestException({ code: 'sms_field_type', message: `«${f.label}» no sirve para «${SMS_FIELD_ROLE_META[role].label}».`, data: { status: 400 } });
            }
            clean[role] = f ? f.id : null;
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{sms}', ${JSON.stringify(writeSmsListFields(clean))}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'sms.columns',
                targetType: 'list',
                targetId: list.id,
                targetLabel: list.name,
                meta: { fields: clean },
            });
        });
        this.realtime.lists(tenantId);
    }

    /** «Preparar columnas»: crea en la lista las que falten y guarda el mapeo. */
    async setupListColumns(tenantId: number, actor: SmsActor, listIdOrSlug: string): Promise<SmsListColumns> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.fields.listByListId(tenantId, list.id);
        const mapping = { ...suggestSmsFields(current) } as SmsListFields;
        const saved = readSmsListFields(list.settings);
        for (const role of SMS_FIELD_ROLES) {
            if (saved[role] && current.some((f) => f.id === saved[role])) mapping[role] = saved[role];
        }
        for (const role of SMS_FIELD_ROLES) {
            if (mapping[role]) continue;
            const meta = SMS_FIELD_ROLE_META[role];
            const config =
                role === 'last_status'
                    ? { options: Object.values(SMS_STATUS_OPTIONS).map((o) => ({ value: o.value, label: o.label, color: o.color })) }
                    : role === 'phone'
                      ? { default_country: 'CO' }
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

    // ── Panel de la conexión ────────────────────────────────────────────

    async connectionDetail(tenantId: number, actor: SmsActor, connectionId: number): Promise<SmsConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (!isSmsProvider(editable.provider)) throw this.notSms();
        const hook = await this.ensureHook(tenantId, connectionId);
        const visible = (await this.connectors.list(tenantId, actor.userId, actor.role)).find((c) => c.id === connectionId);
        const since = new Date(Date.now() - 30 * 86_400_000);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ config: connections.config, lastCheckOk: connections.lastCheckOk, lastCheckError: connections.lastCheckError })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1);
            const [totals] = await tx
                .select({
                    sent: sql<number>`count(*) FILTER (WHERE ${smsMessages.status} IN ('enviado', 'entregado'))::int`,
                    delivered: sql<number>`count(*) FILTER (WHERE ${smsMessages.status} = 'entregado')::int`,
                    failed: sql<number>`count(*) FILTER (WHERE ${smsMessages.status} = 'fallido')::int`,
                    segments: sql<number>`coalesce(sum(${smsMessages.segments}) FILTER (WHERE ${smsMessages.status} IN ('enviado', 'entregado')), 0)::int`,
                })
                .from(smsMessages)
                .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.connectionId, connectionId), gt(smsMessages.createdAt, since)));
            const [pending] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(smsMessages)
                .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.connectionId, connectionId), inArray(smsMessages.status, ['programado', 'en_cola', 'enviando'])));
            const recent = await tx
                .select()
                .from(smsMessages)
                .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.connectionId, connectionId)))
                .orderBy(desc(smsMessages.id))
                .limit(30);
            const allLists = await tx.select({ id: lists.id, name: lists.name }).from(lists).where(and(eq(lists.tenantId, tenantId), isNull(lists.deletedAt))).orderBy(asc(lists.name));
            return { row, totals, pending, recent, allLists };
        });
        const f = (((out.row?.config ?? {}) as Record<string, unknown>).fields ?? {}) as Record<string, string>;
        const provider = editable.provider as SmsProviderKey;
        return {
            connection: {
                ...this.summaryOf({ id: connectionId, name: editable.name, integration_key: provider, account_label: visible?.account_label ?? null, fields: f }),
                can_edit: true,
                secret_state: visible?.secret_state ?? 'ok',
            },
            delivery: {
                mode: SMS_PROVIDER_META[provider].delivery,
                url: this.hookUrl(hook.token),
                last_hook_at: hook.lastHookAt ? hook.lastHookAt.toISOString() : null,
            },
            totals: {
                sent_30d: Number(out.totals?.sent ?? 0),
                delivered_30d: Number(out.totals?.delivered ?? 0),
                failed_30d: Number(out.totals?.failed ?? 0),
                pending: Number(out.pending?.n ?? 0),
                segments_30d: Number(out.totals?.segments ?? 0),
            },
            recent: out.recent.map(toMessageDto),
            lists: out.allLists,
            last_error: out.row?.lastCheckOk === false ? (out.row.lastCheckError ?? null) : null,
        };
    }

    /** La agenda (recordatorios por SMS): sólo si la conexión sigue siendo de SMS. */
    async isSmsConnection(tenantId: number, connectionId: number): Promise<boolean> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ provider: connections.provider }).from(connections).where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId))).limit(1),
        );
        return row !== undefined && isSmsProvider(row.provider);
    }
}

// ── Helpers puros ───────────────────────────────────────────────────────

async function readTenantFormatInTx(tx: Tx, tenantId: number): Promise<string | null> {
    const res = await tx.execute<{ tz: string | null }>(sql`SELECT settings #>> '{format,timezone}' AS tz FROM tenants WHERE id = ${tenantId}`);
    const rows = (res as unknown as { rows?: Array<{ tz: string | null }> }).rows ?? (res as unknown as Array<{ tz: string | null }>);
    const tz = rows?.[0]?.tz;
    return typeof tz === 'string' && tz !== '' ? tz : null;
}

function toMessageDto(r: SmsMessageRowDb): SmsMessageDto {
    return {
        id: r.id,
        to: r.toPhone,
        status: r.status as SmsStatus,
        error: r.error,
        segments: r.segments,
        encoding: (r.encoding === 'ucs2' ? 'ucs2' : 'gsm7') as SmsEncoding,
        source: r.source,
        list_id: r.listId,
        record_id: r.recordId,
        created_at: r.createdAt.toISOString(),
        sent_at: r.sentAt ? r.sentAt.toISOString() : null,
        delivered_at: r.deliveredAt ? r.deliveredAt.toISOString() : null,
        send_after: r.sendAfter ? r.sendAfter.toISOString() : null,
    };
}

function effectiveMapping(list: List, fields: Field[]): SmsListFields {
    const saved = readSmsListFields(list.settings);
    const alive = new Set(fields.map((f) => f.id));
    const out = {} as SmsListFields;
    for (const role of SMS_FIELD_ROLES) out[role] = saved[role] && alive.has(saved[role]) ? saved[role] : null;
    if (out.phone === null) out.phone = suggestSmsFields(fields).phone;
    return out;
}

function columnsOf(list: List, fields: Field[]): SmsListColumns {
    const saved = readSmsListFields(list.settings);
    const alive = new Set(fields.map((f) => f.id));
    const current = {} as SmsListFields;
    const candidates = {} as SmsListColumns['candidates'];
    for (const role of SMS_FIELD_ROLES) {
        current[role] = saved[role] && alive.has(saved[role]) ? saved[role] : null;
        candidates[role] = fields.filter((f) => SMS_FIELD_ROLE_META[role].types.includes(f.type)).map((f) => ({ id: f.id, label: f.label, type: f.type }));
    }
    if (current.phone === null) current.phone = suggestSmsFields(fields).phone;
    return { list_id: list.id, list_name: list.name, fields: current, candidates };
}

/** El valor de una columna del SMS en el tipo de su campo (o null para vaciarla). */
export function columnValue(role: SmsFieldRole, value: unknown, field: { type: string; config: Record<string, unknown> }): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (role === 'last_status') {
        const shown = value === 'enviando' ? 'en_cola' : (value as keyof typeof SMS_STATUS_OPTIONS);
        const opt = SMS_STATUS_OPTIONS[shown];
        if (!opt) return null;
        return field.type === 'select' ? opt.value : opt.label;
    }
    if (role === 'last_at') {
        const d = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(d.getTime())) return null;
        return field.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
    }
    return String(value);
}

/** El teléfono del registro, salvo que el campo esté oculto para quien pide. */
function visiblePhone(list: List, fields: Field[], data: Record<string, unknown>, hidden: Set<string>): unknown {
    const mapping = effectiveMapping(list, fields);
    if (!mapping.phone) return null;
    const field = fields.find((f) => f.id === mapping.phone);
    if (!field || hidden.has(field.slug)) return null;
    return data[jsonbKeyForField(field.id)];
}
