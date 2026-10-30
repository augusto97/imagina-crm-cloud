import { assertApprovalFlowRefs } from '../approvals/approval-refs';
import { assertAgentRefs } from '../ai-agents/agent-refs';
import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type {
    Automation,
    AutomationRun,
    AutomationRunStatus,
    AutomationTestRunInput,
    AutomationTestRunResult,
    AutomationTestStep,
    AutomationVersion,
    CreateAutomationInput,
    HookCapture,
    TestStepStatus,
    UpdateAutomationInput,
    WebhookTestInput,
    WebhookTestResult,
    EmailTestInput,
    EmailTestResult,
} from '@imagina-base/shared';
import {
    AUTOMATION_VERSIONS_KEPT,
    automationConfigIssues,
    emailDesignSchema,
    FALLBACK_TIME_ZONE,
    formatEmailFieldValue,
    parseEmailDesign,
    tenantFormatSchema,
    zonedToday,
    type BillingStatus,
} from '@imagina-base/shared';
import { accessOf } from '../billing/tenant-access';
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import { maskHeaders, redactValues } from '../connectors/connection-parts';
import { ConnectorsService, type ResolvedAction } from '../connectors/connectors.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { automationHooks, automationRuns, automations, automationVersions, fields, records, tenants, users } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AutomationDispatcher } from './automation-dispatcher.service';
import { AutomationScheduler } from './automation-scheduler.service';
import { EmailComposer, type ComposedEmail } from './email-composer';
import { applyMergeTags, escapeHtml, labelResolverFor } from './merge-tags';
import { DocumentsService } from '../documents/documents.service';
import { MailService } from '../mail/mail.service';
import type { MailAttachment } from '../mail/mail.types';
import { compileConnectorCall } from '../connectors/connector-actions';
import {
    buildIntegrationRequest,
    checkIntegrationResponse,
    compileIntegrationValues,
} from '../connectors/integration-calls';
import { buildWebhookRequest } from './webhook-request';
import { IncidentHub } from '../incidents/incident-hub';
import { BillingService } from '../billing/billing.service';
import { AutomationEngine } from './automation-engine.service';
import { redactAutomationSecrets, restoreRedactedSecrets } from './automation-secrets';
import { cancelWaitingRuns, trashRow } from '../trash/trash-ops';
import {
    AutomationsRepository,
    type AutomationRow,
    type AutomationRunRow,
} from './automations.repository';

/**
 * Subconjunto de ioredis que usan las capturas de webhook — tipado angosto
 * para poder pasar un fake en memoria en los tests sin levantar Redis.
 */
export interface HookCaptureStore {
    lpush(key: string, value: string): Promise<number>;
    ltrim(key: string, start: number, stop: number): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
}

/** Cuántas capturas de prueba se conservan por webhook y por cuánto tiempo. */
const HOOK_CAPTURES_MAX = 5;
const HOOK_CAPTURES_TTL_S = 24 * 60 * 60;

