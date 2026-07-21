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
 * CSS del wrapper del bloque. Regla de comodidad: si hay fondo o borde
 * pero no se eligió relleno/radio, se aplican defaults amables (md) —
 * un fondo pegado al contenido sin padding se ve roto.
 *
 * v0.1.95 — además de pintar el wrapper, el fondo/texto RE-TIÑEN los
 * tokens del tema localmente (`--imcrm-card`, `--imcrm-border`,
 * `--imcrm-muted`, foregrounds): los bloques con tarjeta propia (portal
 * y ficha CRM pintan con `hsl(var(--imcrm-card))`) adoptan el color
 * elegido en vez de quedar como tarjeta blanca sobre la banda.
 */
export function blockStyleCss(style: BlockStyle): React.CSSProperties {
    const css: React.CSSProperties & Record<string, string | number> = {};
    const boxed = style.bg !== undefined || style.border !== undefined;
    if (style.bg !== undefined) {
        css.backgroundColor = style.bg;
        const t = hexToHslTriplet(style.bg);
        if (t !== null) {
            css['--imcrm-card'] = t;
            css['--imcrm-muted'] = t;
            // Sin borde elegido, los hairlines internos se funden con el
            // fondo (una banda sólida no quiere bordecitos grises adentro).
            css['--imcrm-border'] = hexToHslTriplet(style.border ?? style.bg) ?? t;
        }
    }
    if (style.text !== undefined) {
        css.color = style.text;
        const t = hexToHslTriplet(style.text);
        if (t !== null) {
            css['--imcrm-card-foreground'] = t;
            css['--imcrm-foreground'] = t;
            css['--imcrm-muted-foreground'] = t;
        }
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
    const css: React.CSSProperties = {};
    if (isHex(opts.bg)) {
        css.backgroundColor = opts.bg;
        css.borderRadius = `${RADIUS_PX.md}px`;
        if (opts.padding === undefined || opts.padding === '') {
            css.padding = `${PAD_PX.md}px`;
        }
    }
    if (opts.padding !== undefined && opts.padding !== '') css.padding = opts.padding;
    if (opts.margin !== undefined && opts.margin !== '') css.margin = opts.margin;
    return css;
}
