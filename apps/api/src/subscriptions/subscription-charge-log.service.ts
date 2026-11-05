import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    BLUEPRINT_VERSION,
    CHARGE_LOG_LIST_NAME,
    CHARGE_LOG_MARKER_KEY,
    EMPTY_CHARGE_LOG_FIELDS,
    SUBSCRIPTION_CHARGE_LOG_LABELS,
    SUBSCRIPTION_CHARGE_LOG_ROLES,
    SUBSCRIPTION_CHARGE_LOG_TYPES,
    SUBSCRIPTION_CHARGE_STATUS_OPTIONS,
    chargeLogMarkerFor,
    chargeLogTitle,
    chargeLogValue,
    jsonbKeyForField,
    missingChargeStatusOptions,
    readMirrorListMarker,
    readSubscriptionChargeLog,
    relationTargetListId,
    resolveTitleFieldId,
    validateFieldValue,
    type ChargeLogFacts,
    type FieldType,
    type ListBlueprint,
    type SetSubscriptionChargeLogInput,
    type SubscriptionChargeLog,
    type SubscriptionChargeLogFields,
    type SubscriptionChargeLogRole,
    type SubscriptionChargeLogStatus,
    type SubscriptionChargeStatus,
} from '@imagina-base/shared';
import { and, asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import type { CollectionActor } from '../collections/collections.service';
import type { Tx } from '../db/client';
import { lists, subscriptionCharges, subscriptions, tenants } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { f, kpi, list as bpList, ref, select, opt, table, kanban, widget, dashboard as bpDashboard } from '../templates/blueprint-dsl';
import { BlueprintService } from '../templates/blueprint.service';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { parseTenantTimeZone } from '../tenancy/tenant-time-zone.service';

const SYSTEM_ACTOR = { userId: 0, role: 'admin' as const };
/** Cuántos cobros escribe una pasada por suscripción (el resto, en la próxima). */
const PER_PASS = 200;
/** Hasta cuántos cobros pendientes se escriben ANTES de responder al configurar. */
const INLINE_BACKFILL = 300;
const LOCK_TTL_S = 120;

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

interface DestField {
    id: number;
    label: string;
    type: string;
    config: unknown;
}

/** Cómo se crea cada columna cuando la pide la pantalla («Crear columna»). */
function columnSpec(role: SubscriptionChargeLogRole, subscribersListId: number, currency: string): { type: FieldType; config: Record<string, unknown> } {
    switch (role) {
        case 'record':
            return { type: 'relation', config: { target_list_id: subscribersListId } };
        case 'amount':
            return { type: 'currency', config: { currency, precision: currency === 'COP' ? 0 : 2 } };
        case 'status':
            return { type: 'select', config: { options: Object.values(SUBSCRIPTION_CHARGE_STATUS_OPTIONS) } };
        case 'date':
            return { type: 'datetime', config: {} };
        case 'period':
            return { type: 'date', config: {} };
        case 'reason':
            return { type: 'long_text', config: {} };
        default:
            return { type: 'text', config: {} };
    }
}

/**
 * v0.1.371 (ADR-S96) — El REGISTRO DE COBROS: cada cobro de una suscripción
 * (pagado, rechazado, en proceso, reembolsado) queda como un registro en la
 * lista que eligió la empresa, vinculado al registro suscrito.
 *
 * Reglas:
 * - El cobro recuerda en qué lista y en qué registro quedó (`log_list_id`,
 *   `log_record_id`): no se duplica nunca, y si cambia (un reembolso, el medio
 *   de pago que llegó después) se ACTUALIZA ese mismo registro.
 * - La carga de lo que ya existía no dispara «Cuando se crea un registro»
 *   (nadie quiere 300 correos al configurarlo); los cobros nuevos, sí.
 * - Un registro que alguien borró no se vuelve a crear.
 * - Si no se puede escribir (el límite de registros del plan, la lista ya no
 *   existe), se abre un Problema y el cobro queda pendiente para la próxima.
 */
@Injectable()
export class SubscriptionChargeLogService {
    private readonly logger = new Logger(SubscriptionChargeLogService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
        @Optional() private readonly fieldsService?: FieldsService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
        @Optional() private readonly moduleRef?: ModuleRef,
    ) {}

    // Records, plantillas y tableros dependen de este módulo (las automatizaciones
    // usan las suscripciones): se resuelven al usarlos.
    private lazy<T>(token: new (...args: never[]) => T): T {
        const svc = this.moduleRef?.get(token, { strict: false });
        if (!svc) throw new Error(`${token.name} no disponible`);
        return svc;
    }

    private get fields(): FieldsService {
        if (!this.fieldsService) throw new Error('FieldsService no disponible');
        return this.fieldsService;
    }

    // ── Lo que muestra la pantalla ─────────────────────────────────────

    async status(tenantId: number, actor: CollectionActor, listIdOrSlug: string): Promise<SubscriptionChargeLogStatus> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const cfg = readSubscriptionChargeLog(list.settings);
        const warnings: string[] = [];
        const [totals] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    charges: count(),
                    logged: sql<number>`count(*) filter (where ${subscriptionCharges.logListId} = ${cfg?.list_id ?? 0} and ${subscriptionCharges.logRecordId} is not null)`,
                })
                .from(subscriptionCharges)
                .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
                .where(and(eq(subscriptionCharges.tenantId, tenantId), eq(subscriptions.listId, list.id))),
        );
        let config: SubscriptionChargeLogStatus['config'] = null;
        if (cfg) {
            const dest = await this.lists.get(tenantId, String(cfg.list_id)).catch(() => null);
            if (!dest) {
                warnings.push('La lista donde se registraban los cobros ya no existe (o está en la papelera): elige otra.');
            } else {
                const destFields = await this.fields.listByListId(tenantId, dest.id);
                const byId = new Map(destFields.map((x) => [x.id, x]));
                const out: Record<string, { id: number; label: string } | null> = {};
                for (const role of SUBSCRIPTION_CHARGE_LOG_ROLES) {
                    const id = cfg.fields[role];
                    const field = id !== null ? byId.get(id) : undefined;
                    out[role] = field ? { id: field.id, label: field.label } : null;
                    if (id !== null && !field) warnings.push(`La columna de «${SUBSCRIPTION_CHARGE_LOG_LABELS[role]}» ya no existe en «${dest.name}».`);
                }
                config = { list_id: dest.id, list_name: dest.name, list_slug: dest.slug, fields: out, dashboard_id: cfg.dashboard_id };
            }
        }
        return {
            config,
            charges: Number(totals?.charges ?? 0),
            logged: Number(totals?.logged ?? 0),
            can_setup: can(actor, 'manage_fields'),
            ...(warnings.length > 0 ? { warnings } : {}),
        };
    }

    // ── Configurar ──────────────────────────────────────────────────────

    async configure(tenantId: number, actor: CollectionActor, listIdOrSlug: string, input: SetSubscriptionChargeLogInput): Promise<SubscriptionChargeLogStatus> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        if (input.mode === 'off') {
            await this.tenantDb.withTenant(tenantId, async (tx) => {
                await tx
                    .update(lists)
                    .set({ settings: sql`coalesce(${lists.settings}, '{}'::jsonb) - 'subscription_charges'`, updatedAt: new Date() })
                    .where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id)));
                // v0.1.383 — las columnas de la lista de cobros vuelven a ser comunes.
                await writeChargeLogMarker(tx, tenantId, list.id, null);
            });
            await this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'subscriptions.charge_log',
                targetType: 'list',
                targetId: list.id,
                targetLabel: list.name,
                meta: { mode: 'off' },
            });
            this.incidents?.resolve(tenantId, incidentKey(list.id));
            return this.status(tenantId, actor, String(list.id));
        }

        let cfg: SubscriptionChargeLog;
        if (input.mode === 'create') {
            if (!can(actor, 'manage_lists')) {
                throw new ForbiddenException({ code: 'forbidden', message: 'Crear la lista de cobros lo hace quien puede crear listas.', data: { status: 403 } });
            }
            cfg = await this.createList(tenantId, actor, list, input.dashboard !== false);
        } else {
            cfg = await this.useExisting(tenantId, list, input.list_id, input.fields);
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{subscription_charges}', ${JSON.stringify(cfg)}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id)));
            // v0.1.383 — la lista destino sabe qué columnas escribe el registro de
            // cobros: quedan protegidas (no se editan a mano).
            await writeChargeLogMarker(tx, tenantId, list.id, cfg);
        });
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscriptions.charge_log',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { mode: input.mode, list_id: cfg.list_id, fields: cfg.fields },
        });
        // Lo que ya existía queda escrito (sin disparar automatizaciones). Si
        // es mucho, sigue en segundo plano y la pantalla cuenta cómo avanza.
        const pending = await this.pendingForList(tenantId, list.id, cfg.list_id);
        const run = this.backfillList(tenantId, list.id);
        if (pending <= INLINE_BACKFILL) await run;
        else void run.catch((err) => this.logger.warn(`Registro de cobros (carga) falló: ${String(err)}`));
        return this.status(tenantId, actor, String(list.id));
    }

    /** Arma «Cobros de suscripciones» (con el vínculo a la lista y, si se pide, su tablero). */
    private async createList(
        tenantId: number,
        actor: CollectionActor,
        subscribers: { id: number; name: string; group_id?: number | null },
        withDashboard: boolean,
    ): Promise<SubscriptionChargeLog> {
        const currency = await this.subscriptionsCurrency(tenantId, subscribers.id);
        const money = { currency, precision: currency === 'COP' ? 0 : 2 };
        const statusOpts = Object.values(SUBSCRIPTION_CHARGE_STATUS_OPTIONS).map((o) => opt(o.value, o.label, o.color));
        const paid = {
            type: 'group',
            logic: 'and',
            children: [{ type: 'condition', field_id: ref('estado'), op: 'eq', value: SUBSCRIPTION_CHARGE_STATUS_OPTIONS.approved.value }],
        };
        const rejected = {
            type: 'group',
            logic: 'and',
            children: [{ type: 'condition', field_id: ref('estado'), op: 'eq', value: SUBSCRIPTION_CHARGE_STATUS_OPTIONS.rejected.value }],
        };
        const thisMonth = { field_id: ref('fecha'), preset: 'this_month' };
        const blueprint: ListBlueprint = {
            version: BLUEPRINT_VERSION,
            lists: [
                bpList(
                    'cobros',
                    CHARGE_LOG_LIST_NAME,
                    'receipt',
                    '#14B8A6',
                    [
                        f('Cobro', 'cobro', 'text', { description: 'El plan y la cuota que cubre.' }),
                        f(subscribers.name.slice(0, 120) || 'Suscriptor', 'suscriptor', 'relation', {
                            config: { target_list_id: subscribers.id },
                            description: 'El registro suscrito.',
                        }),
                        f('Valor', 'valor', 'currency', { config: money }),
                        select('Estado', 'estado', statusOpts),
                        f('Fecha', 'fecha', 'datetime', { description: 'Cuándo se pagó o se intentó.' }),
                        f('Período', 'periodo', 'date', { description: 'La cuota que cubre (la fecha en que tocaba cobrar).' }),
                        f('Plan', 'plan', 'text'),
                        f('Medio de pago', 'medio', 'text'),
                        f('Motivo del rechazo', 'motivo', 'long_text'),
                        f('Id del pago', 'id_pago', 'text', { description: 'El número del pago en Mercado Pago o PayPal.' }),
                    ],
                    {
                        settings: { title_field_id: ref('cobro') },
                        views: [
                            table('Todos', true, { sort: [{ field_id: ref('fecha'), dir: 'desc' }] }),
                            kanban('Por estado', 'estado'),
                            table('Rechazados', false, {
                                filter_tree: rejected,
                                filters: [{ field_id: ref('estado'), op: 'eq', value: SUBSCRIPTION_CHARGE_STATUS_OPTIONS.rejected.value }],
                                sort: [{ field_id: ref('fecha'), dir: 'desc' }],
                            }),
                        ],
                    },
                ),
            ],
            dashboards: withDashboard
                ? [
                      bpDashboard(`Suscripciones · ${subscribers.name}`.slice(0, 190), 'Lo cobrado y lo rechazado de las suscripciones, mes a mes.', [
                          kpi('cobros', 'Cobrado este mes', { metric: 'sum', metric_field_id: ref('valor'), prefix: '$', icon: 'wallet', filter_tree: paid, period: thisMonth }, 0),
                          kpi('cobros', 'Cobros pagados este mes', { icon: 'receipt', filter_tree: paid, period: thisMonth }, 3),
                          kpi('cobros', 'Rechazados este mes', { icon: 'flag', filter_tree: rejected, period: thisMonth }, 6),
                          kpi('cobros', 'Cobrado en total', { metric: 'sum', metric_field_id: ref('valor'), prefix: '$', icon: 'dollar', filter_tree: paid }, 9),
                          widget(
                              'chart_bar',
                              'cobros',
                              'Por mes y estado',
                              {
                                  metric: 'sum',
                                  metric_field_id: ref('valor'),
                                  group_by_field_id: ref('fecha'),
                                  date_field_id: ref('fecha'),
                                  time_bucket: 'month',
                                  sub_group_by_field_id: ref('estado'),
                                  stack_mode: 'stacked',
                                  bar_orientation: 'vertical',
                              },
                              0,
                              2,
                              8,
                              5,
                          ),
                          widget('chart_pie', 'cobros', 'Cobros por estado', { metric: 'count', group_by_field_id: ref('estado'), center_label: 'Cobros' }, 8, 2, 4, 5),
                          widget(
                              'chart_bar',
                              'cobros',
                              'Cobrado por plan',
                              { metric: 'sum', metric_field_id: ref('valor'), group_by_field_id: ref('plan'), filter_tree: paid, hide_zero_groups: true },
                              0,
                              7,
                              6,
                              4,
                          ),
                          widget(
                              'table',
                              'cobros',
                              'Últimos rechazos',
                              {
                                  limit: 10,
                                  sort_field_id: ref('fecha'),
                                  sort_dir: 'desc',
                                  filter_tree: rejected,
                                  visible_field_ids: [ref('cobro'), ref('suscriptor'), ref('valor'), ref('motivo')],
                              },
                              6,
                              7,
                              6,
                              4,
                          ),
                      ]),
                  ]
                : [],
        };
        const res = await this.lazy(BlueprintService).materialize(tenantId, actor.userId, blueprint, {
            groupId: subscribers.group_id ?? null,
            includeRecords: false,
        });
        const created = res.lists[0];
        const ids = res.fieldIds.cobros ?? {};
        if (!created) badRequest('charge_log_failed', 'No se pudo crear la lista de cobros.');
        const pick = (slug: string): number | null => ids[slug] ?? null;
        return {
            list_id: created!.id,
            fields: {
                record: pick('suscriptor'),
                amount: pick('valor'),
                status: pick('estado'),
                date: pick('fecha'),
                period: pick('periodo'),
                plan: pick('plan'),
                method: pick('medio'),
                reason: pick('motivo'),
                payment_id: pick('id_pago'),
            },
            dashboard_id: res.dashboardIds[0] ?? null,
        };
    }

    /** Una lista que ya existe: valida cada columna (o la crea) y le suma las opciones que falten. */
    private async useExisting(
        tenantId: number,
        subscribers: { id: number; name: string },
        destId: number,
        choices: Partial<Record<SubscriptionChargeLogRole, number | 'create' | null | undefined>>,
    ): Promise<SubscriptionChargeLog> {
        if (destId === subscribers.id) badRequest('invalid_charge_log', 'Los cobros van a OTRA lista (no a la de los suscriptores).');
        const dest = await this.lists.get(tenantId, String(destId)).catch(() => null);
        if (!dest) badRequest('invalid_charge_log', 'Esa lista no existe.');
        if (readMirrorListMarker(dest!.settings)) badRequest('invalid_charge_log', `«${dest!.name}» la manda una tienda o un sitio: elige otra lista.`);
        const current = (await this.fields.listByListId(tenantId, dest!.id)) as DestField[];
        const byId = new Map(current.map((x) => [x.id, x]));
        const mapping: SubscriptionChargeLogFields = { ...EMPTY_CHARGE_LOG_FIELDS };
        const used = new Map<number, SubscriptionChargeLogRole>();
        for (const role of SUBSCRIPTION_CHARGE_LOG_ROLES) {
            const choice = choices[role];
            if (typeof choice !== 'number') continue;
            const field = byId.get(choice);
            if (!field) badRequest('invalid_charge_log', `«${SUBSCRIPTION_CHARGE_LOG_LABELS[role]}»: esa columna no es de «${dest!.name}».`);
            if (!SUBSCRIPTION_CHARGE_LOG_TYPES[role].includes(field!.type)) {
                badRequest('invalid_charge_log', `«${SUBSCRIPTION_CHARGE_LOG_LABELS[role]}» no se puede guardar en «${field!.label}»: esa columna es de otro tipo.`);
            }
            if (role === 'record' && relationTargetListId(field!.config) !== subscribers.id) {
                badRequest('invalid_charge_log', `«${field!.label}» no vincula con «${subscribers.name}»: el suscriptor tiene que ser un vínculo a esa lista.`);
            }
            const other = used.get(choice);
            if (other)
                badRequest(
                    'invalid_charge_log',
                    `«${field!.label}» no puede guardar a la vez «${SUBSCRIPTION_CHARGE_LOG_LABELS[other]}» y «${SUBSCRIPTION_CHARGE_LOG_LABELS[role]}».`,
                );
            used.set(choice, role);
        }
        if (!SUBSCRIPTION_CHARGE_LOG_ROLES.some((r) => choices[r] !== null && choices[r] !== undefined)) {
            badRequest('invalid_charge_log', 'Elige al menos una columna donde guardar los cobros.');
        }
        const currency = await this.subscriptionsCurrency(tenantId, subscribers.id);
        for (const role of SUBSCRIPTION_CHARGE_LOG_ROLES) {
            const choice = choices[role];
            if (choice === undefined || choice === null) continue;
            if (choice === 'create') {
                const spec = columnSpec(role, subscribers.id, currency);
                const created = await this.fields.create(tenantId, String(dest!.id), {
                    label: role === 'record' ? subscribers.name.slice(0, 120) || SUBSCRIPTION_CHARGE_LOG_LABELS[role] : SUBSCRIPTION_CHARGE_LOG_LABELS[role],
                    type: spec.type,
                    config: spec.config,
                });
                mapping[role] = created.id;
                continue;
            }
            mapping[role] = choice;
            const field = byId.get(choice)!;
            if (role === 'status' && field.type === 'select') {
                const missing = missingChargeStatusOptions(field.config);
                if (missing.length > 0) {
                    const opts = Array.isArray((field.config as { options?: unknown })?.options) ? ((field.config as { options: unknown[] }).options as unknown[]) : [];
                    await this.fields.update(tenantId, String(dest!.id), String(field.id), {
                        config: { ...(field.config as Record<string, unknown>), options: [...opts, ...missing] },
                    });
                }
            }
        }
        return { list_id: dest!.id, fields: mapping, dashboard_id: null };
    }

    // ── Escribir ────────────────────────────────────────────────────────

    /** Todas las suscripciones de una lista (al configurar): sin automatizaciones. */
    async backfillList(tenantId: number, listId: number): Promise<number> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: subscriptions.id })
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.listId, listId)))
                .orderBy(asc(subscriptions.createdAt))
                .limit(5000),
        );
        let written = 0;
        for (const r of rows) {
            written += await this.syncSubscription(tenantId, r.id, { automations: false });
        }
        return written;
    }

    /**
     * Escribe en el registro de cobros lo que falta de una suscripción: los
     * cobros nuevos (un registro cada uno) y los que cambiaron (se actualiza el
     * mismo registro). Devuelve cuántos registros escribió.
     */
    async syncSubscription(tenantId: number, subscriptionId: number, opts: { automations: boolean }): Promise<number> {
        const lockKey = `subchglog:${tenantId}:${subscriptionId}`;
        if (this.redis) {
            const got = await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_S, 'NX').catch(() => 'OK');
            if (got !== 'OK') {
                // Otra pasada ya escribe esta suscripción: lo que quede pendiente lo toma la próxima.
                if (opts.automations) setTimeout(() => void this.syncSubscription(tenantId, subscriptionId, opts).catch(() => undefined), 5000).unref();
                return 0;
            }
        }
        try {
            return await this.syncLocked(tenantId, subscriptionId, opts);
        } finally {
            if (this.redis) await this.redis.del(lockKey).catch(() => undefined);
        }
    }

    private async syncLocked(tenantId: number, subscriptionId: number, opts: { automations: boolean }): Promise<number> {
        const [sub] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, subscriptionId)))
                .limit(1),
        );
        if (!sub || sub.listId === null) return 0;
        const subscribers = await this.lists.get(tenantId, String(sub.listId)).catch(() => null);
        if (!subscribers) return 0;
        const cfg = readSubscriptionChargeLog(subscribers.settings);
        if (!cfg) return 0;
        const dest = await this.lists.get(tenantId, String(cfg.list_id)).catch(() => null);
        if (!dest) return 0;
        const readOnly = await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId));
        if (readOnly) return 0;

        const charges = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(subscriptionCharges)
                .where(
                    and(
                        eq(subscriptionCharges.tenantId, tenantId),
                        eq(subscriptionCharges.subscriptionId, sub.id),
                        sql`(${subscriptionCharges.logListId} is distinct from ${cfg.list_id} or ${subscriptionCharges.loggedAt} is null or ${subscriptionCharges.updatedAt} > ${subscriptionCharges.loggedAt})`,
                    ),
                )
                .orderBy(asc(subscriptionCharges.createdAt), asc(subscriptionCharges.id))
                .limit(PER_PASS),
        );
        if (charges.length === 0) return 0;

        const destFields = (await this.fields.listByListId(tenantId, dest.id)) as DestField[];
        const byId = new Map(destFields.map((x) => [x.id, x]));
        const live: Array<{ role: SubscriptionChargeLogRole; field: DestField }> = [];
        for (const role of SUBSCRIPTION_CHARGE_LOG_ROLES) {
            const id = cfg.fields[role];
            const field = id !== null ? byId.get(id) : undefined;
            if (field && SUBSCRIPTION_CHARGE_LOG_TYPES[role].includes(field.type)) live.push({ role, field });
        }
        const titleId = resolveTitleFieldId(destFields as never, dest.settings);
        const titleField = titleId !== null && !live.some((l) => l.field.id === titleId) ? byId.get(titleId) : undefined;
        const timeZone = await this.timeZone(tenantId);
        // El suscriptor puede estar en la papelera: sin él, el cobro igual queda (sin el vínculo).
        const subscriberAlive =
            sub.recordId !== null && (await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, sub.listId!, sub.recordId!))) !== null;

        let written = 0;
        for (const c of charges) {
            const facts: ChargeLogFacts = {
                recordId: subscriberAlive ? sub.recordId : null,
                amount: Number(c.amount),
                status: c.status as SubscriptionChargeStatus,
                date: (c.paidAt ?? c.createdAt).toISOString(),
                period: c.periodStart ? c.periodStart.toISOString() : null,
                plan: sub.planName ?? sub.title,
                method: c.method,
                reason: c.failureReason,
                paymentId: c.providerPaymentId,
            };
            const data: Record<string, unknown> = {};
            for (const { role, field } of live) {
                const raw = chargeLogValue(role, facts, field.type, field.config, timeZone);
                if (raw === null || raw === undefined) continue;
                // El vínculo no vive en `data`: el alta lo separa y lo valida contra la otra lista.
                if (field.type === 'relation') {
                    data[jsonbKeyForField(field.id)] = raw;
                    continue;
                }
                const v = validateFieldValue({ type: field.type as FieldType, config: (field.config ?? {}) as Record<string, unknown>, is_required: false }, raw);
                if (v.ok) data[jsonbKeyForField(field.id)] = v.value;
            }
            if (titleField && (titleField.type === 'text' || titleField.type === 'long_text')) {
                data[jsonbKeyForField(titleField.id)] = chargeLogTitle(facts, timeZone);
            }

            if (c.logListId === dest.id && c.logRecordId !== null) {
                // Ya quedó: se actualiza ESE registro (salvo el vínculo, que no se toca).
                const recordKey = cfg.fields.record !== null ? jsonbKeyForField(cfg.fields.record) : null;
                const titleKey = titleField ? jsonbKeyForField(titleField.id) : null;
                const changed = await this.tenantDb.withTenant(tenantId, async (tx) => {
                    const rec = await this.recordsRepo.findByIdForUpdate(tx, tenantId, dest.id, c.logRecordId!);
                    if (rec) {
                        const before = rec.data as Record<string, unknown>;
                        const after = { ...before };
                        for (const [k, v] of Object.entries(data)) {
                            if (k === recordKey || k === titleKey) continue;
                            after[k] = v;
                        }
                        if (JSON.stringify(before) !== JSON.stringify(after)) {
                            await this.recordsRepo.updateData(tx, tenantId, dest.id, rec.id, after, 0);
                            await this.activity.logInTx(tx, {
                                tenantId,
                                listId: dest.id,
                                recordId: rec.id,
                                userId: null,
                                action: 'record_updated',
                                diff: computeDiff(before, after),
                            });
                        }
                        await tx
                            .update(subscriptionCharges)
                            .set({ loggedAt: sql`now()` })
                            .where(eq(subscriptionCharges.id, c.id));
                        return JSON.stringify(before) !== JSON.stringify(after);
                    }
                    // Alguien lo borró: no se vuelve a crear.
                    await tx
                        .update(subscriptionCharges)
                        .set({ loggedAt: sql`now()` })
                        .where(eq(subscriptionCharges.id, c.id));
                    return false;
                });
                if (changed) written++;
                continue;
            }

            try {
                const created = await this.lazy(RecordsService).create(
                    tenantId,
                    SYSTEM_ACTOR,
                    String(dest.id),
                    { data },
                    // `sync`: es la dueña de esas columnas (para el resto están protegidas).
                    { lenientRequired: true, silent: true, noAutomations: !opts.automations, sync: true },
                );
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .update(subscriptionCharges)
                        .set({ logListId: dest.id, logRecordId: created.id, loggedAt: sql`now()` })
                        .where(eq(subscriptionCharges.id, c.id)),
                );
                written++;
            } catch (err) {
                const code = (err as { response?: { code?: string } }).response?.code;
                this.incidents?.report({
                    tenantId,
                    key: incidentKey(subscribers.id),
                    source: 'collections',
                    listId: dest.id,
                    title: `Los cobros de las suscripciones no se están registrando en «${dest.name}»`,
                    message:
                        code === 'plan_limit_reached'
                            ? 'La empresa llegó al límite de registros de su plan: los cobros siguen guardados en la suscripción y se escriben en la lista apenas haya lugar.'
                            : `No se pudo crear el registro del cobro: ${errorText(err)}`,
                });
                break;
            }
        }
        if (written > 0) {
            this.incidents?.resolve(tenantId, incidentKey(subscribers.id));
            this.realtime.records(tenantId, dest.id);
        }
        return written;
    }

    // ── Auxiliares ──────────────────────────────────────────────────────

    private async pendingForList(tenantId: number, subscribersListId: number, destListId: number): Promise<number> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ n: count() })
                .from(subscriptionCharges)
                .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
                .where(
                    and(
                        eq(subscriptionCharges.tenantId, tenantId),
                        eq(subscriptions.listId, subscribersListId),
                        sql`(${subscriptionCharges.logListId} is distinct from ${destListId} or ${subscriptionCharges.loggedAt} is null)`,
                    ),
                ),
        );
        return Number(row?.n ?? 0);
    }

    /** La moneda más usada en las suscripciones de la lista (COP si no hay). */
    private async subscriptionsCurrency(tenantId: number, listId: number): Promise<string> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ currency: subscriptions.currency, n: count() })
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.listId, listId), isNotNull(subscriptions.currency)))
                .groupBy(subscriptions.currency)
                .orderBy(sql`count(*) desc`)
                .limit(1),
        );
        return (row?.currency ?? 'COP').toUpperCase();
    }

    private async timeZone(tenantId: number): Promise<string> {
        const [t] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));
        return parseTenantTimeZone(t?.settings) ?? 'UTC';
    }
}

