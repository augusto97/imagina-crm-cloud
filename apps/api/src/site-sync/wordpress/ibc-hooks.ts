import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SiteHookEvent } from '../site-sync.engine';

/**
 * Los avisos del complemento (v0.1.334, ADR-S84). PURO: la verificación de la
 * firma y la lectura del cuerpo, lo mismo en el controlador y en las pruebas.
 *
 * Firma: `X-Imagina-Signature: sha256=<hex>` = HMAC-SHA256(secreto,
 * `"<timestamp>.<cuerpo crudo>"`) y `X-Imagina-Timestamp` (segundos). El
 * timestamp entra en la firma y tiene que estar a ±5 minutos: un aviso
 * capturado no se puede reenviar más tarde.
 */

export const SITE_HOOK_TOLERANCE_S = 300;
/** Tope de eventos por aviso (el complemento manda de a 200). */
export const SITE_HOOK_MAX_EVENTS = 500;

export type SiteSignatureCheck = 'ok' | 'bad' | 'stale';

export function siteHookSignature(secret: string, timestamp: string, rawBody: string): string {
    return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
}

export function verifySiteSignature(
    secret: string,
    timestamp: string | undefined,
    rawBody: string,
    header: string | undefined,
    nowMs = Date.now(),
): SiteSignatureCheck {
    if (!header || !timestamp || secret === '' || !/^\d{9,12}$/.test(timestamp)) return 'bad';
    const expected = Buffer.from(siteHookSignature(secret, timestamp, rawBody), 'utf8');
    const given = Buffer.from(header.trim(), 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad';
    return Math.abs(nowMs / 1000 - Number(timestamp)) > SITE_HOOK_TOLERANCE_S ? 'stale' : 'ok';
}

/** La huella del secreto que informa el complemento (sin que el secreto viaje). */
export function secretFingerprint(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16);
}

export type SiteHookBody = { type: 'ping' } | { type: 'events'; events: SiteHookEvent[] };

/** El cuerpo de un aviso, validado. `null` = no es algo que se entienda (se ignora). */
export function parseSiteHookBody(body: unknown): SiteHookBody | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const b = body as Record<string, unknown>;
    if (b.type === 'ping') return { type: 'ping' };
    if (b.type !== 'events' || !Array.isArray(b.events)) return null;
    const events: SiteHookEvent[] = [];
    for (const raw of b.events.slice(0, SITE_HOOK_MAX_EVENTS)) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as Record<string, unknown>;
        const kind = e.kind === 'post' || e.kind === 'term' || e.kind === 'media' ? e.kind : null;
        const action = e.action === 'saved' || e.action === 'trashed' || e.action === 'deleted' ? e.action : null;
        const id = Number(e.id);
        const object = typeof e.object === 'string' && /^[a-z0-9_-]{1,32}$/.test(e.object) ? e.object : null;
        if (!kind || !action || !object || !Number.isInteger(id) || id <= 0) continue;
        events.push({ kind, object, id, action });
    }
    return { type: 'events', events };
}

/** La dirección del aviso apunta a ESTA sincronización (la del token). */
export function sameHookUrl(a: string | null, b: string): boolean {
    return (a ?? '').replace(/\/+$/, '') === b.replace(/\/+$/, '');
}
