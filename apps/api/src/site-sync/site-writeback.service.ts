import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { connectionSyncs } from '../db/schema';
import type { RecordChange } from '../records/record-change-hub';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SiteSyncEngine } from './site-sync.engine';
import { SiteSyncQueue, type SiteSyncPushJob } from './site-sync.queue';
import { readSiteSettings } from './site-sync.types';
import { planModuleOff } from '../billing/plan-module-gate';

interface WriteTarget {
    syncId: number;
    connectionId: number;
    actorId: number;
    /** Ids de los campos que viajan al sitio (las columnas habilitadas). */
    fieldIds: Set<number>;
}

const TARGETS_TTL_MS = 30_000;

/**
 * Edición en los dos sentidos (v0.1.333, ADR-S83): lo que una PERSONA (o una
 * automatización, o una edición masiva) cambia en una columna habilitada viaja
 * al sitio. Escucha el `RecordChangeHub`; lo que escribe la sincronización no
 * pasa por ahí, así que un cambio nunca rebota en un bucle.
 */
@Injectable()
export class SiteWriteBackService {
    private readonly logger = new Logger(SiteWriteBackService.name);
    private readonly targets = new Map<number, { at: number; byList: Map<number, WriteTarget> }>();
    private credsResolver: ((tenantId: number, syncId: number) => Promise<IntegrationCreds | null>) | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly engine: SiteSyncEngine,
        private readonly queue: SiteSyncQueue,
    ) {}

    setCredsResolver(fn: (tenantId: number, syncId: number) => Promise<IntegrationCreds | null>): void {
        this.credsResolver = fn;
    }

    /** Tras cambiar los ajustes (activar/desactivar la edición, traer una columna). */
    forget(tenantId: number): void {
        this.targets.delete(tenantId);
    }

    async onRecordChange(change: RecordChange): Promise<void> {
        // Un alta hecha en la app no tiene contraparte en el sitio (ni debería existir: la lista no deja crear).
        if (change.kind === 'created') return;
        const target = (await this.writeTargets(change.tenantId)).get(change.listId);
        if (!target) return;
        // v0.1.338 (ADR-S87) — sin «Sitio WordPress» en el plan, no viaja nada.
        if (await this.tenantDb.withTenant(change.tenantId, (tx) => planModuleOff(tx, change.tenantId, 'wordpress'))) return;
        const changed: number[] = [];
        for (const fieldId of target.fieldIds) {
            const key = `f${fieldId}`;
            if (JSON.stringify(change.before[key] ?? null) !== JSON.stringify(change.after[key] ?? null)) changed.push(fieldId);
        }
        if (changed.length === 0) return;
        const job: SiteSyncPushJob = { tenantId: change.tenantId, syncId: target.syncId, recordId: change.recordId, fieldIds: changed };
        // Sin cola (tests, sin Redis) se manda en el acto.
        if (!this.queue.enqueuePush(job)) await this.processPush(job);
    }

    async processPush(job: SiteSyncPushJob, creds: IntegrationCreds | null = null): Promise<void> {
        const c = creds ?? (this.credsResolver ? await this.credsResolver(job.tenantId, job.syncId) : null);
        if (!c) return;
        let error: string | null = null;
        let sent = false;
        try {
            sent = (await this.engine.push(job.tenantId, job.syncId, c, job.recordId, job.fieldIds)) !== null;
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Envío al sitio (sincronización #${job.syncId}, registro ${job.recordId}): ${error}`);
        }
        if (!sent && !error) return;
        const [row] = await this.tenantDb.withTenant(job.tenantId, (tx) =>
            tx
                .select({ connectionId: connectionSyncs.connectionId, createdBy: connectionSyncs.createdBy })
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, job.tenantId), eq(connectionSyncs.id, job.syncId)))
                .limit(1),
        );
        if (row) {
            this.engine.siteIncident({ tenantId: job.tenantId, connectionId: row.connectionId, actorId: row.createdBy ?? 0 }, 'push', error, 'Un cambio hecho en la app no llegó al sitio');
        }
        await this.tenantDb.withTenant(job.tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({
                    state: sql`jsonb_set(
                        ${connectionSyncs.state},
                        '{write_back}',
                        coalesce(${connectionSyncs.state}->'write_back', '{}'::jsonb) || jsonb_build_object(
                            'pushed', coalesce((${connectionSyncs.state}->'write_back'->>'pushed')::int, 0) + ${sent ? 1 : 0}::int,
                            'failed', coalesce((${connectionSyncs.state}->'write_back'->>'failed')::int, 0) + ${error ? 1 : 0}::int,
                            'last_at', ${new Date().toISOString()}::text,
                            'last_error', ${error}::text
                        )
                    )`,
                    updatedAt: new Date(),
                })
                .where(and(eq(connectionSyncs.tenantId, job.tenantId), eq(connectionSyncs.id, job.syncId))),
        );
    }

    /** Qué listas de este tenant mandan cambios a un sitio (cache corta: se consulta en CADA edición). */
    private async writeTargets(tenantId: number): Promise<Map<number, WriteTarget>> {
        const hit = this.targets.get(tenantId);
        if (hit && Date.now() - hit.at < TARGETS_TTL_MS) return hit.byList;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connectionSyncs.id, connectionId: connectionSyncs.connectionId, createdBy: connectionSyncs.createdBy, settings: connectionSyncs.settings })
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.enabled, true), eq(connectionSyncs.provider, 'wordpress'))),
        );
        const byList = new Map<number, WriteTarget>();
        for (const row of rows) {
            const s = readSiteSettings(row.settings);
            if (!s.write_back) continue;
            for (const [resource, o] of Object.entries(s.objects)) {
                const listId = s.lists[resource];
                if (!listId) continue;
                const map = s.fields[resource] ?? {};
                const can = new Set(o.columns.filter((c) => c.can_edit).map((c) => c.key));
                const ids = new Set(o.editable.filter((k) => can.has(k)).map((k) => map[k]).filter((id): id is number => typeof id === 'number'));
                if (ids.size > 0) byList.set(listId, { syncId: row.id, connectionId: row.connectionId, actorId: row.createdBy ?? 0, fieldIds: ids });
            }
        }
        this.targets.set(tenantId, { at: Date.now(), byList });
        return byList;
    }
}
