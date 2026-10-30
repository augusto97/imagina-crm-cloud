import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    htmlToPlainText,
    isBlockedSender,
    jsonbKeyForField,
    parseTicketTokens,
    readHelpdeskSettings,
    resolveTimeZone,
    resolveTitleFieldId,
    zonedToday,
    type EmailEventInfo,
    type Field,
    type HelpdeskMessageStatus,
    type HelpdeskSettings,
    type List,
} from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import { CommentsRepository } from '../comments/comments.repository';
import { DRIZZLE, type Db } from '../db/client';
import { helpdeskMailboxes, helpdeskMessages, helpdeskTickets, records, type HelpdeskMailboxRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { ListsService } from '../lists/lists.service';
import { NotifyHub } from '../notifications/notify-hub';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { RecordsService, type Actor } from '../records/records.service';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { HelpdeskConfigService, HelpdeskConnectError } from './helpdesk-config.service';
import { HelpdeskSlaService } from './helpdesk-sla.service';
import { HelpdeskQueue } from './helpdesk.queue';
import { imapErrorDiagnostic, type ImapFetched } from './imap-reader';
import { bodyToRichDoc, parseInbound, stripQuotedReply, type InboundAttachment, type InboundMail } from './inbound-mail';
import { planIncludesSql } from '../billing/plan-module-gate';

const SYSTEM_ACTOR: Actor = { userId: 0, role: 'admin' };
/** Correos por vuelta (si hay más, se encola otra enseguida). */
export const HELPDESK_MAX_PER_RUN = 50;
/** Vida del candado de una lectura (más que una vuelta de 50 correos). */
const LOCK_TTL_MS = 10 * 60_000;
/** Cada cuánto se lee un buzón que anda bien. */
const POLL_EVERY_MS = 60_000;
const MAX_ATTACHMENTS = 10;
const COMMENT_MAX = 10_000;

/** Lo que usan el candado y el freno por remitente (tipado chico: los tests usan uno en memoria). */
export interface HelpdeskRedis {
    set(key: string, value: string, mode: 'PX', ms: number, nx: 'NX'): Promise<unknown>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
}

interface RunCtx {
    tenantId: number;
    mailbox: HelpdeskMailboxRow;
    list: List;
    fields: Field[];
    settings: HelpdeskSettings;
    timeZone: string;
    uidValidity: number;
}

type Outcome = { kind: 'done'; status: HelpdeskMessageStatus } | { kind: 'pending'; reason: string };

/**
 * D2 — El lector del buzón de soporte: cada minuto (BullMQ) trae los correos
 * NUEVOS por IMAP y los convierte en tickets o en comentarios.
 *
 *  - Lleva la cuenta por UIDVALIDITY + último UID procesado: no borra, no
 *    mueve y no marca nada en el buzón (salvo «marcar como leído»). Al
 *    conectar arranca DESDE AHORA: lo viejo no crea tickets.
 *  - Una sola lectura a la vez por buzón entre nodos (candado en Redis).
 *  - Cada correo nuevo crea un ticket por `RecordsService.create` (el mismo
 *    camino que un alta: validación, límite del plan, actividad,
 *    automatizaciones); una respuesta del cliente —reconocida por
 *    `In-Reply-To`/`References` o por `[TCK-0001]` en el asunto— se suma como
 *    comentario visible para él y puede reabrir el ticket.
 *  - Ignora respuestas automáticas, rebotes, sus propios envíos, remitentes
 *    bloqueados, correos demasiado grandes y a quien manda demasiados.
 *  - Límite del plan o solo-lectura: el correo NO se pierde — el cursor no
 *    avanza (queda en el buzón) y se avisa con un Problema; en la próxima
 *    vuelta con lugar se procesa.
 */
@Injectable()
export class HelpdeskIngestService {
    private readonly logger = new Logger(HelpdeskIngestService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: HelpdeskRedis,
        private readonly config: HelpdeskConfigService,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly comments: CommentsRepository,
        private readonly files: FilesService,
        private readonly billing: BillingService,
        private readonly sla: HelpdeskSlaService,
        private readonly dispatcher: AutomationDispatcher,
        private readonly realtime: RealtimeService,
        private readonly queue: HelpdeskQueue,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── Planificador ─────────────────────────────────────────────────────

    /** Los buzones que toca leer (todas las empresas): se encola una lectura por cada uno. */
    async tick(now: Date = new Date()): Promise<number> {
        const due = await this.db
            .select({ id: helpdeskMailboxes.id, tenantId: helpdeskMailboxes.tenantId })
            .from(helpdeskMailboxes)
            .where(
                and(
                    eq(helpdeskMailboxes.enabled, true),
                    isNotNull(helpdeskMailboxes.nextCheckAt),
                    lte(helpdeskMailboxes.nextCheckAt, now),
                    // Papelera: con la lista borrada no se lee (al restaurarla sigue sola).
                    sql`NOT EXISTS (SELECT 1 FROM lists l WHERE l.id = ${helpdeskMailboxes.listId} AND l.deleted_at IS NOT NULL)`,
                    // v0.1.338 (ADR-S87) — sólo si el plan incluye «Mesa de ayuda por
                    // correo»: los correos esperan en el buzón (nada se pierde).
                    planIncludesSql(helpdeskMailboxes.tenantId, 'helpdesk'),
                ),
            )
            .orderBy(asc(helpdeskMailboxes.nextCheckAt))
            .limit(200);
        for (const d of due) {
            // Provisorio: no se re-encola mientras espera; la lectura pone la próxima de verdad.
            await this.db
                .update(helpdeskMailboxes)
                .set({ nextCheckAt: new Date(now.getTime() + 5 * 60_000) })
                .where(eq(helpdeskMailboxes.id, d.id));
            this.queue.enqueuePoll(d.tenantId, d.id);
        }
        return due.length;
    }

    // ── Una lectura ──────────────────────────────────────────────────────

    /** `false` = otra lectura del mismo buzón la tenía tomada. */
    async run(tenantId: number, mailboxId: number): Promise<boolean> {
        const lockKey = `helpdesk:lock:${mailboxId}`;
        const token = randomUUID();
        if ((await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')) !== 'OK') return false;
        try {
            await this.runLocked(tenantId, mailboxId);
            return true;
        } finally {
            const current = await this.redis.get(lockKey).catch(() => null);
            if (current === token) await this.redis.del(lockKey).catch(() => undefined);
        }
    }

    private async runLocked(tenantId: number, mailboxId: number): Promise<void> {
        const mailbox = await this.loadMailbox(tenantId, mailboxId);
        if (!mailbox || !mailbox.enabled) return;
        const list = await this.lists.get(tenantId, String(mailbox.listId)).catch(() => null);
        if (!list) return;
        const key = `helpdesk:${mailbox.id}`;
        const pendingKey = `helpdesk:${mailbox.id}:pending`;
        const startedAt = new Date();
        const state = { ...((mailbox.state ?? {}) as Record<string, unknown>) };
        const counts = { tickets: 0, replies: 0, ignored: 0, failed: 0, ...((state.counts ?? {}) as Record<string, number>) };

        // SEC-34: una empresa en solo-lectura no crea tickets. El correo se queda en el buzón.
        const readOnly = await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId));
        if (readOnly) {
            const reason = 'La empresa está en solo lectura (plan vencido o suspendido): los correos esperan en el buzón y se procesan al reactivarla.';
            await this.saveState(tenantId, mailbox.id, { last_check_at: startedAt.toISOString(), pending_reason: reason }, new Date(Date.now() + 15 * 60_000));
            this.reportPending(tenantId, mailbox, list, pendingKey, reason);
            return;
        }
        const pw = this.config.password(mailbox);
        if (pw.state !== 'ok') {
            const msg =
                pw.state === 'unreadable'
                    ? `No se puede leer la contraseña del buzón (${pw.reason}). Escríbela de nuevo en Ajustes de la lista → Correo entrante.`
                    : 'El buzón no tiene contraseña: escríbela en Ajustes de la lista → Correo entrante.';
            await this.fail(tenantId, mailbox, list, key, msg, state);
            return;
        }

        let session;
        try {
            session = await this.config.connect({
                host: mailbox.host,
                port: mailbox.port,
                security: mailbox.security as 'tls' | 'starttls' | 'none',
                username: mailbox.username,
                pass: pw.pass,
                allowInvalidCert: mailbox.allowInvalidCert,
            });
        } catch (err) {
            const d = err instanceof HelpdeskConnectError ? err.diagnostic : imapErrorDiagnostic(err, { host: mailbox.host, port: mailbox.port, security: mailbox.security as 'tls', folder: mailbox.folder });
            await this.fail(tenantId, mailbox, list, key, `${d.message} ${d.hints[0] ?? ''}`.trim(), state);
            return;
        }

        let pendingReason: string | null = null;
        let more = false;
        try {
            const box = await session.open(mailbox.folder, { writable: mailbox.markSeen });
            const knownValidity = typeof state.uidvalidity === 'number' ? state.uidvalidity : null;
            if (knownValidity !== box.uidValidity) {
                // Primera lectura (o el buzón se reorganizó): se arranca DESDE AHORA.
                const patch: Record<string, unknown> = { uidvalidity: box.uidValidity, last_uid: Math.max(0, box.uidNext - 1) };
                if (knownValidity !== null) patch.note = 'El buzón se reorganizó (UIDVALIDITY cambió): se sigue con los correos que lleguen desde ahora.';
                await this.saveState(tenantId, mailbox.id, patch);
            } else {
                const lastUid = typeof state.last_uid === 'number' ? state.last_uid : 0;
                const fieldsList = await this.fields.listByListId(tenantId, list.id);
                const ctx: RunCtx = {
                    tenantId,
                    mailbox,
                    list,
                    fields: fieldsList,
                    settings: readHelpdeskSettings(list.settings),
                    timeZone: this.timeZones ? await this.timeZones.orUtc(tenantId) : 'UTC',
                    uidValidity: box.uidValidity,
                };
                const maxBytes = ctx.settings.max_size_mb * 1024 * 1024;
                const fetched = await session.fetchAfter(lastUid, HELPDESK_MAX_PER_RUN, maxBytes);
                const seen: number[] = [];
                for (const m of fetched) {
                    const outcome = await this.processOne(ctx, m);
                    if (outcome.kind === 'pending') {
                        pendingReason = outcome.reason;
                        break;
                    }
                    counts[outcome.status === 'ticket' ? 'tickets' : outcome.status === 'reply' ? 'replies' : outcome.status === 'failed' ? 'failed' : 'ignored'] += 1;
                    await this.saveState(tenantId, mailbox.id, { last_uid: m.uid, counts });
                    if (mailbox.markSeen) seen.push(m.uid);
                }
                if (seen.length > 0) await session.markSeen(seen).catch(() => undefined);
                more = fetched.length === HELPDESK_MAX_PER_RUN && pendingReason === null;
            }
        } catch (err) {
            const d = imapErrorDiagnostic(err, { host: mailbox.host, port: mailbox.port, security: mailbox.security as 'tls', folder: mailbox.folder });
            await session.close().catch(() => undefined);
            await this.fail(tenantId, mailbox, list, key, `${d.message} ${d.hints[0] ?? ''}`.trim(), state);
            return;
        }
        await session.close().catch(() => undefined);

        await this.saveState(
            tenantId,
            mailbox.id,
            { last_check_at: startedAt.toISOString(), last_ok_at: new Date().toISOString(), last_error: null, errors_in_row: 0, pending_reason: pendingReason, counts },
            new Date(Date.now() + (pendingReason ? 15 * 60_000 : POLL_EVERY_MS)),
        );
        this.incidents?.resolve(tenantId, key);
        if (pendingReason) this.reportPending(tenantId, mailbox, list, pendingKey, pendingReason);
        else this.incidents?.resolve(tenantId, pendingKey);
        if (more) this.queue.enqueuePoll(tenantId, mailbox.id, 2_000);
    }

    /** No se pudo leer: el motivo en el panel, un Problema y una espera creciente. */
    private async fail(tenantId: number, mailbox: HelpdeskMailboxRow, list: List, key: string, message: string, state: Record<string, unknown>): Promise<void> {
        const inRow = (typeof state.errors_in_row === 'number' ? state.errors_in_row : 0) + 1;
        const waitMin = Math.min(30, 2 ** Math.min(inRow, 5));
        await this.saveState(
            tenantId,
            mailbox.id,
            { last_check_at: new Date().toISOString(), last_error: message, errors_in_row: inRow },
            new Date(Date.now() + waitMin * 60_000),
        );
        this.incidents?.report({
            tenantId,
            key,
            source: 'helpdesk',
            sourceId: mailbox.id,
            listId: list.id,
            ownerId: mailbox.createdBy,
            title: `No se puede leer el buzón de soporte de «${list.name}»`,
            message: `${message} Los correos nuevos esperan en el buzón: no se pierden.`,
        });
    }

    private reportPending(tenantId: number, mailbox: HelpdeskMailboxRow, list: List, key: string, reason: string): void {
        this.incidents?.report({
            tenantId,
            key,
            source: 'helpdesk',
            sourceId: mailbox.id,
            listId: list.id,
            ownerId: mailbox.createdBy,
            title: `Hay correos de soporte sin procesar en «${list.name}»`,
            message: reason,
        });
    }

    // ── Un correo ────────────────────────────────────────────────────────

    async processOne(ctx: RunCtx, m: ImapFetched): Promise<Outcome> {
        const support = ctx.mailbox.supportAddress.toLowerCase();
        if (m.source === null) {
            const mb = (m.size / 1024 / 1024).toFixed(1);
            await this.logMessage(ctx, { status: 'ignored', reason: `Pesa ${mb} MB: más que el máximo (${ctx.settings.max_size_mb} MB).`, uid: m.uid });
            return { kind: 'done', status: 'ignored' };
        }
        let mail: InboundMail;
        try {
            mail = await parseInbound(m.source);
        } catch (err) {
            await this.logMessage(ctx, { status: 'failed', reason: `No se pudo leer el correo: ${errorText(err, 200)}`, uid: m.uid });
            return { kind: 'done', status: 'failed' };
        }
        const messageId = mail.messageId ?? `uid.${ctx.uidValidity}.${m.uid}.${ctx.mailbox.id}@helpdesk.invalid`;
        const base = { uid: m.uid, messageId, mail };

        // Ya procesado (un reintento, otro nodo): nada.
        if (await this.alreadyProcessed(ctx, messageId)) return { kind: 'done', status: 'ignored' };

        const ignore = async (reason: string): Promise<Outcome> => {
            await this.logMessage(ctx, { ...base, status: 'ignored', reason });
            return { kind: 'done', status: 'ignored' };
        };
        // Lo mandó esta mesa de ayuda (copia en la bandeja, un reenvío automático): se corta el bucle.
        if (mail.fromHelpdesk || mail.from?.email === support || (await this.isOwnOutbound(ctx, messageId))) {
            return ignore('Lo envió esta mesa de ayuda (se evita un bucle).');
        }
        if (mail.autoReason) return ignore(mail.autoReason);
        const customer = mail.customer;
        if (!customer) return ignore('El correo no trae un remitente válido.');
        if (customer.email === support) return ignore('Lo envió esta mesa de ayuda (se evita un bucle).');
        if (isBlockedSender(customer.email, ctx.settings.blocked_senders)) return ignore(`El remitente ${customer.email} está bloqueado.`);

        const recordId = await this.findThread(ctx, mail, customer.email);
        if (recordId !== null) return this.appendReply(ctx, recordId, mail, messageId, m.uid);

        // Freno por remitente: un robot (o un bucle con otro autorespondedor) no llena la lista.
        const hour = Math.floor(Date.now() / 3_600_000);
        const rateKey = `helpdesk:rate:${ctx.mailbox.id}:${customer.email}:${hour}`;
        const n = await this.redis.incr(rateKey).catch(() => 0);
        if (n === 1) await this.redis.expire(rateKey, 3700).catch(() => undefined);
        if (n > ctx.settings.max_per_sender_hour) {
            return ignore(`${customer.email} ya abrió ${ctx.settings.max_per_sender_hour} tickets en la última hora.`);
        }
        return this.createTicket(ctx, mail, messageId, m.uid);
    }

    /** ¿A qué ticket responde? Por Message-ID; si no, por el token del asunto (sólo de alguien del hilo). */
    private async findThread(ctx: RunCtx, mail: InboundMail, sender: string): Promise<number | null> {
        const ids = [...new Set([mail.inReplyTo, ...mail.references].filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, 50);
        if (ids.length > 0) {
            const [hit] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                tx
                    .select({ recordId: helpdeskMessages.recordId })
                    .from(helpdeskMessages)
                    .innerJoin(records, and(eq(records.id, helpdeskMessages.recordId), sql`${records.deletedAt} IS NULL`))
                    .where(
                        and(
                            eq(helpdeskMessages.tenantId, ctx.tenantId),
                            eq(helpdeskMessages.listId, ctx.list.id),
                            inArray(helpdeskMessages.messageId, ids),
                            isNotNull(helpdeskMessages.recordId),
                        ),
                    )
                    .orderBy(desc(helpdeskMessages.id))
                    .limit(1),
            );
            if (hit?.recordId) return hit.recordId;
        }
        // El token del asunto: cualquiera puede escribir «[TCK-0005]», así que sólo
        // vale si quien escribe ya participa del hilo (el cliente del ticket o
        // alguien que ya le escribió a ese ticket). Si no, es un ticket nuevo.
        const tokens = parseTicketTokens(mail.subject);
        if (tokens.length === 0) return null;
        const autonumbers = ctx.fields.filter((f) => f.type === 'autonumber');
        for (const tok of tokens) {
            let candidate: number | null = null;
            if (tok.kind === 'id') {
                const [r] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                    tx
                        .select({ id: records.id })
                        .from(records)
                        .where(and(eq(records.tenantId, ctx.tenantId), eq(records.listId, ctx.list.id), eq(records.id, tok.id), sql`${records.deletedAt} IS NULL`))
                        .limit(1),
                );
                candidate = r?.id ?? null;
            } else if (autonumbers.length > 0) {
                for (const f of autonumbers) {
                    const key = jsonbKeyForField(f.id);
                    const [r] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                        tx
                            .select({ id: records.id })
                            .from(records)
                            .where(
                                and(
                                    eq(records.tenantId, ctx.tenantId),
                                    eq(records.listId, ctx.list.id),
                                    sql`lower(${records.data} ->> ${key}) = lower(${tok.code})`,
                                    sql`${records.deletedAt} IS NULL`,
                                ),
                            )
                            .limit(1),
                    );
                    if (r) {
                        candidate = r.id;
                        break;
                    }
                }
            }
            if (candidate !== null && (await this.isParticipant(ctx, candidate, sender))) return candidate;
        }
        return null;
    }

    private async isParticipant(ctx: RunCtx, recordId: number, email: string): Promise<boolean> {
        const e = email.toLowerCase();
        const [hit] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx.execute(sql`
                SELECT 1 AS ok FROM helpdesk_tickets t
                 WHERE t.record_id = ${recordId} AND lower(t.customer_email) = ${e}
                UNION ALL
                SELECT 1 FROM helpdesk_messages m
                 WHERE m.record_id = ${recordId} AND m.direction = 'in' AND lower(m.from_email) = ${e}
                LIMIT 1`),
        ).then((r) => (r as unknown as { rows: unknown[] }).rows);
        return hit !== undefined;
    }

    private async alreadyProcessed(ctx: RunCtx, messageId: string): Promise<boolean> {
        const [hit] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: helpdeskMessages.id })
                .from(helpdeskMessages)
                .where(and(eq(helpdeskMessages.mailboxId, ctx.mailbox.id), eq(helpdeskMessages.messageId, messageId), eq(helpdeskMessages.direction, 'in')))
                .limit(1),
        );
        return hit !== undefined;
    }

    private async isOwnOutbound(ctx: RunCtx, messageId: string): Promise<boolean> {
        const [hit] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: helpdeskMessages.id })
                .from(helpdeskMessages)
                .where(and(eq(helpdeskMessages.tenantId, ctx.tenantId), eq(helpdeskMessages.listId, ctx.list.id), eq(helpdeskMessages.messageId, messageId), eq(helpdeskMessages.direction, 'out')))
                .limit(1),
        );
        return hit !== undefined;
    }

    // ── Ticket nuevo ─────────────────────────────────────────────────────

    private async createTicket(ctx: RunCtx, mail: InboundMail, messageId: string, uid: number): Promise<Outcome> {
        const s = ctx.settings;
        const customer = mail.customer!;
        const data: Record<string, unknown> = {};
        const set = (fieldId: number | null, value: unknown): void => {
            if (fieldId === null || value === null || value === undefined || value === '') return;
            if (!ctx.fields.some((f) => f.id === fieldId)) return;
            data[jsonbKeyForField(fieldId)] = value;
        };
        const titleId = s.title_field_id ?? resolveTitleFieldId(ctx.fields, ctx.list.settings);
        set(titleId, (mail.subject || '(sin asunto)').slice(0, 250));
        set(s.from_name_field_id, customer.name.slice(0, 250) || null);
        const emailField = ctx.fields.find((f) => f.id === s.from_email_field_id);
        set(s.from_email_field_id, emailField ? customer.email : null);
        const received = ctx.fields.find((f) => f.id === s.received_at_field_id);
        if (received) set(received.id, received.type === 'date' ? zonedToday(resolveTimeZone(ctx.timeZone)) : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
        const plain = mail.text !== '' ? mail.text : mail.html ? htmlToPlainText(mail.html) : '';
        set(s.body_text_field_id, plain.slice(0, 20_000) || null);
        set(s.status_field_id, s.initial_status);
        if (s.contact_field_id !== null) {
            const contact = await this.findContact(ctx, customer.email);
            if (contact !== null) set(s.contact_field_id, [contact]);
        }
        const attach = await this.storeAttachments(ctx, mail.attachments);
        if (attach.ids.length > 0 && s.attachments_field_id !== null) set(s.attachments_field_id, attach.ids);

        let created: { id: number; data: Record<string, unknown> };
        try {
            created = await this.records.create(ctx.tenantId, SYSTEM_ACTOR, String(ctx.list.id), { data }, { lenientRequired: true });
        } catch (err) {
            const code = (err as { response?: { code?: string } }).response?.code;
            if (code === 'plan_limit_reached') {
                await this.discard(ctx, attach.ids);
                return { kind: 'pending', reason: `Se llegó al límite de registros del plan: los correos nuevos esperan en el buzón. ${errorText(err, 200)}` };
            }
            // Un dato que la lista no acepta (una regla de un campo): se crea con lo mínimo.
            try {
                const minimal: Record<string, unknown> = {};
                if (titleId !== null) minimal[jsonbKeyForField(titleId)] = (mail.subject || '(sin asunto)').slice(0, 250);
                created = await this.records.create(ctx.tenantId, SYSTEM_ACTOR, String(ctx.list.id), { data: minimal }, { lenientRequired: true });
            } catch (err2) {
                await this.discard(ctx, attach.ids);
                const reason = `No se pudo crear el ticket: ${errorText(err2, 300)}`;
                await this.logMessage(ctx, { uid, messageId, mail, status: 'failed', reason });
                this.incidents?.report({
                    tenantId: ctx.tenantId,
                    key: `helpdesk:${ctx.mailbox.id}:create`,
                    source: 'helpdesk',
                    sourceId: ctx.mailbox.id,
                    listId: ctx.list.id,
                    ownerId: ctx.mailbox.createdBy,
                    title: `Un correo de soporte no se pudo convertir en ticket en «${ctx.list.name}»`,
                    message: `${reason} (de ${customer.email}, «${mail.subject || 'sin asunto'}»). El correo sigue en el buzón.`,
                });
                return { kind: 'done', status: 'failed' };
            }
        }
        this.incidents?.resolve(ctx.tenantId, `helpdesk:${ctx.mailbox.id}:create`);

        const doc = bodyToRichDoc(mail);
        if (doc) {
            await this.records
                .updateDescription(ctx.tenantId, SYSTEM_ACTOR, String(ctx.list.id), created.id, { description: doc })
                .catch((err: unknown) => this.logger.warn(`Descripción del ticket ${created.id}: ${errorText(err)}`));
        }
        await this.sla.ensureTicket(ctx.tenantId, ctx.list.id, created.id, {
            customerEmail: customer.email,
            customerName: customer.name || null,
            subject: (mail.subject || '').slice(0, 500) || null,
            mailboxId: ctx.mailbox.id,
            data: created.data,
            settings: ctx.settings,
        });
        await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx.update(helpdeskTickets).set({ lastInboundAt: new Date() }).where(and(eq(helpdeskTickets.tenantId, ctx.tenantId), eq(helpdeskTickets.recordId, created.id))),
        );
        if (ctx.settings.sla.enabled) await this.sla.recompute(ctx.tenantId, created.id).catch(() => undefined);
        await this.logMessage(ctx, {
            uid,
            messageId,
            mail,
            status: 'ticket',
            recordId: created.id,
            reason: attach.notes.length > 0 ? attach.notes.join(' ') : null,
        });
        this.dispatcher.dispatch({
            tenantId: ctx.tenantId,
            listId: ctx.list.id,
            recordId: created.id,
            trigger: 'email_received',
            after: created.data,
            email: emailInfo(mail, 'nuevo', plain),
        });
        return { kind: 'done', status: 'ticket' };
    }

    /** El contacto de la otra lista con ese correo (el campo elegido o el primer correo). */
    private async findContact(ctx: RunCtx, email: string): Promise<number | null> {
        const rel = ctx.fields.find((f) => f.id === ctx.settings.contact_field_id);
        const target = Number((rel?.config as { target_list_id?: unknown } | undefined)?.target_list_id);
        if (!rel || !Number.isInteger(target) || target <= 0) return null;
        const targetFields = await this.fields.listByListId(ctx.tenantId, target).catch(() => [] as Field[]);
        const match = ctx.settings.contact_match_field_id !== null ? targetFields.find((f) => f.id === ctx.settings.contact_match_field_id) : targetFields.find((f) => f.type === 'email');
        if (!match) return null;
        const key = jsonbKeyForField(match.id);
        const [r] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.tenantId, ctx.tenantId), eq(records.listId, target), sql`lower(${records.data} ->> ${key}) = ${email.toLowerCase()}`, sql`${records.deletedAt} IS NULL`))
                .orderBy(asc(records.id))
                .limit(1),
        );
        return r?.id ?? null;
    }

    // ── Respuesta del cliente ────────────────────────────────────────────

    private async appendReply(ctx: RunCtx, recordId: number, mail: InboundMail, messageId: string, uid: number): Promise<Outcome> {
        const s = ctx.settings;
        const customer = mail.customer!;
        const plain = mail.text !== '' ? mail.text : mail.html ? htmlToPlainText(mail.html) : '';
        const body = stripQuotedReply(plain).slice(0, COMMENT_MAX) || '(correo sin texto)';
        const attach = await this.storeAttachments(ctx, mail.attachments);
        const comment = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const row = await this.comments.insert(tx, {
                tenantId: ctx.tenantId,
                listId: ctx.list.id,
                recordId,
                userId: 0,
                body,
                kind: 'email',
                parentId: null,
                visibility: 'client',
                metadata: {
                    email: {
                        direction: 'in',
                        from: customer.email,
                        from_name: customer.name,
                        to: mail.to,
                        cc: mail.cc,
                        subject: mail.subject,
                        message_id: messageId,
                        attachments: attach.files,
                    },
                },
            });
            await tx
                .update(helpdeskTickets)
                .set({ lastInboundAt: new Date(), updatedAt: new Date() })
                .where(and(eq(helpdeskTickets.tenantId, ctx.tenantId), eq(helpdeskTickets.recordId, recordId)));
            return row;
        });
        await this.logMessage(ctx, { uid, messageId, mail, status: 'reply', recordId, commentId: comment.id, reason: attach.notes.length > 0 ? attach.notes.join(' ') : null });

        // Adjuntos al campo y reapertura, en UNA edición (actividad, automatizaciones, SLA).
        const [rec] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx.select({ data: records.data }).from(records).where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, recordId))).limit(1),
        );
        const current = (rec?.data ?? {}) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        if (attach.ids.length > 0 && s.attachments_field_id !== null && ctx.fields.some((f) => f.id === s.attachments_field_id)) {
            const key = jsonbKeyForField(s.attachments_field_id);
            const prev = Array.isArray(current[key]) ? (current[key] as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
            patch[key] = [...prev, ...attach.ids].slice(-100);
        }
        if (s.status_field_id !== null && s.reopen_status !== null) {
            const key = jsonbKeyForField(s.status_field_id);
            const status = typeof current[key] === 'string' ? (current[key] as string) : null;
            // El cliente contestó: si estaba cerrado (o esperándolo), vuelve a la cola del equipo.
            if (status !== null && (s.closed_statuses.includes(status) || s.paused_statuses.includes(status)) && status !== s.reopen_status) {
                patch[key] = s.reopen_status;
            }
        }
        let after = current;
        if (Object.keys(patch).length > 0) {
            try {
                const updated = await this.records.update(ctx.tenantId, SYSTEM_ACTOR, String(ctx.list.id), recordId, { data: patch });
                after = { ...current, ...patch };
                void updated;
            } catch (err) {
                this.logger.warn(`Respuesta al ticket ${recordId}: no se pudo actualizar el registro: ${errorText(err)}`);
            }
        }
        this.realtime.records(ctx.tenantId, ctx.list.id);
        this.notify?.emit({
            type: 'comment',
            tenantId: ctx.tenantId,
            listId: ctx.list.id,
            recordId,
            actorId: 0,
            body,
            mentioned: [],
            commentId: comment.id,
            visibility: 'client',
            fromClient: true,
            clientName: customer.name || customer.email,
        });
        this.dispatcher.dispatch({
            tenantId: ctx.tenantId,
            listId: ctx.list.id,
            recordId,
            trigger: 'email_received',
            after,
            email: emailInfo(mail, 'respuesta', body),
        });
        return { kind: 'done', status: 'reply' };
    }

    // ── Adjuntos ─────────────────────────────────────────────────────────

    /**
     * Guarda los adjuntos en el módulo de archivos (cuentan para el
     * almacenamiento del plan, o van al almacenamiento propio de la empresa).
     * Lo que no entra se anota; nunca corta el ticket.
     */
    private async storeAttachments(ctx: RunCtx, list: InboundAttachment[]): Promise<{ ids: number[]; files: Array<{ id: number; name: string; size: number }>; notes: string[] }> {
        const ids: number[] = [];
        const files: Array<{ id: number; name: string; size: number }> = [];
        const notes: string[] = [];
        if (list.length === 0) return { ids, files, notes };
        const external = await this.files.uploadsExternally(ctx.tenantId).catch(() => false);
        for (const a of list.slice(0, MAX_ATTACHMENTS)) {
            try {
                if (!external) await this.billing.assertCanUpload(ctx.tenantId, a.content.length);
                const dto = await this.files.upload(ctx.tenantId, 0, a.filename, a.contentType, Readable.from(a.content));
                ids.push(dto.id);
                files.push({ id: dto.id, name: a.filename, size: a.content.length });
            } catch (err) {
                notes.push(`El adjunto «${a.filename}» no se guardó: ${errorText(err, 160)}`);
            }
        }
        if (list.length > MAX_ATTACHMENTS) notes.push(`Llegaron ${list.length} adjuntos: se guardaron los primeros ${MAX_ATTACHMENTS}.`);
        return { ids, files, notes };
    }

    private async discard(ctx: RunCtx, ids: number[]): Promise<void> {
        for (const id of ids) await this.files.remove(ctx.tenantId, id).catch(() => undefined);
    }

    // ── Estado y registro ────────────────────────────────────────────────

    private async logMessage(
        ctx: RunCtx,
        m: { uid: number; status: HelpdeskMessageStatus; reason?: string | null; messageId?: string; mail?: InboundMail; recordId?: number; commentId?: number },
    ): Promise<void> {
        await this.tenantDb
            .withTenant(ctx.tenantId, (tx) =>
                tx
                    .insert(helpdeskMessages)
                    .values({
                        tenantId: ctx.tenantId,
                        listId: ctx.list.id,
                        mailboxId: ctx.mailbox.id,
                        recordId: m.recordId ?? null,
                        commentId: m.commentId ?? null,
                        direction: 'in',
                        status: m.status,
                        reason: m.reason ?? null,
                        messageId: m.messageId ?? null,
                        inReplyTo: m.mail?.inReplyTo ?? null,
                        refs: (m.mail?.references ?? []).slice(-50),
                        fromEmail: m.mail?.customer?.email ?? m.mail?.from?.email ?? null,
                        fromName: (m.mail?.customer?.name ?? m.mail?.from?.name ?? '').slice(0, 255) || null,
                        toAddr: m.mail?.to ?? null,
                        ccAddr: m.mail?.cc ?? null,
                        subject: (m.mail?.subject ?? '').slice(0, 500) || null,
                        uid: m.uid,
                        uidvalidity: ctx.uidValidity,
                    })
                    .onConflictDoNothing(),
            )
            .catch((err: unknown) => this.logger.warn(`Registro del correo ${m.messageId ?? m.uid}: ${errorText(err)}`));
    }

    private async loadMailbox(tenantId: number, id: number): Promise<HelpdeskMailboxRow | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(helpdeskMailboxes).where(and(eq(helpdeskMailboxes.tenantId, tenantId), eq(helpdeskMailboxes.id, id))).limit(1),
        );
        return row ?? null;
    }

    /** Mezcla en `state` (nunca pisa la configuración que edita la persona). */
    private async saveState(tenantId: number, id: number, patch: Record<string, unknown>, nextCheckAt?: Date): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(helpdeskMailboxes)
                .set({ state: sql`${helpdeskMailboxes.state} || ${JSON.stringify(patch)}::jsonb`, ...(nextCheckAt ? { nextCheckAt } : {}) })
                .where(and(eq(helpdeskMailboxes.tenantId, tenantId), eq(helpdeskMailboxes.id, id))),
        );
    }
}

function emailInfo(mail: InboundMail, tipo: EmailEventInfo['tipo'], text: string): EmailEventInfo {
    return {
        tipo,
        de: mail.customer?.email ?? '',
        nombre: mail.customer?.name ?? '',
        asunto: mail.subject,
        texto: text.slice(0, 5000),
        message_id: mail.messageId,
    };
}
