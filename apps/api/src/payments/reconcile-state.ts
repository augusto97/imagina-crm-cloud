import { Inject, Injectable } from '@nestjs/common';
import {
    platformReconcileRunSchema,
    type PaymentProvider,
    type PlatformReconcileRun,
    type PlatformReconcileStatus,
} from '@imagina-base/shared';
import { z } from 'zod';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.382 — Lo que la revisión de respaldo de los cobros guarda en Redis.
 * Ninguna clave empieza con `platform:` a propósito: no viajan en el snapshot
 * (ADR-S20). Lo que sí viaja es la FRECUENCIA, dentro de `platform:payments`.
 */
export const RECONCILE_LAST_KEY = 'billing:reconcile:last';
export const RECONCILE_LOCK_KEY = 'billing:reconcile:lock';
/** Cuándo empezó la última revisión que terminó sin errores (desde ahí se busca). */
export const RECONCILE_OK_KEY = 'billing:reconcile:last_ok_at';
/** Pagos y órdenes que se abrieron desde la app y todavía no se confirmaron. */
export const OPEN_CHECKOUTS_KEY = 'billing:open_checkouts';

/** Cuánto se sigue mirando un pago abierto (PSE y efectivo pueden tardar días). */
export const OPEN_CHECKOUT_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** Subconjunto de ioredis que se usa (se testea con un fake en memoria). */
export interface ReconcileStateStore {
    get(key: string): Promise<string | null>;
}

export async function readLastRun(store: ReconcileStateStore): Promise<PlatformReconcileRun | null> {
    try {
        const raw = await store.get(RECONCILE_LAST_KEY);
        if (!raw) return null;
        const parsed = platformReconcileRunSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/** Cuándo toca la próxima automática. Puro: se testea sin Redis. */
export function nextReconcileAt(intervalMinutes: number, last: Pick<PlatformReconcileRun, 'started_at'> | null, now: Date): Date | null {
    if (intervalMinutes <= 0) return null;
    if (!last) return now;
    const t = Date.parse(last.started_at);
    if (Number.isNaN(t)) return now;
    const next = t + intervalMinutes * 60_000;
    return new Date(Math.max(next, now.getTime()));
}

/**
 * ¿Le toca a una revisión automática? Con un minuto de margen: el reloj que
 * la dispara corre cada 5 minutos y no tiene que saltearse una por segundos.
 */
export function reconcileDue(intervalMinutes: number, last: Pick<PlatformReconcileRun, 'started_at'> | null, now: Date): boolean {
    if (intervalMinutes <= 0) return false;
    if (!last) return true;
    const t = Date.parse(last.started_at);
    if (Number.isNaN(t)) return true;
    return now.getTime() - t >= intervalMinutes * 60_000 - 60_000;
}

/**
 * Desde cuándo se buscan los pagos. Manual: una semana entera. Automática:
 * desde la última que salió bien, con dos horas de solapamiento (un pago que
 * cambió de estado justo en el borde no se escapa) — nunca menos de 6 horas
 * ni más de 30 días. Puro.
 */
export function reconcileSince(trigger: 'auto' | 'manual', lastOkAt: string | null, now: Date): Date {
    const floor = now.getTime() - 30 * DAY;
    if (trigger === 'manual' || !lastOkAt) return new Date(Math.max(floor, now.getTime() - 7 * DAY));
    const ok = Date.parse(lastOkAt);
    if (Number.isNaN(ok)) return new Date(now.getTime() - 7 * DAY);
    const since = Math.min(ok - 2 * 60 * 60 * 1000, now.getTime() - 6 * 60 * 60 * 1000);
    return new Date(Math.max(floor, since));
}

export async function readReconcileStatus(store: ReconcileStateStore, intervalMinutes: number, now = new Date()): Promise<PlatformReconcileStatus> {
    const last = await readLastRun(store);
    let running = false;
    try {
        running = Boolean(await store.get(RECONCILE_LOCK_KEY));
    } catch {
        running = false;
    }
    const next = nextReconcileAt(intervalMinutes, last, now);
    return { interval_minutes: intervalMinutes, running, last, next_at: next ? next.toISOString() : null };
}

// ── Pagos abiertos desde la app ─────────────────────────────────────────

/**
 * Un pago que se abrió desde la app (Checkout Pro de Mercado Pago u orden de
 * PayPal). Con PayPal es la única forma de volver a encontrarlo: su API no
 * deja buscar órdenes; con Mercado Pago se busca por la referencia.
 */
export const openCheckoutSchema = z.object({
    provider: z.enum(['mercadopago', 'paypal']),
    external_id: z.string().min(1).max(128),
    reference: z.string().min(1).max(200),
    tenant_id: z.number().int().positive(),
    created_at: z.number(),
});
export type OpenCheckout = z.infer<typeof openCheckoutSchema>;

export interface OpenCheckoutsRedis {
    zadd(key: string, score: number, member: string): Promise<unknown>;
    zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
    zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
    zrem(key: string, ...members: string[]): Promise<unknown>;
}

/** Hasta cuántos pagos abiertos se revisan por vez (los más nuevos). */
const MAX_OPEN = 300;

@Injectable()
export class OpenCheckouts {
    constructor(@Inject(REDIS) private readonly redis: OpenCheckoutsRedis) {}

    /** Best-effort: si Redis no está, el pago igual se abre (llega por el aviso). */
    async remember(c: { provider: PaymentProvider; externalId: string; reference: string; tenantId: number }, now = new Date()): Promise<void> {
        const entry: OpenCheckout = {
            provider: c.provider,
            external_id: c.externalId,
            reference: c.reference,
            tenant_id: c.tenantId,
            created_at: now.getTime(),
        };
        if (!openCheckoutSchema.safeParse(entry).success) return;
        try {
            await this.redis.zadd(OPEN_CHECKOUTS_KEY, entry.created_at, JSON.stringify(entry));
        } catch {
            /* sin Redis: se entera por el aviso */
        }
    }

    /** Los abiertos de la última semana; los más viejos se descartan. */
    async list(now = new Date()): Promise<Array<{ member: string; checkout: OpenCheckout }>> {
        const cut = now.getTime() - OPEN_CHECKOUT_DAYS * DAY;
        await this.redis.zremrangebyscore(OPEN_CHECKOUTS_KEY, '-inf', cut);
        const raw = await this.redis.zrangebyscore(OPEN_CHECKOUTS_KEY, cut, '+inf');
        const out: Array<{ member: string; checkout: OpenCheckout }> = [];
        for (const member of raw.slice(-MAX_OPEN)) {
            try {
                const parsed = openCheckoutSchema.safeParse(JSON.parse(member));
                if (parsed.success) out.push({ member, checkout: parsed.data });
                else await this.redis.zrem(OPEN_CHECKOUTS_KEY, member);
            } catch {
                await this.redis.zrem(OPEN_CHECKOUTS_KEY, member);
            }
        }
        return out;
    }

    async settle(members: string[]): Promise<void> {
        if (members.length === 0) return;
        await this.redis.zrem(OPEN_CHECKOUTS_KEY, ...members);
    }
}
