import { z } from 'zod';

/**
 * H1 — Notificaciones push (Web Push estándar con VAPID, RFC 8030/8291/8292).
 *
 * El push es un CANAL más de los avisos de la bandeja (ADR-S40): el mismo
 * aviso que llega a la campana sale también al teléfono o al escritorio de la
 * persona, si sus preferencias lo piden para ese tipo. Una SUSCRIPCIÓN es un
 * dispositivo (navegador + origen) de UNA persona en UNA empresa.
 */

/** base64url sin relleno (lo que entrega `PushSubscription.toJSON()`). */
const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'base64url inválido');

/** Lo que el navegador entrega al suscribirse (`PushSubscription.toJSON()`). */
export const pushSubscribeSchema = z.object({
    endpoint: z.string().trim().url().max(2048),
    keys: z.object({
        /** Clave pública P-256 del navegador: 65 bytes → 87 caracteres base64url. */
        p256dh: base64url.min(80).max(100),
        /** Secreto de autenticación: 16 bytes → 22 caracteres base64url. */
        auth: base64url.min(16).max(32),
    }),
    expirationTime: z.number().nullable().optional(),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

/** Quitar la suscripción de ESTE dispositivo (al desactivar o al cerrar sesión). */
export const pushUnsubscribeSchema = z.object({
    endpoint: z.string().trim().url().max(2048),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

export interface PushDeviceDto {
    id: number;
    /** Navegador del dispositivo, tal como lo informó al suscribirse. */
    user_agent: string;
    /**
     * Huella del endpoint (sha256, 16 hex). El endpoint en sí no vuelve: con
     * él y nuestras llaves se le puede mandar un push a la persona. El
     * navegador calcula la misma huella para marcar «Este dispositivo».
     */
    endpoint_hash: string;
    created_at: string;
    last_used_at: string | null;
    /** El último envío falló (servicio caído, permiso revocado…). */
    last_error: string | null;
}

export interface PushStatusDto {
    /** Clave pública VAPID (base64url, 65 bytes) para `pushManager.subscribe`. */
    public_key: string;
    devices: PushDeviceDto[];
    /** Tope de notificaciones por persona y hora (el resto queda en la campana). */
    per_hour: number;
}

/**
 * Lo que viaja CIFRADO al dispositivo. Lo mínimo: título, una línea y la URL
 * del registro — nunca el contenido completo del registro ni del comentario.
 */
export interface PushPayload {
    v: 1;
    title: string;
    body: string;
    /** Ruta relativa al origen de la app (`/#/lists/…`). */
    url: string;
    /** Notificaciones con el mismo `tag` se reemplazan en vez de apilarse. */
    tag: string;
    tenant_id: number;
    kind: string;
    /** Marca de tiempo (ms) del aviso. */
    ts: number;
}

export interface PushTestResult {
    /** Dispositivos a los que se envió (el servicio de push lo aceptó). */
    sent: number;
    failed: number;
    /** Suscripciones vencidas que se borraron (404/410 del servicio). */
    removed: number;
    errors: string[];
}

/** Título y línea del push: cortos y en UNA línea (la notificación del sistema corta igual). */
export function pushLine(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Tag por registro (o por tipo si el aviso no es de un registro). */
export function pushTag(kind: string, recordId: number | null | undefined, id?: number): string {
    if (recordId) return `rec-${recordId}-${kind}`;
    return id ? `n-${id}` : `k-${kind}`;
}