@Injectable()
export class AutomationsService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly repo: AutomationsRepository,
        private readonly lists: ListsService,
        private readonly scheduler: AutomationScheduler,
        @Inject(REDIS) private readonly captures: HookCaptureStore,
        private readonly connectors: ConnectorsService,
        // v0.1.263 — para que el probador resuelva {{date.today}} como el motor.
        @Optional() private readonly timeZones?: TenantTimeZones,
        // v0.1.265 — «Enviar prueba» del editor de correos.
        @Optional() private readonly mail?: MailService,
        // v0.1.266 — los PDF adjuntos de la prueba.
        @Optional() private readonly documents?: DocumentsService,
        @Optional() private readonly incidents?: IncidentHub,
        // El dispatcher cachea qué disparadores tiene cada lista: guardar los invalida.
        @Optional() private readonly dispatcher?: AutomationDispatcher,
        // Límite de automatizaciones activas del plan (`max_automations`).
        @Optional() private readonly billing?: BillingService,
        // v0.1.288 — «Probar» paso a paso (simulación con el mismo motor).
        @Optional() private readonly engine?: AutomationEngine,
    ) {}

    /**
     * v0.1.110 — Webhook entrante: asegura el token público del trigger
     * `incoming_webhook`. Si el trigger_config no trae `webhook_token`
     * (alta nueva o "regenerar URL"), se genera uno opaco y se persiste en
     * el config; el mapeo token → automatización vive en `automation_hooks`
     * (sin RLS, patrón public_lists) y cualquier token viejo se revoca.
     * Con otro trigger, se elimina el mapeo (la URL deja de existir).
     */
    private async syncHook(tenantId: number, row: AutomationRow): Promise<AutomationRow> {
        if (row.triggerType !== 'incoming_webhook') {
            await this.db.delete(automationHooks).where(eq(automationHooks.automationId, row.id));
            return row;
        }
        const cfg = { ...(row.triggerConfig ?? {}) } as Record<string, unknown>;
        let token = typeof cfg.webhook_token === 'string' ? cfg.webhook_token : '';
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
            token = randomBytes(24).toString('base64url');
            cfg.webhook_token = token;
            const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
                this.repo.update(tx, tenantId, row.id, { triggerConfig: cfg as AutomationRow['triggerConfig'] }),
            );
            if (updated) row = updated;
        }
        // Primero revocar tokens viejos: el índice único por automation_id
        // haría que el insert del token NUEVO se descartara en silencio.
        await this.db
            .delete(automationHooks)
            .where(and(eq(automationHooks.automationId, row.id), ne(automationHooks.token, token)));
        await this.db
            .insert(automationHooks)
            .values({ token, tenantId, automationId: row.id })
            .onConflictDoNothing();
        return row;
    }

    async list(tenantId: number, listIdOrSlug: string): Promise<Automation[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await this.repo.listByList(tx, tenantId, list.id);
            if (rows.length === 0) return [];
            // v0.1.285 — la última corrida de cada una, en UNA consulta (índice
            // por automatización + id descendente: no recorre el historial).
            const last = await tx.execute<{ automation_id: string; status: string; error: string | null; created_at: Date | string }>(sql`
                select a.id as automation_id, r.status, r.error, r.created_at
                from (values ${sql.join(rows.map((r) => sql`(${r.id}::bigint)`), sql`, `)}) as a(id)
                join lateral (
                    select status, error, created_at from automation_runs
                    where tenant_id = ${tenantId} and automation_id = a.id
                    order by id desc limit 1
                ) r on true`);
            const byId = new Map(last.rows.map((r) => [Number(r.automation_id), r]));
            // v0.1.288 — cuántas corridas esperan en un «Esperar» (índice parcial).
            const waiting = await tx
                .select({ id: automationRuns.automationId, n: sql<number>`count(*)::int` })
                .from(automationRuns)
                .where(
                    and(
                        eq(automationRuns.tenantId, tenantId),
                        eq(automationRuns.status, 'waiting'),
                        inArray(automationRuns.automationId, rows.map((r) => r.id)),
                    ),
                )
                .groupBy(automationRuns.automationId);
            const waitingBy = new Map(waiting.map((w) => [Number(w.id), Number(w.n)]));
            return rows.map((row) => {
                const r = byId.get(row.id);
                return {
                    ...toAutomation(row),
                    last_run: r ? { status: r.status, error: r.error, at: new Date(r.created_at).toISOString() } : null,
                    waiting_runs: waitingBy.get(row.id) ?? 0,
                };
            });
        });
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, id),
        );
        // SEC-31 (v0.1.228): la automatización tiene que ser de ESTA lista
        // (la ruta la nombra); antes cualquier id de la empresa servía.
        if (!row || row.listId !== list.id) throw notFound(id);
        return toAutomation(row);
    }

    /**
     * v0.1.221 — Re-registra al arrancar los horarios de TODAS las
     * automatizaciones temporales activas (cross-tenant, por la conexión
     * base). Idempotente. Hace falta porque hasta v0.1.220 una automatización
     * programada guardada desde el editor nunca quedaba registrada (ver
     * `AutomationScheduler.sync`): sin esto seguirían muertas hasta que
     * alguien las volviera a guardar.
     */
    async resyncSchedules(): Promise<number> {
        const rows = await this.db
            .select()
            .from(automations)
            // Conexión base (sin RLS): lo que está en la papelera se filtra a mano.
            .where(and(eq(automations.isActive, true), isNull(automations.deletedAt), inArray(automations.triggerType, ['scheduled', 'due_date_reached'])));
        for (const row of rows) await this.scheduler.sync(row.tenantId, row);
        return rows.length;
    }

    /**
     * v0.1.263 — La empresa cambió su zona horaria: re-registra sus horarios
     * (los que no tienen zona propia pasan a correr en la nueva).
     */
    async resyncTenantSchedules(tenantId: number): Promise<number> {
        const rows = await this.db
            .select()
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.isActive, true), isNull(automations.deletedAt), eq(automations.triggerType, 'scheduled')));
        for (const row of rows) await this.scheduler.sync(row.tenantId, row);
        return rows.length;
    }

    /**
     * v0.1.221 — Ejecutar AHORA una automatización programada (para probar,
     * p. ej., una edición en lote semanal sin esperar al lunes). Corre por la
     * cola igual que el horario: el resultado aparece en su historial.
     */
    async runNow(tenantId: number, listIdOrSlug: string, id: number): Promise<{ queued: true }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findById(tx, tenantId, id));
        if (!row || row.listId !== list.id) throw notFound(id);
        if (row.triggerType !== 'scheduled') {
            throw new BadRequestException({
                code: 'automation_not_scheduled',
                message: 'Sólo una automatización «En un horario» se puede ejecutar a mano.',
                data: { status: 400 },
            });
        }
        if (!(await this.scheduler.runNow(tenantId, id))) {
            throw new ServiceUnavailableException({
                code: 'queue_unavailable',
                message: 'La cola de tareas no está disponible: prueba de nuevo en un rato.',
                data: { status: 503 },
            });
        }
        return { queued: true };
    }

    /**
     * Mantenimiento del historial de corridas (cross-tenant, por la conexión
     * base; lo llama el tick periódico de la cola):
     * - una corrida que quedó en `running` más de una hora es de un proceso
     *   que se cayó a mitad: se marca interrumpida (el escaneo de
     *   vencimientos la reintenta con su tope);
     * - las corridas de más de `RUNS_RETENTION_DAYS` días se borran por tandas
     *   (la tabla crecía sin tope: una automatización por vencimiento sobre
     *   miles de registros suma miles de filas por día).
     */
    async maintainRuns(): Promise<{ interrupted: number; pruned: number }> {
        const stale = await this.db.execute(sql`
            update automation_runs
               set status = 'failed',
                   error = 'La ejecución se interrumpió (el servidor se reinició o se cayó a mitad).',
                   finished_at = now()
             where status = 'running' and coalesce(resumed_at, created_at) < now() - interval '1 hour'`);
        let pruned = 0;
        for (let i = 0; i < 20; i++) {
            const res = await this.db.execute(sql`
                delete from automation_runs
                 where id in (
                    select id from automation_runs
                     where created_at < now() - make_interval(days => ${RUNS_RETENTION_DAYS})
                       -- v0.1.288 — una corrida que espera (hasta un año) no se poda.
                       and status <> 'waiting'
                     limit 5000)`);
            const n = res.rowCount ?? 0;
            pruned += n;
            if (n < 5000) break;
        }
        return { interrupted: stale.rowCount ?? 0, pruned };
    }

    /** v0.1.265 — email de una cuenta (la prueba del correo sale a su casilla). */
    async userEmail(userId: number): Promise<string> {
        const [row] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (!row) throw new NotFoundException({ code: 'user_not_found', message: 'Usuario no encontrado', data: { status: 404 } });
        return row.email;
    }

    async create(
        tenantId: number,
        listIdOrSlug: string,
        input: CreateAutomationInput,
        opts: VersionOpts = {},
    ): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        normalizeEmailDesigns(input.actions);
        // Una automatización ACTIVA tiene que poder correr; pausada se guarda
        // como borrador aunque le falte algo.
        if (input.is_active !== false) {
            assertRunnable({ trigger_type: input.trigger_type, trigger_config: input.trigger_config ?? {}, actions: input.actions });
            await this.billing?.assertCanActivateAutomation(tenantId);
        }
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // C5 — los flujos de aprobación que usa tienen que ser de esta lista.
            await assertApprovalFlowRefs(tx, tenantId, list.id, { trigger_type: input.trigger_type, trigger_config: input.trigger_config ?? {}, actions: input.actions });
            // E6 — los agentes de IA que nombra tienen que trabajar en esta lista.
            await assertAgentRefs(tx, tenantId, list.id, input.actions);
            const inserted = await this.repo.insert(tx, {
                tenantId,
                listId: list.id,
                name: input.name,
                description: input.description ?? null,
                triggerType: input.trigger_type,
                triggerConfig: input.trigger_config ?? {},
                actions: input.actions,
                isActive: input.is_active ?? true,
            });
            await this.recordVersion(tx, tenantId, inserted, opts.actorId ?? null, opts.note ?? 'Creó la automatización');
            return inserted;
        });
        await this.dispatcher?.invalidate(tenantId, list.id);
        await this.scheduler.sync(tenantId, row);
        return toAutomation(await this.syncHook(tenantId, row));
    }

    /**
     * v0.1.288 — Duplicar: una copia «Nombre (copia)» PAUSADA en la misma
     * lista (pausada para que no empiece a correr dos veces lo mismo). El token
     * del webhook entrante NO se copia: la copia recibe su propia URL.
     */
    async duplicate(tenantId: number, listIdOrSlug: string, id: number, actorId: number | null): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const src = await this.repo.findById(tx, tenantId, id);
            if (!src || src.listId !== list.id) throw notFound(id);
            const triggerConfig = { ...(src.triggerConfig ?? {}) } as Record<string, unknown>;
            delete triggerConfig.webhook_token;
            const suffix = ' (copia)';
            const inserted = await this.repo.insert(tx, {
                tenantId,
                listId: list.id,
                name: `${src.name.slice(0, 190 - suffix.length)}${suffix}`,
                description: src.description,
                triggerType: src.triggerType,
                triggerConfig: triggerConfig as AutomationRow['triggerConfig'],
                actions: JSON.parse(JSON.stringify(src.actions)) as AutomationRow['actions'],
                isActive: false,
            });
            await this.recordVersion(tx, tenantId, inserted, actorId, `Duplicada de «${src.name}»`.slice(0, 300));
            return inserted;
        });
        await this.scheduler.sync(tenantId, row);
        return toAutomation(await this.syncHook(tenantId, row));
    }

    /**
     * v0.1.288 — Una versión nueva en el historial (sin secretos). No se
     * repite una foto idéntica a la última; se conservan las últimas 50.
     */
    private async recordVersion(
        tx: Tx,
        tenantId: number,
        row: AutomationRow,
        authorId: number | null,
        note: string | null,
    ): Promise<void> {
        const snapshot = {
            name: row.name,
            description: row.description ?? null,
            triggerType: row.triggerType,
            triggerConfig: redactAutomationSecrets(row.triggerConfig ?? {}) as Record<string, unknown>,
            actions: redactAutomationSecrets(row.actions ?? []),
            isActive: row.isActive,
        };
        const [last] = await tx
            .select()
            .from(automationVersions)
            .where(and(eq(automationVersions.tenantId, tenantId), eq(automationVersions.automationId, row.id)))
            .orderBy(desc(automationVersions.id))
            .limit(1);
        if (
            last &&
            note === null &&
            JSON.stringify([last.name, last.description, last.triggerType, last.triggerConfig, last.actions, last.isActive]) ===
                JSON.stringify([snapshot.name, snapshot.description, snapshot.triggerType, snapshot.triggerConfig, snapshot.actions, snapshot.isActive])
        ) {
            return;
        }
        await tx.insert(automationVersions).values({ tenantId, automationId: row.id, authorId, note, ...snapshot });
        const keep = tx
            .select({ id: automationVersions.id })
            .from(automationVersions)
            .where(and(eq(automationVersions.tenantId, tenantId), eq(automationVersions.automationId, row.id)))
            .orderBy(desc(automationVersions.id))
            .limit(AUTOMATION_VERSIONS_KEPT);
        await tx
            .delete(automationVersions)
            .where(and(eq(automationVersions.tenantId, tenantId), eq(automationVersions.automationId, row.id), notInArray(automationVersions.id, keep)));
    }

    /** v0.1.288 — Historial de versiones (más nueva primero, hasta 50). */
    async versions(tenantId: number, listIdOrSlug: string, id: number): Promise<AutomationVersion[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const auto = await this.repo.findById(tx, tenantId, id);
            if (!auto || auto.listId !== list.id) throw notFound(id);
            const rows = await tx
                .select({ v: automationVersions, authorName: users.name, authorEmail: users.email })
                .from(automationVersions)
                .leftJoin(users, eq(users.id, automationVersions.authorId))
                .where(and(eq(automationVersions.tenantId, tenantId), eq(automationVersions.automationId, id)))
                .orderBy(desc(automationVersions.id))
                .limit(AUTOMATION_VERSIONS_KEPT);
            return rows.map(({ v, authorName, authorEmail }) => ({
                id: v.id,
                automation_id: v.automationId,
                name: v.name,
                description: v.description ?? null,
                trigger_type: v.triggerType,
                trigger_config: v.triggerConfig ?? {},
                actions: v.actions ?? [],
                is_active: v.isActive,
                author: v.authorId !== null ? { id: v.authorId, name: authorName || authorEmail || `#${v.authorId}` } : null,
                note: v.note ?? null,
                created_at: v.createdAt.toISOString(),
            }));
        });
    }

    /**
     * v0.1.288 — «Cancelar espera» de una corrida desde el historial. Sólo
     * corridas en `waiting` de esa automatización.
     */
    async cancelWaitingRun(tenantId: number, automationId: number, runId: number, actorId: number): Promise<{ cancelled: boolean }> {
        const name = await this.db
            .select({ name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, actorId))
            .limit(1)
            .then((r) => r[0]?.name || r[0]?.email || null);
        const n = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const auto = await this.repo.findById(tx, tenantId, automationId);
            if (!auto) throw notFound(automationId);
            return this.repo.cancelWaiting(tx, tenantId, automationId, name ? `Cancelada a mano por ${name}.` : 'Cancelada a mano.', runId);
        });
        return { cancelled: n > 0 };
    }

    /**
     * v0.1.288 — «Probar» paso a paso: simula la automatización (con los
     * cambios SIN guardar) contra un registro real, con el mismo motor que la
     * ejecuta de verdad. No escribe, no envía, no llama ni emite números de
     * documento (salvo los webhooks/conectores marcados para ejecutar).
     */
    async testRun(tenantId: number, listIdOrSlug: string, input: AutomationTestRunInput): Promise<AutomationTestRunResult> {
        if (!this.engine) {
            throw new ServiceUnavailableException({ code: 'engine_unavailable', message: 'El motor de automatizaciones no está disponible.', data: { status: 503 } });
        }
        const list = await this.lists.get(tenantId, listIdOrSlug);
        normalizeEmailDesigns(input.actions);
        let payload: Record<string, unknown> | null = null;
        if (input.trigger_type === 'incoming_webhook' && input.automation_id) {
            const caps = await this.hookCaptures(tenantId, input.automation_id).catch(() => []);
            payload = caps[0]?.payload ?? null;
        }
        const out = await this.engine.simulate({
            tenantId,
            auto: {
                id: input.automation_id ?? 0,
                listId: list.id,
                name: 'Prueba',
                triggerType: input.trigger_type,
                triggerConfig: (input.trigger_config ?? {}) as AutomationRow['triggerConfig'],
                actions: input.actions,
                isActive: true,
                createdAt: new Date(),
            },
            ...(input.record_id ? { recordId: input.record_id } : {}),
            realSteps: input.real_steps,
            payload,
            ...(input.approval_result ? { approvalResult: input.approval_result } : {}),
        });
        const steps: AutomationTestStep[] = out.log.map((entry) => {
            const { path, _sim, ...details } = (entry.details ?? {}) as Record<string, unknown> & { path?: unknown; _sim?: unknown };
            const pathKey = typeof path === 'string' ? path : '';
            const status: TestStepStatus =
                entry.status === 'failed'
                    ? 'failed'
                    : entry.status === 'skipped'
                      ? 'skipped'
                      : _sim === 'ran' || _sim === 'info' || _sim === 'would_run'
                        ? (_sim as TestStepStatus)
                        : 'info';
            return {
                path: pathKey,
                depth: pathKey === '' ? 0 : pathKey.split('.').filter((p) => p === 'then' || p === 'else' || p === 'each').length,
                action: entry.action,
                status,
                message: entry.message ?? '',
                details,
            };
        });
        return { record: out.record, trigger: out.trigger, steps, responses: out.responses };
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        id: number,
        input: UpdateAutomationInput,
        opts: VersionOpts = {},
    ): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const { restored_from: restoredFrom, ...rest } = input;
        let patch: Omit<UpdateAutomationInput, 'restored_from'> = rest;
        if (patch.actions !== undefined) normalizeEmailDesigns(patch.actions);
        const restoredNote = restoredFrom !== undefined ? await this.restoredNote(tenantId, id, restoredFrom) : null;
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.listId !== list.id) throw notFound(id);
            // v0.1.288 — una versión restaurada (o una config leída por el MCP)
            // trae los secretos tapados: se completan con los actuales.
            patch = { ...patch, ...restoreRedactedSecrets({ actions: patch.actions, trigger_config: patch.trigger_config }, current) } as typeof patch;
            // El historial arranca con el estado de ANTES del primer cambio
            // registrado (las automatizaciones anteriores a v0.1.288 no tenían).
            const [hasVersion] = await tx
                .select({ id: automationVersions.id })
                .from(automationVersions)
                .where(and(eq(automationVersions.tenantId, tenantId), eq(automationVersions.automationId, id)))
                .limit(1);
            if (!hasVersion) await this.recordVersion(tx, tenantId, current, null, 'Estado antes del historial de versiones');
            // Lo imprescindible para correr, sobre el resultado del cambio, si
            // va a quedar ACTIVA (pausar o renombrar una rota siempre se puede).
            const activating = patch.is_active === true && !current.isActive;
            const touchesConfig = patch.trigger_type !== undefined || patch.trigger_config !== undefined || patch.actions !== undefined;
            if ((patch.is_active ?? current.isActive) && (activating || touchesConfig)) {
                assertRunnable({
                    trigger_type: patch.trigger_type ?? current.triggerType,
                    trigger_config: (patch.trigger_config ?? current.triggerConfig ?? {}) as Record<string, unknown>,
                    actions: patch.actions ?? current.actions,
                });
            }
            if (activating) await this.billing?.assertCanActivateAutomation(tenantId);
            // C5 — los flujos de aprobación que usa tienen que ser de esta lista.
            if (touchesConfig) {
                await assertApprovalFlowRefs(tx, tenantId, list.id, {
                    trigger_type: patch.trigger_type ?? current.triggerType,
                    trigger_config: (patch.trigger_config ?? current.triggerConfig ?? {}) as Record<string, unknown>,
                    actions: patch.actions ?? current.actions,
                });
            }
            // E6 — sólo si cambian las acciones (pausar una con un agente borrado se puede).
            if (patch.actions !== undefined) await assertAgentRefs(tx, tenantId, list.id, patch.actions);
            const changes: Partial<typeof import('../db/schema').automations.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.description !== undefined) changes.description = patch.description ?? null;
            if (patch.trigger_type !== undefined) changes.triggerType = patch.trigger_type;
            if (patch.trigger_config !== undefined) changes.triggerConfig = patch.trigger_config;
            if (patch.actions !== undefined) changes.actions = patch.actions;
            if (patch.is_active !== undefined) changes.isActive = patch.is_active;
            const updated = await this.repo.update(tx, tenantId, id, changes);
            if (!updated) throw notFound(id);
            // v0.1.288 — pausarla cancela sus esperas (al reactivarla no
            // vuelven: correrían días después con algo que ya no aplica).
            if (patch.is_active === false && current.isActive) {
                await this.repo.cancelWaiting(tx, tenantId, id, 'Se pausó la automatización: la espera no siguió.');
            }
            await this.recordVersion(tx, tenantId, updated, opts.actorId ?? null, restoredNote ?? opts.note ?? null);
            return updated;
        });
        await this.dispatcher?.invalidate(tenantId, list.id);
        await this.scheduler.sync(tenantId, row);
        return toAutomation(await this.syncHook(tenantId, row));
    }

    /**
     * Manda la automatización a la papelera: deja de correr al instante (se
     * quitan sus horarios, la URL de su webhook responde 404 y sus esperas en
     * curso se cancelan) y restaurarla la vuelve a dejar como estaba.
     */
    async remove(tenantId: number, listIdOrSlug: string, id: number, userId: number | null = null): Promise<{ id: number; name: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.listId !== list.id) return null;
            if (!(await trashRow(tx, 'automations', tenantId, id, userId))) return null;
            await cancelWaitingRuns(tx, tenantId, [id], 'La automatización se movió a la papelera: la espera no siguió.');
            return current;
        });
        if (!deleted) throw notFound(id);
        await this.dispatcher?.invalidate(tenantId, list.id);
        await this.scheduler.remove(id);
        // v0.1.285 — lo que ya no existe no puede seguir "fallando".
        this.incidents?.resolve(tenantId, `automation:${id}`);
        return { id: deleted.id, name: deleted.name };
    }

    /**
     * Contexto de PRUEBA de una acción: un registro real de la lista (el
     * indicado o el último) y las mismas funciones de variables que usa el
     * motor (`|label`, `{{date.today}}` en la zona de la empresa). Lo usan el
     * probador de webhooks y el de correos: lo que se prueba es lo que sale.
     */
    private async sampleContext(tenantId: number, listIdOrSlug: string, recordId?: number) {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const sample = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await tx
                .select({ id: fields.id, slug: fields.slug, label: fields.label, type: fields.type, config: fields.config })
                .from(fields)
                .where(eq(fields.listId, list.id));
            const where = recordId
                ? and(
                      eq(records.tenantId, tenantId),
                      eq(records.listId, list.id),
                      eq(records.id, recordId),
                      isNull(records.deletedAt),
                  )
                : and(eq(records.tenantId, tenantId), eq(records.listId, list.id), isNull(records.deletedAt));
            const [row] = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(where)
                .orderBy(desc(records.id))
                .limit(1);
            return {
                slugToKey: new Map(fieldRows.map((f) => [f.slug, `f${f.id}`])),
                fieldsBySlug: new Map(
                    fieldRows.map((f) => [f.slug, { type: f.type, config: f.config, label: f.label }]),
                ),
                record: row ?? null,
            };
        });

        const data = (sample.record?.data ?? {}) as Record<string, unknown>;
        const tz = this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
        const accessor = (token: string): unknown => {
            if (token === 'date.now') return new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (token === 'date.today') return zonedToday(tz);
            const key = sample.slugToKey.get(token.replace(/^before\./, ''));
            return key !== undefined ? data[key] : undefined;
        };
        // v0.1.178 — el probador resuelve `|label` igual que el motor: lo que
        // se prueba es lo que después sale.
        const merge = (raw: unknown): string =>
            applyMergeTags(
                typeof raw === 'string' ? raw : '',
                accessor,
                sample.record?.id ?? null,
                undefined,
                labelResolverFor(sample.fieldsBySlug),
            );
        const mergeHtml = (raw: unknown): string =>
            applyMergeTags(
                typeof raw === 'string' ? raw : '',
                accessor,
                sample.record?.id ?? null,
                escapeHtml,
                labelResolverFor(sample.fieldsBySlug),
            );
        return { ...sample, list, accessor, merge, mergeHtml, timeZone: tz };
    }

    /**
     * v0.1.265 — Probador de correos (ADR-S34). Arma el correo con el MISMO
     * compositor del motor contra un registro real y, si se pide, lo manda a
     * la casilla de QUIEN prueba (nunca a otra: la prueba no es un canal para
     * mandar correos arbitrarios). Sin `send` sólo devuelve el HTML resuelto
     * — la vista «con datos de un registro» del editor.
     */
    async testEmail(
        tenantId: number,
        listIdOrSlug: string,
        input: EmailTestInput,
        user: { id: number; email: string },
    ): Promise<EmailTestResult> {
        const sample = await this.sampleContext(tenantId, listIdOrSlug, input.record_id);
        const cfg = input.config;
        let composed: ComposedEmail;
        try {
            composed = await this.tenantDb.withTenant(tenantId, (tx) =>
                new EmailComposer().compose(tx, {
                    tenantId,
                    cfg,
                    merge: sample.merge,
                    mergeHtml: sample.mergeHtml,
                    fieldsBySlug: sample.fieldsBySlug,
                    fieldValue: (slug) => sample.accessor(slug),
                    timeZone: sample.timeZone,
                }),
            );
        } catch (err) {
            return {
                subject: '',
                html: null,
                text: null,
                sample_record_id: sample.record?.id ?? null,
                sent_to: null,
                error: err instanceof Error ? err.message : String(err),
                signature_note: null,
            };
        }
        const base = {
            subject: composed.subject,
            html: composed.html ?? null,
            text: composed.text ?? null,
            sample_record_id: sample.record?.id ?? null,
            signature_note: composed.signatureNote ?? null,
        };
        if (!input.send) return { ...base, sent_to: null, error: null };
        if (!this.mail) return { ...base, sent_to: null, error: 'El correo no está disponible en este servidor.' };
        // v0.1.266 — los PDF que adjunta la acción, armados con el registro de
        // ejemplo (si no hay registro, la prueba sale sin adjuntos y lo dice).
        const attachments: MailAttachment[] = [];
        const pdfIds = Array.isArray(cfg.pdf_templates)
            ? [...new Set((cfg.pdf_templates as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5)
            : [];
        if (pdfIds.length > 0) {
            if (!this.documents || !sample.record) {
                return { ...base, sent_to: null, error: 'Para probar los PDF adjuntos la lista necesita al menos un registro.' };
            }
            try {
                for (const id of pdfIds) {
                    const doc = await this.tenantDb.withTenant(tenantId, (tx) =>
                        this.documents!.renderTemplateInTx(tx, {
                            tenantId,
                            listId: sample.list.id,
                            recordId: sample.record!.id,
                            templateId: id,
                            actor: { userId: 0, role: 'admin' },
                            // v0.1.290 — Una prueba no emite números ni congela.
                            assign: false,
                        }),
                    );
                    attachments.push({ filename: doc.filename, contentType: 'application/pdf', contentBase64: doc.buffer.toString('base64') });
                }
            } catch (err) {
                return { ...base, sent_to: null, error: `No se pudo armar el PDF adjunto: ${err instanceof Error ? err.message : String(err)}` };
            }
        }
        const attachedInfo = attachments.map((a) => ({ filename: a.filename, bytes: Math.round((a.contentBase64.length * 3) / 4) }));
        try {
            await this.mail.sendNow({
                ...(attachments.length > 0 ? { attachments } : {}),
                tenantId,
                to: user.email,
                subject: `[Prueba] ${composed.subject || '(sin asunto)'}`,
                ...(composed.html !== undefined ? { html: composed.html } : {}),
                ...(composed.text !== undefined ? { text: composed.text } : {}),
                from: typeof cfg.from_email === 'string' && cfg.from_email ? sample.merge(cfg.from_email) : undefined,
                fromName: typeof cfg.from_name === 'string' && cfg.from_name ? sample.merge(cfg.from_name) : undefined,
            });
            return { ...base, sent_to: user.email, error: null, ...(attachedInfo.length > 0 ? { attachments: attachedInfo } : {}) };
        } catch (err) {
            return { ...base, sent_to: null, error: err instanceof Error ? err.message : String(err) };
        }
    }

    /**
     * Probador de webhooks salientes (v0.1.155). Arma la petición con el MISMO
     * builder que el motor, resolviendo las variables contra un registro real
     * de la lista (el indicado o el último), la ejecuta con el guard anti-SSRF
     * y devuelve lo enviado + lo respondido.
     *
     * Configurar una API ajena (un gateway de WhatsApp, un CRM externo) era
     * escribir a ciegas y esperar a que saltara un registro para ver si
     * funcionaba; ahora se ve el cuerpo exacto y el error exacto en el acto.
     */
    async testWebhook(
        tenantId: number,
        listIdOrSlug: string,
        input: WebhookTestInput,
    ): Promise<WebhookTestResult> {
        const sample = await this.sampleContext(tenantId, listIdOrSlug, input.record_id);
        const { merge, mergeHtml } = sample;

        // v0.1.196 — el probador resuelve la CONEXIÓN igual que el motor: si
        // la acción usa un conector, lo que se prueba lleva su credencial.
        const connectionId = Number((input.config as Record<string, unknown>).connection_id);
        let connection = null;
        try {
            if (Number.isFinite(connectionId) && connectionId > 0) {
                connection = await this.connectors.resolveParts(tenantId, connectionId);
            }
        } catch (err) {
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: sample.record?.id ?? null,
            };
        }

        // v0.1.198 — si la acción es de un CONECTOR con nombre, se compila
        // igual que en el motor y lo que se prueba es la misma petición.
        let cfg: Record<string, unknown> = input.config;
        let mergeForBuild = merge;
        const actionKey = (input.config as Record<string, unknown>).action_key;
        if (actionKey !== undefined && actionKey !== null && String(actionKey) !== '') {
            const resolved = await this.connectors
                .resolveAction(tenantId, connectionId, actionKey)
                .catch(() => null);
            if (!resolved?.action) {
                return {
                    request: { url: '', method: 'POST', headers: {}, body: null },
                    response: null,
                    error: resolved
                        ? `«${resolved.name}» ya no tiene la acción «${String(actionKey)}».`
                        : `La conexión #${connectionId} ya no existe.`,
                    sample_record_id: sample.record?.id ?? null,
                };
            }
            const rawValues = ((input.config as Record<string, unknown>).values ?? {}) as Record<string, unknown>;
            // v0.1.203 — una app de la galería: la petición la arma el código
            // de esa app, exactamente como en el motor.
            if (resolved.integration) {
                return this.testIntegration(resolved, rawValues, merge, mergeHtml, sample.record?.id ?? null);
            }
            const call = compileConnectorCall(resolved.action, rawValues, merge);
            if (call.missing.length > 0) {
                return {
                    request: { url: '', method: resolved.action.method, headers: {}, body: null },
                    response: null,
                    error: `Falta completar: ${call.missing.join(', ')}.`,
                    sample_record_id: sample.record?.id ?? null,
                };
            }
            cfg = call.cfg;
            // Los valores ya pasaron por merge en el compilador (ver el motor).
            mergeForBuild = (raw: unknown): string => String(raw ?? '');
        }

        const req = buildWebhookRequest(
            cfg,
            mergeForBuild,
            { recordId: sample.record?.id ?? null, listId: sample.list.id },
            connection,
        );
        // Lo que se MUESTRA no puede volver a filtrar la credencial que
        // acabamos de sacar del jsonb: se tapa dondequiera que haya quedado.
        const hide = connection?.redact ?? [];
        const request = {
            url: redactValues(req.url, hide),
            method: req.method,
            headers: connection ? maskHeaders(req.headers) : req.headers,
            body: req.body !== undefined ? redactValues(req.body, hide) : null,
        };
        if (!req.url) {
            return {
                request,
                response: null,
                error: 'Falta la URL del webhook.',
                sample_record_id: sample.record?.id ?? null,
            };
        }
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
            });
            return {
                request,
                response: { status: res.status, content_type: res.contentType ?? '', body: res.body ?? '' },
                error: null,
                sample_record_id: sample.record?.id ?? null,
            };
        } catch (err) {
            // Un destino bloqueado o caído NO es un 500 de nuestra app: es el
            // resultado de la prueba, y el usuario tiene que poder leerlo.
            return {
                request,
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: sample.record?.id ?? null,
            };
        }
    }

    /** Prueba de una acción de la galería: arma, ejecuta y revisa la respuesta. */
    private async testIntegration(
        resolved: ResolvedAction,
        rawValues: Record<string, unknown>,
        merge: (raw: unknown) => string,
        mergeHtml: (raw: unknown) => string,
        sampleRecordId: number | null,
    ): Promise<WebhookTestResult> {
        const integ = resolved.integration!;
        const action = resolved.action!;
        const hide = [integ.creds.secret, integ.creds.accessToken].filter((v) => v.length >= 4);
        const compiled = compileIntegrationValues(integ.key, action, rawValues, merge, mergeHtml);
        if (compiled.missing.length > 0) {
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: `Falta completar: ${compiled.missing.join(', ')}.`,
                sample_record_id: sampleRecordId,
            };
        }
        // v0.1.251 — un link de cobro no se "prueba" de verdad: crearía un
        // link real a nombre de la empresa. Se muestra lo que se crearía.
        if (integ.key === 'mercadopago' || integ.key === 'wompi') {
            const v = compiled.values;
            const currency = integ.key === 'wompi' ? 'COP' : (v.currency || 'COP');
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: `Así se crearía el link: «${v.title ?? ''}» por ${v.amount ?? ''} ${currency}${v.payer_email ? ` para ${v.payer_email}` : ''}. Para no generar un cobro real, la prueba no lo envía: pruébalo con «Cobrar» en un registro.`,
                sample_record_id: sampleRecordId,
            };
        }
        let req;
        try {
            req = buildIntegrationRequest(integ.key, action.key, compiled, integ.creds);
        } catch (err) {
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: sampleRecordId,
            };
        }
        const request = {
            url: redactValues(req.url, hide),
            method: req.method,
            headers: maskHeaders(req.headers),
            body: req.body !== undefined ? redactValues(req.body, hide) : null,
        };
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
            });
            return {
                request,
                response: {
                    status: res.status,
                    content_type: res.contentType ?? '',
                    body: redactValues(res.body ?? '', hide),
                },
                error: checkIntegrationResponse(integ.key, res.status, res.body ?? ''),
                sample_record_id: sampleRecordId,
            };
        } catch (err) {
            return {
                request,
                response: null,
                error: redactValues(err instanceof Error ? err.message : String(err), hide),
                sample_record_id: sampleRecordId,
            };
        }
    }

    /** «Restauró la versión del 21/10/2026 14:30» (en el formato de la empresa). */
    private async restoredNote(tenantId: number, automationId: number, versionId: number): Promise<string> {
        const found = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [v] = await tx
                .select({ createdAt: automationVersions.createdAt })
                .from(automationVersions)
                .where(and(eq(automationVersions.tenantId, tenantId), eq(automationVersions.automationId, automationId), eq(automationVersions.id, versionId)))
                .limit(1);
            const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
            return { at: v?.createdAt ?? null, settings: (t?.settings ?? {}) as Record<string, unknown> };
        });
        if (!found.at) return 'Restauró una versión anterior';
        const parsed = tenantFormatSchema.safeParse(found.settings.format ?? {});
        const tz = this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
        const when = formatEmailFieldValue({ type: 'datetime', config: {} }, found.at.toISOString(), {
            ...(parsed.success ? parsed.data : { number_format: 'comma_dot', date_format: 'ymd', time_format: 'h24' }),
            timezone: tz,
        });
        return `Restauró la versión del ${when}`;
    }

    /**
     * v0.1.110 — resuelve un token de webhook entrante (endpoint público).
     * Devuelve tenant/automation o null (el caller responde 404 opaco).
     */
    async resolveHookToken(
        token: string,
    ): Promise<{ tenantId: number; automationId: number; readOnly: boolean } | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const [row] = await this.db
            .select({
                tenantId: automationHooks.tenantId,
                automationId: automationHooks.automationId,
                status: tenants.status,
                archivedAt: tenants.archivedAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
                plan: tenants.plan,
                trialEndsAt: tenants.trialEndsAt,
            })
            .from(automationHooks)
            .innerJoin(tenants, eq(tenants.id, automationHooks.tenantId))
            // Papelera: la URL de una automatización borrada responde 404
            // (conexión base: el filtro va a mano) y vuelve al restaurarla.
            .innerJoin(automations, and(eq(automations.id, automationHooks.automationId), isNull(automations.deletedAt)))
            .where(eq(automationHooks.token, token))
            .limit(1);
        if (!row) return null;
        // SEC-34: el estado de la empresa viaja con el token, así el endpoint
        // público rechaza ANTES de capturar o encolar nada.
        return {
            tenantId: row.tenantId,
            automationId: row.automationId,
            // v0.1.338 — pausada también cuenta (no tiene acceso completo).
            readOnly: accessOf(row).state !== 'full',
        };
    }

    /**
     * v0.1.111 — guarda una captura de prueba del webhook entrante (los
     * últimos N payloads recibidos, TTL 24h) para que el editor muestre
     * qué llega y ayude a mapear claves → campos. Best-effort: un fallo de
     * Redis no debe romper la recepción del hook (el caller ya la ignora).
     */
    async captureHookPayload(
        tenantId: number,
        automationId: number,
        payload: Record<string, unknown>,
    ): Promise<void> {
        const key = hookCapturesKey(tenantId, automationId);
        const entry = JSON.stringify({ payload, received_at: new Date().toISOString() });
        await this.captures.lpush(key, entry);
        await this.captures.ltrim(key, 0, HOOK_CAPTURES_MAX - 1);
        await this.captures.expire(key, HOOK_CAPTURES_TTL_S);
    }

    /**
     * v0.1.111 — capturas de prueba del webhook de una automatización
     * (más reciente primero). 404 si la automatización no es del tenant.
     */
    async hookCaptures(tenantId: number, automationId: number): Promise<HookCapture[]> {
        const auto = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, automationId),
        );
        if (!auto) throw notFound(automationId);
        const raw = await this.captures.lrange(
            hookCapturesKey(tenantId, automationId),
            0,
            HOOK_CAPTURES_MAX - 1,
        );
        const out: HookCapture[] = [];
        for (const item of raw) {
            try {
                const parsed = JSON.parse(item) as HookCapture;
                if (parsed && typeof parsed === 'object' && parsed.payload && typeof parsed.received_at === 'string') {
                    out.push({ payload: parsed.payload, received_at: parsed.received_at });
                }
            } catch {
                // entrada corrupta: se ignora
            }
        }
        return out;
    }

    /** Runs de una automatización por id (sin contexto de lista — la ruta del fork). */
    async runsById(
        tenantId: number,
        automationId: number,
        opts: { cursor?: number; limit?: number },
    ): Promise<{ data: AutomationRun[]; meta: { next_cursor: string | null } }> {
        const auto = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, automationId),
        );
        if (!auto) throw notFound(automationId);
        const limit = Math.min(opts.limit ?? 50, 200);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listRuns(tx, tenantId, automationId, { cursor: opts.cursor, limit: limit + 1 }),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map((r) => toRun(r, auto.listId)), meta: { next_cursor: nextCursor } };
    }
}