function incidentKey(subscribersListId: number): string {
    return `subscription-charge-log:${subscribersListId}`;
}

/**
 * v0.1.383 — La marca en la lista DESTINO del registro de cobros (sus columnas
 * quedan protegidas): se saca de donde estaba y, si hay configuración, se pone
 * en la nueva. La configuración vive en la lista de suscriptores; la marca es
 * lo que permite proteger las columnas sin mirar otras listas.
 */
async function writeChargeLogMarker(tx: Tx, tenantId: number, sourceListId: number, cfg: SubscriptionChargeLog | null): Promise<void> {
    await tx
        .update(lists)
        .set({ settings: sql`${lists.settings} - ${CHARGE_LOG_MARKER_KEY}::text` })
        .where(and(eq(lists.tenantId, tenantId), sql`${lists.settings} -> ${CHARGE_LOG_MARKER_KEY}::text ->> 'list_id' = ${String(sourceListId)}`));
    if (!cfg) return;
    const marker = chargeLogMarkerFor(sourceListId, cfg.fields);
    if (!marker) return;
    await tx
        .update(lists)
        .set({ settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), ${`{${CHARGE_LOG_MARKER_KEY}}`}::text[], ${JSON.stringify(marker)}::jsonb)` })
        .where(and(eq(lists.tenantId, tenantId), eq(lists.id, cfg.list_id)));
}
