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
}

const PAD_PX: Record<StyleScale, number> = { none: 0, sm: 10, md: 16, lg: 24, xl: 40 };
const RADIUS_PX: Record<StyleScale, number> = { none: 0, sm: 6, md: 10, lg: 16, xl: 24 };
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
    return out;
}

export function hasBlockStyle(style: BlockStyle): boolean {
    return Object.keys(style).length > 0;
}

/**
 * CSS del wrapper del bloque. Regla de comodidad: si hay fondo o borde
 * pero no se eligió relleno/radio, se aplican defaults amables (md) —
 * un fondo pegado al contenido sin padding se ve roto.
 */
export function blockStyleCss(style: BlockStyle): React.CSSProperties {
    const css: React.CSSProperties = {};
    const boxed = style.bg !== undefined || style.border !== undefined;
    if (style.bg !== undefined) css.backgroundColor = style.bg;
    if (style.text !== undefined) css.color = style.text;
    if (style.border !== undefined) css.border = `1px solid ${style.border}`;
    const pad = style.pad ?? (boxed ? 'md' : undefined);
    if (pad !== undefined && pad !== 'none') css.padding = `${PAD_PX[pad]}px`;
    const radius = style.radius ?? (boxed ? 'md' : undefined);
    if (radius !== undefined && radius !== 'none') css.borderRadius = `${RADIUS_PX[radius]}px`;
    if (style.shadow !== undefined && style.shadow !== 'none') css.boxShadow = SHADOWS[style.shadow];
    if (style.align !== undefined) css.textAlign = style.align;
    return css;
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
