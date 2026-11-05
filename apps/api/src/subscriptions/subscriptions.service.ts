import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnApplicationShutdown,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    EMPTY_SUBSCRIPTION_FIELDS,
    SUBSCRIPTION_FIELD_LABELS,
    SUBSCRIPTION_FIELD_ROLES,
    SUBSCRIPTION_FIELD_TYPES,
    SUBSCRIPTION_STATUS_OPTIONS,
    deriveSubscriptionStatus,
    isLiveSubscriptionStatus,
    jsonbKeyForField,
    monthlySubscriptionAmount,
    readSubscriptionFields,
    resolveTitleFieldId,
    subscriptionStatusEvents,
    suggestSubscriptionFields,
    validateFieldValue,
    type CreateSubscriptionInput,
    type CreateSubscriptionPlanInput,
    type FieldType,
    type RecordSubscriptions,
    type SetSubscriptionFieldsInput,
    type Subscription,
    type SubscriptionCharge,
    type SubscriptionChargeStatus,
    type SubscriptionEvent,
    type SubscriptionEventInfo,
    type SubscriptionFieldRole,
    type SubscriptionFields,
    type SubscriptionFrequencyType,
    type SubscriptionPlan,
    type SubscriptionProviderStatus,
    type SubscriptionRow,
    type SubscriptionsOverview,
    type SubscriptionStatus,
    type UpdateSubscriptionPlanInput,
} from '@imagina-base/shared';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { can } from '../authz/can';
import { planModuleOff } from '../billing/plan-module-gate';
import { CollectionsService, type CollectionActor } from '../collections/collections.service';
import { providerError } from '../collections/collection-gateways';
import { gatewayBases } from '../collections/gateway-bases';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import {
    connections,
    fields,
    lists,
    records,
    subscriptionCharges,
    subscriptionPlans,
    subscriptions,
    tenants,
    type SubscriptionChargeRowDb,
    type SubscriptionPlanRowDb,
    type SubscriptionRowDb,
} from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub } from '../incidents/incident-hub';
import { listRowInScope } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { NotifyHub } from '../notifications/notify-hub';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { REDIS } from '../redis/redis.module';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { parseTenantTimeZone } from '../tenancy/tenant-time-zone.service';
import {
    createPreapprovalRequest,
    invoiceRequest,
    invoicesSearchRequest,
    mpNotice,
    parseCreatedPreapproval,
    parseInvoice,
    parseInvoices,
    parsePreapproval,
    parseSubscriptionPayment,
    preapprovalRequest,
    summarizeCharges,
    updatePreapprovalRequest,
    type ParsedInvoice,
    type PreapprovalPatch,
} from './subscription-gateway';

const FETCH_TIMEOUT_MS = 15_000;
const DAY = 24 * 60 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const TICK_LOCK = 'subscriptions:tick';
/** Cuántos cobros por suscripción se muestran en la ficha. */
const CHARGES_IN_PANEL = 24;

/** Un error de suscripción con un motivo legible (el controller lo vuelve 400). */
export class SubscriptionError extends Error {}

/** Lo que quedó escrito en un registro al cambiar su suscripción. */
interface RecordWrite {
    listId: number;
    recordId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

/** Lo que dejó una sincronización: eventos para el disparador y lo escrito. */
interface SyncOutcome {
    sub: SubscriptionRowDb;
    write: RecordWrite | null;
    events: Array<{ event: SubscriptionEvent; charge: SubscriptionChargeRowDb | null }>;
    readOnly: boolean;
}

/** Datos frescos de Mercado Pago (o null si no se pudo leer esa parte). */
interface RemoteState {
    providerStatus: SubscriptionProviderStatus | null;
    nextPaymentAt: Date | null;
    amount: number | null;
    url: string | null;
    startAt: Date | null;
    invoices: ParsedInvoice[] | null;
}

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

function redact(err: unknown, creds: IntegrationCreds): string {
    let message = err instanceof Error ? err.message : String(err);
    if (creds.secret && creds.secret.length >= 4) message = message.split(creds.secret).join('••••');
    return message;
}

/**
 * v0.1.367 (ADR-S96) — Suscripciones de las EMPRESAS a sus clientes con SU
 * cuenta de Mercado Pago.
 *
 * Reglas que no son opcionales:
 * - El estado NUNCA se toma de un aviso: cada aviso (o la revisión periódica)
 *   relee la suscripción y sus cuotas con la credencial de la empresa.
 * - El MISMO pago llega por dos avisos (`payment` y
 *   `subscription_authorized_payment`): una fila por pago.
 * - Mercado Pago no siempre avisa (la URL de avisos se pega a mano en su
 *   panel): una revisión cada pocos minutos lee lo que esté por cobrarse,
 *   lo que se reintenta y lo pendiente de autorizar. Sin avisos igual funciona.
 * - Borrar el registro no cancela nada en Mercado Pago (sería dejar de cobrar
 *   sin que nadie lo decida): la suscripción queda en la conexión.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SubscriptionsService.name);
    private tickTimer: NodeJS.Timeout | null = null;

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
        private readonly collections: CollectionsService,
        @Optional() private readonly fieldsService?: FieldsService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
    ) {}

    onModuleInit(): void {
        // Los avisos de Mercado Pago llegan a la URL de la conexión de cobro: los
        // que son de una suscripción se los pasa a este servicio.
        this.collections.registerSubscriptionSink((tenantId, connectionId, query, body) => this.handleNotice(tenantId, connectionId, query, body));
        if (this.env.NODE_ENV === 'test') return;
        this.tickTimer = setInterval(() => {
            this.tick().catch((err) => this.logger.warn(`Revisión de suscripciones falló: ${String(err)}`));
        }, TICK_MS);
        this.tickTimer.unref();
    }

    onApplicationShutdown(): void {
        if (this.tickTimer) clearInterval(this.tickTimer);
    }

    private get bases() {
        return gatewayBases(this.env);
    }

    private backUrl(reference: string): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/subscriptions/${reference}`;
    }

    // ── Planes ──────────────────────────────────────────────────────────

    async listPlans(tenantId: number, actor: CollectionActor, connectionId?: number): Promise<SubscriptionPlan[]> {
        const usable = await this.usableConnections(tenantId, actor);
        const ids = usable.map((c) => c.id);
        if (ids.length === 0) return [];
        if (connectionId !== undefined && !ids.includes(connectionId)) return [];
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select()
                .from(subscriptionPlans)
                .where(
                    and(
                        eq(subscriptionPlans.tenantId, tenantId),
                        inArray(subscriptionPlans.connectionId, connectionId !== undefined ? [connectionId] : ids),
                    ),
                )
                .orderBy(desc(subscriptionPlans.active), asc(subscriptionPlans.name));
            return this.planDtos(tx, tenantId, rows, usable);
        });
    }

    private async planDtos(
        tx: Tx,
        tenantId: number,
        rows: SubscriptionPlanRowDb[],
        conns: Array<{ id: number; name: string }>,
    ): Promise<SubscriptionPlan[]> {
        if (rows.length === 0) return [];
        const counts = await tx
            .select({
                planId: subscriptions.planId,
                live: sql<number>`count(*) filter (where ${subscriptions.status} not in ('cancelled', 'finished'))::int`,
                total: sql<number>`count(*)::int`,
            })
            .from(subscriptions)
            .where(and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.planId, rows.map((r) => r.id))))
            .groupBy(subscriptions.planId);
        return rows.map((r) => {
            const c = counts.find((x) => x.planId === r.id);
            return planToDto(r, conns.find((x) => x.id === r.connectionId)?.name ?? null, {
                live: Number(c?.live ?? 0),
                total: Number(c?.total ?? 0),
            });
        });
    }

    /** Las conexiones de Mercado Pago que esta persona puede usar (las del equipo y sus privadas). */
    private async usableConnections(tenantId: number, actor: CollectionActor) {
        const all = await this.collections.connectionsFor(tenantId, actor);
        return all.filter((c) => c.provider === 'mercadopago');
    }

