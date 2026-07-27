/**
 * Capa de ESTILO por bloque del editor de plantillas (v0.1.93).
 *
 * Cada bloque (registro CRM y portal del cliente) puede llevar
 * `config.style` con apariencia declarativa: fondo, color de texto,
 * borde, esquinas, relleno, sombra y alineación. La MISMA función
 * genera el CSS en el canvas del editor, en la ficha real del registro
 * y en el portal del cliente — WYSIWYG por construcción.
 *
 * Sin dependencias (la consume también el bundle del portal).
 */

export type StyleScale = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type StyleShadow = 'none' | 'sm' | 'md' | 'lg';
export type StyleAlign = 'left' | 'center' | 'right';
export type StyleSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type StyleWeight = 'normal' | 'medium' | 'semibold' | 'bold';

export interface BlockStyle {
    /** Color de fondo (hex). Vacío/undefined = sin fondo propio. */
    bg?: string;
    /** Color del texto (hex). */
    text?: string;
    /** Color del borde (hex). Vacío = sin borde. */
    border?: string;
    /** Relleno interno. */
    pad?: StyleScale;
    /** Radio de esquinas. */
    radius?: StyleScale;
    /** Sombra. */
    shadow?: StyleShadow;
    /** Alineación del texto. */
    align?: StyleAlign;
    /** v0.1.94 — tamaño base de texto del bloque. */
    size?: StyleSize;
    /** v0.1.94 — peso de la tipografía del bloque. */
    weight?: StyleWeight;
}

const PAD_PX: Record<StyleScale, number> = { none: 0, sm: 10, md: 16, lg: 24, xl: 40 };
const RADIUS_PX: Record<StyleScale, number> = { none: 0, sm: 6, md: 10, lg: 16, xl: 24 };
const SIZE_PX: Record<StyleSize, number> = { sm: 12, md: 14, lg: 17, xl: 22, '2xl': 28 };
const WEIGHTS: Record<StyleWeight, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };
const SHADOWS: Record<StyleShadow, string> = {
    none: 'none',
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.06)',
    md: '0 4px 12px -2px rgb(0 0 0 / 0.10)',
    lg: '0 12px 32px -8px rgb(0 0 0 / 0.18)',
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isScale(v: unknown): v is StyleScale {
    return v === 'none' || v === 'sm' || v === 'md' || v === 'lg' || v === 'xl';
}

function isHex(v: unknown): v is string {
    return typeof v === 'string' && HEX_RE.test(v);
}

/**
 * Lee `config.style` de forma tolerante — claves desconocidas o valores
 * inválidos se ignoran (plantillas viejas o editadas a mano no rompen).
 */
export function readBlockStyle(config: Record<string, unknown> | undefined | null): BlockStyle {
    const raw = config?.style;
    if (!raw || typeof raw !== 'object') return {};
    const s = raw as Record<string, unknown>;
    const out: BlockStyle = {};
    if (isHex(s.bg)) out.bg = s.bg;
    if (isHex(s.text)) out.text = s.text;
    if (isHex(s.border)) out.border = s.border;
    if (isScale(s.pad)) out.pad = s.pad;
    if (isScale(s.radius)) out.radius = s.radius;
    if (s.shadow === 'none' || s.shadow === 'sm' || s.shadow === 'md' || s.shadow === 'lg') {
        out.shadow = s.shadow;
    }
    if (s.align === 'left' || s.align === 'center' || s.align === 'right') out.align = s.align;
    if (typeof s.size === 'string' && s.size in SIZE_PX) out.size = s.size as StyleSize;
    if (typeof s.weight === 'string' && s.weight in WEIGHTS) out.weight = s.weight as StyleWeight;
    return out;
}

export function hasBlockStyle(style: BlockStyle): boolean {
    return Object.keys(style).length > 0;
}