function toAutomation(row: AutomationRow): Automation {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        description: row.description ?? null,
        trigger_type: row.triggerType,
        trigger_config: row.triggerConfig ?? {},
        actions: row.actions,
        is_active: row.isActive,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function toRun(row: AutomationRunRow, listId: number): AutomationRun {
    return {
        id: row.id,
        automation_id: row.automationId,
        list_id: listId,
        record_id: row.recordId,
        status: row.status as AutomationRunStatus,
        actions_log: row.actionsLog,
        error: row.error ?? null,
        started_at: row.startedAt ? row.startedAt.toISOString() : null,
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
        resume_at: row.status === 'waiting' && row.resumeAt ? row.resumeAt.toISOString() : null,
    };
}

/** v0.1.288 — quién hizo el cambio (para el historial de versiones). */
export interface VersionOpts {
    actorId?: number | null;
    note?: string | null;
}

function hookCapturesKey(tenantId: number, automationId: number): string {
    return `hookcap:${tenantId}:${automationId}`;
}

/** Cuántos días de historial de corridas se conservan. */
export const RUNS_RETENTION_DAYS = 90;

/**
 * Rechaza (400) una automatización a la que le falta lo imprescindible para
 * correr: un «Enviar email» sin «Para», un webhook sin URL, un horario
 * personalizado (cron) inválido… (la lista vive en `automationConfigIssues`,
 * la misma que avisa en el editor). Antes se guardaba ACTIVA y fallaba —o no
 * hacía nada— en silencio.
 */
function assertRunnable(input: Parameters<typeof automationConfigIssues>[0]): void {
    const issues = automationConfigIssues(input);
    if (issues.length === 0) return;
    throw new BadRequestException({
        code: 'automation_incomplete',
        message: issues.length === 1 ? issues[0]!.message : 'A la automatización le falta configurar algunas cosas.',
        data: { status: 400, errors: Object.fromEntries(issues.map((i) => [i.path, i.message])) },
    });
}

function notFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'automation_not_found',
        message: `Automatización ${id} no encontrada`,
        data: { status: 404 },
    });
}

