import { z } from 'zod';

/**
 * v0.1.272 — Estilo por bloque de los correos (ADR-S34) y de los documentos
 * PDF (ADR-S35) — ADR-S37.
 *
 * UNA capa de estilo común a los dos editores: tipografía (familia, tamaño,
 * peso, itálica, interlineado, espaciado entre letras, mayúsculas),
 * espaciado (margen por fuera, relleno por dentro), recuadro (fondo, borde
 * por lado, esquinas, sombra). Los dos renderizadores la interpretan:
 * `renderEmailHtml` a HTML para correo y el servidor a pdfmake. Lo que un
 * medio no puede dibujar NO se ofrece en su editor (`STYLE_SUPPORT`) —
 * mejor que un control que no hace nada.
 *
 * Todo es OPCIONAL: un bloque sin `style` sale exactamente como antes. Los
 * números son píxeles en el correo y puntos en el PDF (cada editor muestra
 * su unidad).
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = z.string().regex(HEX);

// ---------------------------------------------------------------------------
// Tipografías
// ---------------------------------------------------------------------------

/**
 * Del SISTEMA (se ven igual en todos los programas de correo) y WEB (Google
 * Fonts: Apple Mail, iOS, Outlook de Mac, Samsung y Thunderbird las cargan;
 * Gmail y Outlook de Windows muestran la de respaldo). En el PDF todas se
 * EMBEBEN (`apps/api/assets/fonts`), así que el PDF siempre sale con la
 * elegida — las del sistema con su equivalente libre de mismas métricas.
 */
export const DESIGN_FONTS = [
    'sans',
    'modern',
    'humanist',
    'trebuchet',
    'tahoma',
    'serif',
    'times',
    'mono',
    'inter',
    'roboto',
    'open_sans',
    'lato',
    'montserrat',
    'poppins',
    'nunito',
    'raleway',
    'playfair',
    'merriweather',
    'lora',
] as const;
export type DesignFont = (typeof DESIGN_FONTS)[number];

export type DesignFontCategory = 'sans' | 'serif' | 'mono';

export interface DesignFontDef {
    label: string;
    kind: 'system' | 'web';
    category: DesignFontCategory;
    /** Pila de respaldo del sistema (lo que se ve si la fuente no carga). */
    fallback: string;
    /** Familia en Google Fonts (sólo las web). */
    google?: string;
    /** Familia registrada en el generador de PDF. */
    pdf: string;
    /** Nombre de la que se usa en el PDF cuando no es la misma. */
    pdfLabel?: string;
}

const SANS = 'Arial, Helvetica, sans-serif';
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const MONO = "'Courier New', Courier, monospace";

export const DESIGN_FONT_DEFS: Record<DesignFont, DesignFontDef> = {
    sans: { label: 'Arial', kind: 'system', category: 'sans', fallback: SANS, pdf: 'Arimo', pdfLabel: 'Arimo (idéntica en medidas)' },
    modern: {
        label: 'Moderna (Segoe UI / Roboto)',
        kind: 'system',
        category: 'sans',
        fallback: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        pdf: 'Roboto',
        pdfLabel: 'Roboto',
    },
    humanist: { label: 'Verdana', kind: 'system', category: 'sans', fallback: 'Verdana, Geneva, Tahoma, sans-serif', pdf: 'OpenSans', pdfLabel: 'Open Sans (parecida)' },
    trebuchet: {
        label: 'Trebuchet',
        kind: 'system',
        category: 'sans',
        fallback: "'Trebuchet MS', 'Lucida Grande', 'Lucida Sans Unicode', sans-serif",
        pdf: 'Lato',
        pdfLabel: 'Lato (parecida)',
    },
    tahoma: { label: 'Tahoma', kind: 'system', category: 'sans', fallback: 'Tahoma, Verdana, Geneva, sans-serif', pdf: 'OpenSans', pdfLabel: 'Open Sans (parecida)' },
    serif: { label: 'Georgia (con serifa)', kind: 'system', category: 'serif', fallback: SERIF, pdf: 'Gelasio', pdfLabel: 'Gelasio (idéntica en medidas)' },
    times: { label: 'Times New Roman', kind: 'system', category: 'serif', fallback: "'Times New Roman', Times, serif", pdf: 'Tinos', pdfLabel: 'Tinos (idéntica en medidas)' },
    mono: { label: 'Courier (monoespaciada)', kind: 'system', category: 'mono', fallback: MONO, pdf: 'Cousine', pdfLabel: 'Cousine (idéntica en medidas)' },
    inter: { label: 'Inter', kind: 'web', category: 'sans', fallback: "'Segoe UI', Roboto, Arial, sans-serif", google: 'Inter', pdf: 'Inter' },
    roboto: { label: 'Roboto', kind: 'web', category: 'sans', fallback: SANS, google: 'Roboto', pdf: 'Roboto' },
    open_sans: { label: 'Open Sans', kind: 'web', category: 'sans', fallback: SANS, google: 'Open Sans', pdf: 'OpenSans' },
    lato: { label: 'Lato', kind: 'web', category: 'sans', fallback: SANS, google: 'Lato', pdf: 'Lato' },
    montserrat: { label: 'Montserrat', kind: 'web', category: 'sans', fallback: SANS, google: 'Montserrat', pdf: 'Montserrat' },
    poppins: { label: 'Poppins', kind: 'web', category: 'sans', fallback: SANS, google: 'Poppins', pdf: 'Poppins' },
    nunito: { label: 'Nunito', kind: 'web', category: 'sans', fallback: SANS, google: 'Nunito', pdf: 'Nunito' },
    raleway: { label: 'Raleway', kind: 'web', category: 'sans', fallback: SANS, google: 'Raleway', pdf: 'Raleway' },
    playfair: { label: 'Playfair Display (serifa)', kind: 'web', category: 'serif', fallback: SERIF, google: 'Playfair Display', pdf: 'Playfair' },
    merriweather: { label: 'Merriweather (serifa)', kind: 'web', category: 'serif', fallback: SERIF, google: 'Merriweather', pdf: 'Merriweather' },
    lora: { label: 'Lora (serifa)', kind: 'web', category: 'serif', fallback: SERIF, google: 'Lora', pdf: 'Lora' },
};

