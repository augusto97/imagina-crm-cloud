import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
    businessCalendarOf,
    computeSlaClock,
    formatEmailFieldValue,
    jsonbKeyForField,
    readHelpdeskSettings,
    resolveTitleFieldId,
    sameBulkValue,
    SLA_ALERT_LABELS,
    SLA_STATUS_LABELS,
    SLA_TARGET_LABELS,
    slaTargetsFor,
    tenantFormatSchema,
    type Field,
    type HelpdeskSettings,
    type HelpdeskSlaDto,
    type List,
    type SlaAlertKind,
    type SlaEventInfo,
    type SlaStatusValue,
    type SlaTargetKind,
    type TenantFormat,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { helpdeskTickets, memberships, records, tenants, type HelpdeskTicketRow, type StoredPause } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotifyHub, type NotifyEvent } from '../notifications/notify-hub';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TeamsService } from '../teams/teams.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { staffRoleInSql, staffRoleSql } from './staff-roles';

const SYSTEM_ACTOR: Actor = { userId: 0, role: 'admin' };
/** Tickets por vuelta del planificador. */
const TICK_BATCH = 500;
/** Tope de tickets que se crean/recalculan al activar o cambiar la política. */
const RECONCILE_MAX = 5000;

interface ListCtx {
    list: List;
    settings: HelpdeskSettings;
    fields: Field[];
    timeZone: string;
    /** Formato regional de la empresa (las fechas de los avisos). */
    format: TenantFormat;
}

interface PendingAlert {
    kind: SlaTargetKind;
    alert: SlaAlertKind;
    due: string | null;
}

/** `2026-10-28T19:00:00.000Z` → `2026-10-28T19:00:00Z` (como lo guarda la app). */
function isoNoMs(v: string | null): string | null {
    return v === null ? null : v.replace(/\.\d{3}Z$/, 'Z');
}

/**
 * E5 — El reloj del SLA de cada ticket y sus avisos.
 *
 * El estado vive en `helpdesk_tickets` (cuándo empezó, objetivos de su
 * prioridad, primera respuesta, resolución, pausas) y se recalcula con la
 * función pura de shared (`computeSlaClock`, horas hábiles + festivos de
 * Colombia en la zona de la empresa). Lo calculado se escribe en las
 * COLUMNAS guardadas de la lista (vencimientos y «Estado del SLA») para que
 * filtren, ordenen, agrupen y salgan en el calendario y «Mi trabajo» como
 * cualquier campo.
 *
 * Cuándo se recalcula: al crearse un registro, al cambiar su estado o su
 * prioridad (`RecordChangeHub`), con la primera respuesta (correo saliente o
 * comentario visible para el cliente) y por el planificador cuando llega el
 * próximo umbral (`next_check_at`, indexado). Los avisos «en riesgo» y
 * «vencido» se registran en `alerts` con un UPDATE condicional dentro de la
 * transacción que bloquea el ticket: uno por ticket y por umbral, aunque
 * corran dos nodos.
 */
@Injectable()
export class HelpdeskSlaService implements OnModuleInit {
    private readonly logger = new Logger(HelpdeskSlaService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly dispatcher: AutomationDispatcher,
        @Optional() private readonly notifications?: NotificationsService,
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
        // C1 — avisar / escalar a un equipo (sus personas en el momento del aviso).
        @Optional() private readonly teams?: TeamsService,
    ) {}

    onModuleInit(): void {
        this.changes?.subscribe((c) => this.onRecordChange(c));
        this.notify?.subscribe((e) => this.onNotify(e));
    }

    // ── Eventos ──────────────────────────────────────────────────────────