    async createPlan(tenantId: number, actor: CollectionActor, input: CreateSubscriptionPlanInput): Promise<SubscriptionPlan> {
        // El controller ya valida con el schema; esto cubre a quien llama al servicio directo (asistente, tests).
        if ((input.frequency_type === 'months' && input.frequency > 12) || (input.frequency_type === 'days' && input.frequency > 365) || input.frequency < 1) {
            badRequest('invalid_frequency', 'Cada cuánto se cobra: hasta 12 meses o 365 días.');
        }
        if (!(input.amount > 0)) badRequest('invalid_amount', 'El valor del plan tiene que ser mayor a cero.');
        const conn = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, input.connection_id);
        if (conn.provider !== 'mercadopago') badRequest('not_subscription_provider', 'Las suscripciones se cobran con Mercado Pago: elige una conexión de Mercado Pago.');
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(subscriptionPlans)
                .values({
                    tenantId,
                    connectionId: conn.id,
                    provider: 'mercadopago',
                    name: input.name,
                    description: input.description ?? null,
                    amount: Math.round(input.amount * 100) / 100,
                    currency: input.currency,
                    frequency: input.frequency,
                    frequencyType: input.frequency_type,
                    cycles: input.cycles ?? null,
                    trialDays: input.trial_days,
                    graceDays: input.grace_days,
                    onExpire: input.on_expire,
                    createdBy: actor.userId,
                })
                .returning();
            return created!;
        });
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscription_plan.create',
            targetType: 'connection',
            targetId: conn.id,
            targetLabel: row.name,
            meta: { amount: row.amount, currency: row.currency, frequency: row.frequency, frequency_type: row.frequencyType },
        });
        return planToDto(row, conn.name, { live: 0, total: 0 });
    }

    async updatePlan(tenantId: number, actor: CollectionActor, planId: number, input: UpdateSubscriptionPlanInput): Promise<SubscriptionPlan> {
        const plan = await this.editablePlan(tenantId, actor, planId);
        const patch: Partial<typeof subscriptionPlans.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description ?? null;
        if (input.amount !== undefined) patch.amount = Math.round(input.amount * 100) / 100;
        if (input.currency !== undefined) patch.currency = input.currency;
        if (input.frequency !== undefined) patch.frequency = input.frequency;
        if (input.frequency_type !== undefined) patch.frequencyType = input.frequency_type;
        if (input.cycles !== undefined) patch.cycles = input.cycles ?? null;
        if (input.trial_days !== undefined) patch.trialDays = input.trial_days;
        if (input.grace_days !== undefined) patch.graceDays = input.grace_days;
        if (input.on_expire !== undefined) patch.onExpire = input.on_expire;
        if (input.active !== undefined) patch.active = input.active;
        const freq = patch.frequency ?? plan.frequency;
        const type = (patch.frequencyType ?? plan.frequencyType) as SubscriptionFrequencyType;
        if ((type === 'months' && freq > 12) || (type === 'days' && freq > 365) || freq < 1) badRequest('invalid_frequency', 'Cada cuánto se cobra: hasta 12 meses o 365 días.');
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .update(subscriptionPlans)
                .set(patch)
                .where(and(eq(subscriptionPlans.tenantId, tenantId), eq(subscriptionPlans.id, planId)))
                .returning();
            // Los días de gracia y qué hacer al vencer valen también para las
            // suscripciones que ya existen (no cambian lo que el cliente autorizó).
            if (input.grace_days !== undefined || input.on_expire !== undefined) {
                const subPatch: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date() };
                if (input.grace_days !== undefined) subPatch.graceDays = input.grace_days;
                if (input.on_expire !== undefined) subPatch.onExpire = input.on_expire;
                await tx
                    .update(subscriptions)
                    .set(subPatch)
                    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.planId, planId)));
            }
            if (input.name !== undefined) {
                await tx
                    .update(subscriptions)
                    .set({ planName: input.name })
                    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.planId, planId)));
            }
            const [dto] = await this.planDtos(tx, tenantId, [row!], await this.usableConnections(tenantId, actor));
            return dto!;
        });
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscription_plan.update',
            targetType: 'connection',
            targetId: plan.connectionId,
            targetLabel: out.name,
            meta: { plan_id: planId, changes: Object.keys(input) },
        });
        return out;
    }

    /** Borrar sólo un plan sin suscripciones (si tiene, se desactiva: el historial lo nombra). */
    async deletePlan(tenantId: number, actor: CollectionActor, planId: number): Promise<void> {
        const plan = await this.editablePlan(tenantId, actor, planId);
        const used = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [c] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.planId, planId)));
            return Number(c?.n ?? 0);
        });
        if (used > 0) {
            throw new ConflictException({
                code: 'plan_in_use',
                message: `Este plan tiene ${used} ${used === 1 ? 'suscripción' : 'suscripciones'}: desactívalo para que no se use en suscripciones nuevas (las que ya existen siguen cobrando).`,
                data: { status: 409 },
            });
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(subscriptionPlans).where(and(eq(subscriptionPlans.tenantId, tenantId), eq(subscriptionPlans.id, planId))),
        );
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscription_plan.delete',
            targetType: 'connection',
            targetId: plan.connectionId,
            targetLabel: plan.name,
        });
    }

    private async editablePlan(tenantId: number, actor: CollectionActor, planId: number): Promise<SubscriptionPlanRowDb> {
        const [plan] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.tenantId, tenantId), eq(subscriptionPlans.id, planId))).limit(1),
        );
        if (!plan) throw new NotFoundException({ code: 'plan_not_found', message: 'Ese plan no existe.', data: { status: 404 } });
        if (plan.connectionId === null) badRequest('connection_gone', 'La conexión de este plan ya no existe.');
        await this.connectors.editableConnection(tenantId, actor.userId, actor.role, plan.connectionId!);
        return plan;
    }

    // ── Panel del registro ──────────────────────────────────────────────

    async recordSubscriptions(tenantId: number, actor: CollectionActor, listIdOrSlug: string, recordId: number): Promise<RecordSubscriptions> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const ctx = await this.reachable(tenantId, list, recordId, actor, 'view');
        const canEdit = await this.canReach(tenantId, list, recordId, actor, 'edit');
        const plans = (await this.listPlans(tenantId, actor)).filter((p) => p.active);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const subs = await tx
                .select({ s: subscriptions, connName: connections.name })
                .from(subscriptions)
                .leftJoin(connections, eq(connections.id, subscriptions.connectionId))
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.recordId, recordId)))
                .orderBy(desc(subscriptions.createdAt))
                .limit(20);
            const charges = subs.length
                ? await tx
                      .select()
                      .from(subscriptionCharges)
                      .where(and(eq(subscriptionCharges.tenantId, tenantId), inArray(subscriptionCharges.subscriptionId, subs.map((s) => s.s.id))))
                      .orderBy(desc(subscriptionCharges.createdAt))
                : [];
            const fieldRows = await tx
                .select({ id: fields.id, slug: fields.slug, type: fields.type, label: fields.label })
                .from(fields)
                .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, list.id), isNull(fields.deletedAt)))
                .orderBy(asc(fields.position), asc(fields.id));
            const mapping = readSubscriptionFields(list.settings);
            const slugOf = (id: number | null): string | null => (id ? (fieldRows.find((f) => f.id === id)?.slug ?? null) : null);
            const mapped = mapping ? Object.fromEntries(SUBSCRIPTION_FIELD_ROLES.map((r) => [r, slugOf(mapping[r])])) : null;
            const hasAny = mapped !== null && Object.values(mapped).some((v) => v !== null);
            const titleId = resolveTitleFieldId(fieldRows.map((f) => ({ id: f.id, type: f.type as FieldType })), list.settings);
            const title = titleId ? ctx.data[jsonbKeyForField(titleId)] : null;
            const email = fieldRows.find((f) => f.type === 'email' && typeof ctx.data[jsonbKeyForField(f.id)] === 'string');
            return {
                subscriptions: subs.map((r) => ({
                    ...toDto(r.s, r.connName ?? null),
                    charges: charges
                        .filter((c) => c.subscriptionId === r.s.id)
                        .slice(0, CHARGES_IN_PANEL)
                        .map(chargeToDto),
                })),
                plans,
                fields: hasAny ? mapped : null,
                can_setup: can(actor, 'manage_fields'),
                can_edit: canEdit,
                suggested: {
                    title: typeof title === 'string' && title.trim() !== '' ? title : `Registro #${recordId}`,
                    payer_email: email ? (ctx.data[jsonbKeyForField(email.id)] as string) : null,
                },
            };
        });
    }

    /** «Suscribir» desde la ficha: crea la suscripción en Mercado Pago y deja el link en el registro. */
    async createForRecord(
        tenantId: number,
        actor: CollectionActor,
        listIdOrSlug: string,
        recordId: number,
        input: CreateSubscriptionInput,
    ): Promise<Subscription> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.reachable(tenantId, list, recordId, actor, 'edit');
        const usable = await this.usableConnections(tenantId, actor);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [plan] = await tx
                .select()
                .from(subscriptionPlans)
                .where(and(eq(subscriptionPlans.tenantId, tenantId), eq(subscriptionPlans.id, input.plan_id)))
                .limit(1);
            if (!plan || !plan.active || plan.connectionId === null || !usable.some((c) => c.id === plan.connectionId)) {
                throw new NotFoundException({ code: 'plan_not_found', message: 'Ese plan no existe, está desactivado o su conexión no la puedes usar.', data: { status: 404 } });
            }
            try {
                return await this.createInTx(tx, tenantId, {
                    plan,
                    listId: list.id,
                    recordId,
                    payerEmail: input.payer_email,
                    amount: input.amount ?? null,
                    startDate: input.start_date ?? null,
                    title: input.title ?? null,
                    userId: actor.userId,
                });
            } catch (err) {
                if (err instanceof SubscriptionError) badRequest('subscription_failed', err.message);
                throw err;
            }
        });
        this.afterWrite(tenantId, result.write);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscription.create',
            targetType: 'record',
            targetId: recordId,
            targetLabel: result.sub.title,
            meta: { plan_id: input.plan_id, amount: result.sub.amount, currency: result.sub.currency, list_id: list.id },
        });
        return result.sub;
    }

    /**
     * Crea una suscripción DENTRO de una transacción (la ficha y la
     * automatización comparten esto): llama a Mercado Pago, guarda la fila y
     * escribe el registro. Un registro con una suscripción viva no recibe otra;
     * una que nunca se autorizó se reemplaza (el link viejo deja de servir).
     */
    async createInTx(
        tx: Tx,
        tenantId: number,
        opts: {
            plan: SubscriptionPlanRowDb;
            listId: number;
            recordId: number;
            payerEmail: string;
            amount: number | null;
            /** AAAA-MM-DD (o ISO): desde cuándo cobra. */
            startDate: string | null;
            title: string | null;
            userId: number | null;
            formId?: number | null;
            /** Adónde vuelve el cliente al autorizar (por defecto, la página de la app). */
            backUrlFor?: ((reference: string) => string) | null;
        },
    ): Promise<{ sub: Subscription; write: RecordWrite | null; info: SubscriptionEventInfo; linkField: string | null }> {
        const plan = opts.plan;
        if (!plan.active) throw new SubscriptionError(`El plan «${plan.name}» está desactivado.`);
        if (plan.connectionId === null) throw new SubscriptionError(`La conexión del plan «${plan.name}» ya no existe.`);
        const email = opts.payerEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SubscriptionError(`«${opts.payerEmail}» no es un correo: Mercado Pago lo necesita para la suscripción.`);
        const conn = await this.connectors.integrationCredsInTx(tx, tenantId, plan.connectionId);
        if (!conn) throw new SubscriptionError(`La conexión #${plan.connectionId} ya no existe.`);
        if (conn.provider !== 'mercadopago') throw new SubscriptionError(`«${conn.name}» no es una conexión de Mercado Pago.`);

        const existing = await tx
            .select()
            .from(subscriptions)
            .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.recordId, opts.recordId)));
        const live = existing.filter((s) => isLiveSubscriptionStatus(s.status as SubscriptionStatus));
        const blocking = live.find((s) => s.status !== 'pending');
        if (blocking) {
            throw new SubscriptionError(
                `Este registro ya tiene una suscripción ${SUBSCRIPTION_STATUS_OPTIONS[blocking.status as SubscriptionStatus]?.label.toLowerCase() ?? 'viva'} («${blocking.title}»). Cancélala antes de crear otra.`,
            );
        }

        const amount = Math.round((opts.amount ?? plan.amount) * 100) / 100;
        if (!(amount > 0)) throw new SubscriptionError('El valor de la suscripción tiene que ser mayor a cero.');
        const startAt = resolveStart(opts.startDate, plan.trialDays);
        const reference = `ibs_${randomBytes(12).toString('base64url')}`;
        const title = (opts.title?.trim() || plan.name).slice(0, 200);
        const req = createPreapprovalRequest(
            conn.creds,
            {
                reference,
                title,
                payerEmail: email,
                amount,
                currency: plan.currency,
                frequency: plan.frequency,
                frequencyType: plan.frequencyType as SubscriptionFrequencyType,
                startAt,
                cycles: plan.cycles,
                backUrl: opts.backUrlFor ? opts.backUrlFor(reference) : this.backUrl(reference),
            },
            this.bases,
        );
        let created;
        try {
            const res = await this.fetchMp(req);
            created = parseCreatedPreapproval(res.status, res.body, conn.creds);
        } catch (err) {
            throw new SubscriptionError(`No pudimos comunicarnos con Mercado Pago (${redact(err, conn.creds)}).`);
        }
        if ('error' in created) throw new SubscriptionError(created.error);

        // Un link anterior que nunca se autorizó queda reemplazado (en Mercado
        // Pago se cancela: si no, el cliente podría autorizar los dos).
        for (const old of live) {
            if (old.externalId) {
                await this.fetchMp(updatePreapprovalRequest(conn.creds, old.externalId, { kind: 'status', status: 'cancelled' }, this.bases)).catch(() => undefined);
            }
            await tx
                .update(subscriptions)
                .set({ status: 'cancelled', providerStatus: 'cancelled', cancelledAt: new Date(), cancelReason: 'Se reemplazó por un link nuevo.', url: null, updatedAt: new Date() })
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, old.id)));
        }

        const [row] = await tx
            .insert(subscriptions)
            .values({
                tenantId,
                connectionId: plan.connectionId,
                provider: 'mercadopago',
                planId: plan.id,
                listId: opts.listId,
                recordId: opts.recordId,
                externalId: created.externalId,
                reference,
                url: created.url,
                title,
                planName: plan.name,
                amount,
                currency: plan.currency,
                frequency: plan.frequency,
                frequencyType: plan.frequencyType,
                cycles: plan.cycles,
                graceDays: plan.graceDays,
                onExpire: plan.onExpire,
                payerEmail: email,
                status: 'pending',
                providerStatus: created.providerStatus,
                startAt: created.startAt ?? startAt,
                nextChargeAt: created.nextPaymentAt,
                formId: opts.formId ?? null,
                createdBy: opts.userId,
                lastCheckedAt: new Date(),
            })
            .returning();
        const sub = row!;
        const write = await this.writeRecord(tx, tenantId, sub);
        return {
            sub: toDto(sub, conn.name),
            write,
            info: eventInfo(sub, 'activated', null),
            linkField: await this.fieldLabel(tx, tenantId, sub.listId, 'link'),
        };
    }

    // ── Acciones sobre una suscripción ──────────────────────────────────

    async pause(tenantId: number, actor: CollectionActor, id: number): Promise<Subscription> {
        return this.applyPatch(tenantId, actor, id, { kind: 'status', status: 'paused' }, 'subscription.pause');
    }

    async resume(tenantId: number, actor: CollectionActor, id: number): Promise<Subscription> {
        return this.applyPatch(tenantId, actor, id, { kind: 'status', status: 'authorized' }, 'subscription.resume');
    }

    async cancel(tenantId: number, actor: CollectionActor, id: number, reason: string | null): Promise<Subscription> {
        return this.applyPatch(tenantId, actor, id, { kind: 'status', status: 'cancelled' }, 'subscription.cancel', reason);
    }

    async changeAmount(tenantId: number, actor: CollectionActor, id: number, amount: number): Promise<Subscription> {
        const sub = await this.subForActor(tenantId, actor, id, 'edit');
        return this.applyPatch(tenantId, actor, id, { kind: 'amount', amount, currency: sub.currency }, 'subscription.amount');
    }

    /** «Verificar»: relee de Mercado Pago (para cuando el aviso no llegó). */
    async verify(tenantId: number, actor: CollectionActor, id: number): Promise<Subscription> {
        await this.subForActor(tenantId, actor, id, 'view');
        const out = await this.sync(tenantId, id);
        return out;
    }

    private async applyPatch(
        tenantId: number,
        actor: CollectionActor,
        id: number,
        patch: PreapprovalPatch,
        action: 'subscription.pause' | 'subscription.resume' | 'subscription.cancel' | 'subscription.amount',
        reason: string | null = null,
    ): Promise<Subscription> {
        const sub = await this.subForActor(tenantId, actor, id, 'edit');
        try {
            await this.patchInMp(tenantId, sub, patch, reason ?? (action === 'subscription.cancel' ? 'La canceló la empresa.' : null));
        } catch (err) {
            if (err instanceof SubscriptionError) badRequest('subscription_failed', err.message);
            throw err;
        }
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action,
            targetType: 'record',
            targetId: sub.recordId,
            targetLabel: sub.title,
            meta: { subscription_id: sub.id, ...(patch.kind === 'amount' ? { amount: patch.amount } : {}), ...(reason ? { reason } : {}) },
        });
        return this.sync(tenantId, id);
    }

    /**
     * Cambia la suscripción en Mercado Pago y guarda lo pedido (el resto lo
     * trae la sincronización que sigue). Lo usan la ficha, la automatización y
     * el vencimiento con «cancelar al vencer».
     */
    async patchInMp(tenantId: number, sub: SubscriptionRowDb, patch: PreapprovalPatch, cancelReason: string | null): Promise<void> {
        const status = sub.status as SubscriptionStatus;
        if (patch.kind === 'status') {
            if (status === 'cancelled' || status === 'finished') throw new SubscriptionError('La suscripción ya terminó: para volver a cobrar, crea una nueva.');
            if (patch.status === 'paused' && status === 'paused') throw new SubscriptionError('Ya está pausada.');
            if (patch.status === 'authorized' && status !== 'paused') throw new SubscriptionError('Sólo se reanuda una suscripción pausada.');
            if (patch.status === 'paused' && status === 'pending') throw new SubscriptionError('Todavía no se autorizó: no hay nada que pausar.');
        } else if (status === 'cancelled' || status === 'finished') {
            throw new SubscriptionError('La suscripción ya terminó.');
        }
        if (!sub.connectionId || !sub.externalId) throw new SubscriptionError('La conexión de esta suscripción ya no existe.');
        const conn = await this.connectors.integrationCredsFor(tenantId, sub.connectionId);
        if (!conn) throw new SubscriptionError('La conexión de esta suscripción ya no existe.');
        let res;
        try {
            res = await this.fetchMp(updatePreapprovalRequest(conn.creds, sub.externalId, patch, this.bases));
        } catch (err) {
            throw new SubscriptionError(`No pudimos comunicarnos con Mercado Pago (${redact(err, conn.creds)}).`);
        }
        if (res.status < 200 || res.status >= 300) {
            throw new SubscriptionError(providerError('mercadopago', res.status, res.body));
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(subscriptions)
                .set(
                    patch.kind === 'amount'
                        ? { amount: Math.round(patch.amount * 100) / 100, updatedAt: new Date() }
                        : patch.status === 'cancelled'
                          ? { cancelReason: cancelReason ?? 'La canceló la empresa.', updatedAt: new Date() }
                          : { updatedAt: new Date() },
                )
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, sub.id))),
        );
    }

    private async subForActor(tenantId: number, actor: CollectionActor, id: number, action: 'view' | 'edit'): Promise<SubscriptionRowDb> {
        const [sub] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, id))).limit(1),
        );
        if (!sub) throw new NotFoundException({ code: 'subscription_not_found', message: 'Suscripción no encontrada.', data: { status: 404 } });
        if (sub.listId !== null && sub.recordId !== null) {
            const list = await this.lists.get(tenantId, String(sub.listId));
            await this.reachable(tenantId, list, sub.recordId, actor, action);
        } else if (!sub.connectionId) {
            throw new NotFoundException({ code: 'subscription_not_found', message: 'Suscripción no encontrada.', data: { status: 404 } });
        } else {
            // El registro se borró: la maneja quien puede editar la conexión.
            await this.connectors.editableConnection(tenantId, actor.userId, actor.role, sub.connectionId);
        }
        return sub;
    }

    // ── Sincronizar con Mercado Pago ────────────────────────────────────

    /** Relee la suscripción y sus cuotas, recalcula el estado, escribe el registro y avisa. */
    async sync(tenantId: number, id: number, now = new Date()): Promise<Subscription> {
        const [current] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, id))).limit(1),
        );
        if (!current) throw new NotFoundException({ code: 'subscription_not_found', message: 'Suscripción no encontrada.', data: { status: 404 } });
        const conn = current.connectionId ? await this.connectors.integrationCredsFor(tenantId, current.connectionId).catch(() => null) : null;
        let remote: RemoteState | null = null;
        if (conn && current.externalId) {
            remote = await this.readRemote(tenantId, current, conn.creds);
        }
        const outcome = await this.persist(tenantId, id, remote, now);
        if (!outcome) return toDto(current, conn?.name ?? null);
        await this.after(tenantId, outcome);
        // «Cancelar al vencer»: la suscripción venció y el plan pide cancelarla.
        if (outcome.events.some((e) => e.event === 'expired') && outcome.sub.onExpire === 'cancel' && outcome.sub.externalId) {
            try {
                await this.patchInMp(tenantId, outcome.sub, { kind: 'status', status: 'cancelled' }, 'Se canceló sola: venció sin pago (así lo pide el plan).');
                return this.sync(tenantId, id, now);
            } catch (err) {
                this.logger.warn(`Suscripción ${id}: no se pudo cancelar al vencer: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return toDto(outcome.sub, conn?.name ?? null);
    }

    /**
     * Sincroniza un momento después (la automatización que la cambió todavía
     * tiene su transacción abierta y el registro puede estar bloqueado).
     */
    syncSoon(tenantId: number, id: number, delayMs = 1500): void {
        const t = setTimeout(() => {
            this.sync(tenantId, id).catch((err) => this.logger.warn(`Suscripción ${id}: no se pudo sincronizar: ${String(err)}`));
        }, delayMs);
        t.unref?.();
    }

    /** «Probar» una automatización: el evento con los datos de la suscripción más nueva del registro. */
    async sampleEvent(tenantId: number, recordId: number, event: SubscriptionEvent): Promise<SubscriptionEventInfo | null> {
        const [sub] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.recordId, recordId)))
                .orderBy(desc(subscriptions.createdAt))
                .limit(1),
        );
        return sub ? eventInfo(sub, event, null) : null;
    }

    private async readRemote(tenantId: number, sub: SubscriptionRowDb, creds: IntegrationCreds): Promise<RemoteState | null> {
        const keyIncident = `subscriptions:${sub.connectionId}:read`;
        let res;
        try {
            res = await this.fetchMp(preapprovalRequest(creds, sub.externalId!, this.bases));
        } catch (err) {
            this.logger.warn(`Suscripción ${sub.id}: Mercado Pago no respondió (${redact(err, creds)}).`);
            return null;
        }
        if (res.status === 401 || res.status === 403) {
            this.incidents?.report({
                tenantId,
                key: keyIncident,
                source: 'collections',
                sourceId: sub.connectionId,
                title: 'Las suscripciones de Mercado Pago no se están actualizando',
                message: 'Mercado Pago rechazó el Access Token al leer una suscripción: puede que lo hayan cambiado o revocado. Vuelve a conectar la cuenta en Ajustes → Integraciones.',
            });
            return null;
        }
        const pre = parsePreapproval(res.status, res.body, creds);
        if (!pre) return null;
        this.incidents?.resolve(tenantId, keyIncident);
        let invoices: ParsedInvoice[] | null = null;
        try {
            const inv = await this.fetchMp(invoicesSearchRequest(creds, sub.externalId!, this.bases));
            invoices = parseInvoices(inv.status, inv.body);
        } catch {
            invoices = null;
        }
        return {
            providerStatus: pre.providerStatus,
            nextPaymentAt: pre.nextPaymentAt,
            amount: pre.amount,
            url: pre.url,
            startAt: pre.startAt,
            invoices,
        };
    }

    /**
     * Guarda lo leído (con la fila bloqueada): cobros nuevos, el resumen, el
     * estado y lo que cambió en el registro. Devuelve los eventos.
     */
    private async persist(tenantId: number, id: number, remote: RemoteState | null, now: Date): Promise<SyncOutcome | null> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const locked = await tx.execute(sql`select id from subscriptions where tenant_id = ${tenantId} and id = ${id} for update`);
            if ((locked as unknown as { rows: unknown[] }).rows.length === 0) return null;
            const [sub] = await tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, id))).limit(1);
            if (!sub) return null;
            const freq = sub.frequency;
            const type = sub.frequencyType as SubscriptionFrequencyType;

            const newCharges: SubscriptionChargeRowDb[] = [];
            let retryingInvoiceId: string | null = null;
            let retrying = sub.retrying;
            let failedFinal = sub.failedFinal;
            if (remote?.invoices) {
                for (const inv of remote.invoices) {
                    if (!inv.paymentId || !inv.paymentStatus) continue;
                    const changed = await this.upsertCharge(tx, tenantId, sub, {
                        providerPaymentId: inv.paymentId,
                        invoiceId: inv.invoiceId,
                        amount: inv.amount || Number(sub.amount),
                        currency: inv.currency || sub.currency,
                        status: inv.paymentStatus,
                        attempt: inv.retryAttempt,
                        failureReason: inv.failureReason,
                        method: null,
                        periodStart: inv.debitDate ?? inv.createdAt,
                        paidAt: inv.paymentStatus === 'approved' ? (inv.updatedAt ?? inv.debitDate ?? inv.createdAt) : null,
                    });
                    if (changed) newCharges.push(changed);
                }
                const latest = [...remote.invoices]
                    .filter((i) => i.status !== 'scheduled')
                    .sort((a, b) => (b.debitDate ?? b.createdAt ?? new Date(0)).getTime() - (a.debitDate ?? a.createdAt ?? new Date(0)).getTime())[0];
                retrying = latest?.status === 'recycling';
                retryingInvoiceId = retrying ? (latest?.invoiceId ?? null) : null;
                failedFinal = Boolean(latest && latest.status === 'processed' && latest.paymentStatus === 'rejected');
            }
            const all = await tx
                .select()
                .from(subscriptionCharges)
                .where(and(eq(subscriptionCharges.tenantId, tenantId), eq(subscriptionCharges.subscriptionId, sub.id)));
            const summary = summarizeCharges(
                all.map((c) => ({
                    invoiceId: c.invoiceId,
                    providerPaymentId: c.providerPaymentId,
                    status: c.status as SubscriptionChargeStatus,
                    periodStart: c.periodStart,
                    paidAt: c.paidAt,
                    createdAt: c.createdAt,
                    failureReason: c.failureReason,
                })),
                { frequency: freq, frequencyType: type, retryingInvoiceId },
            );
            const providerStatus = (remote?.providerStatus ?? (sub.providerStatus as SubscriptionProviderStatus | null)) ?? null;
            // Una cuota aprobada después de la rechazada «apaga» la mora.
            if (summary.lastChargeStatus === 'approved') failedFinal = false;
            const startAt = remote?.startAt ?? sub.startAt;
            const status = deriveSubscriptionStatus({
                providerStatus,
                startAt,
                paidUntil: summary.paidUntil,
                graceDays: sub.graceDays,
                retrying,
                failedFinal,
                chargesPaid: summary.chargesPaid,
                cycles: sub.cycles,
                now,
            });
            const prevStatus = sub.status as SubscriptionStatus;
            const cancelReason =
                status === 'cancelled' && !sub.cancelReason
                    ? summary.consecutiveFailed >= 3
                        ? 'Mercado Pago la dio de baja después de 3 cuotas rechazadas.'
                        : 'La canceló el cliente o Mercado Pago.'
                    : sub.cancelReason;
            const nextChargeAt =
                status === 'cancelled' || status === 'finished' || status === 'paused'
                    ? null
                    : (remote?.nextPaymentAt ?? sub.nextChargeAt ?? (summary.paidUntil ? summary.paidUntil : null));
            const [updated] = await tx
                .update(subscriptions)
                .set({
                    status,
                    providerStatus,
                    startAt,
                    nextChargeAt,
                    paidUntil: summary.paidUntil,
                    chargesPaid: summary.chargesPaid,
                    chargesFailed: summary.chargesFailed,
                    consecutiveFailed: summary.consecutiveFailed,
                    retrying,
                    failedFinal,
                    lastChargeAt: summary.lastChargeAt,
                    lastChargeStatus: summary.lastChargeStatus,
                    lastFailureReason: summary.lastFailureReason,
                    amount: remote?.amount && remote.amount > 0 ? remote.amount : sub.amount,
                    url: status === 'pending' ? (remote?.url ?? sub.url) : null,
                    cancelledAt: status === 'cancelled' || status === 'finished' ? (sub.cancelledAt ?? now) : null,
                    cancelReason: status === 'finished' ? (sub.cancelReason ?? 'Se cobraron todas las cuotas del plan.') : cancelReason,
                    lastCheckedAt: now,
                    updatedAt: prevStatus !== status || newCharges.length > 0 ? now : sub.updatedAt,
                })
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, sub.id)))
                .returning();
            const fresh = updated!;
            const events: SyncOutcome['events'] = [];
            for (const c of newCharges.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
                if (c.status === 'approved') events.push({ event: 'charged', charge: c });
                else if (c.status === 'rejected') events.push({ event: 'charge_failed', charge: c });
            }
            for (const e of subscriptionStatusEvents(prevStatus, status)) events.push({ event: e, charge: null });
            const write = await this.writeRecord(tx, tenantId, fresh);
            const readOnly = await tenantIsReadOnly(tx, tenantId);
            return { sub: fresh, write, events, readOnly };
        });
    }

    /** Un cobro nuevo o que cambió (null si ya estaba igual). */
    private async upsertCharge(
        tx: Tx,
        tenantId: number,
        sub: SubscriptionRowDb,
        c: {
            providerPaymentId: string;
            invoiceId: string | null;
            amount: number;
            currency: string;
            status: SubscriptionChargeStatus;
            attempt: number | null;
            failureReason: string | null;
            method: string | null;
            periodStart: Date | null;
            paidAt: Date | null;
        },
    ): Promise<SubscriptionChargeRowDb | null> {
        const [prev] = await tx
            .select()
            .from(subscriptionCharges)
            .where(and(eq(subscriptionCharges.subscriptionId, sub.id), eq(subscriptionCharges.providerPaymentId, c.providerPaymentId)))
            .limit(1);
        if (!prev) {
            const [row] = await tx
                .insert(subscriptionCharges)
                .values({
                    tenantId,
                    subscriptionId: sub.id,
                    provider: sub.provider,
                    providerPaymentId: c.providerPaymentId,
                    invoiceId: c.invoiceId,
                    amount: c.amount,
                    currency: c.currency.toUpperCase(),
                    status: c.status,
                    attempt: c.attempt,
                    failureReason: c.failureReason,
                    method: c.method,
                    periodStart: c.periodStart,
                    paidAt: c.paidAt,
                })
                .onConflictDoNothing()
                .returning();
            return row ?? null;
        }
        // Un pago aprobado no se "desaprueba" con un aviso viejo (salvo el reembolso);
        // lo que faltaba (la cuota, el medio, la fecha) sí se completa: cada aviso trae una parte.
        if (prev.status === 'approved' && c.status !== 'refunded') {
            const fill: Partial<typeof subscriptionCharges.$inferInsert> = {};
            if (!prev.invoiceId && c.invoiceId) fill.invoiceId = c.invoiceId;
            if (!prev.method && c.method) fill.method = c.method;
            if (!prev.paidAt && c.paidAt) fill.paidAt = c.paidAt;
            if (!prev.periodStart && c.periodStart) fill.periodStart = c.periodStart;
            if (Object.keys(fill).length > 0) {
                await tx.update(subscriptionCharges).set({ ...fill, updatedAt: new Date() }).where(eq(subscriptionCharges.id, prev.id));
            }
            return null;
        }
        const same =
            prev.status === c.status &&
            (prev.invoiceId ?? null) === (c.invoiceId ?? prev.invoiceId ?? null) &&
            (prev.method ?? null) === (c.method ?? prev.method ?? null);
        if (same) return null;
        const [row] = await tx
            .update(subscriptionCharges)
            .set({
                status: c.status,
                invoiceId: c.invoiceId ?? prev.invoiceId,
                attempt: c.attempt ?? prev.attempt,
                failureReason: c.failureReason ?? (c.status === 'rejected' ? prev.failureReason : null),
                method: c.method ?? prev.method,
                periodStart: c.periodStart ?? prev.periodStart,
                paidAt: c.paidAt ?? prev.paidAt,
                updatedAt: new Date(),
            })
            .where(eq(subscriptionCharges.id, prev.id))
            .returning();
        return row && row.status !== prev.status ? row : null;
    }

    /** Fuera de la transacción: refrescar pantallas, disparar automatizaciones y avisar. */
    private async after(tenantId: number, out: SyncOutcome): Promise<void> {
        this.afterWrite(tenantId, out.write);
        if (out.sub.listId) this.realtime.records(tenantId, out.sub.listId);
        if (out.events.length === 0 || out.sub.listId === null || out.sub.recordId === null) return;
        const listId = out.sub.listId;
        const recordId = out.sub.recordId;
        const data = out.write?.after ?? (await this.recordData(tenantId, listId, recordId)) ?? null;
        for (const { event, charge } of out.events) {
            const info = eventInfo(out.sub, event, charge);
            if (data && !out.readOnly) {
                this.dispatcher.dispatch({ tenantId, listId, recordId, trigger: 'subscription_event', after: data, subscription: info });
            }
            const notice = noticeFor(out.sub, event, charge);
            if (notice && this.notify) {
                this.notify.emit({
                    type: 'subscription',
                    tenantId,
                    listId,
                    recordId,
                    userIds: out.sub.createdBy ? [out.sub.createdBy] : [],
                    title: notice.title,
                    body: notice.body,
                });
            }
        }
    }

    // ── Avisos de Mercado Pago ──────────────────────────────────────────

    /**
     * Un aviso que llegó a la URL de una conexión de cobro. Devuelve si era
     * de una suscripción (si no, el cobro de links lo sigue procesando).
     */
    async handleNotice(tenantId: number, connectionId: number, query: Record<string, unknown>, body: unknown): Promise<'applied' | 'ignored' | 'not_subscription'> {
        const notice = mpNotice(query, body);
        if (!notice) return 'not_subscription';
        const conn = await this.connectors.integrationCredsFor(tenantId, connectionId).catch(() => null);
        if (!conn) return notice.topic === 'payment' ? 'not_subscription' : 'ignored';
        const find = async (where: { externalId?: string; reference?: string }): Promise<SubscriptionRowDb | undefined> =>
            (
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select()
                        .from(subscriptions)
                        .where(
                            and(
                                eq(subscriptions.tenantId, tenantId),
                                eq(subscriptions.connectionId, connectionId),
                                where.externalId ? eq(subscriptions.externalId, where.externalId) : eq(subscriptions.reference, where.reference!),
                            ),
                        )
                        .limit(1),
                )
            )[0];

        if (notice.topic === 'subscription_preapproval') {
            const sub = await find({ externalId: notice.id });
            if (!sub) return 'ignored';
            await this.sync(tenantId, sub.id);
            return 'applied';
        }
        if (notice.topic === 'subscription_authorized_payment') {
            const res = await this.fetchMp(invoiceRequest(conn.creds, notice.id, this.bases));
            if (res.status >= 500) throw new Error(`Mercado Pago respondió ${res.status} al releer la cuota`);
            const inv = parseInvoice(res.status, res.body);
            if (!inv?.preapprovalId) return 'ignored';
            const sub = await find({ externalId: inv.preapprovalId });
            if (!sub) return 'ignored';
            if (inv.paymentId && inv.paymentStatus) {
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    this.upsertCharge(tx, tenantId, sub, {
                        providerPaymentId: inv.paymentId!,
                        invoiceId: inv.invoiceId,
                        amount: inv.amount || Number(sub.amount),
                        currency: inv.currency || sub.currency,
                        status: inv.paymentStatus!,
                        attempt: inv.retryAttempt,
                        failureReason: inv.failureReason,
                        method: null,
                        periodStart: inv.debitDate ?? inv.createdAt,
                        paidAt: inv.paymentStatus === 'approved' ? (inv.updatedAt ?? inv.debitDate) : null,
                    }),
                );
            }
            await this.sync(tenantId, sub.id);
            return 'applied';
        }
        // `payment`: puede ser de un link de pago (no es nuestro) o de una cuota.
        const res = await this.fetchMp({
            url: `${this.bases.mercadopago.replace(/\/+$/, '')}/v1/payments/${encodeURIComponent(notice.id)}`,
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${conn.creds.secret}` },
        });
        if (res.status >= 500) throw new Error(`Mercado Pago respondió ${res.status} al releer el pago`);
        const pay = parseSubscriptionPayment(res.status, res.body);
        if (!pay) return 'not_subscription';
        const sub =
            (pay.preapprovalId ? await find({ externalId: pay.preapprovalId }) : undefined) ??
            (pay.externalReference?.startsWith('ibs_') ? await find({ reference: pay.externalReference }) : undefined);
        if (!sub) return 'not_subscription';
        // Un primer intento SIN cuota conocida todavía: la cuota llega con la
        // sincronización; aquí ya queda el medio de pago (la cuota no lo trae).
        await this.tenantDb.withTenant(tenantId, (tx) =>
            this.upsertCharge(tx, tenantId, sub, {
                providerPaymentId: pay.paymentId,
                invoiceId: null,
                amount: pay.amount || Number(sub.amount),
                currency: pay.currency || sub.currency,
                status: pay.status,
                attempt: null,
                failureReason: pay.failureReason,
                method: pay.method,
                periodStart: null,
                paidAt: pay.paidAt,
            }),
        );
        await this.sync(tenantId, sub.id);
        return 'applied';
    }

    // ── Revisión periódica ──────────────────────────────────────────────

    /**
     * Cada pocos minutos, en UN nodo (lock en Redis): relee lo que puede haber
     * cambiado — pendientes de autorizar (los primeros días), lo que está por
     * cobrarse o reintentándose, y una vez por día el resto de las vivas. Sin
     * los avisos de Mercado Pago configurados, esto alcanza.
     */
    async tick(now = new Date(), limit = 100): Promise<number> {
        if (this.redis) {
            const got = await this.redis.set(TICK_LOCK, String(process.pid), 'EX', 240, 'NX').catch(() => 'OK');
            if (got !== 'OK') return 0;
        }
        try {
            const due = await this.db.execute(sql`
                select id, tenant_id as "tenantId" from subscriptions
                where status not in ('cancelled', 'finished') and external_id is not null and connection_id is not null and (
                    (status = 'pending' and created_at > ${new Date(now.getTime() - 30 * DAY)} and (last_checked_at is null or last_checked_at < ${now}::timestamptz - (
                        case when created_at > ${new Date(now.getTime() - 2 * DAY)} then interval '10 minutes'
                             when created_at > ${new Date(now.getTime() - 7 * DAY)} then interval '1 hour'
                             else interval '1 day' end)))
                    or (status in ('retrying', 'past_due') and (last_checked_at is null or last_checked_at < ${new Date(now.getTime() - 30 * 60 * 1000)}))
                    or (status = 'active' and (
                        last_checked_at is null
                        or last_checked_at < ${new Date(now.getTime() - 12 * 60 * 60 * 1000)}
                        or (next_charge_at is not null and next_charge_at < ${new Date(now.getTime() + 2 * 60 * 60 * 1000)} and last_checked_at < ${new Date(now.getTime() - 30 * 60 * 1000)})))
                    or (status in ('expired', 'paused') and (last_checked_at is null or last_checked_at < ${new Date(now.getTime() - DAY)}))
                )
                order by last_checked_at asc nulls first
                limit ${limit}
            `);
            const rows = (due as unknown as { rows: Array<{ id: number | string; tenantId: number | string }> }).rows;
            const moduleOff = new Map<number, boolean>();
            let done = 0;
            for (const r of rows) {
                const tenantId = Number(r.tenantId);
                if (!moduleOff.has(tenantId)) moduleOff.set(tenantId, await planModuleOff(this.db, tenantId, 'integrations'));
                if (moduleOff.get(tenantId)) continue;
                try {
                    await this.sync(tenantId, Number(r.id), now);
                    done += 1;
                } catch (err) {
                    this.logger.warn(`Suscripción ${r.id}: no se pudo revisar: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            return done;
        } finally {
            if (this.redis) await this.redis.del(TICK_LOCK).catch(() => undefined);
        }
    }

    // ── Página de vuelta (pública) ──────────────────────────────────────

    /**
     * Lo que ve el cliente al volver de autorizar la tarjeta. Se busca por
     * NUESTRA referencia (aleatoria); si sigue pendiente, se le pregunta a
     * Mercado Pago (a lo sumo cada 15 s). Sólo devuelve lo que el cliente ya
     * sabe: el plan, el valor y si quedó activa.
     */
    async publicStatus(reference: string): Promise<{ tenantName: string; title: string; status: SubscriptionStatus; amount: number; currency: string; frequency: number; frequencyType: SubscriptionFrequencyType } | null> {
        if (!/^ibs_[A-Za-z0-9_-]{8,48}$/.test(reference)) return null;
        const [row] = await this.db
            .select({ id: subscriptions.id, tenantId: subscriptions.tenantId, status: subscriptions.status, lastCheckedAt: subscriptions.lastCheckedAt })
            .from(subscriptions)
            .where(eq(subscriptions.reference, reference))
            .limit(1);
        if (!row) return null;
        const stale = !row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > 15_000;
        if (row.status === 'pending' && stale) {
            await this.sync(row.tenantId, row.id).catch((err: unknown) => {
                this.logger.warn(`Suscripción ${row.id}: no se pudo consultar al volver: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, row.id)).limit(1);
        const [tenant] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, row.tenantId)).limit(1);
        if (!sub) return null;
        return {
            tenantName: tenant?.name ?? '',
            title: sub.title,
            status: sub.status as SubscriptionStatus,
            amount: Number(sub.amount),
            currency: sub.currency,
            frequency: sub.frequency,
            frequencyType: sub.frequencyType as SubscriptionFrequencyType,
        };
    }

    // ── Resumen de la conexión ──────────────────────────────────────────

    async overview(tenantId: number, actor: CollectionActor, connectionId: number): Promise<SubscriptionsOverview> {
        const conn = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (conn.provider !== 'mercadopago') badRequest('not_subscription_provider', 'Las suscripciones son de Mercado Pago.');
        const plans = await this.listPlans(tenantId, actor, connectionId).catch(() => [] as SubscriptionPlan[]);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ s: subscriptions, listName: lists.name, listSlug: lists.slug, listSettings: lists.settings, data: records.data })
                .from(subscriptions)
                .leftJoin(lists, eq(lists.id, subscriptions.listId))
                .leftJoin(records, eq(records.id, subscriptions.recordId))
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.connectionId, connectionId)))
                .orderBy(desc(subscriptions.updatedAt))
                .limit(200);
            const since = new Date(Date.now() - 30 * DAY);
            const chargeRows = await tx
                .select({ c: subscriptionCharges, s: subscriptions })
                .from(subscriptionCharges)
                .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
                .where(and(eq(subscriptionCharges.tenantId, tenantId), eq(subscriptions.connectionId, connectionId)))
                .orderBy(desc(subscriptionCharges.createdAt))
                .limit(100);
            const titles = await this.titlesFor(tx, tenantId, rows.map((r) => ({ listId: r.s.listId, settings: r.listSettings ?? {}, data: r.data ?? {} })));
            const recordTitle = (listId: number | null, data: Record<string, unknown> | null, recordId: number | null): string | null => {
                if (recordId === null || listId === null || data === null) return null;
                const id = titles.get(listId) ?? null;
                const v = id ? data[jsonbKeyForField(id)] : null;
                return typeof v === 'string' && v.trim() !== '' ? v : `Registro #${recordId}`;
            };
            const live = rows.filter((r) => isLiveSubscriptionStatus(r.s.status as SubscriptionStatus));
            const currencies = new Map<string, number>();
            for (const r of live) currencies.set(r.s.currency, (currencies.get(r.s.currency) ?? 0) + 1);
            const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? plans[0]?.currency ?? 'COP';
            const monthly = live
                .filter((r) => r.s.currency === currency && ['active', 'retrying', 'past_due'].includes(r.s.status))
                .reduce((sum, r) => sum + monthlySubscriptionAmount(Number(r.s.amount), r.s.frequency, r.s.frequencyType as SubscriptionFrequencyType), 0);
            const count = (st: SubscriptionStatus) => rows.filter((r) => r.s.status === st).length;
            const subRows: SubscriptionRow[] = rows.map((r) => ({
                ...toDto(r.s, conn.name),
                list_name: r.listName ?? null,
                list_slug: r.listSlug ?? null,
                record_title: recordTitle(r.s.listId, r.data ?? null, r.s.recordId),
            }));
            const recent = chargeRows.map((r) => ({
                ...chargeToDto(r.c),
                record_title: recordTitle(r.s.listId, rows.find((x) => x.s.id === r.s.id)?.data ?? null, r.s.recordId),
                list_slug: rows.find((x) => x.s.id === r.s.id)?.listSlug ?? null,
                record_id: r.s.recordId,
                plan_name: r.s.planName,
            }));
            return {
                plans,
                totals: {
                    live: live.length,
                    active: count('active'),
                    retrying: count('retrying'),
                    past_due: count('past_due'),
                    expired: count('expired'),
                    pending: count('pending'),
                    cancelled_30d: rows.filter((r) => r.s.status === 'cancelled' && r.s.cancelledAt && r.s.cancelledAt >= since).length,
                    monthly: Math.round(monthly * 100) / 100,
                    currency,
                    charged_30d: chargeRows
                        .filter((r) => r.c.status === 'approved' && r.c.currency === currency && (r.c.paidAt ?? r.c.createdAt) >= since)
                        .reduce((s, r) => s + Number(r.c.amount), 0),
                    failed_30d: chargeRows.filter((r) => r.c.status === 'rejected' && r.c.createdAt >= since).length,
                },
                subscriptions: subRows,
                charges: recent,
            };
        });
    }

    private async titlesFor(
        tx: Tx,
        tenantId: number,
        rows: Array<{ listId: number | null; settings: Record<string, unknown> }>,
    ): Promise<Map<number, number | null>> {
        const out = new Map<number, number | null>();
        const listIds = [...new Set(rows.map((r) => r.listId).filter((id): id is number => id !== null))];
        if (listIds.length === 0) return out;
        const fieldRows = await tx
            .select({ id: fields.id, type: fields.type, listId: fields.listId })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), inArray(fields.listId, listIds)))
            .orderBy(asc(fields.position), asc(fields.id));
        for (const listId of listIds) {
            const settings = rows.find((r) => r.listId === listId)?.settings ?? {};
            out.set(
                listId,
                resolveTitleFieldId(fieldRows.filter((f) => f.listId === listId).map((f) => ({ id: f.id, type: f.type as FieldType })), settings),
            );
        }
        return out;
    }

    // ── Columnas de la suscripción en la lista ──────────────────────────

    async getFields(tenantId: number, listIdOrSlug: string): Promise<SubscriptionFields | null> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return readSubscriptionFields(list.settings);
    }

    async setupFields(tenantId: number, actor: CollectionActor, listIdOrSlug: string): Promise<SubscriptionFields> {
        if (!this.fieldsService) throw new Error('FieldsService no disponible');
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.fieldsService.listByListId(tenantId, list.id);
        const suggested = suggestSubscriptionFields(current, readSubscriptionFields(list.settings));
        const input: SetSubscriptionFieldsInput = {};
        for (const role of SUBSCRIPTION_FIELD_ROLES) input[role] = suggested[role] ?? 'create';
        return this.setFields(tenantId, actor, listIdOrSlug, input);
    }

    /**
     * Dónde se guarda cada dato de la suscripción: una columna que ya existe
     * (de un tipo que sirva), una nueva (`'create'`) o ninguna (`null`). Un
     * estado en una lista de opciones recibe las opciones que le falten.
     */
    async setFields(tenantId: number, actor: CollectionActor, listIdOrSlug: string, input: SetSubscriptionFieldsInput): Promise<SubscriptionFields> {
        if (!this.fieldsService) throw new Error('FieldsService no disponible');
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.fieldsService.listByListId(tenantId, list.id);
        const byId = new Map(current.map((f) => [f.id, f]));
        const mapping: SubscriptionFields = { ...EMPTY_SUBSCRIPTION_FIELDS, ...(readSubscriptionFields(list.settings) ?? {}) };
        for (const role of SUBSCRIPTION_FIELD_ROLES) if (mapping[role] !== null && !byId.has(mapping[role]!)) mapping[role] = null;
        const bad = (message: string): never => badRequest('invalid_subscription_fields', message);
        const used = new Map<number, SubscriptionFieldRole>();
        for (const role of SUBSCRIPTION_FIELD_ROLES) {
            const choice = input[role];
            if (typeof choice !== 'number') continue;
            const f = byId.get(choice);
            if (!f) bad(`«${SUBSCRIPTION_FIELD_LABELS[role]}»: esa columna no es de esta lista.`);
            if (!SUBSCRIPTION_FIELD_TYPES[role].includes(f!.type)) {
                bad(`«${SUBSCRIPTION_FIELD_LABELS[role]}» no se puede guardar en «${f!.label}»: esa columna es de otro tipo.`);
            }
            const other = used.get(choice);
            if (other) bad(`«${f!.label}» no puede guardar a la vez «${SUBSCRIPTION_FIELD_LABELS[other]}» y «${SUBSCRIPTION_FIELD_LABELS[role]}».`);
            used.set(choice, role);
        }
        const currencyField = current.find((f) => f.type === 'currency');
        const currency = ((currencyField?.config as Record<string, unknown> | undefined)?.currency as string | undefined) ?? 'COP';
        const statusOptions = Object.values(SUBSCRIPTION_STATUS_OPTIONS).map((o) => ({ value: o.value, label: o.label, color: o.color }));
        const spec: Record<SubscriptionFieldRole, { type: FieldType; config?: Record<string, unknown> }> = {
            status: { type: 'select', config: { options: statusOptions } },
            plan: { type: 'text' },
            amount: { type: 'currency', config: { currency, precision: currency === 'COP' ? 0 : 2 } },
            next_charge: { type: 'date' },
            paid_until: { type: 'date' },
            failed: { type: 'number' },
            link: { type: 'url' },
        };
        for (const role of SUBSCRIPTION_FIELD_ROLES) {
            const choice = input[role];
            if (choice === undefined) continue;
            if (choice === null) {
                mapping[role] = null;
                continue;
            }
            if (choice === 'create') {
                if (mapping[role] !== null) continue;
                const created = await this.fieldsService.create(tenantId, String(list.id), {
                    label: SUBSCRIPTION_FIELD_LABELS[role],
                    type: spec[role].type,
                    config: spec[role].config,
                });
                mapping[role] = created.id;
                continue;
            }
            mapping[role] = choice;
            const f = byId.get(choice)!;
            if (role === 'status' && f.type === 'select') {
                const opts = Array.isArray((f.config as { options?: unknown })?.options) ? (f.config as { options: Array<{ value?: unknown }> }).options : [];
                const have = new Set(opts.map((o) => o?.value));
                const missing = statusOptions.filter((o) => !have.has(o.value));
                if (missing.length > 0) {
                    await this.fieldsService.update(tenantId, String(list.id), String(f.id), {
                        config: { ...(f.config as Record<string, unknown>), options: [...opts, ...missing] },
                    });
                }
            }
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{subscriptions}', ${JSON.stringify({ fields: mapping })}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id))),
        );
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscriptions.setup',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { fields: mapping },
        });
        // Lo que ya existe queda escrito en las columnas recién elegidas.
        await this.rewriteList(tenantId, list.id);
        this.realtime.records(tenantId, list.id);
        return mapping;
    }

    /** Escribe en las columnas el estado de las suscripciones de una lista (al elegir columnas nuevas). */
    private async rewriteList(tenantId: number, listId: number): Promise<void> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: subscriptions.id })
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.listId, listId)))
                .orderBy(asc(subscriptions.createdAt))
                .limit(2000),
        );
        for (const r of rows) {
            const write = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [sub] = await tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, r.id))).limit(1);
                return sub ? this.writeRecord(tx, tenantId, sub) : null;
            });
            if (write) this.realtime.records(tenantId, listId);
        }
    }

    private async fieldLabel(tx: Tx, tenantId: number, listId: number | null, role: SubscriptionFieldRole): Promise<string | null> {
        if (listId === null) return null;
        const [list] = await tx.select({ settings: lists.settings }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId))).limit(1);
        const id = readSubscriptionFields(list?.settings)?.[role] ?? null;
        if (!id) return null;
        const [f] = await tx
            .select({ label: fields.label })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, listId), eq(fields.id, id), isNull(fields.deletedAt)))
            .limit(1);
        return f?.label ?? null;
    }

    /**
     * Escribe la suscripción en el registro, en las columnas mapeadas que
     * sigan existiendo (cada valor pasa por el validador del campo). Sólo la
     * suscripción MÁS NUEVA del registro escribe: una vieja cancelada no pisa
     * a la que la reemplazó. Sin disparar `record_updated` de más: lo escrito
     * es del sistema y el disparador propio de la suscripción ya avisa.
     */
    private async writeRecord(tx: Tx, tenantId: number, sub: SubscriptionRowDb): Promise<RecordWrite | null> {
        if (sub.listId === null || sub.recordId === null) return null;
        const [latest] = await tx
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.recordId, sub.recordId)))
            .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
            .limit(1);
        if (latest && latest.id !== sub.id) return null;
        const [list] = await tx.select({ settings: lists.settings }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, sub.listId))).limit(1);
        const mapping = readSubscriptionFields(list?.settings);
        if (!mapping) return null;
        const ids = SUBSCRIPTION_FIELD_ROLES.map((r) => mapping[r]).filter((id): id is number => id !== null);
        if (ids.length === 0) return null;
        const fieldRows = await tx
            .select({ id: fields.id, type: fields.type, config: fields.config })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, sub.listId), inArray(fields.id, ids), isNull(fields.deletedAt)));
        const record = await this.recordsRepo.findByIdForUpdate(tx, tenantId, sub.listId, sub.recordId);
        if (!record) return null;
        const before = record.data as Record<string, unknown>;
        const after = { ...before };
        let timeZone: string | null = null;
        const status = sub.status as SubscriptionStatus;
        const values: Record<SubscriptionFieldRole, unknown> = {
            status,
            plan: sub.planName ?? sub.title,
            amount: Number(sub.amount),
            next_charge: sub.nextChargeAt,
            paid_until: sub.paidUntil,
            failed: sub.chargesFailed,
            link: status === 'pending' ? sub.url : null,
        };
        for (const role of SUBSCRIPTION_FIELD_ROLES) {
            const fieldId = mapping[role];
            const field = fieldId ? fieldRows.find((f) => f.id === fieldId) : undefined;
            if (!field) continue;
            if ((role === 'next_charge' || role === 'paid_until') && field.type === 'date' && timeZone === null) {
                const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
                timeZone = parseTenantTimeZone(t?.settings) ?? 'UTC';
            }
            const raw = toSubscriptionFieldValue(role, values[role], field.type as FieldType, field.config, timeZone ?? 'UTC');
            const key = jsonbKeyForField(field.id);
            if (raw === null) {
                delete after[key];
                continue;
            }
            const v = validateFieldValue({ type: field.type as FieldType, config: field.config, is_required: false }, raw);
            if (v.ok) after[key] = v.value;
        }
        if (JSON.stringify(before) === JSON.stringify(after)) return null;
        const updated = await this.recordsRepo.updateData(tx, tenantId, sub.listId, sub.recordId, after, 0);
        if (!updated) return null;
        await this.activity.logInTx(tx, {
            tenantId,
            listId: sub.listId,
            recordId: sub.recordId,
            userId: null,
            action: 'record_updated',
            diff: computeDiff(before, after),
        });
        return { listId: sub.listId, recordId: sub.recordId, before, after: updated.data as Record<string, unknown> };
    }

    private afterWrite(tenantId: number, write: RecordWrite | null): void {
        if (!write) return;
        this.realtime.records(tenantId, write.listId);
    }

    private async recordData(tenantId: number, listId: number, recordId: number): Promise<Record<string, unknown> | null> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, listId, recordId));
        return row ? (row.data as Record<string, unknown>) : null;
    }

    private async reachable(
        tenantId: number,
        list: { id: number; settings: Record<string, unknown> },
        recordId: number,
        actor: CollectionActor,
        action: 'view' | 'edit',
    ): Promise<{ data: Record<string, unknown> }> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, recordId));
        const reach = row !== null && listRowInScope(list.settings, actor, action, { id: recordId, createdBy: row.createdBy, data: row.data });
        if (!reach || !row) throw new NotFoundException({ code: 'record_not_found', message: `Registro ${recordId} no encontrado`, data: { status: 404 } });
        return { data: row.data as Record<string, unknown> };
    }

    private async canReach(
        tenantId: number,
        list: { id: number; settings: Record<string, unknown> },
        recordId: number,
        actor: CollectionActor,
        action: 'view' | 'edit',
    ): Promise<boolean> {
        if (action === 'edit' && !can(actor, 'edit_records') && !can(actor, 'edit_own_records')) return false;
        return this.reachable(tenantId, list, recordId, actor, action).then(
            () => true,
            () => false,
        );
    }

    /** La red a Mercado Pago (por el guard anti-SSRF de SEC-03). */
    private async fetchMp(req: IntegrationRequest): Promise<{ status: number; body: string }> {
        const res = await safeWebhookFetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
            captureBody: true,
            maxCaptureBytes: 2_000_000,
            timeoutMs: FETCH_TIMEOUT_MS,
        });
        return { status: res.status, body: res.body ?? '' };
    }
}

