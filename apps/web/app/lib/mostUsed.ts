import {
    MOST_USED_DEDUPE_MS,
    mostUsedKey,
    stableMostUsed,
    type MostUsedRef,
    type MostUsedState,
    type MostUsedVisit,
} from '@imagina-base/shared';

import { getBootData } from '@/lib/boot';

/**
 * v0.1.385 — El lado del navegador de «Más usadas».
 *
 * - **Anotar** (`noteMostUsedVisit`): cada entrada a una lista o a un tablero
 *   se guarda en una cola del dispositivo (localStorage, por empresa) y se
 *   manda JUNTA al servidor cada minuto, al ocultar la pestaña o al volver a
 *   abrir la app: nunca una petición por clic. La misma lista dentro de los
 *   30 minutos no se vuelve a anotar (el servidor también lo controla).
 * - **Mostrar estable** (`stableShown`): el orden se fija al abrir la app y
 *   sólo se agrega al final lo nuevo que califica. Al día siguiente (o al
 *   volver a abrir la app) se reordena.
 */

const FLUSH_DELAY_MS = 60_000;
const QUEUE_MAX = 50;

const queueKey = (tenantId: number): string => `imcrm:most-used-queue:${tenantId}`;

/** Día del dispositivo (`YYYY-MM-DD`): el que la persona entiende por «día». */
export function localDay(now = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function readQueue(tenantId: number): MostUsedVisit[] {
    try {
        const raw = window.localStorage.getItem(queueKey(tenantId));
        const v: unknown = raw === null ? [] : JSON.parse(raw);
        if (!Array.isArray(v)) return [];
        return v.filter(
            (x): x is MostUsedVisit =>
                typeof x === 'object' &&
                x !== null &&
                ((x as MostUsedVisit).kind === 'list' || (x as MostUsedVisit).kind === 'dashboard') &&
                Number.isSafeInteger((x as MostUsedVisit).id) &&
                (x as MostUsedVisit).id > 0 &&
                typeof (x as MostUsedVisit).at === 'number' &&
                typeof (x as MostUsedVisit).day === 'string',
        );
    } catch {
        return [];
    }
}

function writeQueue(tenantId: number, visits: MostUsedVisit[]): void {
    try {
        if (visits.length === 0) window.localStorage.removeItem(queueKey(tenantId));
        else window.localStorage.setItem(queueKey(tenantId), JSON.stringify(visits.slice(-QUEUE_MAX)));
    } catch {
        /* storage bloqueado: la visita simplemente no cuenta */
    }
}

/** Última vez que se anotó cada lista/tablero en esta pestaña (30 minutos). */
const lastNoted = new Map<string, number>();
const timers = new Map<number, number>();
type StateListener = (tenantId: number, state: MostUsedState) => void;
let onFlushed: StateListener | null = null;

/** El hook registra cómo volcar la respuesta del servidor en su caché. */
export function setMostUsedFlushListener(fn: StateListener | null): void {
    onFlushed = fn;
}

export function noteMostUsedVisit(tenantId: number | null, ref: MostUsedRef, now = Date.now()): void {
    if (tenantId === null) return;
    const key = `${tenantId}|${mostUsedKey(ref)}`;
    const prev = lastNoted.get(key);
    if (prev !== undefined && now - prev < MOST_USED_DEDUPE_MS) return;
    lastNoted.set(key, now);
    const queue = readQueue(tenantId);
    queue.push({ kind: ref.kind, id: ref.id, at: now, day: localDay(new Date(now)) });
    writeQueue(tenantId, queue);
    scheduleFlush(tenantId);
}

function scheduleFlush(tenantId: number): void {
    if (timers.has(tenantId)) return;
    timers.set(
        tenantId,
        window.setTimeout(() => {
            timers.delete(tenantId);
            void flushMostUsed(tenantId);
        }, FLUSH_DELAY_MS),
    );
}

const inFlight = new Set<number>();

/**
 * Manda la cola de una empresa. Con `fetch` propio (y no el cliente de la
 * app) para fijar SU empresa aunque la activa ya sea otra, y con `keepalive`
 * para que salga aunque la pestaña se esté cerrando. Si falla, la cola queda
 * para la próxima.
 */
export async function flushMostUsed(tenantId: number, opts: { keepalive?: boolean } = {}): Promise<void> {
    if (inFlight.has(tenantId)) return;
    const visits = readQueue(tenantId);
    if (visits.length === 0) return;
    inFlight.add(tenantId);
    const t = timers.get(tenantId);
    if (t !== undefined) {
        window.clearTimeout(t);
        timers.delete(tenantId);
    }
    try {
        const boot = getBootData();
        const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/me/most-used/visits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-Id': String(tenantId) },
            body: JSON.stringify({ visits }),
            credentials: 'include',
            keepalive: opts.keepalive === true,
        });
        // Lo que se anotó mientras tanto se conserva; lo enviado se saca.
        const sent = new Set(visits.map((v) => `${v.kind}:${v.id}:${v.at}`));
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
            writeQueue(
                tenantId,
                readQueue(tenantId).filter((v) => !sent.has(`${v.kind}:${v.id}:${v.at}`)),
            );
        }
        if (res.ok && onFlushed) {
            const body = (await res.json().catch(() => null)) as MostUsedState | { data?: MostUsedState } | null;
            const state = body && 'enabled' in body ? body : (body as { data?: MostUsedState } | null)?.data;
            if (state && typeof state.enabled === 'boolean' && Array.isArray(state.items)) onFlushed(tenantId, state);
        }
    } catch {
        /* sin red: queda en la cola */
    } finally {
        inFlight.delete(tenantId);
    }
}

/** Borra la cola (al apagar la sección o empezar de cero). */
export function clearMostUsedQueue(tenantId: number): void {
    writeQueue(tenantId, []);
    for (const k of [...lastNoted.keys()]) if (k.startsWith(`${tenantId}|`)) lastNoted.delete(k);
}

/**
 * Lo que se mostró en esta sesión, por empresa y día. Es memoria de la
 * pestaña a propósito: al volver a abrir la app se reordena.
 */
const shownByDay = new Map<string, string[]>();

export function stableShown(tenantId: number, freshKeys: readonly string[], day = localDay()): string[] {
    const k = `${tenantId}|${day}`;
    const next = stableMostUsed(shownByDay.get(k) ?? [], freshKeys);
    shownByDay.set(k, next);
    return next;
}

export function resetShown(tenantId: number): void {
    for (const k of [...shownByDay.keys()]) if (k.startsWith(`${tenantId}|`)) shownByDay.delete(k);
}
