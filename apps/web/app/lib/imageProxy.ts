import { getBootData } from './boot';

/**
 * v0.1.210 — Dirección con la que el navegador pide una imagen de un campo URL.
 *
 * La CSP del SPA sólo deja cargar imágenes del propio origen (`img-src 'self'`),
 * así que una foto de la tienda (otro dominio) se pide por el proxy del API,
 * que la trae con el guard anti-SSRF y sólo si es una imagen de verdad. Lo que
 * ya es del origen (una ruta `/…`) va directo. Lo que no es http(s) no se pide.
 */
export function proxiedImageUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (value === '') return null;
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    if (!/^https?:\/\//i.test(value)) return null;
    return `${getBootData().restRoot.replace(/\/+$/, '')}/media/image?url=${encodeURIComponent(value)}`;
}

/** ¿El campo URL está configurado para mostrarse como miniatura? */
export function isImageUrlField(config: unknown): boolean {
    return !!config && typeof config === 'object' && (config as { display?: unknown }).display === 'image';
}