// ── Helpers puros ───────────────────────────────────────────────────────

/** Desde cuándo cobra: la fecha pedida, o hoy + la prueba gratis del plan (null = al autorizar). */
export function resolveStart(startDate: string | null, trialDays: number, now = new Date()): Date | null {
    if (startDate && startDate.trim() !== '') {
        const raw = startDate.trim();
        const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
        if (Number.isNaN(d.getTime())) throw new SubscriptionError(`«${startDate}» no es una fecha (usa AAAA-MM-DD).`);
        return d.getTime() > now.getTime() ? d : null;
    }
    return trialDays > 0 ? new Date(now.getTime() + trialDays * DAY) : null;
}

function planToDto(r: SubscriptionPlanRowDb, connectionName: string | null, subscribers: { live: number; total: number }): SubscriptionPlan {
    return {
        id: r.id,
        connection_id: r.connectionId,
        connection_name: connectionName,
        provider: 'mercadopago',
        name: r.name,
        description: r.description,
        amount: Number(r.amount),
        currency: r.currency,
        frequency: r.frequency,
        frequency_type: r.frequencyType as SubscriptionFrequencyType,
        cycles: r.cycles,
        trial_days: r.trialDays,
        grace_days: r.graceDays,
        on_expire: r.onExpire === 'cancel' ? 'cancel' : 'mark',
        active: r.active,
        subscribers,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
    };
}

