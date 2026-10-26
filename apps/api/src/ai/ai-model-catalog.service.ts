import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
    AI_EFFORT_LEVELS,
    buildAiModelCatalog,
    resolveAiModelChoice,
    type AiModelCaps,
    type AiModelCatalog,
    type AiModelInfo,
    type AiModelResolution,
} from '@imagina-base/shared';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/** Lo que devuelve el proveedor por modelo (subconjunto tolerante de `ModelInfo`). */
export interface ProviderModel {
    id: string;
    display_name?: string | null;
    created_at?: string | null;
    max_input_tokens?: number | null;
    capabilities?: unknown;
}

/**
 * Lista los modelos que ve UNA clave. Inyectable para testear sin red; en
 * producción es `GET /v1/models` del SDK oficial (pagina solo).
 */
export type AiModelLister = (apiKey: string) => Promise<ProviderModel[]>;
export const AI_MODEL_LISTER = Symbol('AI_MODEL_LISTER');

const MAX_MODELS = 300;
export const defaultModelLister: AiModelLister = async (apiKey) => {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
    const out: ProviderModel[] = [];
    for await (const m of client.models.list({ limit: 100 })) {
        out.push(m);
        if (out.length >= MAX_MODELS) break;
    }
    return out;
};

/** Cada cuánto se vuelve a preguntar (los modelos nuevos salen cada varias semanas). */
const FRESH_MS = 12 * 60 * 60 * 1000;
/** Lo último que se supo se guarda un mes: si el proveedor no responde, se usa eso. */
const KEEP_SECONDS = 30 * 24 * 60 * 60;
/** Tras un fallo no se reintenta en cada pedido. */
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;
/** «Actualizar lista» a mano: un freno corto por clave contra los clics repetidos. */
const MANUAL_REFRESH_MIN_MS = 3 * 1000;
/** Lectura en memoria para el camino caliente (cada mensaje del chat resuelve el modelo). */
const MEMO_MS = 60 * 1000;

interface CacheEntry {
    /** Última consulta exitosa (`null` = nunca). */
    fetched_at: string | null;
    models: AiModelInfo[];
    error: string | null;
    /** Último intento (exitoso o no), para no martillar al proveedor. */
    tried_at: string;
}

/**
 * Catálogo de modelos POR CLAVE (ADR-S60): cada clave puede ver modelos
 * distintos (la de una empresa con acceso a una familia que la de la
 * plataforma no tiene, o al revés). Se cachea en Redis bajo un hash de la
 * clave — nunca la clave — y se refresca cada 12 h; si el proveedor no
 * responde se sigue con lo último que se supo.
 */
