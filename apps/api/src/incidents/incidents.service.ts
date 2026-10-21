import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    INCIDENT_SOURCES,
    type IncidentDto,
    type IncidentSource,
    type IncidentsPage,
    type ListIncidentsQuery,
    type Role,
} from '@imagina-base/shared';
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { incidents, lists, memberships, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { IncidentHub, type IncidentReport } from './incident-hub';

/** Mientras siga abierto, se recuerda a lo sumo una vez por este lapso. */
const RENOTIFY_MS = 24 * 60 * 60 * 1000;
/** Marca en Redis de "hay un problema abierto con esta key" (el camino feliz no toca la base). */
const MARK_TTL_S = 30 * 24 * 3600;
const mark = (tenantId: number, key: string) => `incident:${tenantId}:${key}`;

export interface IncidentViewer {
    userId: number;
    role: Role;
}

/**
 * v0.1.285 (ADR-S44) — Problemas de la empresa.
 *
 * - `report`: abre el problema (o suma una vez más al abierto) y avisa a los
 *   admins + a quien creó lo que falla, por la campana y por correo (tipo de
 *   aviso `failure`, encendido por defecto). Mientras siga abierto, a lo sumo
 *   un recordatorio por día: una automatización que falla cada 5 minutos no
 *   inunda la casilla de nadie.
 * - `resolve`: lo que fallaba volvió a funcionar → el problema se cierra solo.
 *   El camino feliz (cada corrida exitosa) sólo mira una marca en Redis.
 */
@Injectable()
export class IncidentsService implements OnModuleInit {
    private readonly logger = new Logger(IncidentsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly notifications: NotificationsService,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() private readonly hub?: IncidentHub,
    ) {}

    onModuleInit(): void {
        this.hub?.subscribe({
            report: (r) => this.report(r),
            resolve: (t, k) => this.resolve(t, k),
            resolvePrefix: (t, p) => this.resolvePrefix(t, p),
        });
    }

    async report(r: IncidentReport): Promise<void> {
        const key = r.key.slice(0, 120);
        const title = r.title.slice(0, 300);
        const message = r.message.slice(0, 4000);
        const notify = await this.tenantDb.withTenant(r.tenantId, async (tx) => {
            const res = await tx.execute<{ id: string; count: number; first_at: Date | string; notified_at: Date | string | null }>(sql`
                insert into incidents (tenant_id, key, source, source_id, list_id, owner_id, title, message)
                values (${r.tenantId}, ${key}, ${r.source}, ${r.sourceId ?? null}, ${r.listId ?? null}, ${r.ownerId ?? null}, ${title}, ${message})
                on conflict (tenant_id, key) where resolved_at is null
                do update set count = incidents.count + 1, last_at = now(), title = excluded.title, message = excluded.message,
                    source_id = coalesce(excluded.source_id, incidents.source_id),
                    list_id = coalesce(excluded.list_id, incidents.list_id),
                    owner_id = coalesce(excluded.owner_id, incidents.owner_id)
                returning id, count, first_at, notified_at`);
            const row = res.rows[0];
            if (!row) return null;
            // Reclamar el aviso con una condición: dos nodos que fallan a la vez avisan una vez.
            const claimed = await tx.execute<{ id: string }>(sql`
                update incidents set notified_at = now()
                where id = ${Number(row.id)} and (notified_at is null or notified_at < ${new Date(Date.now() - RENOTIFY_MS)})
                returning id`);
            if (claimed.rows.length === 0) return null;
            return { id: Number(row.id), count: Number(row.count), firstAt: new Date(row.first_at), again: row.notified_at !== null };
        });
        await this.redis.set(mark(r.tenantId, key), '1', 'EX', MARK_TTL_S).catch(() => undefined);
        if (!notify) return;

        const recipients = await this.recipients(r.tenantId, r.ownerId ?? null);
        const body = notify.again
            ? `Falló ${notify.count} ${notify.count === 1 ? 'vez' : 'veces'} ${sinceText(notify.firstAt)}. Último error: ${message}`
            : message;
        await this.notifications.deliver(r.tenantId, 'failure', recipients, {
            listId: r.listId ?? null,
            recordId: null,
            actorId: null,
            title: notify.again ? `Sigue fallando: ${lowerFirst(title)}` : title,
            body,
        });
    }

    async resolve(tenantId: number, key: string): Promise<void> {
        const k = key.slice(0, 120);
        // Camino feliz: sin marca no hay nada abierto (si Redis no responde, se mira la base).
        const marked = await this.redis.exists(mark(tenantId, k)).catch(() => 1);
        if (!marked) return;
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(incidents)
                .set({ resolvedAt: new Date() })
                .where(and(eq(incidents.tenantId, tenantId), eq(incidents.key, k), isNull(incidents.resolvedAt))),
        );
        await this.redis.del(mark(tenantId, k)).catch(() => undefined);
    }

    async resolvePrefix(tenantId: number, prefix: string): Promise<void> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(incidents)
                .set({ resolvedAt: new Date() })
                .where(
                    and(
                        eq(incidents.tenantId, tenantId),
                        isNull(incidents.resolvedAt),
                        sql`${incidents.key} like ${`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
                    ),
                )
                .returning({ key: incidents.key }),
        );
        for (const r of rows) await this.redis.del(mark(tenantId, r.key)).catch(() => undefined);
    }

    /** Admins activos de la empresa + quien creó lo que falla. */
    private async recipients(tenantId: number, ownerId: number | null): Promise<number[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'))),
        );
        const ids = rows.map((r) => r.userId);
        if (ownerId !== null) ids.push(ownerId);
        return [...new Set(ids)];
    }

    // ─────────────────────────── Lectura ───────────────────────────

    /** Admin: todos. El resto: los de lo que creó. */
    private scope(tenantId: number, viewer: IncidentViewer): SQL {
        const base = eq(incidents.tenantId, tenantId);
        return viewer.role === 'admin' ? base : and(base, eq(incidents.ownerId, viewer.userId))!;
    }

    async list(tenantId: number, viewer: IncidentViewer, q: ListIncidentsQuery): Promise<IncidentsPage> {
        const scope = this.scope(tenantId, viewer);
        const status =
            q.status === 'open' ? isNull(incidents.resolvedAt) : q.status === 'resolved' ? isNotNull(incidents.resolvedAt) : undefined;
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({
                    id: incidents.id,
                    source: incidents.source,
                    sourceId: incidents.sourceId,
                    listId: incidents.listId,
                    listSlug: lists.slug,
                    listName: lists.name,
                    title: incidents.title,
                    message: incidents.message,
                    count: incidents.count,
                    firstAt: incidents.firstAt,
                    lastAt: incidents.lastAt,
                    resolvedAt: incidents.resolvedAt,
                    resolvedByName: users.name,
                })
                .from(incidents)
                .leftJoin(lists, eq(lists.id, incidents.listId))
                .leftJoin(users, eq(users.id, incidents.resolvedBy))
                .where(status ? and(scope, status) : scope)
                .orderBy(desc(incidents.lastAt))
                .limit(q.limit);
            const [open] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(incidents)
                .where(and(scope, isNull(incidents.resolvedAt)));
            return {
                items: rows.map(
                    (r): IncidentDto => ({
                        id: r.id,
                        source: (INCIDENT_SOURCES as readonly string[]).includes(r.source) ? (r.source as IncidentSource) : 'automation',
                        source_id: r.sourceId,
                        list_id: r.listId,
                        list_slug: r.listSlug ?? null,
                        list_name: r.listName ?? null,
                        title: r.title,
                        message: r.message,
                        count: r.count,
                        first_at: r.firstAt.toISOString(),
                        last_at: r.lastAt.toISOString(),
                        resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
                        resolved_by_name: r.resolvedByName ?? null,
                    }),
                ),
                open: open?.n ?? 0,
            };
        });
    }

    /** «Ya lo arreglé»: lo cierra a mano. Si vuelve a fallar, se abre otro (y se avisa). */
    async markResolved(tenantId: number, viewer: IncidentViewer, id: number): Promise<void> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [found] = await tx
                .select({ key: incidents.key, ownerId: incidents.ownerId, resolvedAt: incidents.resolvedAt })
                .from(incidents)
                .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, id)))
                .limit(1);
            if (!found) throw new NotFoundException({ code: 'not_found', message: 'Ese problema no existe.' });
            if (viewer.role !== 'admin' && found.ownerId !== viewer.userId) {
                throw new ForbiddenException({ code: 'forbidden', message: 'Sólo un admin o quien lo creó puede marcarlo como resuelto.' });
            }
            if (found.resolvedAt) return null;
            await tx
                .update(incidents)
                .set({ resolvedAt: new Date(), resolvedBy: viewer.userId })
                .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, id)));
            return found;
        });
        if (row) await this.redis.del(mark(tenantId, row.key)).catch(() => undefined);
    }

}

function sinceText(first: Date): string {
    const days = Math.floor((Date.now() - first.getTime()) / 86_400_000);
    return days <= 0 ? 'desde hoy' : `desde hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function lowerFirst(s: string): string {
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
