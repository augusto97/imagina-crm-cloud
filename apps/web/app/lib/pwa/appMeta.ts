import { APP_BAR_NEUTRAL } from '@imagina-base/shared';

/**
 * H1 — Las metas de la app instalada: el color de las barras del sistema
 * (`theme-color`: la de arriba con la hora y, en Android, la de abajo) y el
 * nombre bajo el icono en iOS (`apple-mobile-web-app-title`). El manifiesto
 * ya los trae por Host; esto cubre el workspace activo y el modo oscuro.
 *
 * v0.1.326 — el color llega YA resuelto (`resolveAppBarColor`): por defecto
 * neutro, del mismo fondo que la barra superior de la app.
 */
export const DEFAULT_APP_NAME = 'Imagina Base';
export const DEFAULT_THEME_COLOR = APP_BAR_NEUTRAL.light;

function setMeta(name: string, content: string, doc: Document): void {
    let el = doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
        el = doc.createElement('meta');
        el.name = name;
        doc.head.appendChild(el);
    }
    el.content = content;
}

export function applyAppMeta(barColor: string | null, appName: string | null, doc: Document = document): void {
    const color = barColor && /^#[0-9a-fA-F]{6}$/.test(barColor) ? barColor : DEFAULT_THEME_COLOR;
    setMeta('theme-color', color, doc);
    setMeta('apple-mobile-web-app-title', (appName ?? '').trim() || DEFAULT_APP_NAME, doc);
}

/**
 * v0.1.328 — El enlace al manifiesto lleva el tema de ESTE dispositivo
 * (`?scheme=dark`) para que el fondo de la pantalla de inicio coincida con el
 * modo al instalar. El `id` del manifiesto no cambia, así que sigue siendo la
 * misma app instalada.
 *
 * v0.1.346 — La barra de ABAJO de la app instalada en Android NO sale del
 * `background_color`: Chrome la pinta con el `theme_color` del manifiesto en
 * los dos modos (no lee un color para el oscuro). Por eso, con las barras
 * neutras, el manifiesto no lleva `theme_color` y Android usa su barra del
 * sistema, que sigue el modo del teléfono (ver `apps/api/src/pwa/manifest.ts`).
 */
export const MANIFEST_PATH = '/api/v1/public/manifest.webmanifest';

export function manifestHref(theme: 'light' | 'dark'): string {
    return theme === 'dark' ? `${MANIFEST_PATH}?scheme=dark` : MANIFEST_PATH;
}

export function applyManifestScheme(theme: 'light' | 'dark', doc: Document = document): void {
    const link = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;
    const href = manifestHref(theme);
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/** El nombre con el que la app se instala aquí. */
export function currentAppName(doc: Document = document): string {
    return doc.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content?.trim() || DEFAULT_APP_NAME;
}
