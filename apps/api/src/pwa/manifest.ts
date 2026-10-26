/**
 * H1 — El manifiesto de la app instalable (W3C Web App Manifest).
 *
 * Se arma POR HOST: en el dominio de la plataforma, Imagina Base; en el
 * dominio propio (o el subdominio) de una empresa, SU nombre de app y SU
 * color (ADR-S17). Los iconos son siempre los genéricos: el logo de una
 * empresa es de cualquier forma y formato (horizontal, SVG, con fondo
 * transparente) y el lanzador del teléfono necesita un PNG cuadrado de 192 y
 * 512 con margen de seguridad (maskable). Recortarlo o rellenarlo bien exige
 * una librería de imágenes nativa (sharp/libvips, decenas de MB) para un
 * resultado que, con un logo apaisado, se ve peor que un icono neutro.
 */

export const DEFAULT_APP_NAME = 'Imagina Base';
export const DEFAULT_THEME_COLOR = '#0c7e97';

export interface ManifestInput {
    /** Empresa del Host (null = dominio de la plataforma). */
    tenant: { name: string; app_name: string | null; primary_color: string | null } | null;
}

export interface WebAppManifest {
    id: string;
    name: string;
    short_name: string;
    description: string;
    lang: string;
    dir: 'ltr';
    start_url: string;
    scope: string;
    display: 'standalone';
    orientation: 'any';
    background_color: string;
    theme_color: string;
    categories: string[];
    icons: Array<{ src: string; sizes: string; type: string; purpose: 'any' | 'maskable' }>;
    shortcuts: Array<{ name: string; short_name: string; url: string; icons: Array<{ src: string; sizes: string; type: string }> }>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** «Acme Gestión Comercial» → «Acme» si no entra (el lanzador corta en ~12). */
export function shortAppName(name: string): string {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean.length <= 12) return clean;
    const first = clean.split(' ')[0] ?? clean;
    return first.length <= 12 ? first : `${first.slice(0, 11)}…`;
}

export function buildManifest(input: ManifestInput): WebAppManifest {
    const t = input.tenant;
    const name = (t?.app_name?.trim() || t?.name?.trim() || DEFAULT_APP_NAME).slice(0, 60);
    const theme = t?.primary_color && HEX.test(t.primary_color) ? t.primary_color.toLowerCase() : DEFAULT_THEME_COLOR;
    const icon = { src: '/pwa/icon-96.png', sizes: '96x96', type: 'image/png' };
    return {
        // Estable: no cambia con el nombre ni el color (el navegador la usa
        // para reconocer la MISMA app instalada cuando el manifiesto cambia).
        id: '/',
        name,
        short_name: shortAppName(name),
        description: t ? `${name}: listas, registros y avisos de tu equipo.` : 'Listas, registros, vistas y automatizaciones de tu equipo.',
        lang: 'es',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: theme,
        categories: ['business', 'productivity'],
        icons: [
            { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/pwa/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
            { name: 'Mi trabajo', short_name: 'Mi trabajo', url: '/#/my-work', icons: [icon] },
            { name: 'Todas las listas', short_name: 'Listas', url: '/#/lists', icons: [icon] },
        ],
    };
}