    async onRecordChange(c: RecordChange): Promise<void> {
        const list = c.list ?? (await this.lists.get(c.tenantId, String(c.listId)).catch(() => null));
        if (!list) return;
        const settings = readHelpdeskSettings(list.settings);
        if (!settings.sla.enabled) return;
        if (c.kind === 'created') {
            await this.ensureTicket(c.tenantId, list.id, c.recordId, { data: c.after, settings });
            await this.recompute(c.tenantId, c.recordId);
            return;
        }
        const statusKey = settings.status_field_id ? jsonbKeyForField(settings.status_field_id) : null;
        const prioKey = settings.sla.priority_field_id ? jsonbKeyForField(settings.sla.priority_field_id) : null;
        const statusChanged = statusKey !== null && !sameBulkValue(c.before[statusKey] ?? null, c.after[statusKey] ?? null, false);
        const prioChanged = prioKey !== null && !sameBulkValue(c.before[prioKey] ?? null, c.after[prioKey] ?? null, false);
        if (!statusChanged && !prioChanged) return;
        await this.ensureTicket(c.tenantId, list.id, c.recordId, { data: c.before, settings });
        if (statusChanged) {
            await this.applyStatus(c.tenantId, c.recordId, settings, str(c.before[statusKey!]), str(c.after[statusKey!]));
        }
        await this.recompute(c.tenantId, c.recordId);
    }

    /** Un comentario VISIBLE para el cliente escrito por el equipo cuenta como respuesta. */
    async onNotify(e: NotifyEvent): Promise<void> {
        if (e.type !== 'comment' || e.visibility !== 'client' || e.fromClient || e.actorId <= 0) return;
        await this.markFirstResponse(e.tenantId, e.recordId, new Date());
    }

    // ── Ticket ───────────────────────────────────────────────────────────

