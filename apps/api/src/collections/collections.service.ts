import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnApplicationShutdown,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    COLLECTION_FIELD_LABELS,
    COLLECTION_FIELD_ROLES,
    COLLECTION_PROVIDER_LABEL,
    PAYMENT_STATUS_OPTIONS,
    isCollectionProvider,
    jsonbKeyForField,
    readCollectionFields,
    resolveTitleFieldId,
    roleHasCapability,
    validateFieldValue,
    type CollectionConnection,
    type CollectionConnectionDetail,
    type CollectionFieldRole,
    type CollectionFields,
    type CollectionProvider,
    type CreatePaymentLinkInput,
    type FieldType,
    type PaymentLink,
    type PaymentLinkRow,
    type PaymentLinkStatus,
    type RecordPayments,
    type Role,
} from '@imagina-base/shared';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { collectionHooks, connections, fields, lists, paymentLinks, records, type PaymentLinkRowDb } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { effectivePermissions, resolvePermissions, rowInScope } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import {
    createLinkRequest,
    isTestCreds,
    linkInputError,
    mpNotificationPaymentId,
    nextLinkState,
    parseCreatedLink,
    parsePayment,
    parsePaymentSearch,
    paymentRequest,
    pickPayment,
    providerError,
    searchPaymentsRequest,
    verifyWompiChecksum,
    wompiEventTransactionId,
    type GatewayPayment,
    type LinkInput,
} from './collection-gateways';
import { gatewayBases } from './gateway-bases';

export interface CollectionActor {
    userId: number;
    role: Role;
}

