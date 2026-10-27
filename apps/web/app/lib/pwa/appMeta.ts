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

/** El nombre con el que la app se instala aquí. */
export function currentAppName(doc: Document = document): string {
    return doc.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content?.trim() || DEFAULT_APP_NAME;
}