/** hex `#rrggbb`/`#rgb` → triplete HSL `"h s% l%"` (formato de los tokens). */
export function hexToHslTriplet(hex: string): string | null {
    if (!HEX_RE.test(hex)) return null;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let hue = 0;
    let sat = 0;
    if (max !== min) {
        const d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) hue = ((b - r) / d + 2) * 60;
        else hue = ((r - g) / d + 4) * 60;
    }
    return `${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Luminancia relativa aproximada (0-1) de un hex. Decide si encima va
 * tinta oscura o clara.
 */
export function hexLuminance(hex: string): number {
    if (!HEX_RE.test(hex)) return 0;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Mueve la luminosidad de un triplete HSL (clampeada a 0-100). */
function shiftLightness(triplet: string, delta: number): string {
    const [h, s, l] = triplet.split(' ');
    const base = parseInt((l ?? '0%').replace('%', ''), 10);
    const next = Math.max(0, Math.min(100, base + delta));
    return `${h} ${s} ${next}%`;
}

/** Tinta legible sobre un fondo dado (independiente del tema). */
const INK_ON_LIGHT = '224 45% 12%';
const INK_ON_DARK = '210 40% 96%';
/** El "muted" acompaña a la tinta, un escalón más cerca del fondo. */
const MUTED_ON_LIGHT = '224 18% 38%';
const MUTED_ON_DARK = '215 20% 75%';

/**
 * v0.1.122 — Resuelve el color de texto del bloque para que SIEMPRE se lea.
 *
 * Tres casos:
 *  - fondo propio + texto elegido → se respetan los dos (el autor eligió el
 *    par; es legible en cualquier tema porque ambos son fijos).
 *  - fondo propio SIN texto elegido → la tinta se deriva del FONDO. Antes se
 *    heredaba la del tema y en oscuro quedaba texto claro sobre un fondo
 *    claro: invisible.
 *  - texto elegido SIN fondo → el bloque se apoya en la superficie del TEMA:
 *    una tinta oscura elegida en modo claro desaparece en oscuro (y al revés),
 *    así que se lleva a una franja de luminosidad legible conservando el tono.
 */
function resolveInk(
    style: BlockStyle,
    dark: boolean,
): { color: string; fg: string; muted: string } | null {
    if (style.bg !== undefined) {
        const light = hexLuminance(style.bg) > 0.5;
        if (style.text !== undefined) {
            // El autor eligió el par fondo+texto: se respeta tal cual, incluido
            // el "muted" (v0.1.95 — bajarlo por nuestra cuenta arruinaría un
            // contraste que el autor eligió a propósito).
            const t = hexToHslTriplet(style.text);
            if (t === null) return null;
            return { color: style.text, fg: t, muted: t };
        }
        const fg = light ? INK_ON_LIGHT : INK_ON_DARK;
        return {
            color: `hsl(${fg})`,
            fg,
            muted: light ? MUTED_ON_LIGHT : MUTED_ON_DARK,
        };
    }
    if (style.text === undefined) return null;

    // Sin fondo propio: hay que contrastar con la superficie del tema.
    const lum = hexLuminance(style.text);
    const unreadable = dark ? lum < 0.32 : lum > 0.75;
    if (!unreadable) {
        const t = hexToHslTriplet(style.text);
        return t === null ? null : { color: style.text, fg: t, muted: t };
    }
    const t = hexToHslTriplet(style.text);
    if (t === null) return null;
    const [h, s] = t.split(' ');
    // Se conserva el TONO elegido y se lleva la luminosidad a una franja
    // legible sobre la superficie actual.
    const lifted = `${h} ${s} ${dark ? '82%' : '28%'}`;
    return { color: `hsl(${lifted})`, fg: lifted, muted: lifted };
}

/**
 * CSS del wrapper del bloque. Regla de comodidad: si hay fondo o borde
 * pero no se eligió relleno/radio, se aplican defaults amables (md) —
 * un fondo pegado al contenido sin padding se ve roto.
 *
 * v0.1.95 — además de pintar el wrapper, el fondo/texto RE-TIÑEN los
 * tokens del tema localmente (`--imcrm-card`, `--imcrm-border`,
 * `--imcrm-muted`, foregrounds): los bloques con tarjeta propia (portal
 * y ficha CRM pintan con `hsl(var(--imcrm-card))`) adoptan el color
 * elegido en vez de quedar como tarjeta blanca sobre la banda.
 *
 * v0.1.122 — `dark` indica que la superficie del tema es oscura (lo pasan
 * las superficies con tema: admin y dashboards; el portal y las listas
 * públicas quedan siempre en claro, son diseñadas por el tenant).
 */
export function blockStyleCss(
    style: BlockStyle,
    opts: { dark?: boolean } = {},
): React.CSSProperties {
    const css: React.CSSProperties & Record<string, string | number> = {};
    const boxed = style.bg !== undefined || style.border !== undefined;
    if (style.bg !== undefined) {
        css.backgroundColor = style.bg;
        const t = hexToHslTriplet(style.bg);
        if (t !== null) {
            css['--imcrm-card'] = t;
            css['--imcrm-muted'] = t;
            // v0.1.122 — también las superficies "de página": sin esto el
            // header sticky de la tabla (bg-canvas) quedaba como una banda del
            // TEMA dentro de una tarjeta con color propio.
            css['--imcrm-canvas'] = t;
            css['--imcrm-background'] = t;
            css['--imcrm-popover'] = t;
            // El hover de fila necesita separarse del fondo: mismo tono, un
            // escalón hacia la tinta.
            css['--imcrm-accent'] = shiftLightness(t, hexLuminance(style.bg) > 0.5 ? -8 : 10);
            // Sin borde elegido, los hairlines internos se funden con el
            // fondo (una banda sólida no quiere bordecitos grises adentro).
            css['--imcrm-border'] = hexToHslTriplet(style.border ?? style.bg) ?? t;
        }
    }
    const ink = resolveInk(style, opts.dark === true);
    if (ink !== null) {
        css.color = ink.color;
        css['--imcrm-card-foreground'] = ink.fg;
        css['--imcrm-foreground'] = ink.fg;
        css['--imcrm-muted-foreground'] = ink.muted;
    }
    if (style.border !== undefined) {
        css.border = `1px solid ${style.border}`;
        const t = hexToHslTriplet(style.border);
        if (t !== null) css['--imcrm-border'] = t;
    }
    const pad = style.pad ?? (boxed ? 'md' : undefined);
    if (pad !== undefined && pad !== 'none') css.padding = `${PAD_PX[pad]}px`;
    const radius = style.radius ?? (boxed ? 'md' : undefined);
    if (radius !== undefined && radius !== 'none') css.borderRadius = `${RADIUS_PX[radius]}px`;
    if (style.shadow !== undefined && style.shadow !== 'none') css.boxShadow = SHADOWS[style.shadow];
    if (style.align !== undefined) css.textAlign = style.align;
    if (style.size !== undefined) css.fontSize = `${SIZE_PX[style.size]}px`;
    if (style.weight !== undefined) css.fontWeight = WEIGHTS[style.weight];
    return css;
}

/**
 * Clases del wrapper — activan las reglas CSS que fuerzan la HERENCIA
 * tipográfica dentro de bloques cuyo CSS trae tamaños/pesos propios en
 * px (sin esto, "Tamaño de texto" no hacía nada en bloques con tarjeta).
 */
export function blockStyleClass(style: BlockStyle): string {
    const cls: string[] = [];
    if (style.size !== undefined) cls.push('imcrm-style-fs');
    if (style.weight !== undefined) cls.push('imcrm-style-fw');
    return cls.join(' ');
}

/* ── Ajustes de PÁGINA del portal (v0.1.94) ───────────────────────── */

export type PageFont = 'sans' | 'serif' | 'rounded' | 'mono';

/** Stacks de sistema — el portal no carga fuentes externas. */
export const PAGE_FONT_STACKS: Record<PageFont, string> = {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', Times, serif",
    rounded: "ui-rounded, 'SF Pro Rounded', 'Comic Neue', Verdana, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export interface PortalPageSettings {
    /** Fondo de toda la página (hex). */
    bg?: string;
    /** Ancho máximo del contenido en px (0/undefined = default del portal). */
    max_width?: number;
    /** Familia tipográfica global. */
    font?: PageFont;
}

/** Lee `portal_template.page` de forma tolerante (mismo criterio que style). */
export function readPageSettings(raw: unknown): PortalPageSettings {
    if (!raw || typeof raw !== 'object') return {};
    const s = raw as Record<string, unknown>;
    const out: PortalPageSettings = {};
    if (isHex(s.bg)) out.bg = s.bg;
    if (typeof s.max_width === 'number' && Number.isFinite(s.max_width) && s.max_width >= 480) {
        out.max_width = Math.floor(s.max_width);
    }
    if (s.font === 'sans' || s.font === 'serif' || s.font === 'rounded' || s.font === 'mono') {
        out.font = s.font;
    }
    return out;
}

/**
 * CSS de una sección (fila) o columna del layout a partir del fondo +
 * spacing crudos que viajan en los bloques (`secBg`/`colBg` +
 * `secPadding`/`colPadding`…). Un fondo sin padding recibe padding md.
 */
export function wrapperStyleCss(opts: {
    bg?: string;
    padding?: string;
    margin?: string;
}): React.CSSProperties {
    const css: React.CSSProperties & Record<string, string | number> = {};
    if (isHex(opts.bg)) {
        css.backgroundColor = opts.bg;
        css.borderRadius = `${RADIUS_PX.md}px`;
        if (opts.padding === undefined || opts.padding === '') {
            css.padding = `${PAD_PX.md}px`;
        }
        // v0.1.122 — la tinta acompaña al fondo elegido: un fondo claro con la
        // tinta clara del tema oscuro era texto invisible.
        const light = hexLuminance(opts.bg) > 0.5;
        css.color = `hsl(${light ? INK_ON_LIGHT : INK_ON_DARK})`;
        css['--imcrm-foreground'] = light ? INK_ON_LIGHT : INK_ON_DARK;
        css['--imcrm-card-foreground'] = light ? INK_ON_LIGHT : INK_ON_DARK;
        css['--imcrm-muted-foreground'] = light ? MUTED_ON_LIGHT : MUTED_ON_DARK;
        const t = hexToHslTriplet(opts.bg);
        if (t !== null) {
            css['--imcrm-card'] = t;
            css['--imcrm-canvas'] = t;
            css['--imcrm-background'] = t;
        }
    }
    if (opts.padding !== undefined && opts.padding !== '') css.padding = opts.padding;
    if (opts.margin !== undefined && opts.margin !== '') css.margin = opts.margin;
    return css;
}

/**
 * v0.1.122 — Tinta para el contenido que se apoya DIRECTAMENTE sobre una
 * superficie (sin tarjeta propia). Se aplica al elemento, no a la página: un
 * override global se filtraría a los controles y tarjetas que pintan su propio
 * fondo con los tokens del tema (y ahí la tinta correcta es la del tema).
 */
export function surfaceInkCss(dark: boolean): React.CSSProperties {
    const fg = dark ? INK_ON_DARK : INK_ON_LIGHT;
    const muted = dark ? MUTED_ON_DARK : MUTED_ON_LIGHT;
    return {
        color: `hsl(${fg})`,
        ['--imcrm-foreground' as string]: fg,
        ['--imcrm-card-foreground' as string]: fg,
        ['--imcrm-muted-foreground' as string]: muted,
    } as React.CSSProperties;
}

/**
 * v0.1.122 — CSS del contenedor de PÁGINA (portal y dashboards): fondo,
 * tipografía y ancho máximo.
 */
export function pageStyleCss(page: PortalPageSettings): React.CSSProperties {
    const css: React.CSSProperties & Record<string, string | number> = {};
    // Sólo la SUPERFICIE y el layout. La tinta va por elemento
    // (`surfaceInkCss`): aplicarla al contenedor la filtraba a los controles y
    // tarjetas que pintan su propio fondo con los tokens del tema.
    if (page.bg !== undefined) css.backgroundColor = page.bg;
    if (page.font !== undefined) css.fontFamily = PAGE_FONT_STACKS[page.font];
    if (page.max_width !== undefined) {
        css.maxWidth = `${page.max_width}px`;
        css.marginLeft = 'auto';
        css.marginRight = 'auto';
        css.width = '100%';
    }
    return css;
}
