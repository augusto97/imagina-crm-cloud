/**
 * H1 — Las metas de la app instalada con la marca del tenant: el color de la
 * barra del navegador/ventana (`theme-color`) y el nombre bajo el icono en
 * iOS (`apple-mobile-web-app-title`). El manifiesto ya los trae por Host;
 * esto cubre el workspace activo en el dominio de la plataforma.
 */
export const DEFAULT_APP_NAME = 'Imagina Base';
export const DEFAULT_THEME_COLOR = '#0c7e97';

function setMeta(name: string, content: string, doc: Document): void {
    let el = doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
        el = doc.createElement('meta');
        el.name = name;
        doc.head.appendChild(el);
    }
    el.content = content;
}

export function applyAppMeta(primaryColor: string | null, appName: string | null, doc: Document = document): void {
    const color = primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_THEME_COLOR;
    setMeta('theme-color', color, doc);
    setMeta('apple-mobile-web-app-title', (appName ?? '').trim() || DEFAULT_APP_NAME, doc);
}

/** El nombre con el que la app se instala aquí. */
export function currentAppName(doc: Document = document): string {
    return doc.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content?.trim() || DEFAULT_APP_NAME;
}
