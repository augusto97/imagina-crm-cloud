/**
 * v0.1.177 — Favicon y título de la pestaña.
 *
 * El HTML de ambos SPAs (admin + portal) trae el favicon POR DEFECTO de
 * Imagina Base (`/favicon.svg` + PNG de respaldo para Safari/pestañas
 * ancladas). Estas funciones lo PISAN en runtime con la marca del tenant
 * (white-label): el logo subido en Marca pasa a ser el icono de la pestaña
 * y el `app_name` el título — igual que hacen ClickUp/Notion con el icono
 * del workspace. Sin logo, se restaura el default (nunca queda colgado el
 * logo de otro workspace al cambiar de empresa).
 *
 * DOM puro y sin React a propósito: lo llaman efectos de `useBranding`
 * (admin) y `PortalApp` (portal), y se testea con jsdom.
 */

export const DEFAULT_FAVICON_SVG = '/favicon.svg';
export const DEFAULT_FAVICON_PNG = '/favicon-32.png';
export const DEFAULT_APPLE_TOUCH_ICON = '/apple-touch-icon.png';
export const DEFAULT_APP_TITLE = 'Imagina Base';

/** Los `<link>` que el HTML declara y que este módulo administra. */
const LINK_SELECTOR = 'link[rel="icon"], link[rel="apple-touch-icon"]';

function ensureLink(doc: Document, rel: string, extra: Record<string, string> = {}): HTMLLinkElement {
    const selector = Object.entries(extra).reduce(
        (acc, [k, v]) => `${acc}[${k}="${v}"]`,
        `link[rel="${rel}"]`,
    );
    let link = doc.head.querySelector<HTMLLinkElement>(selector);
    if (!link) {
        link = doc.createElement('link');
        link.rel = rel;
        for (const [k, v] of Object.entries(extra)) link.setAttribute(k, v);
        doc.head.appendChild(link);
    }
    return link;
}

/**
 * Pinta el favicon de la pestaña. `logoUrl` = imagen del tenant (URL firmada
 * del módulo de archivos); `null` = volver al icono por defecto de la app.
 *
 * Con logo propio se deja UN solo `<link rel="icon">` sin `type` (puede ser
 * png/jpeg/webp — el navegador lo detecta) y el apple-touch-icon apunta al
 * mismo logo. Con `null` se restauran los tres links del HTML original.
 */
export function applyFavicon(logoUrl: string | null, doc: Document = document): void {
    const links = Array.from(doc.head.querySelectorAll<HTMLLinkElement>(LINK_SELECTOR));
    if (logoUrl !== null && logoUrl !== '') {
        // Sacar los defaults (SVG+PNG) para que no compitan con el logo.
        for (const l of links) {
            if (l.dataset.imcrmDefault === '1') l.remove();
        }
        const icon = ensureLink(doc, 'icon', { 'data-imcrm-brand': '1' });
        icon.removeAttribute('type');
        icon.removeAttribute('sizes');
        icon.href = logoUrl;
        const touch = ensureLink(doc, 'apple-touch-icon', { 'data-imcrm-brand': '1' });
        touch.href = logoUrl;
        return;
    }
    for (const l of links) {
        if (l.dataset.imcrmBrand === '1') l.remove();
    }
    const svg = ensureLink(doc, 'icon', { 'data-imcrm-default': '1', type: 'image/svg+xml' });
    svg.href = DEFAULT_FAVICON_SVG;
    const png = ensureLink(doc, 'icon', { 'data-imcrm-default': '1', type: 'image/png' });
    png.setAttribute('sizes', '32x32');
    png.href = DEFAULT_FAVICON_PNG;
    const touch = ensureLink(doc, 'apple-touch-icon', { 'data-imcrm-default': '1' });
    touch.href = DEFAULT_APPLE_TOUCH_ICON;
}

/**
 * Título de la pestaña: `app_name` del tenant o el de la app. `section`
 * (opcional) va adelante — "Portal — Acme" — como hacía el HTML del portal.
 */
export function applyDocumentTitle(
    appName: string | null,
    section: string | null = null,
    doc: Document = document,
): void {
    const base = appName !== null && appName.trim() !== '' ? appName.trim() : DEFAULT_APP_TITLE;
    doc.title = section !== null && section.trim() !== '' ? `${section.trim()} — ${base}` : base;
}