/** La pila CSS completa: la fuente web primero y la de respaldo detrás. */
export function fontStack(font: DesignFont): string {
    const d = DESIGN_FONT_DEFS[font] ?? DESIGN_FONT_DEFS.sans;
    return d.google ? `'${d.google}', ${d.fallback}` : d.fallback;
}

/** Las familias de Google que hace falta pedir (sin repetir). */
export function googleFontsHref(fonts: Iterable<DesignFont>): string | null {
    const families = new Set<string>();
    for (const f of fonts) {
        const g = DESIGN_FONT_DEFS[f]?.google;
        if (g) families.add(g);
    }
    if (families.size === 0) return null;
    // Sólo 400/700 normal e itálica: existen en TODAS las familias del
    // catálogo (Google responde 400 si se pide un peso que no hay).
    const q = [...families]
        .sort()
        .map((g) => `family=${g.replace(/ /g, '+')}:ital,wght@0,400;0,700;1,400;1,700`)
        .join('&');
    return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

/**
 * `@font-face` de las fuentes web servidas por la PROPIA app (vista previa
 * del editor: la CSP no deja cargar Google Fonts). `base` = origen de la
 * app; los archivos viven en `/email-fonts/`.
 */
export function selfHostedFontFaces(fonts: Iterable<DesignFont>, base: string): string {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const f of fonts) {
        const d = DESIGN_FONT_DEFS[f];
        if (!d?.google || seen.has(f)) continue;
        seen.add(f);
        for (const [w, s] of [
            ['400', 'normal'],
            ['700', 'normal'],
            ['400', 'italic'],
            ['700', 'italic'],
        ]) {
            out.push(
                `@font-face{font-family:'${d.google}';font-style:${s};font-weight:${w};font-display:swap;src:url(${base}/email-fonts/${f}-${w}-${s}.woff2) format('woff2');}`,
            );
        }
    }
    return out.join('');
}

// ---------------------------------------------------------------------------
// Schema del estilo
// ---------------------------------------------------------------------------

export const DESIGN_FONT_WEIGHTS = [400, 600, 700, 800] as const;
export type DesignFontWeight = (typeof DESIGN_FONT_WEIGHTS)[number];
export const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'] as const;
export type TextTransform = (typeof TEXT_TRANSFORMS)[number];
export const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];
export const SHADOWS = ['none', 'sm', 'md', 'lg'] as const;
export type Shadow = (typeof SHADOWS)[number];
export const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

const space = z.number().min(0).max(160).nullable().optional();

/** Tipografía de un bloque (o de una parte: el texto de un botón). */
export const textStyleShape = {
    font: z.enum(DESIGN_FONTS).nullable().optional(),
    font_size: z.number().min(6).max(96).nullable().optional(),
    font_weight: z
        .union([z.literal(400), z.literal(600), z.literal(700), z.literal(800)])
        .nullable()
        .optional(),
    italic: z.boolean().optional(),
    /** Multiplicador del tamaño (1,5 = 150 %). */
    line_height: z.number().min(0.8).max(3).nullable().optional(),
    letter_spacing: z.number().min(-3).max(20).nullable().optional(),
    text_transform: z.enum(TEXT_TRANSFORMS).optional(),
};

/** Caja de un bloque: espacio por fuera y por dentro, borde, esquinas, sombra. */
export const boxStyleShape = {
    margin_top: space,
    margin_bottom: space,
    padding_top: space,
    padding_right: space,
    padding_bottom: space,
    padding_left: space,
    /**
     * Correo: el fondo del bloque como BANDA de borde a borde de la hoja (lo
     * de siempre) o como RECUADRO dentro de los márgenes (una tarjeta).
     */
    bg_mode: z.enum(['band', 'box']).optional(),
    border_width: z.number().min(0).max(16).nullable().optional(),
    border_style: z.enum(BORDER_STYLES).optional(),
    border_color: hex.nullable().optional(),
    /** Vacío = los cuatro lados. */
    border_sides: z.array(z.enum(BORDER_SIDES)).max(4).optional(),
    radius: z.number().min(0).max(60).nullable().optional(),
    shadow: z.enum(SHADOWS).optional(),
};