/** Lo que quedó escrito en un registro al cambiar su cobro. */
interface RecordWrite {
    listId: number;
    recordId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

/** Lo que una automatización puede usar después con `{{pago.*}}`. */
export type PaymentContext = {
    link: string;
    monto: number;
    moneda: string;
    estado: string;
    monto_pagado: number | null;
    metodo: string | null;
    fecha: string | null;
    concepto: string;
    id: string | null;
    proveedor: string;
};

/** Un error de cobro con un motivo legible (el controller lo vuelve 400). */
export class CollectionError extends Error {}

const DAY = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Cobros de las EMPRESAS a sus clientes (v0.1.251, ADR-S31): Mercado Pago y
 * Wompi. El dinero va a la cuenta de la empresa; la app crea el link, lo deja
 * en el registro y se entera sola cuando el cliente paga.
 *
 * Reglas que no son opcionales:
 * - El estado de un pago NUNCA se toma del cuerpo de un aviso: se relee del
 *   proveedor con la credencial de la empresa (Wompi además firma el aviso).
 * - Un pago se aplica al link de la conexión que recibió el aviso: un aviso
 *   no puede tocar links de otra empresa ni de otra cuenta.
 * - Un link pagado no se "despaga" con un intento rechazado posterior.
 */
@Injectable()
export class CollectionsService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(CollectionsService.name);
    private expireTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly connectors: ConnectorsService,
        private readonly lists: ListsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly dispatcher: AutomationDispatcher,
        private readonly audit: AuditService,
        @Optional() private readonly fieldsService?: FieldsService,
    ) {}

    onModuleInit(): void {
        if (this.env.NODE_ENV === 'test') return;
        // Vencer los links pendientes cuya fecha pasó. Idempotente (sólo toca
        // los `pending`), así varios nodos pueden correrlo a la vez.
        this.expireTimer = setInterval(() => {
            this.expireDue().catch((err) => this.logger.warn(`Vencimiento de links falló: ${String(err)}`));
        }, 15 * 60 * 1000);
        this.expireTimer.unref();
    }

    onApplicationShutdown(): void {
        if (this.expireTimer) clearInterval(this.expireTimer);
    }

    private get bases() {
        return gatewayBases(this.env);
    }

    // ── Conexiones ──────────────────────────────────────────────────────

    /** Las conexiones de cobro que esta persona puede usar. */
    async connectionsFor(tenantId: number, actor: CollectionActor): Promise<CollectionConnection[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: connections.id,
                    name: connections.name,
                    provider: connections.provider,
                    config: connections.config,
                    visibility: connections.visibility,
                    ownerUserId: connections.ownerUserId,
                })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), inArray(connections.provider, ['mercadopago', 'wompi'])))
                .orderBy(connections.name),
        );
        return rows
            .filter((r) => r.visibility !== 'private' || r.ownerUserId === actor.userId)
            .map((r) => toConnection(r));
    }

    /** URL a la que el proveedor manda los avisos de una conexión (se crea la primera vez). */
    async hookUrlFor(tenantId: number, connectionId: number, provider: CollectionProvider): Promise<string> {
        const token = await this.ensureHook(tenantId, connectionId, provider);
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/collections/${token}`;
    }

    private async ensureHook(tenantId: number, connectionId: number, provider: CollectionProvider): Promise<string> {
        const [found] = await this.db
            .select({ token: collectionHooks.token })
            .from(collectionHooks)
            .where(eq(collectionHooks.connectionId, connectionId))
            .limit(1);
        if (found) return found.token;
        const token = randomBytes(24).toString('base64url');
        await this.db
            .insert(collectionHooks)
            .values({ token, tenantId, connectionId, provider })
            .onConflictDoNothing();
        const [row] = await this.db
            .select({ token: collectionHooks.token })
            .from(collectionHooks)
            .where(eq(collectionHooks.connectionId, connectionId))
            .limit(1);
        return row?.token ?? token;
    }

    /** El panel «Cobros» de una conexión: URL de avisos, totales y los últimos links. */
    async connectionDetail(tenantId: number, actor: CollectionActor, connectionId: number): Promise<CollectionConnectionDetail> {
        const editable = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (!isCollectionProvider(editable.provider)) {
            throw new BadRequestException({ code: 'not_collection', message: 'Esa conexión no cobra.', data: { status: 400 } });
        }
        const provider = editable.provider;
        const hookUrl = await this.hookUrlFor(tenantId, connectionId, provider);
        const [hook] = await this.db
            .select({ lastHookAt: collectionHooks.lastHookAt })
            .from(collectionHooks)
            .where(eq(collectionHooks.connectionId, connectionId))
            .limit(1);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [conn] = await tx
                .select({
                    id: connections.id,
                    name: connections.name,
                    provider: connections.provider,
                    config: connections.config,
                    secrets: connections.secrets,
                })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1);
            const rows = await tx
                .select({ link: paymentLinks, listName: lists.name, listSlug: lists.slug, listSettings: lists.settings, data: records.data })
                .from(paymentLinks)
                .innerJoin(lists, eq(lists.id, paymentLinks.listId))
                .innerJoin(records, eq(records.id, paymentLinks.recordId))
                .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.connectionId, connectionId)))
                .orderBy(desc(paymentLinks.createdAt))
                .limit(100);
            const [totals] = await tx
                .select({
                    pending: sql<number>`count(*) filter (where ${paymentLinks.status} = 'pending')::int`,
                    approved: sql<number>`count(*) filter (where ${paymentLinks.status} = 'approved')::int`,
                    approvedAmount: sql<string>`coalesce(sum(${paymentLinks.paidAmount}) filter (where ${paymentLinks.status} = 'approved'), 0)`,
                })
                .from(paymentLinks)
                .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.connectionId, connectionId)));
            const listIds = [...new Set(rows.map((r) => r.link.listId))];
            const titleFields = await this.titleFieldsFor(tx, tenantId, listIds, rows);
            const links: PaymentLinkRow[] = rows.map((r) => ({
                ...toDto(r.link, conn?.name ?? null),
                list_name: r.listName,
                list_slug: r.listSlug,
                record_title: recordTitle(titleFields.get(r.link.listId) ?? null, r.data, r.link.recordId),
            }));
            const secrets = (conn?.secrets ?? {}) as Record<string, unknown>;
            return {
                connection: toConnection({
                    id: connectionId,
                    name: conn?.name ?? editable.name,
                    provider,
                    config: (conn?.config ?? {}) as Record<string, unknown>,
                }),
                hook_url: hookUrl,
                hook_needs_setup: provider === 'wompi',
                events_secret_set: typeof secrets.signing_secret === 'string' && secrets.signing_secret !== '',
                last_hook_at: hook?.lastHookAt ? hook.lastHookAt.toISOString() : null,
                links,
                totals: {
                    pending: Number(totals?.pending ?? 0),
                    approved: Number(totals?.approved ?? 0),
                    approved_amount: Number(totals?.approvedAmount ?? 0),
                },
            };
        });
    }

    private async titleFieldsFor(
        tx: Tx,
        tenantId: number,
        listIds: number[],
        rows: Array<{ link: { listId: number }; listSettings: Record<string, unknown> }>,
    ): Promise<Map<number, number | null>> {
        const out = new Map<number, number | null>();
        if (listIds.length === 0) return out;
        const fieldRows = await tx
            .select({ id: fields.id, type: fields.type, listId: fields.listId })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), inArray(fields.listId, listIds)))
            .orderBy(asc(fields.position), asc(fields.id));
        for (const listId of listIds) {
            const settings = rows.find((r) => r.link.listId === listId)?.listSettings ?? {};
            const own = fieldRows.filter((f) => f.listId === listId).map((f) => ({ id: f.id, type: f.type as FieldType }));
            out.set(listId, resolveTitleFieldId(own, settings));
        }
        return out;
    }

    // ── Panel del registro ──────────────────────────────────────────────

    async recordPayments(tenantId: number, actor: CollectionActor, listIdOrSlug: string, recordId: number): Promise<RecordPayments> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const ctx = await this.reachable(tenantId, list, recordId, actor, 'view');
        const conns = await this.connectionsFor(tenantId, actor);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ link: paymentLinks, connName: connections.name })
                .from(paymentLinks)
                .leftJoin(connections, eq(connections.id, paymentLinks.connectionId))
                .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.recordId, recordId)))
                .orderBy(desc(paymentLinks.createdAt))
                .limit(50);
            const fieldRows = await tx
                .select({ id: fields.id, slug: fields.slug, type: fields.type, label: fields.label, config: fields.config })
                .from(fields)
                .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, list.id)))
                // El título es el primer campo de texto POR POSICIÓN.
                .orderBy(asc(fields.position), asc(fields.id));
            const mapping = readCollectionFields(list.settings);
            const slugOf = (id: number | null): string | null => (id ? (fieldRows.find((f) => f.id === id)?.slug ?? null) : null);
            const mapped = mapping
                ? {
                      link: slugOf(mapping.link),
                      status: slugOf(mapping.status),
                      paid_at: slugOf(mapping.paid_at),
                      paid_amount: slugOf(mapping.paid_amount),
                      method: slugOf(mapping.method),
                  }
                : null;
            const hasAny = mapped && Object.values(mapped).some((v) => v !== null);
            return {
                links: rows.map((r) => toDto(r.link, r.connName ?? null)),
                connections: conns,
                fields: hasAny ? mapped : null,
                can_setup: roleHasCapability(actor.role, 'manage_fields'),
                suggested: suggestFrom(fieldRows, list.settings, ctx.data, recordId),
            };
        });
    }

    /** Crea un link desde el botón «Cobrar» de un registro. */
    async createForRecord(
        tenantId: number,
        actor: CollectionActor,
        listIdOrSlug: string,
        recordId: number,
        input: CreatePaymentLinkInput,
    ): Promise<PaymentLink> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.reachable(tenantId, list, recordId, actor, 'edit');
        const conns = await this.connectionsFor(tenantId, actor);
        if (!conns.some((c) => c.id === input.connection_id)) {
            throw new NotFoundException({ code: 'connection_not_found', message: 'Esa conexión de cobro no existe o no la puedes usar.', data: { status: 404 } });
        }
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            try {
                return await this.createLinkInTx(tx, tenantId, {
                    connectionId: input.connection_id,
                    listId: list.id,
                    recordId,
                    title: input.title,
                    amount: input.amount,
                    currency: input.currency,
                    payerEmail: input.payer_email ?? null,
                    expiresDays: input.expires_days ?? null,
                    userId: actor.userId,
                });
            } catch (err) {
                if (err instanceof CollectionError) {
                    throw new BadRequestException({ code: 'payment_link_failed', message: err.message, data: { status: 400 } });
                }
                throw err;
            }
        });
        this.afterWrite(tenantId, result.write);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'payment_link.create',
            targetType: 'record',
            targetId: recordId,
            targetLabel: result.link.title,
            meta: { provider: result.link.provider, amount: result.link.amount, currency: result.link.currency, list_id: list.id },
        });
        return result.link;
    }

    /**
     * Crea un link DENTRO de una transacción (el botón y la automatización
     * comparten esto). Hace la llamada al proveedor y deja el link en el
     * registro (columnas de cobro de la lista, si las tiene).
     */
    async createLinkInTx(
        tx: Tx,
        tenantId: number,
        opts: {
            connectionId: number;
            listId: number;
            recordId: number;
            title: string;
            amount: number;
            currency: string;
            payerEmail: string | null;
            expiresDays: number | null;
            userId: number | null;
        },
    ): Promise<{ link: PaymentLink; write: RecordWrite | null; context: PaymentContext }> {
        const conn = await this.connectors.integrationCredsInTx(tx, tenantId, opts.connectionId);
        if (!conn) throw new CollectionError(`La conexión #${opts.connectionId} ya no existe.`);
        if (!isCollectionProvider(conn.provider)) throw new CollectionError(`«${conn.name}» no es una conexión de cobro.`);
        const provider = conn.provider;
        const currency = (provider === 'wompi' ? 'COP' : opts.currency || 'COP').toUpperCase();
        const amount = Math.round(opts.amount * 100) / 100;
        const expiresAt = opts.expiresDays && opts.expiresDays > 0 ? new Date(Date.now() + opts.expiresDays * DAY) : null;
        const reference = `ib_${randomBytes(12).toString('base64url')}`;
        const input: LinkInput = {
            title: opts.title.trim().slice(0, 200) || 'Pago',
            amount,
            currency,
            payerEmail: opts.payerEmail?.trim() || null,
            expiresAt,
            reference,
            notificationUrl: provider === 'mercadopago' ? await this.hookUrlFor(tenantId, opts.connectionId, provider) : null,
        };
        const invalid = linkInputError(provider, input);
        if (invalid) throw new CollectionError(invalid);

        const req = createLinkRequest(provider, conn.creds, input, this.bases);
        let created: { externalId: string; url: string } | { error: string };
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
                timeoutMs: FETCH_TIMEOUT_MS,
            });
            created = parseCreatedLink(provider, res.status, res.body ?? '', conn.creds, input, this.bases);
        } catch (err) {
            const label = COLLECTION_PROVIDER_LABEL[provider];
            throw new CollectionError(`No pudimos comunicarnos con ${label} (${redact(err, conn.creds)}).`);
        }
        if ('error' in created) throw new CollectionError(created.error);

        const [row] = await tx
            .insert(paymentLinks)
            .values({
                tenantId,
                connectionId: opts.connectionId,
                provider,
                listId: opts.listId,
                recordId: opts.recordId,
                externalId: created.externalId,
                url: created.url,
                title: input.title,
                amount,
                currency,
                payerEmail: input.payerEmail,
                expiresAt,
                createdBy: opts.userId,
            })
            .returning();
        const link = row!;
        const write = await this.writeRecord(tx, tenantId, link, {
            link: link.url,
            status: 'pending',
            paid_at: null,
            paid_amount: null,
            method: null,
        });
        return { link: toDto(link, conn.name), write, context: paymentContext(link) };
    }

    /** Anula un link pendiente (en Wompi además lo desactiva). */
    async cancelLink(tenantId: number, actor: CollectionActor, linkId: number): Promise<PaymentLink> {
        const link = await this.linkForActor(tenantId, actor, linkId, 'edit');
        if (link.status !== 'pending') {
            throw new BadRequestException({ code: 'link_not_pending', message: 'Sólo se anula un link pendiente.', data: { status: 400 } });
        }
        if (link.provider === 'wompi' && link.connectionId) {
            const conn = await this.connectors.integrationCredsFor(tenantId, link.connectionId);
            if (conn) {
                const base = isTestCreds('wompi', conn.creds) ? this.bases.wompiSandbox : this.bases.wompiProduction;
                await safeWebhookFetch(`${base.replace(/\/+$/, '')}/payment_links/${encodeURIComponent(link.externalId)}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.creds.secret}` },
                    body: JSON.stringify({ active: false }),
                    timeoutMs: FETCH_TIMEOUT_MS,
                }).catch(() => undefined);
            }
        }
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [updated] = await tx
                .update(paymentLinks)
                .set({ status: 'cancelled', updatedAt: new Date(), note: 'Anulado desde la app.' })
                .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId), eq(paymentLinks.status, 'pending')))
                .returning();
            if (!updated) return { link, write: null };
            const write = await this.writeRecord(tx, tenantId, updated, { status: 'cancelled' });
            return { link: updated, write };
        });
        this.afterWrite(tenantId, out.write);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'payment_link.cancel',
            targetType: 'record',
            targetId: link.recordId,
            targetLabel: link.title,
            meta: { provider: link.provider, link_id: link.id },
        });
        return toDto(out.link, null);
    }

    /**
     * «Verificar»: pregunta al proveedor por los pagos del link (para cuando
     * el aviso no llegó — la URL mal pegada en Wompi, un corte de red).
     */
    async verifyLink(tenantId: number, actor: CollectionActor, linkId: number): Promise<PaymentLink> {
        const link = await this.linkForActor(tenantId, actor, linkId, 'view');
        if (!link.connectionId || !isCollectionProvider(link.provider)) {
            throw new BadRequestException({ code: 'connection_gone', message: 'La conexión de este link ya no existe: no se puede consultar.', data: { status: 400 } });
        }
        const conn = await this.connectors.integrationCredsFor(tenantId, link.connectionId);
        if (!conn) {
            throw new BadRequestException({ code: 'connection_gone', message: 'La conexión de este link ya no existe: no se puede consultar.', data: { status: 400 } });
        }
        const provider = link.provider;
        const req = searchPaymentsRequest(provider, conn.creds, { externalId: link.externalId, createdAt: link.createdAt }, this.bases);
        let payments: GatewayPayment[] | null;
        try {
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, maxCaptureBytes: 2_000_000, timeoutMs: FETCH_TIMEOUT_MS });
            payments = parsePaymentSearch(provider, res.status, res.body ?? '', link.externalId);
            if (payments === null) {
                throw new BadRequestException({ code: 'verify_failed', message: providerError(provider, res.status, res.body ?? ''), data: { status: 400 } });
            }
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            throw new BadRequestException({
                code: 'verify_failed',
                message: `No pudimos comunicarnos con ${COLLECTION_PROVIDER_LABEL[provider]} (${redact(err, conn.creds)}).`,
                data: { status: 400 },
            });
        }
        const chosen = pickPayment(payments);
        if (chosen) await this.applyPayment(tenantId, link.id, chosen);
        else await this.expireIfDue(tenantId, link.id);
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(paymentLinks).set({ lastCheckedAt: new Date() }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link.id))),
        );
        const fresh = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(paymentLinks).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link.id))).limit(1),
        );
        return toDto(fresh[0] ?? link, conn.name);
    }

    private async linkForActor(tenantId: number, actor: CollectionActor, linkId: number, action: 'view' | 'edit'): Promise<PaymentLinkRowDb> {
        const [link] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(paymentLinks).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId))).limit(1),
        );
        if (!link) throw new NotFoundException({ code: 'link_not_found', message: 'Link de pago no encontrado.', data: { status: 404 } });
        const list = await this.lists.get(tenantId, String(link.listId));
        await this.reachable(tenantId, list, link.recordId, actor, action);
        return link;
    }

    // ── Avisos del proveedor ────────────────────────────────────────────

    /**
     * Un aviso a `POST /public/collections/:token`. Devuelve qué pasó (para
     * el log y los tests). Un aviso que no corresponde a nada nuestro se
     * contesta 200 igual (si no, el proveedor reintenta para siempre); uno que
     * falló por red se lanza para que reintente.
     */
    async handleHook(token: string, query: Record<string, unknown>, body: unknown): Promise<'applied' | 'ignored' | 'unknown_token' | 'bad_signature'> {
        if (!/^[\w-]{16,64}$/.test(token)) return 'unknown_token';
        const [hook] = await this.db.select().from(collectionHooks).where(eq(collectionHooks.token, token)).limit(1);
        if (!hook) return 'unknown_token';
        if (!isCollectionProvider(hook.provider)) return 'ignored';
        await this.db.update(collectionHooks).set({ lastHookAt: new Date() }).where(eq(collectionHooks.token, token));
        const tenantId = hook.tenantId;
        const conn = await this.connectors.integrationCredsFor(tenantId, hook.connectionId);
        if (!conn) return 'ignored';

        let paymentId: string | null;
        if (hook.provider === 'mercadopago') {
            paymentId = mpNotificationPaymentId(query, body);
        } else {
            const secret = (conn.creds.signingSecret ?? '').trim();
            if (secret !== '' && !verifyWompiChecksum(body, secret)) return 'bad_signature';
            paymentId = wompiEventTransactionId(body);
        }
        if (!paymentId) return 'ignored';

        // El estado se RELEE del proveedor con la credencial de la empresa.
        const req = paymentRequest(hook.provider, conn.creds, paymentId, this.bases);
        const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, timeoutMs: FETCH_TIMEOUT_MS });
        if (res.status >= 500) throw new Error(`${COLLECTION_PROVIDER_LABEL[hook.provider]} respondió ${res.status} al releer el pago`);
        const payment = parsePayment(hook.provider, res.status, res.body ?? '');
        if (!payment || !payment.linkRef) return 'ignored';

        const [link] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: paymentLinks.id })
                .from(paymentLinks)
                .where(
                    and(
                        eq(paymentLinks.tenantId, tenantId),
                        eq(paymentLinks.provider, hook.provider),
                        eq(paymentLinks.externalId, payment.linkRef!),
                        eq(paymentLinks.connectionId, hook.connectionId),
                    ),
                )
                .limit(1),
        );
        if (!link) return 'ignored';
        const changed = await this.applyPayment(tenantId, link.id, payment);
        return changed ? 'applied' : 'ignored';
    }

    /**
     * Aplica un pago a un link (con lock de la fila): estado, monto, medio y
     * fecha; las columnas del registro; y, si quedó pagado, dispara las
     * automatizaciones «Cuando se recibe un pago». Devuelve si cambió algo.
     */
    async applyPayment(tenantId: number, linkId: number, payment: GatewayPayment): Promise<boolean> {
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const locked = await tx.execute(
                sql`select id from payment_links where tenant_id = ${tenantId} and id = ${linkId} for update`,
            );
            if ((locked as unknown as { rows: unknown[] }).rows.length === 0) return null;
            const [link] = await tx.select().from(paymentLinks).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId))).limit(1);
            if (!link) return null;
            const next = nextLinkState(
                { status: link.status as PaymentLinkStatus, amount: link.amount, currency: link.currency, paymentId: link.paymentId },
                payment,
            );
            if (!next) return null;
            const [updated] = await tx
                .update(paymentLinks)
                .set({
                    status: next.status,
                    paidAmount: next.paidAmount,
                    paidAt: next.paidAt,
                    method: next.method,
                    paymentId: next.paymentId,
                    note: next.note,
                    updatedAt: new Date(),
                    lastCheckedAt: new Date(),
                })
                .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId)))
                .returning();
            const write = await this.writeRecord(tx, tenantId, updated!, {
                status: next.status,
                paid_at: next.paidAt,
                paid_amount: next.paidAmount,
                method: next.method,
            });
            const becamePaid = next.status === 'approved' && link.status !== 'approved';
            const readOnly = await tenantIsReadOnly(tx, tenantId);
            return { link: updated!, write, becamePaid, readOnly };
        });
        if (!out) return false;
        this.afterWrite(tenantId, out.write);
        this.realtime.records(tenantId, out.link.listId);
        if (out.becamePaid && !out.readOnly) {
            const data = out.write?.after ?? (await this.recordData(tenantId, out.link.listId, out.link.recordId)) ?? {};
            this.dispatcher.dispatch({
                tenantId,
                listId: out.link.listId,
                recordId: out.link.recordId,
                trigger: 'payment_received',
                after: data,
                payment: paymentContext(out.link),
            });
        }
        return true;
    }

    private async recordData(tenantId: number, listId: number, recordId: number): Promise<Record<string, unknown> | null> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, listId, recordId));
        return row ? (row.data as Record<string, unknown>) : null;
    }

    private async expireIfDue(tenantId: number, linkId: number): Promise<void> {
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [updated] = await tx
                .update(paymentLinks)
                .set({ status: 'expired', updatedAt: new Date() })
                .where(
                    and(
                        eq(paymentLinks.tenantId, tenantId),
                        eq(paymentLinks.id, linkId),
                        eq(paymentLinks.status, 'pending'),
                        lt(paymentLinks.expiresAt, new Date()),
                    ),
                )
                .returning();
            if (!updated) return null;
            return this.writeRecord(tx, tenantId, updated, { status: 'expired' });
        });
        this.afterWrite(tenantId, out);
    }

    /** Pasa a «Vencido» los links pendientes cuya fecha ya pasó (todas las empresas). */
    async expireDue(now = new Date()): Promise<number> {
        const due = await this.db
            .select({ id: paymentLinks.id, tenantId: paymentLinks.tenantId })
            .from(paymentLinks)
            .where(and(eq(paymentLinks.status, 'pending'), lt(paymentLinks.expiresAt, now)))
            .limit(500);
        for (const d of due) await this.expireIfDue(d.tenantId, d.id);
        return due.length;
    }

    // ── Columnas de cobro en la lista ───────────────────────────────────

    /**
     * Crea en la lista las columnas donde se escribe el cobro (las que falten)
     * y guarda el mapeo en `settings.collections.fields`.
     */
    async setupFields(tenantId: number, actor: CollectionActor, listIdOrSlug: string): Promise<CollectionFields> {
        if (!this.fieldsService) throw new Error('FieldsService no disponible');
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const existing = readCollectionFields(list.settings) ?? {
            link: null,
            status: null,
            paid_at: null,
            paid_amount: null,
            method: null,
        };
        const current = await this.fieldsService.listByListId(tenantId, list.id);
        const alive = new Set(current.map((f) => f.id));
        const currencyField = current.find((f) => f.type === 'currency');
        const currency =
            ((currencyField?.config as Record<string, unknown> | undefined)?.currency as string | undefined) ?? 'COP';
        const mapping: CollectionFields = { ...existing };
        const spec: Record<CollectionFieldRole, { type: FieldType; config?: Record<string, unknown> }> = {
            link: { type: 'url' },
            status: {
                type: 'select',
                config: {
                    options: Object.values(PAYMENT_STATUS_OPTIONS).map((o) => ({ value: o.value, label: o.label, color: o.color })),
                },
            },
            paid_at: { type: 'datetime' },
            paid_amount: { type: 'currency', config: { currency, precision: currency === 'COP' ? 0 : 2 } },
            method: { type: 'text' },
        };
        for (const role of COLLECTION_FIELD_ROLES) {
            const id = mapping[role];
            if (id && alive.has(id)) continue;
            const created = await this.fieldsService.create(tenantId, String(list.id), {
                label: COLLECTION_FIELD_LABELS[role],
                type: spec[role].type,
                config: spec[role].config,
            });
            mapping[role] = created.id;
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{collections}', ${JSON.stringify({ fields: mapping })}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id))),
        );
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'collections.setup',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { fields: mapping },
        });
        this.realtime.records(tenantId, list.id);
        return mapping;
    }

    /**
     * Escribe el cobro en el registro, en las columnas mapeadas que sigan
     * existiendo. Cada valor pasa por el validador del campo (si la persona
     * cambió las opciones del estado, ese valor se saltea en vez de romper).
     */
    private async writeRecord(
        tx: Tx,
        tenantId: number,
        link: PaymentLinkRowDb,
        values: Partial<Record<CollectionFieldRole, unknown>>,
    ): Promise<RecordWrite | null> {
        const [list] = await tx
            .select({ settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, link.listId)))
            .limit(1);
        const mapping = readCollectionFields(list?.settings);
        if (!mapping) return null;
        const ids = COLLECTION_FIELD_ROLES.map((r) => mapping[r]).filter((id): id is number => id !== null);
        if (ids.length === 0) return null;
        const fieldRows = await tx
            .select({ id: fields.id, type: fields.type, config: fields.config })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, link.listId), inArray(fields.id, ids)));
        const record = await this.recordsRepo.findById(tx, tenantId, link.listId, link.recordId);
        if (!record) return null;
        const before = record.data as Record<string, unknown>;
        const after = { ...before };
        for (const role of COLLECTION_FIELD_ROLES) {
            if (!(role in values)) continue;
            const fieldId = mapping[role];
            const field = fieldId ? fieldRows.find((f) => f.id === fieldId) : undefined;
            if (!field) continue;
            const raw = toFieldValue(role, values[role], field.type as FieldType);
            const key = jsonbKeyForField(field.id);
            if (raw === null) {
                delete after[key];
                continue;
            }
            const v = validateFieldValue({ type: field.type as FieldType, config: field.config, is_required: false }, raw);
            if (v.ok) after[key] = v.value;
        }
        if (JSON.stringify(before) === JSON.stringify(after)) return null;
        const updated = await this.recordsRepo.updateData(tx, tenantId, link.listId, link.recordId, after);
        if (!updated) return null;
        await this.activity.logInTx(tx, {
            tenantId,
            listId: link.listId,
            recordId: link.recordId,
            userId: null,
            action: 'record_updated',
            diff: computeDiff(before, after),
        });
        return { listId: link.listId, recordId: link.recordId, before, after: updated.data as Record<string, unknown> };
    }

    /** Fuera de la transacción: refrescar pantallas y avisar a las automatizaciones. */
    private afterWrite(tenantId: number, write: RecordWrite | null): void {
        if (!write) return;
        this.realtime.records(tenantId, write.listId);
        this.dispatcher.dispatch({
            tenantId,
            listId: write.listId,
            recordId: write.recordId,
            trigger: 'record_updated',
            after: write.after,
            before: write.before,
        });
    }

    /** ¿La persona alcanza el registro? (mismo ACL que editar/ver la fila). */
    private async reachable(
        tenantId: number,
        list: { id: number; settings: Record<string, unknown> },
        recordId: number,
        actor: CollectionActor,
        action: 'view' | 'edit',
    ): Promise<{ data: Record<string, unknown> }> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, recordId));
        const scope = effectivePermissions(list.settings, actor.role, actor.userId)[action];
        const assignmentId = resolvePermissions(list.settings).assignment_field_id;
        const key = assignmentId ? jsonbKeyForField(assignmentId) : null;
        const reach =
            row !== null &&
            rowInScope(scope, actor.userId, {
                createdBy: row.createdBy,
                assignmentValue: key ? (row.data as Record<string, unknown>)[key] : null,
            });
        if (!reach || !row) {
            throw new NotFoundException({ code: 'record_not_found', message: `Registro ${recordId} no encontrado`, data: { status: 404 } });
        }
        return { data: row.data as Record<string, unknown> };
    }
}

