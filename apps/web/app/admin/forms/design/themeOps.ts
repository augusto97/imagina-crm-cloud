import {
    DEFAULT_PUBLIC_THEME,
    formConfigFileIds,
    publicThemeFileIds,
    readPublicTheme,
    type FormConfig,
    type FormFieldItem,
    type FormSettings,
    type PublicChoiceStyle,
    type PublicTheme,
} from '@imagina-base/shared';

/**
 * v0.1.351 (ADR-S94) — Operaciones PURAS del diseño del formulario. Todo
 * devuelve un `FormConfig` nuevo: pasan por el `change()` del constructor y
 * se deshacen con Ctrl+Z como cualquier otro cambio.
 *
 * Reglas:
 * - `settings.theme` null = el diseño de siempre («Clásico»). El primer
 *   cambio arranca de `DEFAULT_PUBLIC_THEME`.
 * - El color viejo del formulario (`settings.accent_color`) pasa al acento
 *   del tema la primera vez que se toca el diseño, y queda en null.
 * - Tocar cualquier ajuste suelta la plantilla (`preset` → null): ya no es
 *   la plantilla tal cual.
 */

export const THEME_SECTIONS = ['colors', 'typography', 'layout', 'background', 'cover', 'split', 'card', 'inputs', 'choices', 'button'] as const;
export type ThemeSectionKey = (typeof THEME_SECTIONS)[number];
/** Lo que tiene su botón «Restablecer» en el panel de diseño. */
export type ThemeResetKey = ThemeSectionKey | 'custom_css';

const FALLBACK_ACCENT = '#0e7490';

/** El tema que se ve: el guardado o, sin él, el de siempre. */
export function effectiveTheme(settings: Pick<FormSettings, 'theme'>): PublicTheme {
    return settings.theme ? readPublicTheme(settings.theme) : DEFAULT_PUBLIC_THEME;
}

/** ¿El formulario usa el diseño de siempre (sin tema propio)? */
export function isClassicTheme(settings: Pick<FormSettings, 'theme'>): boolean {
    return settings.theme === null || settings.theme === undefined;
}

/**
 * El tema desde donde se edita: el guardado o el de siempre, con el color
 * viejo del formulario como acento si el tema todavía no tiene uno.
 */
export function startTheme(settings: Pick<FormSettings, 'theme' | 'accent_color'>): PublicTheme {
    const base = effectiveTheme(settings);
    if (settings.accent_color && !base.colors.accent) {
        return { ...base, colors: { ...base.colors, accent: settings.accent_color } };
    }
    return base;
}

