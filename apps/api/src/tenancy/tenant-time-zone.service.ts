import { Injectable } from '@nestjs/common';
import { FALLBACK_TIME_ZONE, tenantFormatSchema } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema';
import type { Tx } from '../db/client';
import { TenantDb } from './tenant-db.service';

const TTL_MS = 30_000;

/**
 * v0.1.263 — La zona horaria de cada empresa (`tenants.settings.format.
 * timezone`), con caché corta: se consulta en caminos calientes (cada filtro
 * con "hoy", cada escaneo de vencimientos) y cambia una vez en la vida.
 * `null` = la empresa todavía no eligió una; `orUtc` da la que hay que usar.
 */
@Injectable()
export class TenantTimeZones {
    private readonly cache = new Map<number, { tz: string | null; at: number }>();

    constructor(private readonly tenantDb: TenantDb) {}

    /** La zona elegida por la empresa, o null. */
    async get(tenantId: number, tx?: Tx): Promise<string | null> {
        const hit = this.cache.get(tenantId);
        if (hit && Date.now() - hit.at < TTL_MS) return hit.tz;
        const read = (t: Tx) =>
            t.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const [row] = tx ? await read(tx) : await this.tenantDb.withTenant(tenantId, read);
        const tz = parseTenantTimeZone(row?.settings);
        this.cache.set(tenantId, { tz, at: Date.now() });
        return tz;
    }

    /** La zona a usar: la de la empresa o UTC. */
    async orUtc(tenantId: number, tx?: Tx): Promise<string> {
        return (await this.get(tenantId, tx)) ?? FALLBACK_TIME_ZONE;
    }

    /** Tras cambiarla (o en tests). */
    invalidate(tenantId: number): void {
        this.cache.delete(tenantId);
    }

    /**
     * Quien depende de la zona (los horarios de automatizaciones en BullMQ)
     * se entera de un cambio por acá, sin que el módulo de ajustes tenga que
     * conocerlo.
     */
    onChange(listener: (tenantId: number) => Promise<void> | void): void {
        this.listeners.push(listener);
    }

    /** La empresa cambió su zona: limpia la caché y avisa. */
    async changed(tenantId: number): Promise<void> {
        this.invalidate(tenantId);
        for (const l of this.listeners) {
            try {
                await l(tenantId);
            } catch {
                // Un listener que falla no frena el guardado de la zona.
            }
        }
    }

    private readonly listeners: Array<(tenantId: number) => Promise<void> | void> = [];
}

/** Lee la zona de `tenants.settings` (tolerante a datos viejos o rotos). */
export function parseTenantTimeZone(settings: unknown): string | null {
    const raw = (settings as Record<string, unknown> | null | undefined)?.format ?? {};
    const parsed = tenantFormatSchema.safeParse(raw);
    return parsed.success ? parsed.data.timezone : null;
}