// ── Helpers puros ───────────────────────────────────────────────────────

function toConnection(r: { id: number; name: string; provider: string; config: Record<string, unknown> }): CollectionConnection {
    const f = (r.config.fields ?? {}) as Record<string, unknown>;
    return {
        id: r.id,
        name: r.name,
        provider: r.provider as CollectionProvider,
        account_label: typeof r.config.account_label === 'string' ? r.config.account_label : null,
        test_mode: f.test_mode === 'true',
    };
}

function toDto(r: PaymentLinkRowDb, connectionName: string | null): PaymentLink {
    return {
        id: r.id,
        provider: r.provider as CollectionProvider,
        connection_id: r.connectionId,
        connection_name: connectionName,
        list_id: r.listId,
        record_id: r.recordId,
        title: r.title,
        amount: Number(r.amount),
        currency: r.currency,
        status: r.status as PaymentLinkStatus,
        url: r.url,
        payer_email: r.payerEmail,
        expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
        paid_amount: r.paidAmount === null ? null : Number(r.paidAmount),
        paid_at: r.paidAt ? r.paidAt.toISOString() : null,
        method: r.method,
        payment_id: r.paymentId,
        note: r.note,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
        last_checked_at: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
    };
}

/** El valor de un rol en el tipo de su columna (o `null` para vaciarla). */
export function toFieldValue(role: CollectionFieldRole, value: unknown, type: FieldType): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (role === 'status') {
        const opt = PAYMENT_STATUS_OPTIONS[value as PaymentLinkStatus];
        if (!opt) return null;
        return type === 'select' ? opt.value : type === 'multi_select' ? [opt.value] : opt.label;
    }
    if (role === 'paid_at') {
        const d = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(d.getTime())) return null;
        return type === 'date' ? d.toISOString().slice(0, 10) : type === 'datetime' ? d.toISOString() : d.toISOString().slice(0, 10);
    }
    if (role === 'paid_amount') {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return type === 'text' || type === 'long_text' ? String(n) : n;
    }
    return String(value);
}

