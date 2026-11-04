import { DESIGN_FONT_DEFS, fontStack, selfHostedFontFaces, type DesignFont } from './design-style';
import {
    DEFAULT_LIGHT_PALETTE,
    PUBLIC_CSS_MAX,
    type PublicButton,
    type PublicChoiceStyle,
    type PublicLabelPosition,
    type PublicPalette,
    type PublicPaletteKey,
    type PublicTheme,
} from './public-theme';

/**
 * v0.1.351 (ADR-S94) — Del tema (datos) a la página pública: variables CSS,
 * clases del `<body>` y las imágenes de fondo/portada. La estructura y TODAS
 * las variantes (estilos de campo, de opciones, de botón, etiqueta al lado o
 * dentro…) viven en `PUBLIC_BASE_CSS`, fijo y conocido; el tema sólo prende
 * clases y pone valores. Así el CSS propio de una empresa tiene nombres de
 * clase estables (`.ib-…`, documentados) y la vista previa del constructor
 * dibuja exactamente lo mismo que ve el visitante.
 */

// ───────────────────────────── Colores ─────────────────────────────

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const h = m ? m[1]! : '000000';
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: Rgb): string {
    const c = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mezcla `a` con `b`: t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Luminancia relativa (WCAG). */
export function luminance(hex: string): number {
    const ch = hexToRgb(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Blanco o tinta casi negra: el que más contrasta sobre `bg`. */
export function inkOnColor(bg: string): string {
    return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111827') ? '#ffffff' : '#111827';
}

/**
 * Lleva `fg` hacia el blanco o el negro (lo que más ayude contra `bg`) hasta
 * llegar al contraste pedido, conservando el tono. Para el acento usado como
 * TEXTO (botón de contorno, enlaces) sobre la tarjeta.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
    if (contrastRatio(fg, bg) >= min) return fg;
    const target = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
    for (let t = 0.08; t <= 1; t += 0.08) {
        const c = mixHex(fg, target, t);
        if (contrastRatio(c, bg) >= min) return c;
    }
    return target;
}

function rgba(hex: string, alpha: number): string {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
}

export type FullPalette = Record<PublicPaletteKey, string> & { accent: string; accent_ink: string };

const DARK_BASE: Record<PublicPaletteKey, string> = {
    background: '#0f1115',
    card: '#171a21',
    text: '#e8eaef',
    muted: '#9aa3b2',
    border: '#2c313c',
    input_bg: '#12151b',
    input_border: '#373d49',
    error: '#f97066',
};

/** ¿Esta paleta ya es oscura? (fondo y tarjeta oscuros). */
export function isDarkPalette(p: Pick<PublicPalette, 'card' | 'background'>): boolean {
    return luminance(p.card) < 0.18 && luminance(p.background) < 0.18;
}

/**
 * Paleta oscura calculada a partir de la clara: neutros oscuros con un toque
 * del acento, y el acento aclarado si no se lee sobre la tarjeta oscura.
 */
export function deriveDarkPalette(light: PublicPalette, accent: string): FullPalette {
    if (isDarkPalette(light)) return fullPalette(light, accent);
    const tint = (hex: string, t: number): string => mixHex(hex, accent, t);
    const base: Record<PublicPaletteKey, string> = {
        background: tint(DARK_BASE.background, 0.04),
        card: tint(DARK_BASE.card, 0.04),
        text: DARK_BASE.text,
        muted: DARK_BASE.muted,
        border: tint(DARK_BASE.border, 0.06),
        input_bg: tint(DARK_BASE.input_bg, 0.03),
        input_border: tint(DARK_BASE.input_border, 0.06),
        error: DARK_BASE.error,
    };
    const a = ensureContrast(accent, base.card, 3);
    return { ...base, accent: a, accent_ink: inkOnColor(a) };
}

function fullPalette(p: Partial<PublicPalette>, accent: string): FullPalette {
    const out = { ...DEFAULT_LIGHT_PALETTE } as Record<PublicPaletteKey, string>;
    for (const k of Object.keys(DEFAULT_LIGHT_PALETTE) as PublicPaletteKey[]) {
        const v = p[k];
        if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
    }
    const a = p.accent ?? accent;
    return { ...out, accent: a, accent_ink: p.accent_ink ?? inkOnColor(a) };
}

export interface ResolvedPalettes {
    /** La que se ve (clara, u oscura si el modo es «oscuro»). */
    main: FullPalette;
    /** Modo «según el dispositivo»: la que se usa con el dispositivo en oscuro. */
    dark: FullPalette | null;
}

/** Las paletas finales de un tema. `accent` = el de respaldo (formulario o marca). */
export function resolvePublicPalettes(theme: PublicTheme, accent: string): ResolvedPalettes {
    const base = theme.colors.accent ?? accent;
    const main = fullPalette(theme.colors, base);
    if (theme.mode !== 'auto') return { main, dark: null };
    const derived = deriveDarkPalette(theme.colors, base);
    const over = theme.dark_colors ?? {};
    const dark: FullPalette = { ...derived };
    for (const k of Object.keys(DEFAULT_LIGHT_PALETTE) as PublicPaletteKey[]) {
        const v = over[k];
        if (typeof v === 'string') dark[k] = v;
    }
    if (typeof over.accent === 'string') dark.accent = over.accent;
    dark.accent_ink = typeof over.accent_ink === 'string' ? over.accent_ink : inkOnColor(dark.accent);
    return { main, dark };
}

const SHADOW: Record<string, string> = {
    none: 'none',
    sm: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.06)',
    md: '0 1px 2px rgba(16,24,40,.04), 0 6px 24px rgba(16,24,40,.06)',
    lg: '0 4px 8px rgba(16,24,40,.05), 0 18px 48px rgba(16,24,40,.12)',
};
const SHADOW_DARK: Record<string, string> = {
    none: 'none',
    sm: '0 1px 3px rgba(0,0,0,.35)',
    md: '0 2px 4px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35)',
    lg: '0 6px 12px rgba(0,0,0,.35), 0 24px 60px rgba(0,0,0,.45)',
};

function paletteVars(p: FullPalette, shadow: string): string {
    const dark = isDarkPalette(p);
    const soft = mixHex(p.card, p.text, dark ? 0.08 : 0.045);
    const fill = p.input_bg.toLowerCase() === p.card.toLowerCase() ? mixHex(p.card, p.text, dark ? 0.1 : 0.06) : p.input_bg;
    const accentText = ensureContrast(p.accent, p.card, 4.5);
    return [
        `color-scheme:${dark ? 'dark' : 'light'}`,
        `--ib-bg:${p.background}`,
        `--ib-card:${p.card}`,
        `--ib-text:${p.text}`,
        `--ib-muted:${p.muted}`,
        `--ib-border:${p.border}`,
        `--ib-input-bg:${p.input_bg}`,
        `--ib-input-border:${p.input_border}`,
        `--ib-input-fill:${fill}`,
        `--ib-error:${p.error}`,
        `--ib-error-soft:${mixHex(p.card, p.error, dark ? 0.16 : 0.07)}`,
        `--ib-accent:${p.accent}`,
        `--ib-accent-ink:${p.accent_ink}`,
        `--ib-accent-text:${accentText}`,
        `--ib-accent-soft:${mixHex(p.card, p.accent, dark ? 0.2 : 0.1)}`,
        `--ib-accent-ring:${rgba(p.accent, dark ? 0.4 : 0.28)}`,
        `--ib-accent-shadow:${rgba(p.accent, 0.35)}`,
        `--ib-soft:${soft}`,
        `--ib-shadow:${(dark ? SHADOW_DARK : SHADOW)[shadow] ?? SHADOW.md}`,
    ].join(';');
}

// ───────────────────────────── Tamaños ─────────────────────────────

const INPUT_SIZE = { sm: { h: 36, px: 10 }, md: { h: 44, px: 12 }, lg: { h: 52, px: 14 } } as const;
const BUTTON_SIZE = { sm: { h: 36, px: 16, fs: -1 }, md: { h: 44, px: 22, fs: 0 }, lg: { h: 54, px: 30, fs: 1 } } as const;

function px(n: number): string {
    return `${Math.round(n * 100) / 100}px`;
}

function layoutVars(theme: PublicTheme): string {
    const t = theme.typography;
    const heading: DesignFont = t.heading_font ?? t.font;
    const i = INPUT_SIZE[theme.inputs.size];
    const b = BUTTON_SIZE[theme.button.size];
    return [
        `--ib-font:${fontStack(t.font)}`,
        `--ib-heading-font:${fontStack(heading)}`,
        `--ib-fs:${px(t.base_size)}`,
        `--ib-lh:${t.line_height}`,
        `--ib-title-fs:${px(t.title_size)}`,
        `--ib-title-fw:${t.title_weight}`,
        `--ib-title-ls:${px(t.title_letter_spacing)}`,
        `--ib-q-fs:${px(t.question_size)}`,
        `--ib-q-fw:${t.question_weight}`,
        `--ib-width:${px(theme.layout.width)}`,
        `--ib-pad:${px(theme.layout.padding)}`,
        `--ib-gap:${px(theme.layout.gap)}`,
        `--ib-logo-h:${px(theme.layout.logo_size)}`,
        `--ib-card-radius:${px(theme.card.radius)}`,
        `--ib-card-bw:${px(theme.card.border_width)}`,
        `--ib-input-h:${px(i.h)}`,
        `--ib-input-px:${px(i.px)}`,
        `--ib-input-radius:${theme.inputs.style === 'pill' ? '999px' : px(theme.inputs.radius)}`,
        `--ib-input-bw:${px(theme.inputs.border_width)}`,
        `--ib-choice-radius:${px(theme.choices.radius)}`,
        `--ib-btn-h:${px(b.h)}`,
        `--ib-btn-px:${px(theme.button.style === 'text' ? 4 : b.px)}`,
        `--ib-btn-fs:${px(t.base_size + b.fs)}`,
        `--ib-btn-radius:${px(theme.button.radius)}`,
        `--ib-cover-h:${px(theme.cover.height)}`,
    ].join(';');
}

// ───────────────────────────── Clases ─────────────────────────────

/**
 * Lo que la página necesita del tema para ARMAR la pantalla (no sólo para
 * pintarla): dónde va la etiqueta, cómo se dibujan las opciones, el avance…
 * Viaja en la meta pública (`theme`), sin colores ni archivos.
 */
export interface PublicThemeView {
    /** Clases del `<body>`: prenden las variantes de `PUBLIC_BASE_CSS`. */
    classes: string[];
    label_position: PublicLabelPosition;
    choice_style: PublicChoiceStyle;
    choice_columns: number;
    progress: 'bar' | 'steps' | 'none';
    button_icon: PublicButton['icon'];
    cover: boolean;
    band: boolean;
    split: { side: 'left' | 'right'; headline: string } | null;
    /** Insertado en otro sitio, ¿se ve el fondo? (si no, transparente). */
    embed_background: boolean;
}

export function publicThemeView(theme: PublicTheme): PublicThemeView {
    const c: string[] = [];
    c.push(`ib-container-${theme.layout.container}`);
    c.push(`ib-input-${theme.inputs.style}`);
    c.push(`ib-labels-${theme.inputs.label_position}`);
    c.push(`ib-btn-${theme.button.style}`);
    c.push(`ib-btn-align-${theme.button.align}`);
    if (theme.button.full_width) c.push('ib-btn-full');
    if (theme.button.shadow) c.push('ib-btn-shadow');
    if (theme.button.uppercase) c.push('ib-btn-upper');
    if (theme.layout.header_align === 'center') c.push('ib-header-center');
    if (theme.layout.vertical_center) c.push('ib-vcenter');
    if (!theme.layout.show_title) c.push('ib-no-title');
    if (!theme.layout.show_description) c.push('ib-no-desc');
    if (theme.background.kind !== 'color' || theme.background.pattern !== 'none') c.push('ib-has-bg');
    if (theme.split.enabled) c.push('ib-split', `ib-split-${theme.split.side}`);
    c.push(`ib-ratio-${theme.choices.image_ratio}`);
    return {
        classes: c,
        label_position: theme.inputs.label_position,
        choice_style: theme.choices.style,
        choice_columns: theme.choices.columns,
        progress: theme.layout.progress,
        button_icon: theme.button.icon,
        cover: theme.cover.enabled,
        band: theme.layout.band && !theme.cover.enabled,
        split: theme.split.enabled ? { side: theme.split.side, headline: theme.split.headline } : null,
        embed_background: theme.layout.embed_background,
    };
}

// ───────────────────────────── Imágenes ─────────────────────────────

/** Sólo rutas propias (`/api/…`) o https sin caracteres que rompan el CSS. */
export function cssUrl(u: string | null | undefined): string | null {
    if (!u) return null;
    if (!/^(\/(?!\/)|https:\/\/)[^\s"'()\\<>]*$/.test(u)) return null;
    return `url("${u}")`;
}

export interface PublicThemeImages {
    cover?: string | null;
    split?: string | null;
    background?: string | null;
}

const PATTERN: Record<string, (ink: string) => string> = {
    dots: (ink) => `radial-gradient(${ink} 1.1px, transparent 1.3px) 0 0/18px 18px`,
    grid: (ink) => `linear-gradient(${ink} 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0/24px 24px`,
    diagonal: (ink) => `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px 14px)`,
};

function backgroundCss(theme: PublicTheme, p: FullPalette, images: PublicThemeImages): string {
    const bg = theme.background;
    const out: string[] = [];
    const layers: string[] = [];
    const ink = rgba(p.text, isDarkPalette(p) ? 0.1 : 0.08);
    if (bg.pattern !== 'none') layers.push(PATTERN[bg.pattern]!(ink));
    if (bg.kind === 'gradient') {
        layers.push(`linear-gradient(${bg.gradient_angle}deg, ${p.background}, ${bg.gradient_to ?? mixHex(p.background, p.accent, 0.35)})`);
    }
    if (layers.length) out.push(`.ib-bg{background:${layers.join(',')}${bg.kind === 'gradient' ? '' : `,${p.background}`}}`);
    const img = bg.kind === 'image' ? cssUrl(images.background) : null;
    if (img) {
        const size = bg.fit === 'repeat' ? 'auto' : bg.fit;
        const repeat = bg.fit === 'repeat' ? 'repeat' : 'no-repeat';
        out.push(
            `.ib-bg-img{background:${img} center/${size} ${repeat};${bg.blur > 0 ? `filter:blur(${bg.blur}px);inset:-${bg.blur * 2}px;` : ''}}`,
        );
        if (bg.overlay > 0) out.push(`.ib-bg-img::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,${bg.overlay})}`);
    }
    return out.join('');
}

function coverCss(theme: PublicTheme, p: FullPalette, images: PublicThemeImages): string {
    if (!theme.cover.enabled) return '';
    const img = cssUrl(images.cover);
    const fill = img
        ? `${img} center ${theme.cover.position}/cover no-repeat`
        : `linear-gradient(135deg, ${p.accent}, ${mixHex(p.accent, '#000000', 0.35)})`;
    const shade = theme.cover.overlay > 0 ? `linear-gradient(rgba(0,0,0,${theme.cover.overlay}),rgba(0,0,0,${theme.cover.overlay})),` : '';
    return `.ib-cover{background:${shade}${fill}}`;
}

function splitCss(theme: PublicTheme, p: FullPalette, images: PublicThemeImages): string {
    if (!theme.split.enabled) return '';
    const img = cssUrl(images.split);
    const panel = theme.split.color ?? p.accent;
    const shade = theme.split.overlay > 0 ? `linear-gradient(rgba(0,0,0,${theme.split.overlay}),rgba(0,0,0,${theme.split.overlay})),` : '';
    const fill = img ? `${shade}${img} center/cover no-repeat, ${panel}` : `${shade}linear-gradient(160deg, ${panel}, ${mixHex(panel, '#000000', 0.3)})`;
    const ink = img ? '#ffffff' : inkOnColor(panel);
    return `.ib-split-media{background:${fill};color:${ink}}`;
}

// ───────────────────────────── CSS propio ─────────────────────────────

export interface SanitizedCss {
    css: string;
    /** Qué se quitó (para avisarlo en el editor). */
    removed: string[];
}

/**
 * Limpia el CSS que escribe una empresa: nada que cargue algo de afuera
 * (`url(`, `@import`, `@font-face`, `image-set(`…), nada que cierre la
 * etiqueta `<style>` y nada de los trucos viejos para ejecutar código
 * (`expression(`, `behavior`, `-moz-binding`, `javascript:`). Las barras
 * invertidas se quitan porque con ellas se escribe `url(` de otra forma.
 */
export function sanitizePublicCss(raw: string): SanitizedCss {
    let css = String(raw ?? '').slice(0, PUBLIC_CSS_MAX);
    const removed = new Set<string>();
    const strip = (re: RegExp, what: string, replacement = ''): void => {
        if (re.test(css)) {
            removed.add(what);
            css = css.replace(re, replacement);
        }
        re.lastIndex = 0;
    };
    // Los escapes de CSS (`u\72l(` = `url(`, `\3c` = `<`) se DECODIFICAN antes
    // de revisar, así lo disfrazado se reconoce y se quita como lo demás; las
    // barras que queden (un `\5c` decodificado) se quitan después.
    if (/\\/.test(css)) {
        removed.add('barras invertidas');
        css = css.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^\n0-9a-fA-F])/g, (_m, hex: string | undefined, ch: string | undefined) => {
            if (hex) {
                const cp = parseInt(hex, 16);
                return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
            }
            return ch ?? '';
        });
    }
    strip(/[\\]/g, 'barras invertidas');
    strip(/</g, 'el carácter «<»');
    strip(/\/\*[\s\S]*?(\*\/|$)/g, 'comentarios');
    strip(/@import[^;]*;?/gi, '@import');
    strip(/@font-face\s*\{[^}]*\}?/gi, '@font-face');
    strip(/@(namespace|charset|document)[^;{]*[;{]?/gi, '@namespace/@charset');
    // Primero la llamada ENTERA con su argumento (así no queda la dirección
    // escrita); de adentro hacia afuera, para image-set(url(…) 1x).
    const CALL = /\b(-webkit-)?(url|src|image-set|image|cross-fade|element|expression)\s*\((?:"[^"]*"|'[^']*'|[^()"'])*\)/gi;
    for (let i = 0; i < 6 && CALL.test(css); i++) {
        CALL.lastIndex = 0;
        css = css.replace(CALL, (_m, _w, name: string) => {
            const n = name.toLowerCase();
            removed.add(n === 'image-set' ? 'image-set()' : n === 'expression' ? 'expression()' : 'url() y otras cargas');
            return 'none';
        });
    }
    CALL.lastIndex = 0;
    // Lo que quede abierto (sin cerrar el paréntesis) tampoco carga nada.
    strip(/(-webkit-)?image-set\s*\(/gi, 'image-set()', 'none(');
    strip(/\b(url|src|image|cross-fade|element)\s*\(/gi, 'url() y otras cargas', 'none(');
    strip(/expression\s*\(/gi, 'expression()', 'none(');
    strip(/(behavior|-moz-binding)\s*:/gi, 'behavior / -moz-binding', 'x-blocked:');
    strip(/javascript\s*:/gi, 'javascript:', '');
    return { css: css.trim(), removed: [...removed] };
}

// ───────────────────────────── El CSS del tema ─────────────────────────────

export interface PublicThemeCssOptions {
    /** Acento de respaldo (el del formulario o el de la marca). */
    accent: string;
    images?: PublicThemeImages;
    /** Origen de las fuentes servidas por la app (vacío = mismo origen). */
    fontBase?: string;
    /** Sumar el CSS propio (por defecto sí). */
    includeCustom?: boolean;
}

/** Las fuentes web que usa un tema (para pedir sólo esas). */
export function publicThemeWebFonts(theme: PublicTheme): DesignFont[] {
    const out = new Set<DesignFont>();
    for (const f of [theme.typography.font, theme.typography.heading_font ?? theme.typography.font]) {
        if (DESIGN_FONT_DEFS[f]?.kind === 'web') out.add(f);
    }
    return [...out];
}

/** El archivo de la fuente del texto (para el `<link rel=preload>`). */
export function publicThemePreloadFont(theme: PublicTheme, base = ''): string | null {
    const f = theme.typography.font;
    if (DESIGN_FONT_DEFS[f]?.kind !== 'web') return null;
    return `${base}/email-fonts/${f}-400-normal.woff2`;
}

/**
 * Todo lo que el tema le agrega a la página: fuentes, variables (claras y,
 * si corresponde, oscuras), fondo, portada, panel dividido y el CSS propio
 * limpio. Se sirve en `<style id="ib-theme">` y la vista previa lo reemplaza
 * en vivo.
 */
export function buildPublicThemeCss(theme: PublicTheme, opts: PublicThemeCssOptions): string {
    const images = opts.images ?? {};
    const pals = resolvePublicPalettes(theme, opts.accent);
    const parts: string[] = [];
    const fonts = publicThemeWebFonts(theme);
    if (fonts.length) parts.push(selfHostedFontFaces(fonts, opts.fontBase ?? ''));
    parts.push(`:root{${paletteVars(pals.main, theme.card.shadow)};${layoutVars(theme)}}`);
    parts.push(backgroundCss(theme, pals.main, images));
    parts.push(coverCss(theme, pals.main, images));
    parts.push(splitCss(theme, pals.main, images));
    if (pals.dark) {
        const dark = paletteVars(pals.dark, theme.card.shadow);
        const darkExtra = [backgroundCss(theme, pals.dark, images), coverCss(theme, pals.dark, images), splitCss(theme, pals.dark, images)].join('');
        // Según el dispositivo… salvo que la vista previa fuerce uno (`data-scheme`).
        parts.push(`@media (prefers-color-scheme: dark){:root:not([data-scheme=light]){${dark}}}`);
        parts.push(`:root[data-scheme=dark]{${dark}}`);
        if (darkExtra) {
            parts.push(`@media (prefers-color-scheme: dark){${scope(darkExtra, ':root:not([data-scheme=light])')}}`);
            parts.push(scope(darkExtra, ':root[data-scheme=dark]'));
        }
    }
    if (opts.includeCustom !== false && theme.custom_css.trim() !== '') {
        const clean = sanitizePublicCss(theme.custom_css).css;
        if (clean) parts.push(`/* CSS propio */\n${clean}`);
    }
    return parts.filter(Boolean).join('\n');
}

/** Antepone un selector a cada regla simple `sel{…}` de un bloque generado por nosotros. */
function scope(css: string, prefix: string): string {
    return css.replace(/(^|\})\s*([^{}@]+)\{/g, (_m, close: string, sel: string) => `${close}${sel.split(',').map((s) => `${prefix} ${s.trim()}`).join(',')}{`);
}

/**
 * Estructura y TODAS las variantes. Fijo (no depende del tema): el tema pone
 * los valores en variables y prende clases en `<body>`. Nombres `.ib-…`
 * estables: son los que se documentan para el CSS propio.
 */
export const PUBLIC_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
[hidden]{display:none!important}
body{background:var(--ib-bg);color:var(--ib-text);font-family:var(--ib-font);font-size:var(--ib-fs);line-height:var(--ib-lh);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;text-rendering:optimizeLegibility}
body.ib-embedded:not(.ib-embed-bg){background:transparent}
body.ib-embedded:not(.ib-embed-bg) .ib-bg{display:none}
a{color:var(--ib-accent-text)}
.ib-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.ib-bg-img{position:absolute;inset:0}
.ib-shell{position:relative;z-index:1;min-height:100vh;min-height:100dvh;display:flex}
.ib-wrap{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:center;padding:32px 16px 48px}
body.ib-embedded .ib-wrap{padding:8px 4px 16px}
.ib-vcenter .ib-wrap{justify-content:center}
.ib-card{position:relative;width:100%;max-width:var(--ib-width);background:var(--ib-card);border:var(--ib-card-bw) solid var(--ib-border);border-radius:var(--ib-card-radius);box-shadow:var(--ib-shadow);overflow:hidden}
body.ib-embedded:not(.ib-embed-bg) .ib-card{box-shadow:none}
.ib-container-plain .ib-card{background:transparent;border-color:transparent;box-shadow:none;border-radius:0;overflow:visible}
.ib-band{height:6px;background:var(--ib-accent)}
.ib-cover{height:var(--ib-cover-h);background:var(--ib-accent)}
.ib-inner{padding:var(--ib-pad)}
.ib-container-plain .ib-inner{padding-left:0;padding-right:0}
@media (max-width:520px){.ib-inner{padding:min(var(--ib-pad),22px) min(var(--ib-pad),18px)}.ib-wrap{padding:16px 10px 32px}.ib-container-plain .ib-inner{padding-left:4px;padding-right:4px}}
.ib-header{margin-bottom:22px}
.ib-header-center .ib-header{text-align:center}
.ib-logo{margin-bottom:16px;display:flex;align-items:center;gap:10px;color:var(--ib-muted);font-size:13px}
.ib-header-center .ib-logo{justify-content:center}
.ib-logo img{display:block;height:var(--ib-logo-h);width:auto;max-width:min(280px,100%);object-fit:contain}
.ib-title{font-family:var(--ib-heading-font);font-size:var(--ib-title-fs);font-weight:var(--ib-title-fw);letter-spacing:var(--ib-title-ls);line-height:1.2;margin:0 0 8px;overflow-wrap:anywhere}
@media (max-width:520px){.ib-title{font-size:min(var(--ib-title-fs),32px)}}
.ib-no-title .ib-title{display:none}
.ib-no-desc .ib-desc{display:none}
.ib-desc p{margin:0 0 8px;color:var(--ib-muted);white-space:pre-wrap}
.ib-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));column-gap:16px;row-gap:var(--ib-gap)}
.ib-item{grid-column:span 6;min-width:0}
.ib-w-half{grid-column:span 3}.ib-w-third{grid-column:span 2}.ib-w-two_thirds{grid-column:span 4}
@media (max-width:560px){.ib-item{grid-column:span 6}}
.ib-heading{font-family:var(--ib-heading-font);font-size:calc(var(--ib-q-fs) + 3px);font-weight:650;margin-top:6px;padding-top:14px;border-top:1px solid var(--ib-border);line-height:1.3}
.ib-text p{margin:0 0 6px;white-space:pre-wrap}
.ib-image{margin:0}
.ib-image img{display:block;max-width:100%;height:auto;border-radius:min(var(--ib-choice-radius),24px);margin:0 auto}
.ib-image figcaption{color:var(--ib-muted);font-size:13px;margin-top:6px;text-align:center}
.ib-label{display:block;font-size:var(--ib-q-fs);font-weight:var(--ib-q-fw);line-height:1.35;margin-bottom:6px}
.ib-req{color:var(--ib-error);margin-left:3px}
.ib-help{color:var(--ib-muted);font-size:calc(var(--ib-fs) - 2px);margin:-2px 0 8px;white-space:pre-wrap}
.ib-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ib-control{position:relative}
.ib-input{display:block;width:100%;font:inherit;color:var(--ib-text);background:var(--ib-input-bg);border:var(--ib-input-bw) solid var(--ib-input-border);border-radius:var(--ib-input-radius);padding:0 var(--ib-input-px);min-height:var(--ib-input-h);outline:none;transition:border-color .15s,box-shadow .15s,background-color .15s}
textarea.ib-input{padding-top:10px;padding-bottom:10px;min-height:calc(var(--ib-input-h) * 2.6);resize:vertical;border-radius:min(var(--ib-input-radius),18px)}
select.ib-input{appearance:none;-webkit-appearance:none;padding-right:38px;background-image:linear-gradient(45deg,transparent 50%,var(--ib-muted) 50%),linear-gradient(135deg,var(--ib-muted) 50%,transparent 50%);background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.ib-input::placeholder{color:var(--ib-muted);opacity:.85}
.ib-input:hover{border-color:color-mix(in srgb,var(--ib-input-border) 55%,var(--ib-text))}
.ib-input:focus{border-color:var(--ib-accent);box-shadow:0 0 0 3px var(--ib-accent-ring)}
@media (max-width:768px){.ib-input{font-size:max(16px,var(--ib-fs))}}
.ib-input-filled .ib-input{background:var(--ib-input-fill);border-color:transparent}
.ib-input-filled .ib-input:focus{background:var(--ib-input-bg);border-color:var(--ib-accent)}
.ib-input-underline .ib-input{background:transparent;border-width:0 0 var(--ib-input-bw,1px) 0;border-radius:0;padding-left:0;padding-right:0}
.ib-input-underline textarea.ib-input{border-width:var(--ib-input-bw,1px);border-radius:var(--ib-input-radius);padding-left:var(--ib-input-px);padding-right:var(--ib-input-px)}
.ib-input-underline .ib-input:focus{box-shadow:0 1px 0 0 var(--ib-accent)}
.ib-input-underline select.ib-input{padding-right:28px;background-position:calc(100% - 10px) 50%,calc(100% - 5px) 50%}
.ib-affix{display:flex;align-items:stretch}
.ib-affix>span{display:flex;align-items:center;padding:0 12px;border:var(--ib-input-bw) solid var(--ib-input-border);background:var(--ib-soft);color:var(--ib-muted);font-size:14px;white-space:nowrap}
.ib-affix>span.ib-pre{border-radius:var(--ib-input-radius) 0 0 var(--ib-input-radius);border-right:0}
.ib-affix>span.ib-suf{border-radius:0 var(--ib-input-radius) var(--ib-input-radius) 0;border-left:0}
.ib-affix .ib-input.ib-pre{border-top-left-radius:0;border-bottom-left-radius:0}
.ib-affix .ib-input.ib-suf{border-top-right-radius:0;border-bottom-right-radius:0}
.ib-input-underline .ib-affix>span{background:transparent;border-width:0 0 var(--ib-input-bw,1px) 0;border-radius:0;padding:0 8px 0 0}
.ib-labels-floating .ib-float .ib-input{padding-top:16px}
.ib-labels-floating .ib-float textarea.ib-input{padding-top:24px}
.ib-labels-floating .ib-float>.ib-control>.ib-label{position:absolute;left:calc(var(--ib-input-px) + var(--ib-input-bw));top:calc(var(--ib-input-h) / 2);transform:translateY(-50%);margin:0;max-width:calc(100% - var(--ib-input-px) * 2 - 8px);color:var(--ib-muted);font-weight:400;font-size:var(--ib-fs);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:top .15s,font-size .15s,color .15s,transform .15s}
.ib-labels-floating.ib-input-underline .ib-float>.ib-control>.ib-label{left:0}
.ib-labels-floating .ib-float .ib-input:focus~.ib-label,.ib-labels-floating .ib-float .ib-input:not(:placeholder-shown)~.ib-label{top:6px;transform:none;font-size:11.5px;font-weight:600;color:var(--ib-accent-text)}
@media (min-width:640px){
.ib-labels-left .ib-field:not(.ib-type-checkbox){display:grid;grid-template-columns:minmax(110px,32%) minmax(0,1fr);column-gap:18px;align-items:start}
.ib-labels-left .ib-field:not(.ib-type-checkbox)>.ib-label{grid-column:1;grid-row:1 / span 3;padding-top:calc((var(--ib-input-h) - 1.35em) / 2)}
.ib-labels-left .ib-field:not(.ib-type-checkbox)>:not(.ib-label){grid-column:2}
}
.ib-choices{display:grid;grid-template-columns:repeat(var(--ib-cols,1),minmax(0,1fr));gap:8px}
.ib-cols-2{--ib-cols:2}.ib-cols-3{--ib-cols:3}.ib-cols-4{--ib-cols:4}
@media (max-width:560px){.ib-choices-list{--ib-cols:1}.ib-choices-cards.ib-cols-3,.ib-choices-cards.ib-cols-4{--ib-cols:2}}
.ib-choice{position:relative;display:flex;align-items:center;gap:10px;min-height:calc(var(--ib-input-h) - 2px);padding:8px 12px;border:var(--ib-input-bw,1px) solid var(--ib-input-border);border-radius:var(--ib-choice-radius);background:var(--ib-input-bg);cursor:pointer;transition:border-color .15s,background-color .15s,box-shadow .15s,color .15s;user-select:none}
.ib-choice:hover{border-color:var(--ib-accent)}
.ib-choice.ib-checked{border-color:var(--ib-accent);background:var(--ib-accent-soft)}
.ib-choice:focus-within{box-shadow:0 0 0 3px var(--ib-accent-ring)}
.ib-choice input{width:18px;height:18px;accent-color:var(--ib-accent);margin:0;flex:none}
.ib-choice-label{min-width:0;overflow-wrap:anywhere}
.ib-choices-buttons{display:flex;flex-wrap:wrap}
.ib-choices-buttons .ib-choice{min-height:0;padding:9px 16px;border-radius:max(var(--ib-choice-radius),6px)}
.ib-choices-buttons .ib-choice input{position:absolute;opacity:0;pointer-events:none}
.ib-choices-buttons .ib-choice.ib-checked{background:var(--ib-accent);border-color:var(--ib-accent);color:var(--ib-accent-ink)}
.ib-choices-cards .ib-choice{flex-direction:column;align-items:stretch;padding:0;gap:0;overflow:hidden;min-height:0;border-radius:min(var(--ib-choice-radius),24px)}
.ib-choices-cards .ib-choice input{position:absolute;top:10px;right:10px;z-index:1}
.ib-choices-cards .ib-choice-img{display:block;aspect-ratio:16/10;background:var(--ib-soft)}
.ib-ratio-square .ib-choice-img{aspect-ratio:1/1}.ib-ratio-portrait .ib-choice-img{aspect-ratio:3/4}
.ib-choices-cards .ib-choice-img img{display:block;width:100%;height:100%;object-fit:cover}
.ib-choices-cards .ib-choice-label{padding:10px 36px 10px 12px;font-weight:500}
.ib-choices-cards .ib-choice:not(:has(.ib-choice-img)) .ib-choice-label{padding:14px 36px 14px 14px}
.ib-choices-cards .ib-choice.ib-checked{box-shadow:0 0 0 2px var(--ib-accent) inset}
.ib-check{display:flex;align-items:flex-start;gap:10px;cursor:pointer}
.ib-check input{width:18px;height:18px;accent-color:var(--ib-accent);margin:2px 0 0;flex:none}
.ib-stars{display:flex;gap:4px;flex-wrap:wrap}
.ib-stars button{border:0;background:none;padding:2px;cursor:pointer;font-size:30px;line-height:1;color:color-mix(in srgb,var(--ib-muted) 45%,transparent);transition:transform .1s}
.ib-stars button.ib-on{color:#f5a524}
.ib-stars button:hover{transform:scale(1.08)}
.ib-files .ib-drop{border:1.5px dashed var(--ib-input-border);border-radius:var(--ib-input-radius);padding:16px;text-align:center;color:var(--ib-muted);cursor:pointer;font-size:14px;background:var(--ib-input-bg)}
.ib-input-pill .ib-files .ib-drop{border-radius:18px}
.ib-files .ib-drop:hover,.ib-files .ib-drop:focus-visible{border-color:var(--ib-accent);color:var(--ib-text);outline:none}
.ib-files ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.ib-files li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border:1px solid var(--ib-border);border-radius:8px;font-size:14px}
.ib-files li button{border:0;background:none;color:var(--ib-muted);cursor:pointer;font:inherit;font-size:13px}
.ib-error{color:var(--ib-error);font-size:13px;margin-top:6px}
.ib-invalid .ib-input,.ib-invalid .ib-choice,.ib-invalid .ib-drop{border-color:var(--ib-error)}
.ib-alert{border:1px solid color-mix(in srgb,var(--ib-error) 35%,transparent);background:var(--ib-error-soft);color:var(--ib-error);border-radius:10px;padding:10px 12px;margin-top:18px;font-size:14px}
.ib-actions{margin-top:26px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ib-btn-align-center .ib-actions{justify-content:center}
.ib-btn-align-right .ib-actions{justify-content:flex-end}
.ib-actions .ib-grow{flex:1}
.ib-btn-align-center .ib-actions .ib-grow,.ib-btn-align-right .ib-actions .ib-grow{display:none}
.ib-btn-full .ib-actions .ib-btn{flex:1}
.ib-btn-full .ib-actions .ib-grow{display:none}
@media (max-width:520px){.ib-actions.ib-paged .ib-btn{flex:1}.ib-actions.ib-paged .ib-grow{display:none}}
.ib-btn{appearance:none;-webkit-appearance:none;font:inherit;font-weight:600;font-size:var(--ib-btn-fs);line-height:1.2;min-height:var(--ib-btn-h);padding:0 var(--ib-btn-px);border-radius:var(--ib-btn-radius);border:1.5px solid transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;transition:filter .15s,background-color .15s,box-shadow .15s,transform .06s}
.ib-btn svg{width:1.05em;height:1.05em;flex:none}
.ib-btn:active{transform:translateY(1px)}
.ib-btn[disabled]{opacity:.6;cursor:default;transform:none}
.ib-btn:focus-visible{outline:2px solid var(--ib-accent);outline-offset:2px}
.ib-btn-primary{background:var(--ib-accent);color:var(--ib-accent-ink)}
.ib-btn-primary:hover{filter:brightness(1.07)}
.ib-btn-secondary{background:transparent;color:var(--ib-text);border-color:var(--ib-border)}
.ib-btn-secondary:hover{background:var(--ib-soft)}
.ib-btn-outline .ib-btn-primary{background:transparent;color:var(--ib-accent-text);border-color:var(--ib-accent)}
.ib-btn-outline .ib-btn-primary:hover{background:var(--ib-accent-soft);filter:none}
.ib-btn-soft .ib-btn-primary{background:var(--ib-accent-soft);color:var(--ib-accent-text)}
.ib-btn-soft .ib-btn-primary:hover{filter:brightness(.97)}
.ib-btn-text .ib-btn-primary{background:transparent;color:var(--ib-accent-text);text-decoration:underline;text-underline-offset:3px}
.ib-btn-text .ib-btn-primary:hover{filter:none;text-decoration-thickness:2px}
.ib-btn-shadow .ib-btn-primary{box-shadow:0 6px 18px -4px var(--ib-accent-shadow)}
.ib-btn-upper .ib-btn{text-transform:uppercase;letter-spacing:.05em;font-size:calc(var(--ib-btn-fs) - 1px)}
.ib-steps{margin:2px 0 20px}
.ib-steps-top{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--ib-muted);margin-bottom:6px}
.ib-steps-top strong{color:var(--ib-text);font-weight:600}
.ib-steps-top strong:focus{outline:none}
.ib-progress{height:6px;background:color-mix(in srgb,var(--ib-muted) 22%,transparent);border-radius:99px;overflow:hidden}
.ib-progress span{display:block;height:100%;background:var(--ib-accent);border-radius:99px;transition:width .25s ease}
.ib-dots{display:flex;gap:6px;flex-wrap:wrap}
.ib-dots span{flex:1;min-width:16px;height:6px;border-radius:99px;background:color-mix(in srgb,var(--ib-muted) 22%,transparent);transition:background-color .2s}
.ib-dots span.ib-on{background:var(--ib-accent)}
.ib-page-title{font-family:var(--ib-heading-font);font-size:calc(var(--ib-q-fs) + 4px);line-height:1.3;font-weight:650;margin:0 0 16px}
.ib-page-title:focus{outline:none}
.ib-captcha{margin-top:20px;min-height:66px}
.ib-consent{margin-top:22px;padding:14px;border:1px solid var(--ib-border);border-radius:10px;background:var(--ib-soft)}
.ib-consent .ib-check span{font-size:14px}
.ib-consent-links{margin:8px 0 0 28px;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px}
.ib-linkbtn{appearance:none;border:0;background:none;padding:0;font:inherit;color:var(--ib-text);text-decoration:underline;cursor:pointer}
.ib-consent-links a{color:var(--ib-text)}
.ib-consent-text{white-space:pre-wrap;font-size:13px;line-height:1.55;border:1px solid var(--ib-border);border-radius:8px;padding:12px 14px;max-height:280px;overflow:auto;margin:10px 0 0;background:var(--ib-card);color:var(--ib-text)}
.ib-consent-text:focus{outline:2px solid var(--ib-accent);outline-offset:1px}
.ib-consent .ib-error{margin-left:28px}
.ib-consent.ib-invalid{border-color:var(--ib-error)}
.ib-closed{text-align:center;padding:24px 8px;color:var(--ib-muted);white-space:pre-wrap}
.ib-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.ib-done{text-align:center;padding:28px 8px 12px}
.ib-done .ib-tick{width:56px;height:56px;border-radius:50%;background:var(--ib-accent);color:var(--ib-accent-ink);display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:14px}
.ib-done .ib-tick.ib-tick-error{background:var(--ib-error);color:#fff}
.ib-done h2{margin:0 0 6px;font-size:calc(var(--ib-title-fs) * .9);font-family:var(--ib-heading-font)}
.ib-done p{color:var(--ib-muted);margin:0 0 18px;white-space:pre-wrap}
.ib-done .ib-small{font-size:13px}
.ib-split-media{display:none}
.ib-split .ib-split-media{display:flex;flex:0 0 44%;position:sticky;top:0;height:100vh;height:100dvh;align-items:flex-end;padding:48px}
.ib-split-right .ib-shell{flex-direction:row-reverse}
.ib-split-headline{font-family:var(--ib-heading-font);font-size:clamp(24px,3vw,40px);font-weight:700;line-height:1.15;letter-spacing:-.01em;max-width:520px;white-space:pre-wrap}
.ib-split .ib-wrap{justify-content:center}
@media (max-width:900px){.ib-split .ib-shell{flex-direction:column}.ib-split .ib-split-media{position:relative;height:auto;min-height:160px;flex:none;padding:24px}.ib-split-headline{font-size:24px}}
body.ib-embedded .ib-split-media{display:none}
.ib-pv-item{cursor:pointer;border-radius:8px;outline-offset:6px}
.ib-pv-item:hover{outline:1px dashed color-mix(in srgb,var(--ib-muted) 70%,transparent)}
.ib-pv-item.ib-selected{outline:2px solid var(--ib-accent)}
.ib-pv-tag{display:inline-block;margin-bottom:6px;padding:1px 6px;border-radius:4px;background:color-mix(in srgb,var(--ib-muted) 16%,transparent);color:var(--ib-muted);font-size:11px;font-weight:500}
.ib-pv-empty{color:var(--ib-muted);text-align:center;padding:24px 0;font-size:14px}
.ib-captcha-ph{margin-top:20px;border:1.5px dashed var(--ib-border);border-radius:8px;padding:14px;color:var(--ib-muted);font-size:13px;text-align:center}
.ib-skeleton{display:grid;gap:18px}
.ib-skeleton span{display:block;height:var(--ib-input-h);border-radius:var(--ib-input-radius);background:var(--ib-soft)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