    /**
     * Crea la fila del ticket si no existe (los datos del cliente los completa
     * el lector del buzón). El estado inicial ya puede estar cerrado o en
     * pausa (un registro creado así, o la política activada después).
     */
    async ensureTicket(
        tenantId: number,
        listId: number,
        recordId: number,
        opts: {
            data?: Record<string, unknown>;
            settings?: HelpdeskSettings;
            startedAt?: Date;
            customerEmail?: string | null;
            customerName?: string | null;
            subject?: string | null;
            mailboxId?: number | null;
        } = {},
    ): Promise<void> {
        const settings = opts.settings;
        const status = settings?.status_field_id ? str(opts.data?.[jsonbKeyForField(settings.status_field_id)]) : null;
        const now = new Date();
        const closed = status !== null && settings !== undefined && settings.closed_statuses.includes(status);
        const paused = status !== null && settings !== undefined && settings.paused_statuses.includes(status);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const customer = {
                ...(opts.customerEmail !== undefined ? { customerEmail: opts.customerEmail } : {}),
                ...(opts.customerName !== undefined ? { customerName: opts.customerName } : {}),
                ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
                ...(opts.mailboxId !== undefined ? { mailboxId: opts.mailboxId } : {}),
            };
            await tx
                .insert(helpdeskTickets)
                .values({
                    tenantId,
                    listId,
                    recordId,
                    startedAt: opts.startedAt ?? now,
                    resolvedAt: closed ? now : null,
                    pauses: paused ? [{ from: now.toISOString(), to: null }] : [],
                    ...customer,
                })
                .onConflictDoUpdate({
                    target: helpdeskTickets.recordId,
                    set: { ...customer, ...(opts.startedAt ? { startedAt: opts.startedAt } : {}), updatedAt: now },
                });
        });
    }

    /** Transición de estado: cerrar, reabrir, pausar o reanudar el reloj. */
    private async applyStatus(tenantId: number, recordId: number, s: HelpdeskSettings, before: string | null, after: string | null): Promise<void> {
        const now = new Date().toISOString();
        const wasClosed = before !== null && s.closed_statuses.includes(before);
        const isClosed = after !== null && s.closed_statuses.includes(after);
        const wasPaused = before !== null && s.paused_statuses.includes(before);
        const isPaused = after !== null && s.paused_statuses.includes(after);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx
                .select()
                .from(helpdeskTickets)
                .where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId)))
                .for('update')
                .limit(1);
            if (!t) return;
            let pauses: StoredPause[] = Array.isArray(t.pauses) ? [...t.pauses] : [];
            const closeOpen = (): void => {
                pauses = pauses.map((p) => (p.to === null ? { ...p, to: now } : p));
            };
            let resolvedAt = t.resolvedAt;
            if (isClosed && !wasClosed) {
                resolvedAt = new Date(now);
                closeOpen();
            } else if (wasClosed && !isClosed) {
                // Reabierto: el reloj de resolución sigue desde donde empezó.
                resolvedAt = null;
            }
            if (isPaused && !wasPaused && !pauses.some((p) => p.to === null)) pauses.push({ from: now, to: null });
            if (wasPaused && !isPaused) closeOpen();
            await tx
                .update(helpdeskTickets)
                .set({ resolvedAt, pauses: pauses.slice(-200), updatedAt: new Date() })
                .where(eq(helpdeskTickets.id, t.id));
        });
    }

    /** La primera respuesta al cliente (correo saliente o comentario visible para él). */
    async markFirstResponse(tenantId: number, recordId: number, at: Date): Promise<void> {
        const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(helpdeskTickets)
                .set({ firstResponseAt: at, lastOutboundAt: at, updatedAt: new Date() })
                .where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId), sql`${helpdeskTickets.firstResponseAt} IS NULL`))
                .returning({ id: helpdeskTickets.id }),
        );
        if (updated.length > 0) await this.recompute(tenantId, recordId);
    }

    // ── Recalcular ───────────────────────────────────────────────────────

    private async listCtx(tenantId: number, listId: number): Promise<ListCtx | null> {
        const list = await this.lists.get(tenantId, String(listId)).catch(() => null);
        if (!list) return null;
        const [tenant] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));
        const fmt = tenantFormatSchema.safeParse(((tenant?.settings ?? {}) as Record<string, unknown>).format ?? {});
        return {
            list,
            settings: readHelpdeskSettings(list.settings),
            fields: await this.fields.listByListId(tenantId, list.id),
            timeZone: this.timeZones ? await this.timeZones.orUtc(tenantId) : 'UTC',
            format: fmt.success ? fmt.data : tenantFormatSchema.parse({}),
        };
    }

    /**
     * Recalcula el SLA de un ticket en `now`: guarda vencimientos y estado en
     * la fila del ticket y en las columnas de la lista, y dispara los avisos
     * que correspondan (una sola vez por umbral).
     */
    async recompute(tenantId: number, recordId: number, opts: { now?: Date } = {}): Promise<HelpdeskSlaDto | null> {
        const now = opts.now ?? new Date();
        const [head] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ listId: helpdeskTickets.listId }).from(helpdeskTickets).where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId))).limit(1),
        );
        if (!head) return null;
        const ctx = await this.listCtx(tenantId, head.listId);
        if (!ctx) return null;
        const policy = ctx.settings.sla;

        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx
                .select()
                .from(helpdeskTickets)
                .where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId)))
                .for('update')
                .limit(1);
            const [rec] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.id, recordId), sql`${records.deletedAt} IS NULL`))
                .limit(1);
            if (!t || !rec) return null;
            const data = (rec.data ?? {}) as Record<string, unknown>;
            if (!policy.enabled) {
                await tx.update(helpdeskTickets).set({ slaStatus: null, nextCheckAt: null, updatedAt: new Date() }).where(eq(helpdeskTickets.id, t.id));
                return { dto: null, patch: null, before: data, alerts: [] as PendingAlert[], ticket: t };
            }
            const prio = policy.priority_field_id ? str(data[jsonbKeyForField(policy.priority_field_id)]) : null;
            const targets = slaTargetsFor(policy, prio);
            const frm = targets?.first_response_hours != null ? Math.round(targets.first_response_hours * 60) : null;
            const res = targets?.resolution_hours != null ? Math.round(targets.resolution_hours * 60) : null;
            const clock = computeSlaClock(
                {
                    started_at: t.startedAt.toISOString(),
                    first_response_minutes: frm,
                    resolution_minutes: res,
                    first_response_at: t.firstResponseAt?.toISOString() ?? null,
                    resolved_at: t.resolvedAt?.toISOString() ?? null,
                    pauses: Array.isArray(t.pauses) ? t.pauses : [],
                    calendar: businessCalendarOf(policy.calendar, ctx.timeZone),
                    at_risk_percent: policy.at_risk_percent,
                },
                now,
            );
            await tx
                .update(helpdeskTickets)
                .set({
                    priority: prio,
                    firstResponseMinutes: frm,
                    resolutionMinutes: res,
                    slaStatus: clock.status,
                    firstResponseDue: clock.first_response.due ? new Date(clock.first_response.due) : null,
                    resolutionDue: clock.resolution.due ? new Date(clock.resolution.due) : null,
                    nextCheckAt: clock.next_check_at ? new Date(clock.next_check_at) : null,
                    updatedAt: new Date(),
                })
                .where(eq(helpdeskTickets.id, t.id));

            // Las columnas guardadas (sólo si cambian: el planificador no reescribe en vano).
            const patch: Record<string, unknown> = {};
            const put = (fieldId: number | null, value: unknown): void => {
                if (fieldId === null || !ctx.fields.some((f) => f.id === fieldId)) return;
                const key = jsonbKeyForField(fieldId);
                if (!sameBulkValue(data[key] ?? null, value ?? null, false)) patch[key] = value;
            };
            put(policy.first_due_field_id, isoNoMs(clock.first_response.due));
            put(policy.resolution_due_field_id, isoNoMs(clock.resolution.due));
            put(policy.sla_status_field_id, clock.status);
            if (Object.keys(patch).length > 0) {
                const [r] = await tx
                    .update(records)
                    .set({ data: sql`${records.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date(), updatedBy: 0 })
                    .where(and(eq(records.tenantId, tenantId), eq(records.id, recordId)))
                    .returning({ data: records.data });
                if (r) {
                    await this.activity.logInTx(tx, {
                        tenantId,
                        listId: ctx.list.id,
                        recordId,
                        userId: null,
                        action: 'record_updated',
                        diff: computeDiff(data, (r.data ?? {}) as Record<string, unknown>),
                    });
                }
            }

            // Avisos: uno por ticket y por umbral (UPDATE condicional en esta tx).
            const alerts: PendingAlert[] = [];
            for (const target of [clock.first_response, clock.resolution]) {
                const wanted: SlaAlertKind | null = target.state === 'breached' ? 'breached' : target.state === 'at_risk' ? 'at_risk' : null;
                if (!wanted) continue;
                const keys = wanted === 'breached' ? [`${target.kind}:at_risk`, `${target.kind}:breached`] : [`${target.kind}:at_risk`];
                const fresh = keys.filter((k) => !(t.alerts ?? {})[k]);
                if (fresh.length === 0) continue;
                const stamp = Object.fromEntries(fresh.map((k) => [k, now.toISOString()]));
                const ok = await tx
                    .update(helpdeskTickets)
                    .set({ alerts: sql`${helpdeskTickets.alerts} || ${JSON.stringify(stamp)}::jsonb` })
                    .where(and(eq(helpdeskTickets.id, t.id), sql`NOT (${helpdeskTickets.alerts} ?| ARRAY[${sql.join(fresh.map((k) => sql`${k}`), sql`, `)}]::text[])`))
                    .returning({ id: helpdeskTickets.id });
                // Sólo el umbral nuevo de verdad se avisa (vencido sin pasar por «en riesgo»: uno solo).
                if (ok.length > 0 && fresh.includes(`${target.kind}:${wanted}`)) alerts.push({ kind: target.kind, alert: wanted, due: target.due });
            }
            const dto: HelpdeskSlaDto = {
                status: clock.status,
                first_response_due: clock.first_response.due,
                resolution_due: clock.resolution.due,
                first_response_at: t.firstResponseAt?.toISOString() ?? null,
                resolved_at: t.resolvedAt?.toISOString() ?? null,
                paused: clock.paused,
                priority: prio,
            };
            return { dto, patch: Object.keys(patch).length > 0 ? patch : null, before: data, alerts, ticket: t };
        });
        if (!out) return null;
        if (out.patch) this.realtime.records(tenantId, ctx.list.id);
        for (const a of out.alerts) {
            await this.sendAlert(tenantId, ctx, recordId, { ...out.before, ...(out.patch ?? {}) }, a, out.dto?.status ?? null, out.dto?.priority ?? null).catch((err: unknown) =>
                this.logger.warn(`Aviso de SLA del registro ${recordId}: ${err instanceof Error ? err.message : String(err)}`),
            );
        }
        return out.dto;
    }

    /**
     * Avisa a quien la política indica (personas, roles y el responsable del
     * ticket), escala al vencer (más personas/roles y, si se eligió, pone un
     * campo) y dispara las automatizaciones «Cuando un SLA está en riesgo o se
     * vence». Un invitado o un cliente del portal nunca reciben estos avisos.
     */
    private async sendAlert(
        tenantId: number,
        ctx: ListCtx,
        recordId: number,
        data: Record<string, unknown>,
        a: PendingAlert,
        status: SlaStatusValue | null,
        priority: string | null,
    ): Promise<void> {
        const p = ctx.settings.sla;
        const titleId = resolveTitleFieldId(ctx.fields, ctx.list.settings);
        const rawTitle = titleId ? data[jsonbKeyForField(titleId)] : null;
        const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : `Registro #${recordId}`;
        const when = a.due ? this.formatInstant(a.due, ctx) : null;
        const label = SLA_TARGET_LABELS[a.kind];

        const users = new Set<number>(p.notify_user_ids);
        const roles = new Set<string>(p.notify_roles);
        if (p.notify_assignee_field_id) {
            const v = Number(data[jsonbKeyForField(p.notify_assignee_field_id)]);
            if (Number.isInteger(v) && v > 0) users.add(v);
        }
        const teamIds = new Set<number>(p.notify_team_ids);
        if (a.alert === 'breached') {
            p.escalate_user_ids.forEach((u) => users.add(u));
            p.escalate_roles.forEach((r) => roles.add(r));
            p.escalate_team_ids.forEach((t) => teamIds.add(t));
        }
        if (teamIds.size > 0 && this.teams) {
            const teams = this.teams;
            const members = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const out: number[] = [];
                for (const t of teamIds) out.push(...(await teams.memberIds(tx, t)));
                return out;
            });
            members.forEach((u) => users.add(u));
        }
        if (roles.size > 0) {
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ userId: memberships.userId })
                    .from(memberships)
                    .where(and(eq(memberships.tenantId, tenantId), staffRoleInSql([...roles]))),
            );
            rows.forEach((r) => users.add(r.userId));
        }
        const recipients = await this.staffOnly(tenantId, [...users]);
        if (recipients.length > 0 && this.notifications) {
            await this.notifications.deliver(tenantId, 'sla', recipients, {
                listId: ctx.list.id,
                recordId,
                actorId: null,
                title:
                    a.alert === 'breached'
                        ? `Se venció la ${label} de «${title}»`
                        : `«${title}» está en riesgo: la ${label} vence ${when ?? 'pronto'}`,
                body: [
                    `SLA ${SLA_ALERT_LABELS[a.alert]} · ${label}`,
                    when ? `Vence: ${when}` : null,
                    priority ? `Prioridad: ${this.optionLabel(ctx.fields, p.priority_field_id, priority)}` : null,
                    status ? `Estado del SLA: ${SLA_STATUS_LABELS[status]}` : null,
                ]
                    .filter(Boolean)
                    .join('\n'),
            });
        }
        // Escalar: poner un campo (por la edición normal: valida, deja actividad y dispara automatizaciones).
        if (a.alert === 'breached' && p.escalate_set_field_id) {
            const field = ctx.fields.find((f) => f.id === p.escalate_set_field_id);
            const value = field?.type === 'user' ? p.escalate_set_user_id : field?.type === 'checkbox' ? true : p.escalate_set_value;
            if (field && value !== null && value !== undefined) {
                await this.records
                    .update(tenantId, SYSTEM_ACTOR, String(ctx.list.id), recordId, { data: { [jsonbKeyForField(field.id)]: value } })
                    .catch((err: unknown) => this.logger.warn(`Escalamiento del registro ${recordId}: ${err instanceof Error ? err.message : String(err)}`));
            }
        }
        const info: SlaEventInfo = {
            alerta: a.alert,
            objetivo: a.kind,
            vence: a.due,
            prioridad: priority ? this.optionLabel(ctx.fields, p.priority_field_id, priority) : null,
            estado: status,
        };
        this.dispatcher.dispatch({ tenantId, listId: ctx.list.id, recordId, trigger: 'sla_alert', after: data, sla: info });
    }

    /** Sólo miembros del equipo (ni clientes del portal, ni invitados, ni cuentas ajenas). */
    private async staffOnly(tenantId: number, ids: number[]): Promise<number[]> {
        if (ids.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids), staffRoleSql())),
        );
        return rows.map((r) => r.userId);
    }

    private optionLabel(fields: Field[], fieldId: number | null, value: string): string {
        const f = fields.find((x) => x.id === fieldId);
        const opts = ((f?.config as { options?: Array<{ value?: string; label?: string }> } | undefined)?.options ?? []);
        return opts.find((o) => o.value === value)?.label ?? value;
    }

    /** Un instante en el formato y la zona de la empresa («21/10/2026 14:30»). */
    private formatInstant(iso: string, ctx: ListCtx): string {
        const at = new Date(iso);
        if (Number.isNaN(at.getTime())) return iso;
        return formatEmailFieldValue({ type: 'datetime', config: {} }, at.toISOString(), { ...ctx.format, timezone: ctx.timeZone });
    }

    // ── Planificador ─────────────────────────────────────────────────────

    /** Los tickets cuyo SLA cambia de estado ahora (por índice). Todas las empresas. */
    async tick(now: Date = new Date()): Promise<number> {
        const due = await this.db
            .select({ tenantId: helpdeskTickets.tenantId, recordId: helpdeskTickets.recordId, id: helpdeskTickets.id })
            .from(helpdeskTickets)
            .where(
                and(
                    isNotNull(helpdeskTickets.nextCheckAt),
                    lte(helpdeskTickets.nextCheckAt, now),
                    // Papelera: un ticket borrado no avisa (conexión base: el filtro va a mano).
                    sql`NOT EXISTS (SELECT 1 FROM records r WHERE r.id = ${helpdeskTickets.recordId} AND r.deleted_at IS NOT NULL)`,
                ),
            )
            .orderBy(asc(helpdeskTickets.nextCheckAt))
            .limit(TICK_BATCH);
        for (const d of due) {
            try {
                await this.recompute(d.tenantId, d.recordId, { now });
            } catch (err) {
                this.logger.warn(`SLA del registro ${d.recordId}: ${err instanceof Error ? err.message : String(err)}`);
                // Que un ticket roto no se reintente cada minuto para siempre.
                await this.db
                    .update(helpdeskTickets)
                    .set({ nextCheckAt: new Date(now.getTime() + 10 * 60_000) })
                    .where(eq(helpdeskTickets.id, d.id));
            }
        }
        return due.length;
    }

    /**
     * La política se activó o cambió: los registros vivos sin ticket lo reciben
     * (desde que se crearon) y se recalculan todos los de la lista.
     */
    async reconcileList(tenantId: number, listId: number): Promise<number> {
        const ctx = await this.listCtx(tenantId, listId);
        if (!ctx) return 0;
        if (ctx.settings.sla.enabled) {
            const missing = await this.tenantDb.withTenant(tenantId, (tx: Tx) =>
                tx
                    .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, listId),
                            sql`${records.deletedAt} IS NULL`,
                            sql`NOT EXISTS (SELECT 1 FROM helpdesk_tickets t WHERE t.record_id = ${records.id})`,
                        ),
                    )
                    .orderBy(asc(records.id))
                    .limit(RECONCILE_MAX),
            );
            for (const r of missing) {
                await this.ensureTicket(tenantId, listId, r.id, { data: (r.data ?? {}) as Record<string, unknown>, settings: ctx.settings, startedAt: r.createdAt });
            }
        }
        const all = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ recordId: helpdeskTickets.recordId })
                .from(helpdeskTickets)
                .where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.listId, listId)))
                .orderBy(asc(helpdeskTickets.id))
                .limit(RECONCILE_MAX),
        );
        for (const t of all) await this.recompute(tenantId, t.recordId).catch(() => undefined);
        return all.length;
    }

    /** El SLA de un ticket para la ficha (null si no hay ticket). */
    async forRecord(tenantId: number, recordId: number): Promise<HelpdeskSlaDto | null> {
        const [t] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(helpdeskTickets).where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId))).limit(1),
        );
        return t ? slaDtoOf(t) : null;
    }
}

export function slaDtoOf(t: HelpdeskTicketRow): HelpdeskSlaDto {
    return {
        status: (t.slaStatus as SlaStatusValue | null) ?? null,
        first_response_due: t.firstResponseDue?.toISOString() ?? null,
        resolution_due: t.resolutionDue?.toISOString() ?? null,
        first_response_at: t.firstResponseAt?.toISOString() ?? null,
        resolved_at: t.resolvedAt?.toISOString() ?? null,
        paused: (Array.isArray(t.pauses) ? t.pauses : []).some((p) => p.to === null) && t.resolvedAt === null,
        priority: t.priority,
    };
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : null;
}
