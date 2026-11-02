import type { IconDesign, PlatformBrand } from '@imagina-base/shared';

/**
 * v0.1.345 — Las reglas del estudio del ícono, puras (las prueba
 * `iconStudioState.test.ts`). El estudio de v0.1.343 mezclaba en una sola
 * caja el dibujo, el fondo y la apertura, y un degradado elegido podía
 * quedar guardado pero NO dibujado (con «abrir con el color del ícono» el
 * fondo va de un color): la persona no sabía qué tenía elegido. Ahora lo
 * elegido es siempre lo que se dibuja, y cuando una elección cambia otra se
 * dice en pantalla.
 */

/**
 * El fondo que Android pone al abrir la app instalada en MODO OSCURO.
 *
 * Verificado en el código de Chrome (WebAPK, `res/values-night-v31`): en
 * oscuro la pantalla de apertura usa un color oscuro propio de la app
 * instalada (`dark_background_color`), no el `background_color` del
 * manifiesto, y Chrome ya no lee ningún campo del manifiesto que lo cambie
 * (el experimento de colores oscuros quedó obsoleto). O sea: en modo oscuro
 * el fondo es siempre un gris casi negro y encima va el ícono, elija lo que
 * elija el operador. El valor exacto lo pone el servidor de Google que arma la
 * app instalada; éste es el de su configuración de ejemplo.
 */
export const ANDROID_DARK_SPLASH = '#202020';

/** El tipo de fondo del ícono, tal como se DIBUJA. */
export type IconBgKind = 'color' | 'gradient' | 'none';

export function iconBgKind(brand: Pick<PlatformBrand, 'icon_design'>): IconBgKind {
    const d = brand.icon_design;
    if (!d) return 'none';
    // Con la apertura en el color del ícono el fondo se dibuja de un solo
    // color aunque haya un segundo guardado: se muestra lo que se ve.
    return d.bg_to !== null && d.splash !== 'icon' ? 'gradient' : 'color';
}

/** Un aviso en pantalla cuando una elección cambió otra. */
export type StudioNotice = 'splash-to-app' | 'bg-to-solid';

export interface StudioChange {
    patch: Partial<PlatformBrand>;
    notice: StudioNotice | null;
}

export interface BgKindContext {
    /** El diseño sugerido para el logo (puede no haber). */
    suggestion: IconDesign | null;
    /** El último diseño usado (para volver de «Sin fondo» sin perder lo elegido). */
    lastDesign: IconDesign | null;
    /** El último segundo color del degradado (para volver a «Degradado»). */
    lastGradientTo: string | null;
    /** Un segundo color si no hay ninguno recordado (el del logo o un tono más oscuro). */
    fallbackGradientTo: (from: string) => string;
}

/** Elegir el tipo de fondo. */
export function chooseBgKind(brand: Pick<PlatformBrand, 'icon_design'>, kind: IconBgKind, ctx: BgKindContext): StudioChange {
    if (kind === 'none') return { patch: { icon_design: null, icon_background_auto: true }, notice: null };
    const base = brand.icon_design ?? ctx.lastDesign ?? ctx.suggestion;
    if (!base) return { patch: {}, notice: null };
    if (kind === 'color') return { patch: { icon_design: { ...base, bg_to: null } }, notice: null };
    const to = base.bg_to ?? ctx.lastGradientTo ?? ctx.fallbackGradientTo(base.bg_from);
    // Un degradado no puede abrir con el color del ícono (se vería el borde):
    // la apertura pasa a ser sobre el fondo de la app, y se avisa.
    const toApp = base.splash === 'icon';
    return {
        patch: { icon_design: { ...base, bg_to: to, splash: toApp ? 'app' : base.splash } },
        notice: toApp ? 'splash-to-app' : null,
    };
}

/** Elegir cómo abre la app en Android. */
export function chooseSplash(design: IconDesign, splash: IconDesign['splash']): { design: IconDesign; notice: StudioNotice | null } {
    if (splash === 'icon' && design.bg_to !== null) {
        // El fondo queda del primer color del degradado.
        return { design: { ...design, splash, bg_to: null }, notice: 'bg-to-solid' };
    }
    return { design: { ...design, splash }, notice: null };
}

/** El color de la apertura en MODO CLARO (en oscuro, siempre {@link ANDROID_DARK_SPLASH}). */
export function lightSplashColor(brand: Pick<PlatformBrand, 'icon_design'>): string {
    const d = brand.icon_design;
    return d && d.splash === 'icon' ? d.bg_from : '#ffffff';
}

/** Resumen de una línea de lo elegido («Logo completo · Un color · Abre con tu color»). */
export function studioSummary(brand: Pick<PlatformBrand, 'icon_design' | 'icon_background_auto' | 'icon_background'>): string[] {
    const d = brand.icon_design;
    if (!d) {
        return [
            'El logo tal cual',
            brand.icon_background_auto ? 'Sin fondo (el de la app)' : `Fondo ${brand.icon_background}`,
            'Abre sobre el fondo de la app',
        ];
    }
    const art = d.art === 'mark' ? 'Sólo la marca, en blanco' : d.art === 'white' ? 'El logo en blanco' : 'El logo completo';
    const kind = iconBgKind(brand);
    const bg = kind === 'gradient' ? `Degradado ${d.bg_from} → ${d.bg_to}` : `Un color ${d.bg_from}`;
    return [art, bg, d.splash === 'icon' ? 'Abre con el color de tu ícono' : 'Abre sobre el fondo de la app'];
}
