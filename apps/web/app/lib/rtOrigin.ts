import { RT_ORIGIN_HEADER, rtTabOrigin } from '@imagina-base/shared';

/**
 * v0.1.461 — Id de ESTA pestaña para el realtime. Cada pedido lo manda en
 * `X-Rt-Origin` y el servidor marca con él los avisos de lo que ese pedido
 * escribió (`tab:<id>`). Así la pestaña reconoce su propio eco —y no se come
 * lo que hizo una automatización disparada por su edición, que llega como
 * `job:automations`—.
 *
 * Se inventa al cargar la página (no se guarda): dos pestañas, aunque sean
 * del mismo navegador, son orígenes distintos y cada una ve lo de la otra.
 */
function makeTabId(): string {
    const bytes = new Uint8Array(12);
    try {
        crypto.getRandomValues(bytes);
    } catch {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

const TAB_ID = makeTabId();

/** El origen con el que el servidor marca los avisos de esta pestaña. */
export function ownRtOrigin(): string {
    return rtTabOrigin(TAB_ID);
}

/** La cabecera que lleva cada pedido a la API. */
export function rtOriginHeaders(): Record<string, string> {
    return { [RT_ORIGIN_HEADER]: TAB_ID };
}