export function toDto(r: SubscriptionRowDb, connectionName: string | null): Subscription {
    return {
        id: r.id,
        provider: 'mercadopago',
        connection_id: r.connectionId,
        connection_name: connectionName,
        plan_id: r.planId,
        plan_name: r.planName,
        list_id: r.listId,
        record_id: r.recordId,
        title: r.title,
        amount: Number(r.amount),
        currency: r.currency,
        frequency: r.frequency,
        frequency_type: r.frequencyType as SubscriptionFrequencyType,
        cycles: r.cycles,
        grace_days: r.graceDays,
        on_expire: r.onExpire === 'cancel' ? 'cancel' : 'mark',
        status: r.status as SubscriptionStatus,
        provider_status: r.providerStatus,
        url: r.status === 'pending' ? r.url : null,
        payer_email: r.payerEmail,
        start_at: r.startAt ? r.startAt.toISOString() : null,
        next_charge_at: r.nextChargeAt ? r.nextChargeAt.toISOString() : null,
        paid_until: r.paidUntil ? r.paidUntil.toISOString() : null,
        charges_paid: r.chargesPaid,
        charges_failed: r.chargesFailed,
        consecutive_failed: r.consecutiveFailed,
        last_charge_at: r.lastChargeAt ? r.lastChargeAt.toISOString() : null,
        last_charge_status: (r.lastChargeStatus as SubscriptionChargeStatus | null) ?? null,
        last_failure_reason: r.lastFailureReason,
        cancelled_at: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        cancel_reason: r.cancelReason,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
        last_checked_at: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
    };
}

