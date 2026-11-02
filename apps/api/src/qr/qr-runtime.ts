import { recordLinkPath } from '@imagina-base/shared';
import { signQrToken } from './qr-token';

/**
 * v0.1.344 — Lo que necesitan las VARIABLES para el QR de un registro
 * (`{{registro.enlace}}`, `{{registro.qr}}` y el modificador `|qr`), sin que
 * el motor de automatizaciones, los documentos, el SMS y WhatsApp tengan que
 * inyectar un servicio más: el módulo del QR lo registra al arrancar. Sin
 * registrar (specs que arman un servicio a mano), las variables salen vacías.
 */
export interface QrRuntime {
    /** Origen de las imágenes del QR (`APP_BASE_URL`): las piden Gmail o WhatsApp. */
    imageBase: string;
    secret: string;
    /** Origen de los enlaces de la empresa (su dominio propio si responde; si no, la plataforma). */
    linkBase(tenantId: number): Promise<string>;
}

let runtime: QrRuntime | null = null;

export function configureQrRuntime(r: QrRuntime | null): void {
    runtime = r;
}

/** Los tamaños que se sirven (lado en píxeles). */
export const QR_SIZE_MIN = 96;
export const QR_SIZE_MAX = 1024;
export const QR_SIZE_DEFAULT = 360;

/**
 * URL absoluta de la imagen PNG del QR de `content` ('' sin contenido, sin
 * runtime o si es demasiado largo: una variable que no se puede armar sale
 * vacía, nunca con el contenido crudo donde se esperaba una imagen).
 */
export function qrImageUrl(content: string, size?: number): string {
    const text = content.trim();
    if (!runtime || !text) return '';
    const token = signQrToken(text, runtime.secret);
    if (!token) return '';
    const base = runtime.imageBase.replace(/\/+$/, '');
    const s = size && size !== QR_SIZE_DEFAULT ? `?s=${Math.round(Math.min(QR_SIZE_MAX, Math.max(QR_SIZE_MIN, size)))}` : '';
    return `${base}/api/v1/public/qr/${token}.png${s}`;
}

/** `https://…/lists/<slug>/records/` (sin el id) o '' sin runtime. */
export async function recordLinkPrefix(tenantId: number, listSlug: string): Promise<string> {
    if (!runtime || !listSlug) return '';
    const base = (await runtime.linkBase(tenantId).catch(() => runtime?.imageBase ?? '')).replace(/\/+$/, '');
    if (!base) return '';
    return `${base}${recordLinkPath(listSlug, 0).slice(0, -1)}`;
}

/** El enlace a la ficha de un registro ('' sin runtime). */
export async function recordLinkFor(tenantId: number, listSlug: string, recordId: number): Promise<string> {
    const prefix = await recordLinkPrefix(tenantId, listSlug);
    return prefix && recordId > 0 ? `${prefix}${recordId}` : '';
}

/** Las variables del QR del registro (en español y su alias en inglés). */
export const RECORD_LINK_TOKENS = ['registro.enlace', 'record.link'] as const;
export const RECORD_QR_TOKENS = ['registro.qr', 'record.qr'] as const;

/**
 * El valor de `{{registro.enlace}}` / `{{registro.qr}}` dado el enlace del
 * registro; `undefined` si el token no es una de ellas (sigue el resto del
 * accessor).
 */
export function recordTokenValue(token: string, link: string): string | undefined {
    if ((RECORD_LINK_TOKENS as readonly string[]).includes(token)) return link;
    if ((RECORD_QR_TOKENS as readonly string[]).includes(token)) return link ? qrImageUrl(link) : '';
    return undefined;
}
