import { Injectable, Logger, Optional } from '@nestjs/common';
import { FALLBACK_TIME_ZONE, isValidTimeZone, subscriptionCron, type DashboardSubscriptionInput } from '@imagina-base/shared';
import type { Queue } from 'bullmq';
import type { dashboardSubscriptions } from '../db/schema';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

type Row = typeof dashboardSubscriptions.$inferSelect;

export const DASHBOARD_REPORTS_QUEUE = 'dashboard-reports';
export const SEND_JOB = 'send';

export const schedulerId = (id: number) => `dashsub:${id}`;

/**
 * v0.1.292 (ADR-S50) — Un job scheduler de BullMQ por suscripción (vive en
 * Redis: sobrevive reinicios). La zona: la propia del envío o, si no tiene,
 * la de la EMPRESA (la misma regla de las automatizaciones, v0.1.263); UTC
 * sólo como último recurso. No-op sin cola (tests sin Redis).
 */
@Injectable()
export class DashboardSubscriptionScheduler {
    private readonly logger = new Logger(DashboardSubscriptionScheduler.name);
    private queue: Queue | null = null;

    constructor(@Optional() private readonly timeZones?: TenantTimeZones) {}

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    hasQueue(): boolean {
        return this.queue !== null;
    }

    async sync(tenantId: number, row: Row): Promise<void> {
        if (!this.queue) return;
        try {
            await this.remove(row.id);
            if (!row.enabled) return;
            const tenantTz = this.timeZones ? await this.timeZones.get(tenantId) : null;
            const tz = isValidTimeZone(row.timeZone) ? row.timeZone : isValidTimeZone(tenantTz) ? tenantTz : FALLBACK_TIME_ZONE;
            const pattern = subscriptionCron({
                frequency: row.frequency as DashboardSubscriptionInput['frequency'],
                weekdays: row.weekdays ?? [],
                month_day: row.monthDay,
                hour: row.hour,
                minute: row.minute,
            });
            await this.queue.upsertJobScheduler(
                schedulerId(row.id),
                { pattern, tz },
                { name: SEND_JOB, data: { tenantId, subscriptionId: row.id } },
            );
        } catch (err) {
            this.logger.error(`No se pudo programar el envío ${row.id}: ${String(err)}`);
        }
    }

    async remove(id: number): Promise<void> {
        if (!this.queue) return;
        await this.queue.removeJobScheduler(schedulerId(id)).catch(() => undefined);
    }

    /** Lo que BullMQ tiene registrado (tests y diagnóstico). */
    async describe(id: number): Promise<{ pattern?: string | null; tz?: string | null } | null> {
        if (!this.queue) return null;
        const s = await this.queue.getJobScheduler(schedulerId(id));
        return s ? { pattern: s.pattern ?? null, tz: s.tz ?? null } : null;
    }
}