/**
 * v0.1.265 (ADR-S34) — Valida y limpia los diseños de correo de las acciones
 * `send_email` (también dentro de un si/sino): un diseño que no valida se
 * rechaza al GUARDAR (400 con el motivo), no al primer envío; los documentos
 * de texto pasan por la whitelist de `sanitizeRichDoc`.
 */
function normalizeEmailDesigns(actions: unknown, depth = 0): void {
    if (!Array.isArray(actions) || depth > 4) return;
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue;
        const spec = a as { type?: unknown; config?: Record<string, unknown> };
        const cfg = spec.config;
        if (!cfg || typeof cfg !== 'object') continue;
        if (spec.type === 'if_else') {
            normalizeEmailDesigns(cfg.then_actions, depth + 1);
            normalizeEmailDesigns(cfg.else_actions, depth + 1);
            continue;
        }
        if (spec.type !== 'send_email' || cfg.body_mode !== 'design') continue;
        const design = parseEmailDesign(cfg.design);
        if (!design) {
            const issue = emailDesignSchema.safeParse(cfg.design);
            const detail = issue.success ? '' : issue.error.issues[0]?.path.join('.') ?? '';
            throw new BadRequestException({
                code: 'invalid_email_design',
                message: `El diseño del correo no es válido${detail ? ` (${detail})` : ''}.`,
                data: { status: 400 },
            });
        }
        cfg.design = design;
    }
}
