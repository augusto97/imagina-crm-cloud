/**
 * `/firmar/<token>` (D6, v0.1.446): la página donde una persona de afuera
 * firma un documento. Fuera del router, como /verify y /reset; la página se
 * carga a pedido (quien entra a la app no la baja).
 */
const TOKEN_RE = /\/firmar\/(\d{1,15}-[0-9a-f]{40})\/?$/;

export function getSignToken(path: string = typeof window !== 'undefined' ? window.location.pathname : ''): string | null {
    return TOKEN_RE.exec(path)?.[1] ?? null;
}