function paymentContext(link: PaymentLinkRowDb): PaymentContext {
    return {
        link: link.url,
        monto: Number(link.amount),
        moneda: link.currency,
        estado: PAYMENT_STATUS_OPTIONS[link.status as PaymentLinkStatus]?.label ?? link.status,
        monto_pagado: link.paidAmount === null ? null : Number(link.paidAmount),
        metodo: link.method,
        fecha: link.paidAt ? link.paidAt.toISOString() : null,
        concepto: link.title,
        id: link.paymentId,
        proveedor: COLLECTION_PROVIDER_LABEL[link.provider as CollectionProvider] ?? link.provider,
    };
}

function recordTitle(titleFieldId: number | null, data: Record<string, unknown>, recordId: number): string {
    const v = titleFieldId ? data[jsonbKeyForField(titleFieldId)] : null;
    return typeof v === 'string' && v.trim() !== '' ? v : `Registro #${recordId}`;
}

/** Sugerencias del formulario «Cobrar»: el título, un monto y un correo del registro. */
function suggestFrom(
    fieldRows: Array<{ id: number; slug: string; type: string; label: string; config: Record<string, unknown> }>,
    settings: Record<string, unknown>,
    data: Record<string, unknown>,
    recordId: number,
): RecordPayments['suggested'] {
    const titleId = resolveTitleFieldId(fieldRows.map((f) => ({ id: f.id, type: f.type as FieldType })), settings);
    const mapping = readCollectionFields(settings);
    const skip = new Set(mapping ? Object.values(mapping).filter((v): v is number => v !== null) : []);
    const money = /monto|total|valor|saldo|precio|importe|cuota|amount|price/i;
    const numeric = fieldRows.filter((f) => !skip.has(f.id) && (f.type === 'currency' || f.type === 'number'));
    const pickAmount =
        numeric.find((f) => f.type === 'currency' && money.test(`${f.slug} ${f.label}`)) ??
        numeric.find((f) => f.type === 'currency') ??
        numeric.find((f) => money.test(`${f.slug} ${f.label}`));
    const rawAmount = pickAmount ? Number(data[jsonbKeyForField(pickAmount.id)]) : NaN;
    const email = fieldRows.find((f) => f.type === 'email' && typeof data[jsonbKeyForField(f.id)] === 'string');
    const currency = pickAmount?.type === 'currency' ? ((pickAmount.config.currency as string | undefined) ?? null) : null;
    return {
        title: recordTitle(titleId, data, recordId),
        amount: Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null,
        currency,
        payer_email: email ? (data[jsonbKeyForField(email.id)] as string) : null,
    };
}

function redact(err: unknown, creds: IntegrationCreds): string {
    let message = err instanceof Error ? err.message : String(err);
    for (const s of [creds.secret, creds.signingSecret ?? '']) {
        if (s && s.length >= 4) message = message.split(s).join('••••');
    }
    return message;
}