function chargeToDto(c: SubscriptionChargeRowDb): SubscriptionCharge {
    return {
        id: c.id,
        subscription_id: c.subscriptionId,
        provider_payment_id: c.providerPaymentId,
        amount: Number(c.amount),
        currency: c.currency,
        status: c.status as SubscriptionChargeStatus,
        attempt: c.attempt,
        failure_reason: c.failureReason,
        method: c.method,
        period_start: c.periodStart ? c.periodStart.toISOString() : null,
        paid_at: c.paidAt ? c.paidAt.toISOString() : null,
        created_at: c.createdAt.toISOString(),
    };
}

/** El valor de un rol en el tipo de su columna (o `null` para vaciarla). */
export function toSubscriptionFieldValue(role: SubscriptionFieldRole, value: unknown, type: FieldType, config: unknown, timeZone = 'UTC'): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (role === 'status') {
        const opt = SUBSCRIPTION_STATUS_OPTIONS[value as SubscriptionStatus];
        if (!opt) return null;
        return type === 'select' ? opt.value : opt.label;
    }
    if (role === 'plan') {
        const name = String(value);
        if (type !== 'select') return name;
        const opts = Array.isArray((config as { options?: unknown } | null)?.options) ? (config as { options: Array<{ value?: string; label?: string }> }).options : [];
        const n = name.trim().toLowerCase();
        return opts.find((o) => (o.label ?? '').trim().toLowerCase() === n || (o.value ?? '').trim().toLowerCase() === n)?.value ?? null;
    }
    if (role === 'next_charge' || role === 'paid_until') {
        const d = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(d.getTime())) return null;
        if (type === 'datetime') return d.toISOString();
        try {
            return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        } catch {
            return d.toISOString().slice(0, 10);
        }
    }
    if (role === 'amount' || role === 'failed') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return String(value);
}

