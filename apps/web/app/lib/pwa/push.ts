import type { PushDeviceDto } from '@imagina-base/shared';

import { ApiError, api } from '@/lib/api';

import { readyRegistration } from './serviceWorker';

/**
 * H1 — Notificaciones push en ESTE dispositivo.
 *
 * El navegador crea UNA suscripción por origen (la misma sirve para todas las
 * empresas que la persona abre en este dominio); el servidor la guarda por
 * empresa y atada a la sesión. Un marcador en localStorage por empresa
 * recuerda que la persona la activó aquí: al volver a entrar se re-vincula
 * sola (por ejemplo, tras una sesión vencida), sin volver a preguntar.
 */
const FLAG_PREFIX = 'imcrm:push:';

function flagKey(tenantId: number): string {
    return `${FLAG_PREFIX}${tenantId}`;
}

/** ¿La persona activó el push en este dispositivo para esta empresa? */
export function hasPushFlag(tenantId: number): boolean {
    return readFlag(tenantId);
}

function readFlag(tenantId: number): boolean {
    try {
        return window.localStorage.getItem(flagKey(tenantId)) === '1';
    } catch {
        return false;
    }
}

function writeFlag(tenantId: number, on: boolean): void {
    try {
        if (on) window.localStorage.setItem(flagKey(tenantId), '1');
        else window.localStorage.removeItem(flagKey(tenantId));
    } catch {
        /* storage bloqueado: sólo se pierde la re-vinculación automática */
    }
}

function otherFlags(tenantId: number): number {
    try {
        let n = 0;
        for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith(FLAG_PREFIX) && k !== flagKey(tenantId)) n++;
        }
        return n;
    } catch {
        return 0;
    }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Clave VAPID (base64url) → bytes para `applicationServerKey`. */
export function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
    if (!a) return false;
    const x = new Uint8Array(a);
    return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Huella del endpoint, la misma que calcula el servidor (sha256, 16 hex). */
export async function endpointHash(endpoint: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
    const reg = await readyRegistration();
    if (!reg || !('pushManager' in reg)) return null;
    return reg.pushManager.getSubscription().catch(() => null);
}

export type EnableResult = { ok: true; device: PushDeviceDto } | { ok: false; reason: 'denied' | 'dismissed' | 'unsupported' | 'error'; message?: string };

/**
 * «Activar en este dispositivo»: pide el permiso (sólo con un toque de la
 * persona — los navegadores lo exigen), suscribe con la clave del servidor y
 * la registra en la empresa activa.
 */
export async function enablePush(tenantId: number, publicKey: string): Promise<EnableResult> {
    if (typeof Notification === 'undefined') return { ok: false, reason: 'unsupported' };
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'denied') return { ok: false, reason: 'denied' };
    if (permission !== 'granted') return { ok: false, reason: 'dismissed' };
    try {
        const device = await registerSubscription(publicKey);
        if (!device) return { ok: false, reason: 'unsupported' };
        writeFlag(tenantId, true);
        return { ok: true, device };
    } catch (err) {
        return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Suscribe (o reusa la suscripción del navegador) y la registra en el
 * servidor. Si el servicio de push ya la había dado de baja (el servidor
 * responde `push_subscription_gone`: el navegador no se entera de un 410 y
 * la sigue devolviendo), se descarta y se pide una NUEVA, una sola vez.
 */
async function registerSubscription(publicKey: string): Promise<PushDeviceDto | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const sub = await subscribeBrowser(publicKey);
        if (!sub) return null;
        try {
            const res = await api.post<PushDeviceDto>('/me/push/subscriptions', sub.toJSON());
            return res.data;
        } catch (err) {
            if (attempt === 0 && err instanceof ApiError && err.code === 'push_subscription_gone') {
                await sub.unsubscribe().catch(() => undefined);
                continue;
            }
            throw err;
        }
    }
    return null;
}

async function subscribeBrowser(publicKey: string): Promise<PushSubscription | null> {
    const reg = await readyRegistration();
    if (!reg || !('pushManager' in reg)) return null;
    const key = base64UrlToBytes(publicKey);
    const existing = await reg.pushManager.getSubscription();
    // Una suscripción hecha con OTRA clave (otro servidor, llaves nuevas) no
    // sirve: el servicio rechazaría nuestros mensajes.
    if (existing && sameKey(existing.options.applicationServerKey, key)) return existing;
    if (existing) await existing.unsubscribe().catch(() => undefined);
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** «Desactivar en este dispositivo» (sólo para esta empresa). */
export async function disablePush(tenantId: number): Promise<void> {
    const sub = await currentSubscription();
    writeFlag(tenantId, false);
    if (!sub) return;
    await api.post('/me/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    // La suscripción del navegador es UNA para todo el dominio: si otra
    // empresa abierta aquí la usa, queda viva.
    if (otherFlags(tenantId) === 0) await sub.unsubscribe().catch(() => undefined);
}

/**
 * Al entrar a una empresa: si la persona activó el push aquí y el permiso
 * sigue dado, se re-vincula la suscripción a ESTA sesión (el servidor deja
 * de enviar a una sesión cerrada o vencida). Silencioso: nunca pregunta.
 */
export async function resyncPush(tenantId: number, publicKey: string): Promise<boolean> {
    if (!readFlag(tenantId) || notificationPermission() !== 'granted') return false;
    try {
        return (await registerSubscription(publicKey)) !== null;
    } catch {
        return false;
    }
}

/**
 * Al cerrar sesión: el servidor ya borró los dispositivos de esa sesión; aquí
 * se olvida la suscripción del navegador para que quien entre después en este
 * equipo no herede los avisos de otra persona.
 */
export async function forgetPushOnLogout(): Promise<void> {
    try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith(FLAG_PREFIX)) keys.push(k);
        }
        keys.forEach((k) => window.localStorage.removeItem(k));
    } catch {
        /* nada */
    }
    const sub = await Promise.race([currentSubscription(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    await sub?.unsubscribe().catch(() => undefined);
}
