import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    BLUEPRINT_VERSION,
    DEFAULT_IMPORT_LIST_NAME,
    IDLE_SUBSCRIPTION_IMPORT,
    MP_PREAPPROVAL_STATUSES,
    SUBSCRIPTION_FIELD_ROLES,
    SUBSCRIPTION_STATUS_OPTIONS,
    addSubscriptionPeriod,
    decideImport,
    isProvisionalSubscriberTitle,
    jsonbKeyForField,
    normalizeImportEmail,
    readMirrorListMarker,
    readSubscriptionChargeLog,
    readSubscriptionImportConfig,
    resolveTitleFieldId,
    subscriberTitle,
    type FieldType,
    type ListBlueprint,
    type MpPreapprovalStatus,
    type SubscriptionFields,
    type SubscriptionImportAction,
    type SubscriptionImportConfig,
    type SubscriptionImportInput,
    type SubscriptionImportPlan,
    type SubscriptionImportPreview,
    type SubscriptionImportSample,
    type SubscriptionImportStatus,
} from '@imagina-base/shared';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { planModuleOff } from '../billing/plan-module-gate';
import type { CollectionActor } from '../collections/collections.service';
import { gatewayBases } from '../collections/gateway-bases';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';
import { DRIZZLE, type Db } from '../db/client';
import { connections, lists, records, subscriptionPlans, subscriptions } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { f, list as bpList, opt, ref, select, table, kanban } from '../templates/blueprint-dsl';
import { BlueprintService } from '../templates/blueprint.service';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SubscriptionChargeLogService } from './subscription-charge-log.service';
import {
    invoicesSearchRequest,
    parseInvoices,
    parsePreapprovalPlans,
    parseImportedPreapproval,
    parsePreapprovalSearch,
    paymentPayer,
    preapprovalPlanSearchRequest,
    preapprovalRequest,
    preapprovalSearchRequest,
    type ImportedPlan,
    type ImportedPreapproval,
} from './subscription-gateway';
import { SubscriptionsService } from './subscriptions.service';

const FETCH_TIMEOUT_MS = 15_000;
/** Cuántas suscripciones se leen de Mercado Pago como mucho (50 páginas de 100). */
const MAX_SCAN = 5_000;
/** Cuántas se importan a la vez (cada una lee su suscripción y sus cuotas). */
const CONCURRENCY = 3;
/** Cuántas veces se busca el correo en el último pago (cuando la suscripción no lo trae). */
const EMAIL_LOOKUPS = 400;
const SCAN_EVERY_MS = 30 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const TICK_LOCK = 'subimport:tick';
const STATUS_TTL_S = 30 * 24 * 60 * 60;
const LOCK_TTL_S = 15 * 60;
/** Una revisión periódica trae como mucho estas (el resto, en la próxima). */
const SCAN_IMPORT_CAP = 100;
const SYSTEM_ACTOR = { userId: 0, role: 'admin' as const };

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

function statusKey(tenantId: number, connectionId: number): string {
    return `subimport:${tenantId}:${connectionId}`;
}

function lockKey(connectionId: number): string {
    return `subimport:lock:${connectionId}`;
}

/** Lo que hace falta para decidir con una lista existente (match). */
interface MatchIndex {
    list: { id: number; slug: string; name: string };
    emailFieldId: number;
    byEmail: Map<string, { id: number; title: string }>;
    withLive: Set<number>;
}

interface RunCounters {
    imported: number;
    linked: number;
    records_created: number;
    without_record: number;
    failed: number;
}

/**
 * v0.1.376 (ADR-S96, addendum) — Importar las suscripciones y los planes que
 * la empresa YA tiene en su cuenta de Mercado Pago.
 *
 * Reglas:
 * - Nunca se duplica: lo que ya está en la app (por el id de Mercado Pago) se
 *   salta, y el índice único `(tenant, provider, external_id)` frena a dos
 *   importaciones a la vez (la del aviso y la de la revisión periódica). Por
 *   eso la suscripción se guarda ANTES de crear su registro.
 * - Lo que trae esta app (`external_reference` `ibs_…`) no se importa: si no
 *   está en la base es un intento que se deshizo o de otra instalación.
 * - La importación de lo que ya existía no dispara automatizaciones ni avisos
 *   (`sync(..., { quiet })` y el alta de registros con `noAutomations`); lo que
 *   llega solo después, sí (es nuevo de verdad).
 * - El estado se calcula igual que el de las suscripciones de la app: se
 *   relee la suscripción y sus cuotas con la credencial de la empresa.
 */