/** Lo que la automatización usa como `{{suscripcion.x}}`. */
export function eventInfo(sub: SubscriptionRowDb, event: SubscriptionEvent, charge: SubscriptionChargeRowDb | null): SubscriptionEventInfo {
    const status = sub.status as SubscriptionStatus;
    return {
        subscription_id: sub.id,
        plan_id: sub.planId,
        evento: event,
        estado: SUBSCRIPTION_STATUS_OPTIONS[status]?.label ?? status,
        plan: sub.planName ?? sub.title,
        monto: Number(sub.amount),
        moneda: sub.currency,
        link: status === 'pending' ? sub.url : null,
        proximo_cobro: sub.nextChargeAt ? sub.nextChargeAt.toISOString() : null,
        pagado_hasta: sub.paidUntil ? sub.paidUntil.toISOString() : null,
        cobros_pagados: sub.chargesPaid,
        cobros_fallidos: sub.chargesFailed,
        motivo: charge?.failureReason ?? (status === 'cancelled' || status === 'finished' ? sub.cancelReason : sub.lastFailureReason),
        monto_cobrado: charge ? Number(charge.amount) : null,
        fecha_cobro: charge ? (charge.paidAt ?? charge.createdAt).toISOString() : null,
        id: sub.externalId,
    };
}

/** El aviso de la campana para los eventos que piden actuar (null = no se avisa). */
function noticeFor(sub: SubscriptionRowDb, event: SubscriptionEvent, charge: SubscriptionChargeRowDb | null): { title: string; body: string } | null {
    const who = `«${sub.title.slice(0, 80)}»`;
    const plan = sub.planName ?? sub.title;
    switch (event) {
        case 'charge_failed':
            return {
                title: `Falló el cobro de la suscripción ${who}`,
                body: `${plan}: ${charge?.failureReason ?? 'el banco rechazó el pago'}. Mercado Pago lo vuelve a intentar.`,
            };
        case 'past_due':
            return { title: `La suscripción ${who} está en mora`, body: `${plan}: se agotaron los reintentos del cobro. Todavía está en los días de gracia.` };
        case 'expired':
            return {
                title: `La suscripción ${who} venció sin pago`,
                body: `${plan}: pasaron los días de gracia. Es el momento de suspender el servicio o llamar al cliente.`,
            };
        case 'cancelled':
            return { title: `Se canceló la suscripción ${who}`, body: `${plan}: ${sub.cancelReason ?? 'cancelada.'}` };
        default:
            return null;
    }
}