export const blockStyleSchema = z.object({ ...textStyleShape, ...boxStyleShape });
export type BlockStyle = z.infer<typeof blockStyleSchema>;

/**
 * Lo propio de un ELEMENTO dentro del bloque: el botón (su caja de color) o
 * la imagen (su marco).
 */
export const elementStyleSchema = z.object({
    radius: z.number().min(0).max(60).nullable().optional(),
    border_width: z.number().min(0).max(16).nullable().optional(),
    border_style: z.enum(BORDER_STYLES).optional(),
    border_color: hex.nullable().optional(),
    shadow: z.enum(SHADOWS).optional(),
    /** Relleno interno del botón. */
    pad_y: z.number().min(0).max(60).nullable().optional(),
    pad_x: z.number().min(0).max(120).nullable().optional(),
    /** Ancho fijo del botón (vacío = lo que mida el texto). */
    width: z.number().min(40).max(720).nullable().optional(),
});
export type ElementStyle = z.infer<typeof elementStyleSchema>;

/** ¿El estilo pide una caja (y no sólo tipografía)? */
export function hasBoxStyle(st: BlockStyle | null | undefined): boolean {
    if (!st) return false;
    return (
        st.margin_top != null ||
        st.margin_bottom != null ||
        st.padding_top != null ||
        st.padding_right != null ||
        st.padding_bottom != null ||
        st.padding_left != null ||
        st.bg_mode === 'box' ||
        (st.border_width ?? 0) > 0 ||
        (st.radius ?? 0) > 0 ||
        (st.shadow != null && st.shadow !== 'none')
    );
}

/** Peso → negrita o no (el PDF y Outlook de Windows sólo tienen esas dos). */
export function isBoldWeight(w: number | null | undefined): boolean {
    return (w ?? 400) >= 600;
}

/** Aplica la transformación de mayúsculas (el PDF no tiene `text-transform`). */
export function applyTextTransform(text: string, t: TextTransform | undefined): string {
    switch (t) {
        case 'uppercase':
            return text.toLocaleUpperCase('es');
        case 'lowercase':
            return text.toLocaleLowerCase('es');
        case 'capitalize':
            return text.replace(/(^|[\s\-("'«¿¡])(\p{L})/gu, (_m, pre: string, c: string) => pre + c.toLocaleUpperCase('es'));
        default:
            return text;
    }
}

/** Sombra CSS (Outlook de Windows y algunas versiones de Gmail la ignoran). */
export const SHADOW_CSS: Record<Exclude<Shadow, 'none'>, string> = {
    sm: '0 1px 3px rgba(15,23,42,0.12)',
    md: '0 4px 12px rgba(15,23,42,0.14)',
    lg: '0 12px 32px rgba(15,23,42,0.18)',
};

// ---------------------------------------------------------------------------
// Qué dibuja cada medio
// ---------------------------------------------------------------------------

/**
 * Lo que cada medio sabe dibujar. El editor oculta lo que no — y lo que se
 * ve distinto en algún programa de correo lleva su aviso (`STYLE_CAVEATS`).
 */
export const STYLE_SUPPORT = {
    email: { radius: true, shadow: true, bgMode: true, valign: true, stack: true },
    pdf: { radius: false, shadow: false, bgMode: false, valign: false, stack: false },
} as const;
export type DesignMedium = keyof typeof STYLE_SUPPORT;

export const STYLE_CAVEATS = {
    webFont:
        'Se ve en Apple Mail, iPhone, Outlook de Mac, Samsung y Thunderbird. Gmail y Outlook de Windows muestran la de respaldo.',
    radius: 'Outlook de Windows dibuja las esquinas rectas.',
    shadow: 'Outlook de Windows y la app de Gmail no muestran sombras.',
    weight: 'Outlook de Windows y el PDF sólo distinguen normal y negrita: la seminegrita se ve como negrita.',
} as const;

/**
 * La vista previa del editor (y la del correo armado por el servidor con un
 * registro de verdad) piden las fuentes a Google Fonts; la CSP de la app no lo
 * permite. Esto reemplaza ese `<link>` por las MISMAS fuentes servidas por la
 * app — así se ve exactamente lo que verá quien reciba el correo.
 */
export function localizeGoogleFonts(html: string, base: string): string {
    return html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?([^"]*)"[^>]*>/g, (_m, query: string) => {
        const families = [...query.replace(/&amp;/g, '&').matchAll(/family=([^:&]+)/g)].map((x) => decodeURIComponent(x[1]!.replace(/\+/g, ' ')));
        const keys = DESIGN_FONTS.filter((f) => {
            const g = DESIGN_FONT_DEFS[f].google;
            return g ? families.includes(g) : false;
        });
        return `<style>${selfHostedFontFaces(keys, base)}</style>`;
    });
}