@Injectable()
export class SubscriptionImportService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SubscriptionImportService.name);
    private tickTimer: NodeJS.Timeout | null = null;
    /** Sin Redis (los tests): el estado y el candado viven en memoria. */
    private readonly memStatus = new Map<string, SubscriptionImportStatus>();
    private readonly memLocks = new Set<number>();
    private readonly running = new Map<string, Promise<void>>();

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly connectors: ConnectorsService,
        private readonly lists: ListsService,
        private readonly subs: SubscriptionsService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly fieldsService?: FieldsService,
        @Optional() private readonly chargeLog?: SubscriptionChargeLogService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
        @Optional() private readonly moduleRef?: ModuleRef,
    ) {}

    onModuleInit(): void {
        this.subs.registerImportSink((tenantId, connectionId, preapprovalId) => this.importByExternalId(tenantId, connectionId, preapprovalId));
        if (this.env.NODE_ENV === 'test') return;
        this.tickTimer = setInterval(() => {
            this.scanAll().catch((err) => this.logger.warn(`Revisión de suscripciones nuevas falló: ${String(err)}`));
        }, TICK_MS);
        this.tickTimer.unref();
    }

    onApplicationShutdown(): void {
        if (this.tickTimer) clearInterval(this.tickTimer);
    }

    private lazy<T>(token: new (...args: never[]) => T): T {
        const svc = this.moduleRef?.get(token, { strict: false });
        if (!svc) throw new Error(`${token.name} no disponible`);
        return svc;
    }

    private get fields(): FieldsService {
        if (!this.fieldsService) throw new Error('FieldsService no disponible');
        return this.fieldsService;
    }

    private get bases() {
        return gatewayBases(this.env);
    }

    // ── Permisos y conexión ─────────────────────────────────────────────

    private async mpConnection(tenantId: number, actor: CollectionActor, connectionId: number): Promise<{ id: number; name: string; creds: IntegrationCreds }> {
        const conn = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (conn.provider !== 'mercadopago') {
            badRequest('not_mercadopago', 'Importar suscripciones es para las conexiones de Mercado Pago (PayPal no deja listar las suscripciones de una cuenta).');
        }
        const full = await this.connectors.integrationCredsFor(tenantId, connectionId);
        if (!full) badRequest('connection_not_found', 'La conexión ya no existe.');
        return { id: conn.id, name: conn.name, creds: full!.creds };
    }

    private assertCanImport(actor: CollectionActor): void {
        if (!can(actor, 'manage_lists')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Importar suscripciones lo hace quien puede crear listas.', data: { status: 403 } });
        }
    }

    // ── Leer Mercado Pago ───────────────────────────────────────────────

    private async fetch(req: IntegrationRequest): Promise<{ status: number; body: string }> {
        const res = await safeWebhookFetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
            captureBody: true,
            maxCaptureBytes: 4_000_000,
            timeoutMs: FETCH_TIMEOUT_MS,
        });
        return { status: res.status, body: res.body ?? '' };
    }

    /** Todas las suscripciones de la cuenta (hasta 5.000). */
    private async scanPreapprovals(creds: IntegrationCreds, max = MAX_SCAN): Promise<{ items: ImportedPreapproval[]; truncated: boolean }> {
        const items: ImportedPreapproval[] = [];
        const seen = new Set<string>();
        let offset = 0;
        let total = Infinity;
        while (offset < total && items.length < max) {
            const res = await this.fetch(preapprovalSearchRequest(creds, offset, this.bases));
            if (res.status === 401 || res.status === 403) {
                badRequest('mp_unauthorized', 'Mercado Pago rechazó el Access Token: vuelve a conectar la cuenta en Integraciones.');
            }
            const page = parsePreapprovalSearch(res.status, res.body, creds);
            if (!page) badRequest('mp_unreadable', `Mercado Pago no devolvió las suscripciones (respondió ${res.status}).`);
            total = page!.total;
            for (const it of page!.items) {
                if (seen.has(it.externalId)) continue;
                seen.add(it.externalId);
                items.push(it);
            }
            if (page!.items.length === 0) break;
            offset += page!.items.length;
        }
        return { items: items.slice(0, max), truncated: total > max };
    }

    private async scanPlans(creds: IntegrationCreds): Promise<ImportedPlan[]> {
        const out: ImportedPlan[] = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total && out.length < 500) {
            const res = await this.fetch(preapprovalPlanSearchRequest(creds, offset, this.bases));
            const page = parsePreapprovalPlans(res.status, res.body);
            // Sin planes (o la búsqueda no está habilitada en la cuenta): se sigue sin ellos.
            if (!page) break;
            total = page.total;
            out.push(...page.items);
            if (page.items.length === 0) break;
            offset += page.items.length;
        }
        return out;
    }

    /** Los ids de Mercado Pago que ya están en la app. */
    private async knownIds(tenantId: number, externalIds: readonly string[]): Promise<Set<string>> {
        const out = new Set<string>();
        for (let i = 0; i < externalIds.length; i += 500) {
            const chunk = externalIds.slice(i, i + 500);
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ id: subscriptions.externalId })
                    .from(subscriptions)
                    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.provider, 'mercadopago'), inArray(subscriptions.externalId, chunk))),
            );
            for (const r of rows) if (r.id) out.add(r.id);
        }
        return out;
    }

    private async knownPlans(tenantId: number, connectionId: number): Promise<Map<string, number>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: subscriptionPlans.id, ref: sql<string | null>`${subscriptionPlans.providerRefs}->>'mp_plan_id'` })
                .from(subscriptionPlans)
                .where(and(eq(subscriptionPlans.tenantId, tenantId), eq(subscriptionPlans.connectionId, connectionId), eq(subscriptionPlans.provider, 'mercadopago'))),
        );
        const out = new Map<string, number>();
        for (const r of rows) if (r.ref) out.set(r.ref, r.id);
        return out;
    }

    /** La lista existente y el índice correo → registro (y quién ya tiene una viva). */
    private async matchIndex(tenantId: number, listId: number, emailFieldId: number): Promise<MatchIndex> {
        const list = await this.lists.get(tenantId, String(listId)).catch(() => null);
        if (!list) badRequest('invalid_import', 'Esa lista no existe.');
        if (readMirrorListMarker(list!.settings)) badRequest('invalid_import', `«${list!.name}» la manda una tienda o un sitio: elige otra lista.`);
        const listFields = await this.fields.listByListId(tenantId, list!.id);
        const email = listFields.find((x) => x.id === emailFieldId);
        if (!email) badRequest('invalid_import', 'Esa columna no es de la lista.');
        if (!['email', 'text'].includes(email!.type)) badRequest('invalid_import', `«${email!.label}» no es una columna de correo.`);
        const titleId = resolveTitleFieldId(listFields.map((x) => ({ id: x.id, type: x.type as FieldType })), list!.settings ?? {});
        const ekey = jsonbKeyForField(email!.id);
        const tkey = titleId ? jsonbKeyForField(titleId) : null;
        const { rows, live } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const recs = await tx
                .select({
                    id: records.id,
                    email: sql<string | null>`${records.data}->>${ekey}`,
                    title: tkey ? sql<string | null>`${records.data}->>${tkey}` : sql<string | null>`null`,
                })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list!.id), isNull(records.deletedAt), sql`${records.data} ? ${ekey}`));
            const liveRows = await tx
                .select({ recordId: subscriptions.recordId })
                .from(subscriptions)
                .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.listId, list!.id), notInArray(subscriptions.status, ['cancelled', 'finished'])));
            return { rows: recs, live: liveRows };
        });
        const byEmail = new Map<string, { id: number; title: string }>();
        for (const r of rows) {
            const e = normalizeImportEmail(r.email);
            if (!e || byEmail.has(e)) continue;
            byEmail.set(e, { id: r.id, title: (r.title && r.title.trim()) || e });
        }
        return {
            list: { id: list!.id, slug: list!.slug, name: list!.name },
            emailFieldId: email!.id,
            byEmail,
            withLive: new Set(live.map((r) => r.recordId).filter((id): id is number => id !== null)),
        };
    }

    // ── Vista previa ────────────────────────────────────────────────────

    async preview(tenantId: number, actor: CollectionActor, connectionId: number, input: SubscriptionImportInput): Promise<SubscriptionImportPreview> {
        this.assertCanImport(actor);
        const conn = await this.mpConnection(tenantId, actor, connectionId);
        const [{ items, truncated }, plans] = await Promise.all([this.scanPreapprovals(conn.creds), this.scanPlans(conn.creds)]);
        const known = await this.knownIds(tenantId, items.map((i) => i.externalId));
        const knownPlans = await this.knownPlans(tenantId, connectionId);
        const match = input.mode === 'match' ? await this.matchIndex(tenantId, input.list_id!, input.email_field_id!) : null;

        const byStatus = Object.fromEntries(MP_PREAPPROVAL_STATUSES.map((s) => [s, 0])) as Record<MpPreapprovalStatus, number>;
        const claimed = new Set<number>();
        const counts = { known: 0, toImport: 0, skippedCancelled: 0, skippedPending: 0, withoutEmail: 0, matched: 0, unmatched: 0, conflicts: 0 };
        const sample: SubscriptionImportSample[] = [];
        const planNames = new Map(plans.map((p) => [p.externalId, p.name]));
        const currencies = new Set<string>();
        for (const it of items) {
            byStatus[it.mpStatus] += 1;
            const hit = match && it.payerEmail ? match.byEmail.get(it.payerEmail) : undefined;
            const decision = decideImport({
                known: known.has(it.externalId),
                status: it.mpStatus,
                includeCancelled: input.include_cancelled,
                includePending: input.include_pending,
                ours: (it.externalReference ?? '').startsWith('ibs_'),
                mode: input.mode,
                email: it.payerEmail,
                match: hit ? { recordId: hit.id, hasLive: match!.withLive.has(hit.id) || claimed.has(hit.id) } : null,
                createMissing: input.create_missing,
            });
            if (decision.action === 'known') counts.known += 1;
            else if (decision.action === 'skip') {
                if (it.mpStatus === 'cancelled') counts.skippedCancelled += 1;
                else if (it.mpStatus === 'pending') counts.skippedPending += 1;
            } else {
                counts.toImport += 1;
                if (!it.payerEmail && !it.payerName) counts.withoutEmail += 1;
                if (it.currency) currencies.add(it.currency);
                if (match) {
                    if (decision.action === 'link') {
                        counts.matched += 1;
                        claimed.add(hit!.id);
                    } else if (hit) counts.conflicts += 1;
                    else counts.unmatched += 1;
                }
            }
            if (sample.length < 25 && decision.action !== 'known' && !(decision.action === 'skip' && (it.mpStatus === 'cancelled' || it.mpStatus === 'pending'))) {
                sample.push(this.sampleOf(it, decision, hit?.title ?? null, planNames));
            }
        }
        const subscribersByPlan = new Map<string, number>();
        for (const it of items) if (it.planExternalId) subscribersByPlan.set(it.planExternalId, (subscribersByPlan.get(it.planExternalId) ?? 0) + 1);
        const planRows: SubscriptionImportPlan[] = plans.map((p) => ({
            external_id: p.externalId,
            name: p.name,
            amount: p.amount,
            currency: p.currency,
            frequency: p.frequency,
            frequency_type: p.frequencyType,
            cycles: p.cycles,
            trial_days: p.trialDays,
            active: p.active,
            subscribers: subscribersByPlan.get(p.externalId) ?? 0,
            known: knownPlans.has(p.externalId),
        }));
        return {
            total: items.length,
            by_status: byStatus,
            known: counts.known,
            to_import: counts.toImport,
            skipped_cancelled: counts.skippedCancelled,
            skipped_pending: counts.skippedPending,
            without_email: counts.withoutEmail,
            plans: planRows,
            match: match ? { list_id: match.list.id, list_name: match.list.name, matched: counts.matched, unmatched: counts.unmatched, conflicts: counts.conflicts } : null,
            sample,
            currencies: [...currencies],
            truncated,
        };
    }

    private sampleOf(
        it: ImportedPreapproval,
        decision: { action: SubscriptionImportAction; reason: string | null },
        recordTitle: string | null,
        planNames: Map<string, string>,
    ): SubscriptionImportSample {
        return {
            external_id: it.externalId,
            email: it.payerEmail,
            title: this.titleOf(it),
            plan: (it.planExternalId ? planNames.get(it.planExternalId) : null) ?? it.reason,
            amount: it.amount ?? 0,
            currency: it.currency ?? 'COP',
            frequency: it.frequency,
            frequency_type: it.frequencyType,
            status: it.mpStatus,
            action: decision.action,
            record_title: decision.action === 'link' ? recordTitle : null,
            reason: decision.reason,
        };
    }

    private titleOf(it: ImportedPreapproval): string {
        return subscriberTitle({ name: it.payerName, email: it.payerEmail, payerId: it.payerId, externalId: it.externalId });
    }

    // ── Estado (lo que muestra la pantalla) ─────────────────────────────

    async status(tenantId: number, actor: CollectionActor, connectionId: number): Promise<SubscriptionImportStatus> {
        await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        return this.readStatus(tenantId, connectionId);
    }

    private async readStatus(tenantId: number, connectionId: number): Promise<SubscriptionImportStatus> {
        const config = await this.readConfig(tenantId, connectionId);
        const key = statusKey(tenantId, connectionId);
        let saved: SubscriptionImportStatus | null = null;
        if (this.redis) {
            const raw = await this.redis.get(key).catch(() => null);
            if (raw) {
                try {
                    saved = JSON.parse(raw) as SubscriptionImportStatus;
                } catch {
                    saved = null;
                }
            }
        } else {
            saved = this.memStatus.get(key) ?? null;
        }
        const auto = config
            ? await this.tenantDb.withTenant(tenantId, async (tx) => {
                  const [r] = await tx
                      .select({ n: sql<number>`count(*)::int` })
                      .from(subscriptions)
                      .where(
                          and(
                              eq(subscriptions.tenantId, tenantId),
                              eq(subscriptions.connectionId, connectionId),
                              sql`${subscriptions.reference} like 'ibs_auto_%'`,
                          ),
                      );
                  return Number(r?.n ?? 0);
              })
            : 0;
        return { ...IDLE_SUBSCRIPTION_IMPORT, ...(saved ?? {}), config, auto_imported: auto };
    }

    private async writeStatus(tenantId: number, connectionId: number, s: SubscriptionImportStatus): Promise<void> {
        const key = statusKey(tenantId, connectionId);
        if (this.redis) await this.redis.set(key, JSON.stringify(s), 'EX', STATUS_TTL_S).catch(() => undefined);
        else this.memStatus.set(key, s);
    }

    private async readConfig(tenantId: number, connectionId: number): Promise<SubscriptionImportConfig | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ config: connections.config })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1),
        );
        return row ? readSubscriptionImportConfig(row.config) : null;
    }

    private async saveConfig(tenantId: number, connectionId: number, cfg: SubscriptionImportConfig | null): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connections)
                .set({
                    config:
                        cfg === null
                            ? sql`coalesce(${connections.config}, '{}'::jsonb) - 'subscription_import'`
                            : sql`jsonb_set(coalesce(${connections.config}, '{}'::jsonb), '{subscription_import}', ${JSON.stringify(cfg)}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId))),
        );
    }

    /** Encender o apagar «traer las nuevas solas». */
    async setAuto(tenantId: number, actor: CollectionActor, connectionId: number, auto: boolean): Promise<SubscriptionImportStatus> {
        this.assertCanImport(actor);
        await this.mpConnection(tenantId, actor, connectionId);
        const cfg = await this.readConfig(tenantId, connectionId);
        if (!cfg) badRequest('import_not_configured', 'Todavía no se importó nada de esta conexión.');
        await this.saveConfig(tenantId, connectionId, { ...cfg!, auto });
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'subscriptions.import_auto',
            targetType: 'connection',
            targetId: connectionId,
            meta: { auto },
        });
        return this.readStatus(tenantId, connectionId);
    }

    // ── Importar ────────────────────────────────────────────────────────

    private async takeLock(connectionId: number): Promise<boolean> {
        if (this.redis) {
            const got = await this.redis.set(lockKey(connectionId), String(process.pid), 'EX', LOCK_TTL_S, 'NX').catch(() => 'OK');
            return got === 'OK';
        }
        if (this.memLocks.has(connectionId)) return false;
        this.memLocks.add(connectionId);
        return true;
    }

    private async releaseLock(connectionId: number): Promise<void> {
        if (this.redis) await this.redis.del(lockKey(connectionId)).catch(() => undefined);
        else this.memLocks.delete(connectionId);
    }

    private async refreshLock(connectionId: number): Promise<void> {
        if (this.redis) await this.redis.expire(lockKey(connectionId), LOCK_TTL_S).catch(() => undefined);
    }

    /**
     * Prepara el destino (crea la lista o valida la elegida, elige las
     * columnas, el registro de cobros) y deja la importación corriendo en
     * segundo plano: la pantalla pregunta cómo va.
     */
    async start(tenantId: number, actor: CollectionActor, connectionId: number, input: SubscriptionImportInput): Promise<SubscriptionImportStatus> {
        this.assertCanImport(actor);
        const conn = await this.mpConnection(tenantId, actor, connectionId);
        const ro = await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId));
        if (ro) badRequest('read_only', 'La empresa está en solo lectura: no se pueden importar suscripciones.');
        if (!(await this.takeLock(connectionId))) badRequest('import_running', 'Ya hay una importación en curso para esta conexión.');
        try {
            // Primero se lee Mercado Pago: si la credencial no sirve, no se crea ninguna lista.
            const scan = await this.scanPreapprovals(conn.creds);
            const plans = await this.scanPlans(conn.creds);
            const warnings: string[] = [];
            if (scan.truncated) warnings.push('Hay más de 5.000 suscripciones en Mercado Pago: se trajeron las primeras 5.000. Las demás llegan con la revisión periódica.');
            const dest = input.mode === 'create' ? await this.createList(tenantId, actor, input, scan.items) : await this.useList(tenantId, actor, input);
            let chargeLogListId: number | null = null;
            let dashboardId: number | null = null;
            if (input.charge_log && this.chargeLog) {
                const list = await this.lists.get(tenantId, String(dest.list.id));
                const already = readSubscriptionChargeLog(list.settings);
                if (already) {
                    chargeLogListId = already.list_id;
                    dashboardId = already.dashboard_id ?? null;
                } else {
                    const cl = await this.chargeLog.configure(tenantId, actor, String(dest.list.id), { mode: 'create', dashboard: input.dashboard });
                    chargeLogListId = cl.config?.list_id ?? null;
                    dashboardId = cl.config?.dashboard_id ?? null;
                }
            }
            const cfg: SubscriptionImportConfig = {
                mode: input.mode,
                list_id: dest.list.id,
                email_field_id: dest.emailFieldId,
                create_missing: input.mode === 'create' ? true : input.create_missing,
                auto: input.auto,
                include_pending: input.include_pending,
                since: new Date().toISOString(),
                last_scan_at: new Date().toISOString(),
            };
            await this.saveConfig(tenantId, connectionId, cfg);
            const startedAt = new Date().toISOString();
            const status: SubscriptionImportStatus = {
                ...IDLE_SUBSCRIPTION_IMPORT,
                state: 'running',
                list_id: dest.list.id,
                list_slug: dest.list.slug,
                list_name: dest.list.name,
                charge_log_list_id: chargeLogListId,
                dashboard_id: dashboardId,
                warnings,
                started_at: startedAt,
                config: cfg,
                auto_imported: 0,
            };
            await this.writeStatus(tenantId, connectionId, status);
            await this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'subscriptions.import',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
                meta: { mode: input.mode, list_id: dest.list.id, include_cancelled: input.include_cancelled, include_pending: input.include_pending, auto: input.auto, found: scan.items.length },
            });
            const run = this.run(tenantId, actor, conn, input, cfg, scan.items, plans, status).finally(() => {
                this.running.delete(statusKey(tenantId, connectionId));
                void this.releaseLock(connectionId);
            });
            this.running.set(statusKey(tenantId, connectionId), run);
            return status;
        } catch (err) {
            await this.releaseLock(connectionId);
            throw err;
        }
    }

    /** Para los tests: espera a que termine la importación en curso. */
    async waitFor(tenantId: number, connectionId: number): Promise<SubscriptionImportStatus> {
        await this.running.get(statusKey(tenantId, connectionId));
        return this.readStatus(tenantId, connectionId);
    }

    private async run(
        tenantId: number,
        actor: CollectionActor,
        conn: { id: number; name: string; creds: IntegrationCreds },
        input: SubscriptionImportInput,
        cfg: SubscriptionImportConfig,
        items: ImportedPreapproval[],
        plans: ImportedPlan[],
        status: SubscriptionImportStatus,
    ): Promise<void> {
        const s = { ...status };
        try {
            const planIds = await this.importPlans(tenantId, actor, conn.id, plans, items);
            s.plans_imported = planIds.created;
            const known = await this.knownIds(tenantId, items.map((i) => i.externalId));
            const match = cfg.mode === 'match' && cfg.list_id && cfg.email_field_id ? await this.matchIndex(tenantId, cfg.list_id, cfg.email_field_id) : null;
            const todo = items.filter((it) => {
                const d = decideImport({
                    known: known.has(it.externalId),
                    status: it.mpStatus,
                    includeCancelled: input.include_cancelled,
                    includePending: input.include_pending,
                    ours: (it.externalReference ?? '').startsWith('ibs_'),
                    mode: cfg.mode,
                    email: it.payerEmail,
                    match: null,
                    createMissing: true,
                });
                return d.action !== 'known' && d.action !== 'skip';
            });
            s.total = todo.length;
            await this.writeStatus(tenantId, conn.id, s);
            const counters: RunCounters = { imported: 0, linked: 0, records_created: 0, without_record: 0, failed: 0 };
            const ctx = { emailLookups: EMAIL_LOOKUPS, failures: [] as string[] };
            let next = 0;
            let lastWrite = Date.now();
            const worker = async (): Promise<void> => {
                while (next < todo.length) {
                    const it = todo[next++]!;
                    try {
                        const r = await this.importOne(tenantId, actor, conn, cfg, it, planIds.byExternal, match, { quiet: true, ctx });
                        if (r !== 'duplicate') {
                            counters.imported += 1;
                            if (r === 'linked') counters.linked += 1;
                            else if (r === 'created') counters.records_created += 1;
                            else counters.without_record += 1;
                        }
                    } catch (err) {
                        counters.failed += 1;
                        if (ctx.failures.length < 5) ctx.failures.push(`${this.titleOf(it)}: ${errorText(err)}`);
                        if ((err as { response?: { code?: string } }).response?.code === 'plan_limit_reached') {
                            s.error = 'La empresa llegó al límite de registros de su plan: se importó hasta ahí. Mejora el plan o borra registros y vuelve a importar (lo que ya entró no se duplica).';
                            next = todo.length;
                        }
                    }
                    s.done += 1;
                    Object.assign(s, counters);
                    if (Date.now() - lastWrite > 1500) {
                        lastWrite = Date.now();
                        await this.writeStatus(tenantId, conn.id, s);
                        await this.refreshLock(conn.id);
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(todo.length, 1)) }, () => worker()));
            // v0.1.380 — Las que ya estaban (de una importación anterior) toman el nombre y el correo que ahora se conocen.
            await this.refreshKnown(tenantId, conn.id, cfg, items).catch((err) => this.logger.warn(`No se pudieron completar los suscriptores: ${errorText(err)}`));
            Object.assign(s, counters);
            if (ctx.failures.length > 0) s.warnings = [...s.warnings, ...ctx.failures.map((m) => `No se pudo traer ${m}`)];
            s.state = s.error ? 'failed' : 'done';
            if (s.error && counters.imported > 0) s.state = 'done';
            s.finished_at = new Date().toISOString();
            await this.writeStatus(tenantId, conn.id, s);
            if (cfg.list_id) this.realtime.records(tenantId, cfg.list_id);
        } catch (err) {
            s.state = 'failed';
            s.error = errorText(err);
            s.finished_at = new Date().toISOString();
            await this.writeStatus(tenantId, conn.id, s);
            this.logger.warn(`Importación de suscripciones (conexión ${conn.id}) falló: ${s.error}`);
        }
    }

    /** Los planes de Mercado Pago como planes de la app (una vez: se recuerda su id). */
    private async importPlans(
        tenantId: number,
        actor: CollectionActor,
        connectionId: number,
        plans: ImportedPlan[],
        items: ImportedPreapproval[],
    ): Promise<{ created: number; byExternal: Map<string, { id: number; graceDays: number; cycles: number | null; name: string }> }> {
        const known = await this.knownPlans(tenantId, connectionId);
        const byExternal = new Map<string, { id: number; graceDays: number; cycles: number | null; name: string }>();
        let created = 0;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = known.size > 0 ? await tx.select().from(subscriptionPlans).where(inArray(subscriptionPlans.id, [...known.values()])) : [];
            for (const p of existing) {
                const ext = (p.providerRefs as Record<string, unknown> | null)?.mp_plan_id;
                if (typeof ext === 'string') byExternal.set(ext, { id: p.id, graceDays: p.graceDays, cycles: p.cycles, name: p.name });
            }
            for (const p of plans) {
                if (byExternal.has(p.externalId)) continue;
                // Un plan sin valor fijo toma el de sus suscripciones (el más usado).
                let amount = p.amount;
                if (!amount || amount <= 0) {
                    const counts = new Map<number, number>();
                    for (const it of items) if (it.planExternalId === p.externalId && it.amount) counts.set(it.amount, (counts.get(it.amount) ?? 0) + 1);
                    amount = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
                }
                if (!amount || amount <= 0) continue;
                const [row] = await tx
                    .insert(subscriptionPlans)
                    .values({
                        tenantId,
                        connectionId,
                        provider: 'mercadopago',
                        name: p.name,
                        description: 'Importado de Mercado Pago.',
                        amount: Math.round(amount * 100) / 100,
                        currency: p.currency,
                        frequency: p.frequency,
                        frequencyType: p.frequencyType,
                        cycles: p.cycles,
                        trialDays: p.trialDays,
                        graceDays: 10,
                        onExpire: 'mark',
                        active: p.active,
                        providerRefs: { mp_plan_id: p.externalId },
                        createdBy: actor.userId || null,
                    })
                    .returning();
                byExternal.set(p.externalId, { id: row!.id, graceDays: row!.graceDays, cycles: row!.cycles, name: row!.name });
                created += 1;
            }
        });
        return { created, byExternal };
    }

    /**
     * Una suscripción: se guarda (primero, para que dos importaciones a la vez
     * no la dupliquen), se le busca o crea el registro y se sincroniza.
     */
    private async importOne(
        tenantId: number,
        actor: CollectionActor,
        conn: { id: number; creds: IntegrationCreds },
        cfg: SubscriptionImportConfig,
        it: ImportedPreapproval,
        plans: Map<string, { id: number; graceDays: number; cycles: number | null; name: string }>,
        match: MatchIndex | null,
        opts: { quiet: boolean; ctx: { emailLookups: number } },
    ): Promise<'created' | 'linked' | 'none' | 'duplicate'> {
        let email = it.payerEmail;
        let name = it.payerName;
        if ((!email || !name) && opts.ctx.emailLookups > 0) {
            opts.ctx.emailLookups -= 1;
            const who = await this.payerFromPayments(conn.creds, it.externalId);
            email = email ?? who.email;
            name = name ?? who.name;
        }
        it = { ...it, payerEmail: email, payerName: name };
        const plan = it.planExternalId ? (plans.get(it.planExternalId) ?? null) : null;
        const startAt = it.startAt ?? it.createdAt ?? null;
        const cycles = plan?.cycles ?? (startAt && it.endAt ? cyclesBetween(startAt, it.endAt, it.frequency, it.frequencyType) : null);
        const title = (it.reason ?? plan?.name ?? 'Suscripción de Mercado Pago').slice(0, 200);
        // `ibs_imp_` = la importación de lo que ya existía; `ibs_auto_` = llegó sola después.
        const reference = `${opts.quiet ? 'ibs_imp_' : 'ibs_auto_'}${randomBytes(10).toString('base64url')}`;
        const inserted = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(subscriptions)
                .values({
                    tenantId,
                    connectionId: conn.id,
                    provider: 'mercadopago',
                    planId: plan?.id ?? null,
                    listId: null,
                    recordId: null,
                    externalId: it.externalId,
                    reference,
                    url: it.mpStatus === 'pending' ? it.url : null,
                    title,
                    planName: plan?.name ?? it.reason?.slice(0, 120) ?? null,
                    amount: it.amount && it.amount > 0 ? it.amount : 0,
                    currency: it.currency ?? 'COP',
                    frequency: it.frequency,
                    frequencyType: it.frequencyType,
                    cycles,
                    graceDays: plan?.graceDays ?? 10,
                    onExpire: 'mark',
                    payerEmail: email,
                    status: 'pending',
                    providerStatus: it.providerStatus,
                    startAt,
                    nextChargeAt: it.nextPaymentAt,
                    createdBy: actor.userId || null,
                    createdAt: it.createdAt ?? new Date(),
                    lastCheckedAt: null,
                })
                .onConflictDoNothing()
                .returning({ id: subscriptions.id }),
        );
        const subId = inserted[0]?.id;
        if (!subId) return 'duplicate';

        // El registro: en una lista nueva se crea siempre; en una existente se
        // busca por correo (y se crea el que falta si así se pidió).
        let recordId: number | null = null;
        let outcome: 'created' | 'linked' | 'none' = 'none';
        const listId = cfg.list_id;
        if (listId) {
            const hit = match && email ? match.byEmail.get(email) : undefined;
            if (hit && !match!.withLive.has(hit.id)) {
                recordId = hit.id;
                match!.withLive.add(hit.id);
                outcome = 'linked';
            } else if (!hit && (cfg.mode === 'create' || cfg.create_missing)) {
                recordId = await this.createRecord(tenantId, actor, listId, cfg, it, email, opts.quiet);
                if (recordId !== null) {
                    outcome = 'created';
                    if (match && email) match.byEmail.set(email, { id: recordId, title: email });
                    match?.withLive.add(recordId);
                }
            }
        }
        if (recordId !== null) {
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .update(subscriptions)
                    .set({ listId, recordId, updatedAt: new Date() })
                    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, subId))),
            );
        }
        await this.subs.sync(tenantId, subId, new Date(), { quiet: opts.quiet });
        return outcome;
    }

    /** El correo y el nombre del pagador, de su último pago (cuando la suscripción no los trae). */
    private async payerFromPayments(creds: IntegrationCreds, preapprovalId: string): Promise<{ email: string | null; name: string | null }> {
        const none = { email: null, name: null };
        try {
            let inv = await this.fetch(invoicesSearchRequest(creds, preapprovalId, this.bases));
            let list = parseInvoices(inv.status, inv.body);
            if (!list) {
                inv = await this.fetch(invoicesSearchRequest(creds, preapprovalId, this.bases, false));
                list = parseInvoices(inv.status, inv.body);
            }
            const paymentId = (list ?? [])
                .sort((a, b) => (b.debitDate?.getTime() ?? 0) - (a.debitDate?.getTime() ?? 0))
                .map((i) => i.paymentId)
                .find((id): id is string => Boolean(id));
            if (!paymentId) return none;
            const pay = await this.fetch({
                url: `${this.bases.mercadopago.replace(/\/+$/, '')}/v1/payments/${encodeURIComponent(paymentId)}`,
                method: 'GET',
                headers: { accept: 'application/json', authorization: `Bearer ${creds.secret}` },
            });
            return paymentPayer(pay.status, pay.body);
        } catch {
            return none;
        }
    }

    /**
     * v0.1.380 — Las suscripciones que ya estaban en la app toman el nombre y
     * el correo que ahora da Mercado Pago: el título provisorio del registro
     * («Cliente de Mercado Pago #123») pasa a ser el nombre y se completa el
     * correo si estaba vacío. Lo que la persona escribió a mano no se toca.
     */
    async refreshKnown(tenantId: number, connectionId: number, cfg: SubscriptionImportConfig, items: ImportedPreapproval[]): Promise<number> {
        // Todas: el correo puede haber llegado después por un pago (y estar en la fila).
        const withInfo = items;
        if (withInfo.length === 0) return 0;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: subscriptions.id, externalId: subscriptions.externalId, listId: subscriptions.listId, recordId: subscriptions.recordId, payerEmail: subscriptions.payerEmail })
                .from(subscriptions)
                .where(
                    and(
                        eq(subscriptions.tenantId, tenantId),
                        eq(subscriptions.connectionId, connectionId),
                        inArray(
                            subscriptions.externalId,
                            withInfo.map((i) => i.externalId),
                        ),
                    ),
                ),
        );
        if (rows.length === 0) return 0;
        const byExt = new Map(withInfo.map((i) => [i.externalId, i]));
        // Para saber cuál es el título y cuál el correo de cada lista (una vez por lista).
        const listInfo = new Map<number, { titleId: number | null; emailId: number | null } | null>();
        const infoFor = async (listId: number): Promise<{ titleId: number | null; emailId: number | null } | null> => {
            if (listInfo.has(listId)) return listInfo.get(listId)!;
            let out: { titleId: number | null; emailId: number | null } | null = null;
            try {
                const list = await this.lists.get(tenantId, String(listId));
                if (!readMirrorListMarker(list.settings)) {
                    const listFields = await this.fields.listByListId(tenantId, list.id);
                    const titleId = resolveTitleFieldId(listFields.map((x) => ({ id: x.id, type: x.type as FieldType })), list.settings ?? {});
                    const emailId = cfg.list_id === listId ? cfg.email_field_id : (listFields.find((x) => x.type === 'email')?.id ?? null);
                    out = { titleId, emailId };
                }
            } catch {
                out = null;
            }
            listInfo.set(listId, out);
            return out;
        };
        let changed = 0;
        for (const r of rows) {
            const it = r.externalId ? byExt.get(r.externalId) : undefined;
            if (!it) continue;
            if (!r.payerEmail && it.payerEmail) {
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx.update(subscriptions).set({ payerEmail: it.payerEmail, updatedAt: new Date() }).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, r.id))),
                );
            }
            if (r.listId === null || r.recordId === null) continue;
            const info = await infoFor(r.listId);
            if (!info) continue;
            const current = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [rec] = await tx
                    .select({ data: records.data })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.listId, r.listId!), eq(records.id, r.recordId!), isNull(records.deletedAt)))
                    .limit(1);
                return rec ? ((rec.data ?? {}) as Record<string, unknown>) : null;
            });
            if (!current) continue;
            const patch: Record<string, unknown> = {};
            const email = it.payerEmail ?? r.payerEmail ?? null;
            if (!it.payerName && !email) continue;
            if (info.titleId && info.titleId !== info.emailId) {
                const key = jsonbKeyForField(info.titleId);
                const next = it.payerName ?? email;
                if (next && current[key] !== next && isProvisionalSubscriberTitle(current[key], email)) patch[`f${info.titleId}`] = next;
            }
            if (info.emailId && email) {
                const key = jsonbKeyForField(info.emailId);
                const v = current[key];
                if (typeof v !== 'string' || v.trim() === '') patch[`f${info.emailId}`] = email;
            }
            if (Object.keys(patch).length === 0) continue;
            try {
                await this.lazy(RecordsService).update(tenantId, SYSTEM_ACTOR, String(r.listId), r.recordId, { data: patch } as never, { silent: true, noAutomations: true });
                changed += 1;
            } catch (err) {
                this.logger.warn(`Suscripción ${r.id}: no se pudo completar el suscriptor: ${errorText(err)}`);
            }
        }
        if (changed > 0 && cfg.list_id) this.realtime.records(tenantId, cfg.list_id);
        return changed;
    }

    /** El registro del pagador (título, correo y lo que se sabe desde el principio). */
    private async createRecord(
        tenantId: number,
        actor: CollectionActor,
        listId: number,
        cfg: SubscriptionImportConfig,
        it: ImportedPreapproval,
        email: string | null,
        quiet: boolean,
    ): Promise<number | null> {
        const list = await this.lists.get(tenantId, String(listId));
        const listFields = await this.fields.listByListId(tenantId, list.id);
        const titleId = resolveTitleFieldId(listFields.map((x) => ({ id: x.id, type: x.type as FieldType })), list.settings ?? {});
        const data: Record<string, unknown> = {};
        const byId = new Map(listFields.map((x) => [x.id, x]));
        const title = it.payerName ?? email ?? this.titleOf(it);
        if (titleId && titleId !== cfg.email_field_id) data[jsonbKeyForField(titleId)] = title;
        if (cfg.email_field_id && email) data[jsonbKeyForField(cfg.email_field_id)] = email;
        // Las claves terminan en `_field_id`: migrar una empresa las re-mapea solas.
        const extras = (list.settings as { subscription_import_fields?: Record<string, unknown> } | null)?.subscription_import_fields ?? {};
        const extraId = (k: string): number | null => (typeof extras[k] === 'number' ? (extras[k] as number) : null);
        const since = extraId('since_field_id');
        if (since && byId.get(since) && (it.startAt ?? it.createdAt)) data[jsonbKeyForField(since)] = (it.startAt ?? it.createdAt)!.toISOString().slice(0, 10);
        const extId = extraId('external_id_field_id');
        if (extId && byId.get(extId)) data[jsonbKeyForField(extId)] = it.externalId;
        const created = await this.lazy(RecordsService).create(
            tenantId,
            actor.userId ? actor : SYSTEM_ACTOR,
            String(list.id),
            { data },
            { lenientRequired: true, silent: true, noAutomations: quiet },
        );
        return created.id;
    }

    // ── El destino ──────────────────────────────────────────────────────

    /** «Suscriptores · Mercado Pago»: una lista normal con las columnas ya elegidas. */
    private async createList(
        tenantId: number,
        actor: CollectionActor,
        input: SubscriptionImportInput,
        items: ImportedPreapproval[],
    ): Promise<{ list: { id: number; slug: string; name: string }; emailFieldId: number | null }> {
        const counts = new Map<string, number>();
        for (const it of items) if (it.currency) counts.set(it.currency, (counts.get(it.currency) ?? 0) + 1);
        const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'COP';
        const money = { currency, precision: currency === 'COP' ? 0 : 2 };
        const statusOpts = Object.values(SUBSCRIPTION_STATUS_OPTIONS).map((o) => opt(o.value, o.label, o.color));
        const attention = {
            type: 'group',
            logic: 'and',
            children: [
                {
                    type: 'condition',
                    field_id: ref('estado'),
                    op: 'in',
                    value: [
                        SUBSCRIPTION_STATUS_OPTIONS.retrying.value,
                        SUBSCRIPTION_STATUS_OPTIONS.past_due.value,
                        SUBSCRIPTION_STATUS_OPTIONS.expired.value,
                        SUBSCRIPTION_STATUS_OPTIONS.pending.value,
                    ],
                },
            ],
        };
        const name = (input.list_name?.trim() || DEFAULT_IMPORT_LIST_NAME).slice(0, 120);
        const blueprint: ListBlueprint = {
            version: BLUEPRINT_VERSION,
            lists: [
                bpList(
                    'suscriptores',
                    name,
                    'repeat',
                    '#009EE3',
                    [
                        f('Suscriptor', 'suscriptor', 'text', { description: 'El cliente: su nombre en Mercado Pago (o su correo si no lo da). Puedes cambiarlo.' }),
                        f('Correo', 'correo', 'email', { description: 'El correo con el que paga en Mercado Pago.' }),
                        select('Estado de la suscripción', 'estado', statusOpts),
                        f('Plan', 'plan', 'text'),
                        f('Valor de la suscripción', 'valor', 'currency', { config: money }),
                        f('Próximo cobro', 'proximo_cobro', 'date'),
                        f('Pagado hasta', 'pagado_hasta', 'date'),
                        f('Cobros fallidos', 'fallidos', 'number'),
                        f('Link de la suscripción', 'link', 'url', { description: 'Para que el cliente autorice la tarjeta (mientras está «Por autorizar»).' }),
                        f('Suscrito desde', 'desde', 'date'),
                        f('Id en Mercado Pago', 'id_mp', 'text', { description: 'El número de la suscripción en Mercado Pago (para buscarla allá).' }),
                        f('Notas', 'notas', 'long_text'),
                    ],
                    {
                        settings: { title_field_id: ref('suscriptor') },
                        views: [
                            table('Todos', true, { sort: [{ field_id: ref('proximo_cobro'), dir: 'asc' }] }),
                            // v0.1.380 — Un cliente con varias suscripciones (una cancelada y otra nueva) queda junto.
                            table('Por cliente', false, { group_by_field_id: ref('suscriptor'), sort: [{ field_id: ref('desde'), dir: 'desc' }] }),
                            kanban('Por estado', 'estado'),
                            table('Para revisar', false, {
                                filter_tree: attention,
                                sort: [{ field_id: ref('pagado_hasta'), dir: 'asc' }],
                            }),
                        ],
                    },
                ),
            ],
            dashboards: [],
        };
        const res = await this.lazy(BlueprintService).materialize(tenantId, actor.userId, blueprint, { groupId: null, includeRecords: false });
        const created = res.lists[0];
        if (!created) badRequest('import_failed', 'No se pudo crear la lista de suscriptores.');
        const ids = res.fieldIds.suscriptores ?? {};
        const pick = (slug: string): number | null => ids[slug] ?? null;
        const mapping: SubscriptionFields = {
            status: pick('estado'),
            plan: pick('plan'),
            amount: pick('valor'),
            next_charge: pick('proximo_cobro'),
            paid_until: pick('pagado_hasta'),
            failed: pick('fallidos'),
            link: pick('link'),
        };
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{subscriptions}', ${JSON.stringify({ fields: mapping })}::jsonb), '{subscription_import_fields}', ${JSON.stringify({ since_field_id: pick('desde'), external_id_field_id: pick('id_mp') })}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, created!.id))),
        );
        return { list: { id: created!.id, slug: created!.slug, name: created!.name }, emailFieldId: pick('correo') };
    }

    /** Una lista que ya existe: se valida y se le eligen las columnas de la suscripción que falten. */
    private async useList(tenantId: number, actor: CollectionActor, input: SubscriptionImportInput): Promise<{ list: { id: number; slug: string; name: string }; emailFieldId: number | null }> {
        const match = await this.matchIndex(tenantId, input.list_id!, input.email_field_id!);
        if (!can(actor, 'manage_fields')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Elegir las columnas de la suscripción lo hace quien puede crear campos.', data: { status: 403 } });
        }
        if (input.create_missing && !can(actor, 'create_records')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Crear los clientes que faltan lo hace quien puede crear registros.', data: { status: 403 } });
        }
        const list = await this.lists.get(tenantId, String(match.list.id));
        const current = await this.subs.getFields(tenantId, String(list.id));
        const missing = !current || SUBSCRIPTION_FIELD_ROLES.some((r) => current[r] === null);
        if (missing) await this.subs.setupFields(tenantId, actor, String(list.id));
        return { list: match.list, emailFieldId: match.emailFieldId };
    }

    // ── Las nuevas, solas ───────────────────────────────────────────────

    /**
     * Un aviso de Mercado Pago de una suscripción que la app no conoce. Si la
     * conexión trae las nuevas solas, se importa (dispara automatizaciones: es
     * nueva de verdad).
     */
    async importByExternalId(tenantId: number, connectionId: number, preapprovalId: string): Promise<boolean> {
        const cfg = await this.readConfig(tenantId, connectionId);
        if (!cfg?.auto) return false;
        if (await planModuleOff(this.db, tenantId, 'integrations')) return false;
        const ro = await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId));
        if (ro) return false;
        const conn = await this.connectors.integrationCredsFor(tenantId, connectionId);
        if (!conn || conn.provider !== 'mercadopago') return false;
        const res = await this.fetch(preapprovalRequest(conn.creds, preapprovalId, this.bases));
        const it = parseImportedPreapproval(res.status, res.body, conn.creds);
        if (!it) return false;
        return this.importFresh(tenantId, { id: connectionId, creds: conn.creds }, cfg, [it]).then((n) => n > 0);
    }

    /** Las que todavía no están (y no son de antes de importar si están canceladas). */
    private async importFresh(
        tenantId: number,
        conn: { id: number; creds: IntegrationCreds },
        cfg: SubscriptionImportConfig,
        items: ImportedPreapproval[],
    ): Promise<number> {
        const known = await this.knownIds(tenantId, items.map((i) => i.externalId));
        const since = new Date(cfg.since).getTime();
        const fresh = items.filter((it) => {
            if (known.has(it.externalId)) return false;
            if ((it.externalReference ?? '').startsWith('ibs_')) return false;
            if (it.mpStatus === 'cancelled' && (it.createdAt?.getTime() ?? 0) < since) return false;
            // v0.1.380 — Una «Por autorizar» llega cuando la autoricen (salvo que se pida traerlas).
            if (it.mpStatus === 'pending' && !cfg.include_pending) return false;
            return true;
        });
        if (fresh.length === 0) return 0;
        const plans = await this.importPlans(tenantId, SYSTEM_ACTOR, conn.id, await this.scanPlans(conn.creds).catch(() => []), fresh);
        const match = cfg.mode === 'match' && cfg.list_id && cfg.email_field_id ? await this.matchIndex(tenantId, cfg.list_id, cfg.email_field_id).catch(() => null) : null;
        if (cfg.mode === 'match' && !match) return 0;
        let n = 0;
        for (const it of fresh.slice(0, SCAN_IMPORT_CAP)) {
            try {
                const r = await this.importOne(tenantId, SYSTEM_ACTOR, conn, cfg, it, plans.byExternal, match, { quiet: false, ctx: { emailLookups: 20 } });
                if (r !== 'duplicate') n += 1;
            } catch (err) {
                this.incidents?.report({
                    tenantId,
                    key: `subscriptions:${conn.id}:import`,
                    source: 'collections',
                    sourceId: conn.id,
                    title: 'Una suscripción nueva de Mercado Pago no se pudo traer',
                    message: `La suscripción ${it.externalId} (${this.titleOf(it)}) no se importó: ${errorText(err)}`,
                });
                break;
            }
        }
        if (n > 0) {
            this.incidents?.resolve(tenantId, `subscriptions:${conn.id}:import`);
            if (cfg.list_id) this.realtime.records(tenantId, cfg.list_id);
        }
        return n;
    }

    /**
     * Cada 5 minutos, en UN nodo: las conexiones que traen las nuevas solas y
     * hace más de 30 minutos que no se revisan (los avisos son el camino
     * rápido; esto cubre a quien no los configuró).
     */
    async scanAll(now = new Date()): Promise<number> {
        if (this.redis) {
            const got = await this.redis.set(TICK_LOCK, String(process.pid), 'EX', 240, 'NX').catch(() => 'OK');
            if (got !== 'OK') return 0;
        }
        try {
            const due = await this.db.execute(sql`
                select id, tenant_id as "tenantId" from connections
                where provider = 'mercadopago'
                  and config->'subscription_import'->>'auto' = 'true'
                  and coalesce((config->'subscription_import'->>'last_scan_at')::timestamptz, 'epoch') < ${new Date(now.getTime() - SCAN_EVERY_MS)}
                order by id
                limit 50
            `);
            const rows = (due as unknown as { rows: Array<{ id: number | string; tenantId: number | string }> }).rows;
            let total = 0;
            for (const r of rows) {
                const tenantId = Number(r.tenantId);
                const connectionId = Number(r.id);
                try {
                    total += await this.scanConnection(tenantId, connectionId, now);
                } catch (err) {
                    this.logger.warn(`Conexión ${connectionId}: no se pudieron revisar las suscripciones nuevas: ${errorText(err)}`);
                }
            }
            return total;
        } finally {
            if (this.redis) await this.redis.del(TICK_LOCK).catch(() => undefined);
        }
    }

    async scanConnection(tenantId: number, connectionId: number, now = new Date()): Promise<number> {
        const cfg = await this.readConfig(tenantId, connectionId);
        if (!cfg?.auto) return 0;
        await this.saveConfig(tenantId, connectionId, { ...cfg, last_scan_at: now.toISOString() });
        if (await planModuleOff(this.db, tenantId, 'integrations')) return 0;
        const ro = await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId));
        if (ro) return 0;
        if (!(await this.takeLock(connectionId))) return 0;
        try {
            const conn = await this.connectors.integrationCredsFor(tenantId, connectionId);
            if (!conn || conn.provider !== 'mercadopago') return 0;
            const { items } = await this.scanPreapprovals(conn.creds).catch(() => ({ items: [] as ImportedPreapproval[] }));
            const n = await this.importFresh(tenantId, { id: connectionId, creds: conn.creds }, cfg, items);
            await this.refreshKnown(tenantId, connectionId, cfg, items).catch((err) => this.logger.warn(`No se pudieron completar los suscriptores: ${errorText(err)}`));
            return n;
        } finally {
            await this.releaseLock(connectionId);
        }
    }
}

/** Cuántos cobros entran entre el inicio y el fin (la suscripción tiene fecha de fin). */
export function cyclesBetween(start: Date, end: Date, frequency: number, type: 'months' | 'days'): number | null {
    let n = 0;
    let d = start;
    while (d.getTime() < end.getTime() && n <= 120) {
        d = addSubscriptionPeriod(d, frequency, type);
        n += 1;
    }
    return n >= 1 && n <= 120 ? n : null;
}
