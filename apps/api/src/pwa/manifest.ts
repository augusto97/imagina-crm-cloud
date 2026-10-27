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
 *
 * v0.1.326 — el color de las barras del sistema (`theme_color`) ya no es el
 * primario de la empresa: por defecto es NEUTRO (blanco, como la barra
 * superior de la app) y la empresa elige en Ajustes → Marca si quiere el de
 * su marca u otro (`branding.app_bar_color`). En modo oscuro la app ajusta la
 * meta `theme-color` al cargar; el manifiesto no sabe del tema de la persona.
 */
import { APP_BAR_NEUTRAL, DEFAULT_PLATFORM_APP_NAME, resolveAppBarColor, type PlatformBrand } from '@imagina-base/shared';


export const DEFAULT_APP_NAME = DEFAULT_PLATFORM_APP_NAME;
export const DEFAULT_THEME_COLOR = APP_BAR_NEUTRAL.light;

export interface ManifestInput {
    /** Empresa del Host (null = dominio de la plataforma). */
    tenant: { name: string; app_name: string | null; primary_color: string | null; app_bar_color?: string | null } | null;
    /**
     * v0.1.327 — la marca de la plataforma (Plataforma → Marca): su nombre e
     * ícono valen en el dominio de la PLATAFORMA. En el dominio de una empresa
     * nunca (white-label): ahí van su nombre y el ícono neutro.
     */
    platform?: Pick<PlatformBrand, 'app_name' | 'icons'> | null;
    /**
     * v0.1.328 — tema del dispositivo que pide el manifiesto (`?scheme=dark`).
     * En Android la barra de abajo de la app instalada y el fondo de su
     * pantalla de inicio salen del `background_color`, no de la meta de la
     * página: sin esto quedaban blancos en modo oscuro.
     */
    scheme?: 'light' | 'dark';
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


/** «Acme Gestión Comercial» → «Acme» si no entra (el lanzador corta en ~12). */
export function shortAppName(name: string): string {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean.length <= 12) return clean;
    const first = clean.split(' ')[0] ?? clean;
    return first.length <= 12 ? first : `${first.slice(0, 11)}…`;
}

export function buildManifest(input: ManifestInput): WebAppManifest {
    const t = input.tenant;
    const platformName = input.platform?.app_name?.trim() || DEFAULT_APP_NAME;
    const name = (t ? t.app_name?.trim() || t.name?.trim() || DEFAULT_APP_NAME : platformName).slice(0, 60);
    const own = t === null ? (input.platform?.icons ?? null) : null;
    const scheme = input.scheme ?? 'light';
    const theme = resolveAppBarColor(t?.app_bar_color ?? null, t?.primary_color ?? null, scheme);
    const icon = { src: own?.icon_96 ?? '/pwa/icon-96.png', sizes: '96x96', type: 'image/png' };
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
        background_color: APP_BAR_NEUTRAL[scheme],
        theme_color: theme,
        categories: ['business', 'productivity'],
        icons: own
            ? [
                  { src: own.icon_192, sizes: '192x192', type: 'image/png', purpose: 'any' },
                  { src: own.icon_512, sizes: '512x512', type: 'image/png', purpose: 'any' },
                  { src: own.maskable_192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
                  { src: own.maskable_512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ]
            : [
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