@Injectable()
export class AiModelCatalogService {
    private readonly logger = new Logger(AiModelCatalogService.name);
    private readonly lister: AiModelLister;
    private readonly memo = new Map<string, { at: number; entry: CacheEntry }>();
    private readonly inflight = new Map<string, Promise<CacheEntry>>();
    /** Ajustables en los tests (sin esperas reales). */
    memoMs = MEMO_MS;
    manualRefreshMinMs = MANUAL_REFRESH_MIN_MS;

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() @Inject(AI_MODEL_LISTER) lister?: AiModelLister,
    ) {
        this.lister = lister ?? defaultModelLister;
    }

    /** El catálogo que ve una clave. Sin clave → vacío (`no_key`). */
    async catalog(apiKey: string | null, opts: { refresh?: boolean } = {}): Promise<AiModelCatalog> {
        if (!apiKey) return { models: [], families: [], no_key: true, fetched_at: null, error: null };
        const entry = await this.entry(apiKey, opts.refresh === true);
        const { models, families } = buildAiModelCatalog(entry.models);
        return { models, families, no_key: false, fetched_at: entry.fetched_at, error: entry.error };
    }

    /**
     * Resuelve una elección (`auto:<familia>` o un id) contra lo que ve la
     * clave. `null` sólo si nunca se pudo consultar el catálogo y la elección
     * es «el más reciente» (no hay de dónde sacarlo); el motivo va en `error`.
     */
    async resolve(apiKey: string, choice: string): Promise<{ model: AiModelResolution | null; error: string | null }> {
        const entry = await this.entry(apiKey, false);
        return { model: resolveAiModelChoice(choice, buildAiModelCatalog(entry.models).models), error: entry.error };
    }

    private cacheKey(apiKey: string): string {
        return `ai:models:${createHash('sha256').update(apiKey).digest('hex').slice(0, 32)}`;
    }

    private async entry(apiKey: string, refresh: boolean): Promise<CacheEntry> {
        const key = this.cacheKey(apiKey);
        const now = Date.now();
        const memo = this.memo.get(key);
        if (!refresh && memo && now - memo.at < this.memoMs) return memo.entry;

        const cached = await this.read(key);
        if (cached) {
            const fetchedAgo = cached.fetched_at ? now - Date.parse(cached.fetched_at) : Infinity;
            const triedAgo = now - Date.parse(cached.tried_at);
            const fresh = fetchedAgo < FRESH_MS && cached.error === null;
            const recentlyFailed = cached.error !== null && triedAgo < RETRY_AFTER_ERROR_MS;
            const throttled = refresh && triedAgo < this.manualRefreshMinMs;
            if ((!refresh && (fresh || recentlyFailed)) || throttled) {
                this.memo.set(key, { at: now, entry: cached });
                return cached;
            }
        }

        let pending = this.inflight.get(key);
        if (!pending) {
            pending = this.fetch(key, apiKey, cached).finally(() => this.inflight.delete(key));
            this.inflight.set(key, pending);
        }
        const entry = await pending;
        this.memo.set(key, { at: Date.now(), entry });
        return entry;
    }

    private async fetch(key: string, apiKey: string, previous: CacheEntry | null): Promise<CacheEntry> {
        const triedAt = new Date().toISOString();
        let entry: CacheEntry;
        try {
            const raw = await this.lister(apiKey);
            const models = raw.filter((m) => typeof m?.id === 'string' && m.id.startsWith('claude-')).map(normalizeModel);
            if (models.length === 0) throw new Error('El proveedor no devolvió ningún modelo para esta clave.');
            entry = { fetched_at: triedAt, models, error: null, tried_at: triedAt };
        } catch (err) {
            const message = describeProviderError(err);
            this.logger.warn(`No se pudo consultar el catálogo de modelos: ${message}`);
            entry = { fetched_at: previous?.fetched_at ?? null, models: previous?.models ?? [], error: message, tried_at: triedAt };
        }
        await this.redis.set(key, JSON.stringify(entry), 'EX', KEEP_SECONDS).catch(() => undefined);
        return entry;
    }

    private async read(key: string): Promise<CacheEntry | null> {
        const raw = await this.redis.get(key).catch(() => null);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as CacheEntry;
            return Array.isArray(parsed.models) && typeof parsed.tried_at === 'string' ? parsed : null;
        } catch {
            return null;
        }
    }
}

function normalizeModel(m: ProviderModel): AiModelInfo {
    return {
        id: m.id,
        display_name: typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name : m.id,
        family: null,
        created_at: typeof m.created_at === 'string' ? m.created_at : null,
        max_input_tokens: typeof m.max_input_tokens === 'number' ? m.max_input_tokens : null,
        latest: false,
        caps: capsFrom(m.capabilities),
    };
}

/** Del árbol de capacidades del proveedor a lo que la app usa. `null` si no vino. */
export function capsFrom(raw: unknown): AiModelCaps | null {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const yes = (v: unknown): boolean => !!v && typeof v === 'object' && (v as { supported?: unknown }).supported === true;
    const thinking = c.thinking as { supported?: unknown; types?: Record<string, unknown> } | undefined;
    const thinkingOn = thinking?.supported === true;
    const effort = c.effort as Record<string, unknown> | undefined;
    // v0.1.306 — qué niveles acepta (`xhigh` puede venir en null: no existe en ese modelo).
    const levels = effort ? AI_EFFORT_LEVELS.filter((l) => yes(effort[l])) : [];
    return {
        adaptive_thinking: thinkingOn && yes(thinking?.types?.adaptive),
        budget_thinking: thinkingOn && yes(thinking?.types?.enabled),
        effort: yes(c.effort),
        effort_levels: levels.length > 0 ? levels : null,
        image_input: yes(c.image_input),
        pdf_input: yes(c.pdf_input),
    };
}

/** El error del proveedor en lenguaje claro. */
export function describeProviderError(err: unknown): string {
    const status = (err as { status?: number })?.status;
    if (status === 401) return 'El proveedor rechazó la clave (401). Revisa que esté completa y vigente.';
    if (status === 403) return 'Esta clave no tiene permiso para consultar los modelos (403).';
    if (status === 429) return 'El proveedor limitó los pedidos por un momento (429). Se reintenta solo.';
    if (typeof status === 'number' && status >= 500) return `El proveedor no respondió bien (${status}). Se reintenta solo.`;
    const msg = err instanceof Error ? err.message : String(err);
    return `No se pudo consultar al proveedor: ${msg.slice(0, 200)}`;
}
