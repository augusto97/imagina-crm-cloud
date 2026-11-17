import { createHash } from 'node:crypto';
import { SMTP_DEFAULT_PER_SECOND, SMTP_MAX_PER_SECOND, SMTP_MIN_PER_SECOND } from '@imagina-base/shared';
import type Redis from 'ioredis';

/**
 * v0.1.434 — Ritmo de envío por servidor SMTP.
 *
 * Muchos proveedores aceptan pocos correos por segundo y rechazan el resto con
 * un «452 4.4.5 Messages per second limit exceeded». Antes la cola mandaba
 * hasta 5 a la vez (y los envíos directos de las automatizaciones, más): un
 * par de avisos simultáneos ya pasaba el límite y cada rechazo gastaba un
 * reintento. Ahora cada envío a un servidor reserva su TURNO, separado del
 * anterior por `1000 / correos por segundo` ms, en Redis — así lo respetan
 * todos los procesos y servidores que comparten ese SMTP.
 *
 * El turno se identifica por servidor + puerto + usuario (no por quién manda):
 * la empresa que configura como SMTP propio la misma cuenta que la plataforma
 * comparte el límite, porque el proveedor lo cuenta por cuenta.
 */

/** Pausa entre dos envíos al mismo servidor para `perSecond` correos por segundo. */
export function paceIntervalMs(perSecond: number | null | undefined): number {
    const n = typeof perSecond === 'number' && Number.isFinite(perSecond) ? perSecond : SMTP_DEFAULT_PER_SECOND;
    const clamped = Math.min(SMTP_MAX_PER_SECOND, Math.max(SMTP_MIN_PER_SECOND, n));
    return Math.ceil(1000 / clamped);
}

/** Clave estable del servidor (sin datos legibles en Redis). */
export function paceKey(host: string, port: number, user: string): string {
    const h = createHash('sha256').update(`${host.trim().toLowerCase()}|${port}|${user.trim().toLowerCase()}`).digest('hex').slice(0, 24);
    return `mail:pace:${h}`;
}

/**
 * ¿El servidor rechazó el correo por algo PASAJERO? Un 4xx de SMTP es, por
 * definición, «intenta más tarde» (límite por segundo, buzón ocupado, greylisting).
 * Los errores de conexión NO entran: reintentarlos en el lugar sólo alarga la
 * espera de un servidor mal configurado (para eso está la cola y «Diagnosticar»).
 */
export function isTransientSmtpRejection(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { responseCode?: unknown; message?: unknown };
    if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
    const msg = typeof e.message === 'string' ? e.message : '';
    return /\b4\d\d\b/.test(msg) && /limit|too many|try again|later|temporar/i.test(msg);
}

/** ¿El rechazo pasajero es por pasar el límite de envío? (empuja el turno de todos). */
export function isRateLimitRejection(err: unknown): boolean {
    if (!isTransientSmtpRejection(err)) return false;
    const msg = String((err as { message?: unknown }).message ?? '');
    return /limit|too many|rate|per second|throttl/i.test(msg);
}

/**
 * Reserva el próximo turno de forma atómica: `next` = cuándo puede salir el
 * siguiente correo. Devuelve cuánto tiene que esperar este (ms). `notBefore`
 * corre el turno hacia adelante (después de un rechazo por límite, para que los
 * demás envíos también esperen en vez de seguir chocando).
 */
const RESERVE_LUA = `
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local iv = tonumber(ARGV[2])
local nb = tonumber(ARGV[3])
local slot = nxt
if slot < now then slot = now end
if slot < nb then slot = nb end
redis.call('SET', KEYS[1], tostring(slot + iv), 'PX', math.floor(slot - now + iv + 60000))
return slot - now
`;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MailPacer {
    /** Respaldo sin Redis (o con Redis caído): el ritmo vale dentro de este proceso. */
    private readonly local = new Map<string, number>();

    constructor(
        private readonly redis?: Pick<Redis, 'eval'> | null,
        private readonly sleep: Sleep = realSleep,
        private readonly now: () => number = Date.now,
    ) {}

    /** Reserva el turno y devuelve cuántos ms faltan para que salga. */
    async reserve(key: string, intervalMs: number, notBefore = 0): Promise<number> {
        const now = this.now();
        if (this.redis) {
            try {
                const wait = await this.redis.eval(RESERVE_LUA, 1, key, String(now), String(intervalMs), String(notBefore));
                const n = Number(wait);
                if (Number.isFinite(n)) return Math.max(0, n);
            } catch {
                /* Redis caído: sigue el ritmo dentro del proceso */
            }
        }
        if (this.local.size > 500) this.local.clear();
        const slot = Math.max(this.local.get(key) ?? 0, now, notBefore);
        this.local.set(key, slot + intervalMs);
        return slot - now;
    }

    /** Espera el turno de este envío. */
    async wait(key: string, intervalMs: number, notBefore = 0): Promise<number> {
        const ms = await this.reserve(key, intervalMs, notBefore);
        if (ms > 0) await this.sleep(ms);
        return ms;
    }
}
