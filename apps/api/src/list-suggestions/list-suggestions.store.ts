import { Inject, Injectable } from '@nestjs/common';
import type { AiProposalKind, AiProposalPreview, ListProfile, ListSuggestionCategory } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.341 (ADR-S89) — Dónde viven las sugerencias de cada lista. Todo en
 * Redis: no es un dato del cliente (se puede volver a calcular) y cada pieza
 * tiene su clave para no pisarse:
 *  - el PERFIL de la lista por persona (10 min: depende de lo que cada uno ve);
 *  - el resultado de la IA (por lista, 120 días);
 *  - el trabajo de IA en curso (2 h);
 *  - lo aplicado y lo descartado (un HASH por lista: una escritura por clave).
 */

export interface StoredAiSuggestion {
    key: string;
    category: ListSuggestionCategory;
    title: string;
    why: string;
    tool: string;
    input: Record<string, unknown>;
    kind: AiProposalKind;
    preview: AiProposalPreview | null;
}

export interface StoredAiResult {
    analyzed_at: string;
    by: number;
    fingerprint: string;
    purpose: string | null;
    /** El análisis incluyó ejemplos de texto enmascarados. */
    with_examples?: boolean;
    suggestions: StoredAiSuggestion[];
}

export interface StoredAiJob {
    state: 'running' | 'done' | 'error';
    stage: 'reading' | 'thinking' | 'checking' | null;
    error: string | null;
    started_at: number;
    /** Lugar del cupo del mes que se gastó (se devuelve si falla). */
    reserved: string | null;
}

export interface StoredMark {
    status: 'applied' | 'dismissed';
    at: string;
    by: number;
    title: string;
    /** Para seguir mostrando lo aplicado aunque la regla ya no salga (la vista existe). */
    category?: ListSuggestionCategory;
    source?: 'rules' | 'ai';
    message?: string;
    links?: Array<{ label: string; href: string }>;
}

const PROFILE_TTL = 10 * 60;
const AI_TTL = 120 * 24 * 3600;
const JOB_TTL = 2 * 3600;
const MARKS_TTL = 365 * 24 * 3600;

@Injectable()
export class ListSuggestionsStore {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    private k(kind: string, tenantId: number, listId: number, extra?: number): string {
        return `listsugg:${kind}:${tenantId}:${listId}${extra !== undefined ? `:${extra}` : ''}`;
    }

    async getProfile(tenantId: number, listId: number, userId: number): Promise<ListProfile | null> {
        return this.readJson<ListProfile>(this.k('prof', tenantId, listId, userId));
    }

    async setProfile(tenantId: number, listId: number, userId: number, profile: ListProfile): Promise<void> {
        await this.redis.set(this.k('prof', tenantId, listId, userId), JSON.stringify(profile), 'EX', PROFILE_TTL);
    }

    /** Algo cambió (se aplicó una sugerencia): el perfil se recalcula para todos. */
    async dropProfiles(tenantId: number, listId: number): Promise<void> {
        const pattern = `${this.k('prof', tenantId, listId)}:*`;
        let cursor = '0';
        do {
            const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
            cursor = next;
            if (keys.length > 0) await this.redis.del(...keys);
        } while (cursor !== '0');
    }

    getAi(tenantId: number, listId: number): Promise<StoredAiResult | null> {
        return this.readJson<StoredAiResult>(this.k('ai', tenantId, listId));
    }

    async setAi(tenantId: number, listId: number, result: StoredAiResult): Promise<void> {
        await this.redis.set(this.k('ai', tenantId, listId), JSON.stringify(result), 'EX', AI_TTL);
    }

    getJob(tenantId: number, listId: number): Promise<StoredAiJob | null> {
        return this.readJson<StoredAiJob>(this.k('job', tenantId, listId));
    }

    async setJob(tenantId: number, listId: number, job: StoredAiJob): Promise<void> {
        await this.redis.set(this.k('job', tenantId, listId), JSON.stringify(job), 'EX', JOB_TTL);
    }

    /** Un solo análisis a la vez por lista (dos clics, dos personas): gana uno. */
    async claimJob(tenantId: number, listId: number): Promise<boolean> {
        const ok = await this.redis.set(`${this.k('job', tenantId, listId)}:lock`, '1', 'EX', 15, 'NX');
        return ok === 'OK';
    }

    async releaseJob(tenantId: number, listId: number): Promise<void> {
        await this.redis.del(`${this.k('job', tenantId, listId)}:lock`);
    }

    async marks(tenantId: number, listId: number): Promise<Map<string, StoredMark>> {
        const raw = await this.redis.hgetall(this.k('marks', tenantId, listId));
        const out = new Map<string, StoredMark>();
        for (const [key, json] of Object.entries(raw)) {
            try {
                out.set(key, JSON.parse(json) as StoredMark);
            } catch {
                // Una marca ilegible se ignora: la sugerencia vuelve a mostrarse.
            }
        }
        return out;
    }

    async setMark(tenantId: number, listId: number, key: string, mark: StoredMark): Promise<void> {
        const hk = this.k('marks', tenantId, listId);
        await this.redis.hset(hk, key, JSON.stringify(mark));
        await this.redis.expire(hk, MARKS_TTL);
    }

    async clearMark(tenantId: number, listId: number, key: string): Promise<void> {
        await this.redis.hdel(this.k('marks', tenantId, listId), key);
    }

    /** Candado de aplicación: dos clics en «Aplicar» crean UNA vista. */
    async claimApply(tenantId: number, listId: number, key: string): Promise<boolean> {
        const ok = await this.redis.set(`${this.k('apply', tenantId, listId)}:${key}`, '1', 'EX', 120, 'NX');
        return ok === 'OK';
    }

    async releaseApply(tenantId: number, listId: number, key: string): Promise<void> {
        await this.redis.del(`${this.k('apply', tenantId, listId)}:${key}`);
    }

    /** Cupo del mes (UTC) de la empresa: incrementa y devuelve el contador. */
    async takeQuota(tenantId: number, limit: number, now: Date = new Date()): Promise<string | null> {
        const key = quotaKey(tenantId, now);
        const n = await this.redis.incr(key);
        await this.redis.expire(key, 40 * 24 * 3600);
        if (n > limit) {
            await this.redis.decr(key);
            return null;
        }
        return key;
    }

    async usedQuota(tenantId: number, now: Date = new Date()): Promise<number> {
        return Number((await this.redis.get(quotaKey(tenantId, now))) ?? 0);
    }

    async refund(key: string): Promise<void> {
        await this.redis.decr(key).catch(() => undefined);
    }

    private async readJson<T>(key: string): Promise<T | null> {
        const raw = await this.redis.get(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return null;
        }
    }
}

export function quotaKey(tenantId: number, now: Date = new Date()): string {
    return `listsugg:aiq:${tenantId}:${now.toISOString().slice(0, 7)}`;
}
