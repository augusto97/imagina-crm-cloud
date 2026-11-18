import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    INTEGRATION_DEFAULT_BETA,
    INTEGRATION_DEFAULT_HIDDEN,
    INTEGRATION_KEYS,
    INTEGRATION_RETIRING,
    applyIntegrationOverride,
    integrationPolicies,
    integrationPolicy,
    readIntegrationOverrides,
    type IntegrationKey,
    type IntegrationOverrides,
    type IntegrationPolicy,
    type PlatformIntegrationCatalogItem,
    type UpdateIntegrationCatalogInput,
} from '@imagina-base/shared';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { REDIS } from '../redis/redis.module';

/** Subconjunto de ioredis (se testea con un fake en memoria). */
export interface CatalogStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

/** En `platform:*`: es un ajuste del operador y viaja en las copias (ADR-S20). */
const KEY = 'platform:integration-catalog';
const CACHE_MS = 30_000;

/**
 * v0.1.438 — Qué apps de la galería se ofrecen a las empresas y con qué marca
 * (beta, en retiro). Lo de fábrica vive en shared; aquí sólo lo que el
 * operador cambió.
 */
@Injectable()
export class IntegrationCatalogService {
    private readonly logger = new Logger(IntegrationCatalogService.name);
    private cache: { at: number; overrides: IntegrationOverrides } | null = null;

    constructor(
        @Inject(REDIS) private readonly redis: CatalogStore,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    async overrides(): Promise<IntegrationOverrides> {
        const now = Date.now();
        if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.overrides;
        let overrides: IntegrationOverrides = {};
        try {
            const raw = await this.redis.get(KEY);
            overrides = raw ? readIntegrationOverrides(JSON.parse(raw)) : {};
        } catch (err) {
            // Sin Redis (o un valor roto) se usa lo de fábrica: nunca deja la galería vacía.
            this.logger.warn(`No se pudo leer el catálogo de integraciones: ${(err as Error).message}`);
        }
        this.cache = { at: now, overrides };
        return overrides;
    }

    async policies(): Promise<Record<IntegrationKey, IntegrationPolicy>> {
        return integrationPolicies(await this.overrides());
    }

    async policy(key: IntegrationKey): Promise<IntegrationPolicy> {
        return integrationPolicy(key, await this.overrides());
    }

    /** La vista de la consola: cada app con su política, lo de fábrica y cuántas empresas la usan. */
    async list(): Promise<PlatformIntegrationCatalogItem[]> {
        const [overrides, usage] = await Promise.all([this.overrides(), this.usage()]);
        return INTEGRATION_KEYS.map((key) => {
            const p = integrationPolicy(key, overrides);
            const u = usage.get(key);
            return {
                key,
                stage: p.stage,
                hidden: p.hidden,
                hidden_default: INTEGRATION_DEFAULT_HIDDEN.includes(key),
                beta_default: INTEGRATION_DEFAULT_BETA.includes(key),
                customized: overrides[key] !== undefined,
                replacement: INTEGRATION_RETIRING[key]?.replacement ?? null,
                tenants: u?.tenants ?? 0,
                connections: u?.connections ?? 0,
            };
        });
    }

    async update(key: IntegrationKey, patch: UpdateIntegrationCatalogInput): Promise<PlatformIntegrationCatalogItem> {
        const current = await this.readFresh();
        const next = applyIntegrationOverride(current, key, patch);
        await this.redis.set(KEY, JSON.stringify({ overrides: next }));
        this.cache = { at: Date.now(), overrides: next };
        return (await this.list()).find((i) => i.key === key)!;
    }

    /** Lo guardado sin caché (para no pisar un cambio reciente de otro proceso). */
    private async readFresh(): Promise<IntegrationOverrides> {
        const raw = await this.redis.get(KEY);
        return raw ? readIntegrationOverrides(JSON.parse(raw)) : {};
    }

    /** Conexiones por app de las empresas sin archivar. */
    private async usage(): Promise<Map<string, { tenants: number; connections: number }>> {
        const res = (await this.db.execute(sql`
            SELECT c.provider AS key, count(DISTINCT c.tenant_id)::int AS tenants, count(*)::int AS connections
            FROM connections c JOIN tenants t ON t.id = c.tenant_id
            WHERE t.archived_at IS NULL
            GROUP BY c.provider
        `)) as unknown as { rows: Array<{ key: string; tenants: number; connections: number }> };
        return new Map(res.rows.map((r) => [r.key, { tenants: Number(r.tenants), connections: Number(r.connections) }]));
    }
}