/** Acento de respaldo (cuando el tema no fija uno): el viejo del formulario o el de la marca. */
export function fallbackAccent(settings: Pick<FormSettings, 'accent_color'>, brand: string | null | undefined): string {
    return settings.accent_color ?? (brand && /^#[0-9a-f]{6}$/i.test(brand) ? brand : FALLBACK_ACCENT);
}

/** El acento que se ve: el del tema, el viejo del formulario o el de la marca. */
export function resolvedAccent(settings: Pick<FormSettings, 'theme' | 'accent_color'>, brand: string | null | undefined): string {
    return effectiveTheme(settings).colors.accent ?? fallbackAccent(settings, brand);
}

/** Pone el tema en el formulario (y suelta el color viejo, que ya vive en el tema). */
export function withTheme(config: FormConfig, theme: PublicTheme): FormConfig {
    return { ...config, settings: { ...config.settings, theme, accent_color: null } };
}

/** Cambia una sección del tema (colores, tipografía, página…). */
export function patchThemeSection<K extends ThemeSectionKey>(config: FormConfig, key: K, patch: Partial<PublicTheme[K]>): FormConfig {
    const start = startTheme(config.settings);
    return withTheme(config, { ...start, preset: null, [key]: { ...start[key], ...patch } });
}

/** Cambia algo de primer nivel del tema (modo, colores oscuros, CSS propio). */
export function patchTheme(config: FormConfig, patch: Partial<Pick<PublicTheme, 'mode' | 'dark_colors' | 'custom_css'>>): FormConfig {
    const start = startTheme(config.settings);
    return withTheme(config, { ...start, ...patch, preset: null });
}

/** Un color del modo oscuro (null = el calculado solo). */
export function patchDarkColor(config: FormConfig, key: string, value: string | null): FormConfig {
    const start = startTheme(config.settings);
    const dark: Record<string, string | null | undefined> = { ...(start.dark_colors ?? {}) };
    if (value === null) delete dark[key];
    else dark[key] = value;
    return patchTheme(config, { dark_colors: dark as PublicTheme['dark_colors'] });
}

/** Vuelve una sección a los valores de fábrica. */
export function resetThemeSection(config: FormConfig, key: ThemeResetKey): FormConfig {
    if (isClassicTheme(config.settings)) {
        // Sin tema: sólo el color viejo puede estar "cambiado".
        return key === 'colors' && config.settings.accent_color ? { ...config, settings: { ...config.settings, accent_color: null } } : config;
    }
    const start = startTheme(config.settings);
    const D = DEFAULT_PUBLIC_THEME;
    let next: PublicTheme;
    if (key === 'colors') next = { ...start, colors: D.colors, mode: D.mode, dark_colors: D.dark_colors };
    else if (key === 'custom_css') next = { ...start, custom_css: D.custom_css };
    else next = { ...start, [key]: D[key] };
    return withTheme(config, { ...next, preset: null });
}

/** Comparación estable (las claves de un jsonb vuelven en otro orden). */
export function stableEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

function stableStringify(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
        .join(',')}}`;
}

/** ¿La sección tiene cambios respecto del diseño de fábrica? (para el punto y «Restablecer») */
export function themeSectionModified(settings: Pick<FormSettings, 'theme' | 'accent_color'>, key: ThemeResetKey): boolean {
    if (isClassicTheme(settings)) return key === 'colors' && Boolean(settings.accent_color);
    const t = effectiveTheme(settings);
    const D = DEFAULT_PUBLIC_THEME;
    if (key === 'colors') {
        return !stableEqual(t.colors, D.colors) || t.mode !== D.mode || !stableEqual(t.dark_colors, D.dark_colors) || Boolean(settings.accent_color);
    }
    if (key === 'custom_css') return t.custom_css.trim() !== '';
    return !stableEqual(t[key], D[key]);
}

/** El mismo diseño (sin mirar de qué plantilla salió). */
export function sameTheme(a: PublicTheme | null | undefined, b: PublicTheme | null | undefined): boolean {
    if (!a || !b) return false;
    return stableEqual({ ...a, preset: null }, { ...b, preset: null });
}

export interface ApplyThemeOptions {
    /**
     * Quien aplica no es administrador: no puede borrar el CSS propio de la
     * empresa. Si el tema trae CSS (lo guardó un administrador) se usa ese;
     * si no trae, se conserva el que había.
     */
    keepCustomCss: boolean;
    /**
     * Plantillas de la galería: conservan las imágenes que ya se subieron
     * (portada y panel dividido) para que probar plantillas no las pierda.
     */
    carryImages?: boolean;
}

/** Aplica una plantilla o un tema guardado: reemplaza el tema entero. */
export function applyTheme(config: FormConfig, theme: PublicTheme, opts: ApplyThemeOptions): FormConfig {
    const current = isClassicTheme(config.settings) ? null : effectiveTheme(config.settings);
    const next: PublicTheme = { ...theme };
    if (opts.carryImages && current) {
        next.cover = { ...theme.cover, file_id: theme.cover.file_id ?? current.cover.file_id };
        next.split = { ...theme.split, file_id: theme.split.file_id ?? current.split.file_id };
    }
    if (opts.keepCustomCss && theme.custom_css.trim() === '') next.custom_css = current?.custom_css ?? '';
    return withTheme(config, next);
}

/** La plantilla marcada en la galería (sin tema = «Clásico»). */
export function activePresetId(settings: Pick<FormSettings, 'theme'>): string | null {
    if (isClassicTheme(settings)) return 'classic';
    return effectiveTheme(settings).preset;
}

/**
 * Lo que se guarda: si quedó el color viejo junto a un tema (datos de antes),
 * pasa al acento del tema y el viejo queda en null.
 */
export function normalizeForSave(config: FormConfig): FormConfig {
    const s = config.settings;
    if (isClassicTheme(s) || !s.accent_color) return config;
    const t = effectiveTheme(s);
    return withTheme(config, t.colors.accent ? t : { ...t, colors: { ...t.colors, accent: s.accent_color } });
}

/** Todas las imágenes que usa el formulario (tema, ítems de imagen, opciones). */
export function formImageIds(config: FormConfig): number[] {
    const ids = new Set<number>([...publicThemeFileIds(effectiveTheme(config.settings)), ...formConfigFileIds(config)]);
    return [...ids].sort((a, b) => a - b);
}

/** Tema que trae CSS propio (para avisarle a quien no es administrador). */
export function themeHasCustomCss(settings: Pick<FormSettings, 'theme'>): boolean {
    return effectiveTheme(settings).custom_css.trim() !== '';
}

/** Atajos de ancho de la página. */
export const WIDTH_PRESETS = [
    { value: 520, label: 'Angosto' },
    { value: 660, label: 'Medio' },
    { value: 820, label: 'Ancho' },
] as const;

/**
 * Cómo se van a ver las opciones de una pregunta: lista desplegable o el
 * estilo (lista, botones, tarjetas). Igual que `buildPublicFormItems`.
 */
export function effectiveChoiceDisplay(
    display: FormFieldItem['display'],
    themeStyle: PublicChoiceStyle,
    optionCount: number,
    multiple: boolean,
): PublicChoiceStyle | 'dropdown' {
    if (!multiple && (display === 'dropdown' || (display === 'auto' && optionCount > 6))) return 'dropdown';
    if (display === 'buttons' || display === 'cards') return display;
    if (display === 'radio') return 'list';
    return themeStyle;
}

/** Una imagen por opción (null = quitarla). */
export function setOptionImage(item: FormFieldItem, value: string, fileId: number | null): Pick<FormFieldItem, 'option_images'> {
    const next = { ...item.option_images };
    if (fileId === null) delete next[value];
    else next[value] = fileId;
    return { option_images: next };
}
