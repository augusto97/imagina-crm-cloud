import { z } from 'zod';
import { DESIGN_FONTS, SHADOWS } from './design-style';

/**
 * v0.1.351 — Tema de las PÁGINAS PÚBLICAS (ADR-S94).
 *
 * Un solo motor de diseño para lo que ve alguien de afuera: hoy el
 * formulario (ADR-S39) y, en la entrega siguiente, la página de la agenda
 * (ADR-S67). Lo que se guarda es DATO — colores, tamaños y elecciones — y lo
 * interpreta `buildPublicThemeCss` (CSS) y la página (estructura: dónde va la
 * etiqueta, cómo se ven las opciones). Nada del tema es HTML ni script; el
 * CSS propio pasa por `sanitizePublicCss`.
 *
 * Todo tiene valor por defecto y CADA sección se lee por separado
 * (`.catch`): un valor raro (de una versión futura o editado a mano) cae al
 * de fábrica sin tirar el resto del diseño.
 *
 * Los valores por defecto reproducen EXACTAMENTE el formulario de antes
 * (tarjeta de 660 px, fuente del sistema, color de la marca): un formulario
 * sin tema se ve igual que siempre.
 */

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const color = z.string().regex(HEX6);

export const PUBLIC_PALETTE_KEYS = [
    'background',
    'card',
    'text',
    'muted',
    'border',
    'input_bg',
    'input_border',
    'error',
] as const;
export type PublicPaletteKey = (typeof PUBLIC_PALETTE_KEYS)[number];

export const DEFAULT_LIGHT_PALETTE: Record<PublicPaletteKey, string> = {
    background: '#f4f5f7',
    card: '#ffffff',
    text: '#1d2330',
    muted: '#667085',
    border: '#d9dde5',
    input_bg: '#ffffff',
    input_border: '#d9dde5',
    error: '#c0262d',
};

/**
 * Esquinas «completamente redondas» (píldora). Campos, opciones y botones
 * aceptan de 0 a 40 px en el editor o este valor; el CSS lo dibuja como 999px.
 */
export const PUBLIC_ROUND_RADIUS = 999;

export const publicPaletteSchema = z.object({
    background: color.default(DEFAULT_LIGHT_PALETTE.background),
    card: color.default(DEFAULT_LIGHT_PALETTE.card),
    text: color.default(DEFAULT_LIGHT_PALETTE.text),
    muted: color.default(DEFAULT_LIGHT_PALETTE.muted),
    border: color.default(DEFAULT_LIGHT_PALETTE.border),
    input_bg: color.default(DEFAULT_LIGHT_PALETTE.input_bg),
    input_border: color.default(DEFAULT_LIGHT_PALETTE.input_border),
    error: color.default(DEFAULT_LIGHT_PALETTE.error),
    /** Botón y detalles; null = el del formulario (o el de la marca). */
    accent: color.nullable().default(null),
    /** Texto sobre el acento; null = blanco o tinta según el contraste. */
    accent_ink: color.nullable().default(null),
});
export type PublicPalette = z.infer<typeof publicPaletteSchema>;

const darkPaletteSchema = z.object({
    background: color.optional(),
    card: color.optional(),
    text: color.optional(),
    muted: color.optional(),
    border: color.optional(),
    input_bg: color.optional(),
    input_border: color.optional(),
    error: color.optional(),
    accent: color.nullable().optional(),
    accent_ink: color.nullable().optional(),
});
export type PublicDarkPalette = z.infer<typeof darkPaletteSchema>;

export const PUBLIC_THEME_MODES = ['light', 'dark', 'auto'] as const;
export type PublicThemeMode = (typeof PUBLIC_THEME_MODES)[number];

const weight = z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]);

export const publicTypographySchema = z.object({
    font: z.enum(DESIGN_FONTS).default('modern'),
    /** Títulos; null = la misma del texto. */
    heading_font: z.enum(DESIGN_FONTS).nullable().default(null),
    /** Tamaño del texto (px). */
    base_size: z.number().min(12).max(22).default(15),
    title_size: z.number().min(16).max(64).default(24),
    title_weight: weight.default(700),
    question_size: z.number().min(12).max(30).default(15),
    question_weight: weight.default(600),
    /** Interlineado (1,5 = 150 %). */
    line_height: z.number().min(1.1).max(2.2).default(1.5),
    /** Espaciado entre letras de los títulos (px). */
    title_letter_spacing: z.number().min(-2).max(8).default(-0.24),
});
export type PublicTypography = z.infer<typeof publicTypographySchema>;

export const PUBLIC_CONTAINERS = ['card', 'plain'] as const;
export const PUBLIC_ALIGNS = ['left', 'center'] as const;
export const PUBLIC_PROGRESS = ['bar', 'steps', 'none'] as const;
export const PUBLIC_COVER_POSITIONS = ['top', 'center', 'bottom'] as const;

const fileId = z.number().int().positive();

export const publicLayoutSchema = z.object({
    /** Ancho máximo del formulario (px). */
    width: z.number().int().min(360).max(1200).default(660),
    /** Con tarjeta (recuadro sobre el fondo) o sin ella (el formulario sobre el fondo). */
    container: z.enum(PUBLIC_CONTAINERS).default('card'),
    /** Relleno dentro de la tarjeta (px). */
    padding: z.number().int().min(8).max(72).default(28),
    /** Separación entre preguntas (px). */
    gap: z.number().int().min(4).max(56).default(20),
    /** Alineación del encabezado (logo, título, descripción). */
    header_align: z.enum(PUBLIC_ALIGNS).default('left'),
    /** Formulario centrado en la pantalla cuando entra entero. */
    vertical_center: z.boolean().default(false),
    /** Franja de color arriba de la tarjeta. */
    band: z.boolean().default(true),
    show_title: z.boolean().default(true),
    show_description: z.boolean().default(true),
    /** Alto del logo (px). */
    logo_size: z.number().int().min(16).max(160).default(36),
    /** Cómo se muestra el avance de un formulario de varias páginas. */
    progress: z.enum(PUBLIC_PROGRESS).default('bar'),
    /** Insertado en otro sitio: mostrar el fondo (si no, queda transparente sobre el sitio). */
    embed_background: z.boolean().default(false),
});
export type PublicLayout = z.infer<typeof publicLayoutSchema>;

export const publicCoverSchema = z.object({
    enabled: z.boolean().default(false),
    /** Imagen (un archivo de la empresa); sin imagen, un degradado del color de la marca. */
    file_id: fileId.nullable().default(null),
    height: z.number().int().min(60).max(480).default(180),
    position: z.enum(PUBLIC_COVER_POSITIONS).default('center'),
    /** Oscurecer la imagen (0 = nada, 0,8 = mucho). */
    overlay: z.number().min(0).max(0.85).default(0),
});
export type PublicCover = z.infer<typeof publicCoverSchema>;

export const PUBLIC_SPLIT_SIDES = ['left', 'right'] as const;

/** Diseño dividido: una imagen (o un color) ocupa medio ancho en pantallas grandes. */
export const publicSplitSchema = z.object({
    enabled: z.boolean().default(false),
    side: z.enum(PUBLIC_SPLIT_SIDES).default('left'),
    file_id: fileId.nullable().default(null),
    /** Color del panel cuando no hay imagen; null = el acento. */
    color: color.nullable().default(null),
    overlay: z.number().min(0).max(0.85).default(0),
    /** Texto grande sobre el panel (opcional). */
    headline: z.string().max(160).default(''),
});
export type PublicSplit = z.infer<typeof publicSplitSchema>;

export const PUBLIC_BACKGROUND_KINDS = ['color', 'gradient', 'image'] as const;
export const PUBLIC_PATTERNS = ['none', 'dots', 'grid', 'diagonal'] as const;
export const PUBLIC_IMAGE_FITS = ['cover', 'contain', 'repeat'] as const;

export const publicBackgroundSchema = z.object({
    kind: z.enum(PUBLIC_BACKGROUND_KINDS).default('color'),
    /** Degradado: del color de fondo a éste. */
    gradient_to: color.nullable().default(null),
    gradient_angle: z.number().int().min(0).max(360).default(135),
    file_id: fileId.nullable().default(null),
    fit: z.enum(PUBLIC_IMAGE_FITS).default('cover'),
    overlay: z.number().min(0).max(0.85).default(0),
    /** Desenfoque de la imagen (px). */
    blur: z.number().int().min(0).max(24).default(0),
    pattern: z.enum(PUBLIC_PATTERNS).default('none'),
});
export type PublicBackground = z.infer<typeof publicBackgroundSchema>;

export const publicCardSchema = z.object({
    radius: z.number().int().min(0).max(48).default(14),
    border_width: z.number().int().min(0).max(4).default(1),
    shadow: z.enum(SHADOWS).default('md'),
});
export type PublicCard = z.infer<typeof publicCardSchema>;

export const PUBLIC_INPUT_STYLES = ['outlined', 'filled', 'underline', 'pill'] as const;
export const PUBLIC_SIZES = ['sm', 'md', 'lg'] as const;
export const PUBLIC_LABEL_POSITIONS = ['top', 'left', 'floating'] as const;
export type PublicInputStyle = (typeof PUBLIC_INPUT_STYLES)[number];
export type PublicSize = (typeof PUBLIC_SIZES)[number];
export type PublicLabelPosition = (typeof PUBLIC_LABEL_POSITIONS)[number];

export const publicInputsSchema = z.object({
    style: z.enum(PUBLIC_INPUT_STYLES).default('outlined'),
    size: z.enum(PUBLIC_SIZES).default('md'),
    /** Esquinas en px; PUBLIC_ROUND_RADIUS (999) = completamente redondo. */
    radius: z.number().int().min(0).max(PUBLIC_ROUND_RADIUS).default(8),
    border_width: z.number().min(0).max(3).default(1),
    /** Etiqueta arriba, a la izquierda (en pantallas anchas) o dentro del campo. */
    label_position: z.enum(PUBLIC_LABEL_POSITIONS).default('top'),
});
export type PublicInputs = z.infer<typeof publicInputsSchema>;

export const PUBLIC_CHOICE_STYLES = ['list', 'buttons', 'cards'] as const;
export type PublicChoiceStyle = (typeof PUBLIC_CHOICE_STYLES)[number];
export const PUBLIC_IMAGE_RATIOS = ['square', 'landscape', 'portrait'] as const;

export const publicChoicesSchema = z.object({
    style: z.enum(PUBLIC_CHOICE_STYLES).default('list'),
    /** Columnas de la lista o de las tarjetas (en el celular, como mucho 2). */
    columns: z.number().int().min(1).max(4).default(1),
    radius: z.number().int().min(0).max(PUBLIC_ROUND_RADIUS).default(8),
    image_ratio: z.enum(PUBLIC_IMAGE_RATIOS).default('landscape'),
});
export type PublicChoices = z.infer<typeof publicChoicesSchema>;

export const PUBLIC_BUTTON_STYLES = ['filled', 'outline', 'soft', 'text'] as const;
export const PUBLIC_BUTTON_ALIGNS = ['left', 'center', 'right'] as const;
export const PUBLIC_BUTTON_ICONS = ['none', 'arrow', 'send', 'check'] as const;

export const publicButtonSchema = z.object({
    style: z.enum(PUBLIC_BUTTON_STYLES).default('filled'),
    size: z.enum(PUBLIC_SIZES).default('md'),
    full_width: z.boolean().default(false),
    align: z.enum(PUBLIC_BUTTON_ALIGNS).default('left'),
    radius: z.number().int().min(0).max(PUBLIC_ROUND_RADIUS).default(8),
    shadow: z.boolean().default(false),
    uppercase: z.boolean().default(false),
    icon: z.enum(PUBLIC_BUTTON_ICONS).default('none'),
});
export type PublicButton = z.infer<typeof publicButtonSchema>;

/** Tope del CSS propio (caracteres). */
export const PUBLIC_CSS_MAX = 20_000;

export const publicThemeSchema = z.object({
    version: z.literal(1).catch(1).default(1),
    /** Plantilla de la que salió (para marcarla en la galería); null = propio. */
    preset: z.string().max(40).nullable().catch(null).default(null),
    mode: z.enum(PUBLIC_THEME_MODES).catch('light').default('light'),
    colors: publicPaletteSchema.catch(publicPaletteSchema.parse({})).default({}),
    /** Colores del modo oscuro; null = calculados solos a partir de los claros. */
    dark_colors: darkPaletteSchema.nullable().catch(null).default(null),
    typography: publicTypographySchema.catch(publicTypographySchema.parse({})).default({}),
    layout: publicLayoutSchema.catch(publicLayoutSchema.parse({})).default({}),
    cover: publicCoverSchema.catch(publicCoverSchema.parse({})).default({}),
    split: publicSplitSchema.catch(publicSplitSchema.parse({})).default({}),
    background: publicBackgroundSchema.catch(publicBackgroundSchema.parse({})).default({}),
    card: publicCardSchema.catch(publicCardSchema.parse({})).default({}),
    inputs: publicInputsSchema.catch(publicInputsSchema.parse({})).default({}),
    choices: publicChoicesSchema.catch(publicChoicesSchema.parse({})).default({}),
    button: publicButtonSchema.catch(publicButtonSchema.parse({})).default({}),
    /** CSS propio (sólo administradores; se limpia al guardar y al servir). */
    custom_css: z.string().max(PUBLIC_CSS_MAX).catch('').default(''),
});
export type PublicTheme = z.infer<typeof publicThemeSchema>;
export type PublicThemeInput = z.input<typeof publicThemeSchema>;

export const DEFAULT_PUBLIC_THEME: PublicTheme = publicThemeSchema.parse({});

/** Lee un tema guardado sin tirar nunca: lo que no sirve cae al de fábrica. */
export function readPublicTheme(raw: unknown): PublicTheme {
    const r = publicThemeSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
    return r.success ? r.data : DEFAULT_PUBLIC_THEME;
}

/** Los archivos (imágenes) que usa un tema: portada, panel dividido y fondo. */
export function publicThemeFileIds(theme: PublicTheme): number[] {
    const ids = [theme.cover.file_id, theme.split.file_id, theme.background.kind === 'image' ? theme.background.file_id : null];
    return [...new Set(ids.filter((n): n is number => typeof n === 'number'))];
}

// ─────────────────────── Temas de la empresa («Mis temas») ───────────────────────

export const PUBLIC_THEMES_MAX = 30;

export const savedPublicThemeSchema = z.object({
    id: z.string().regex(/^[a-z0-9]{6,24}$/),
    name: z.string().trim().min(1).max(60),
    theme: publicThemeSchema,
    updated_at: z.string().max(40).default(''),
});
export type SavedPublicTheme = z.infer<typeof savedPublicThemeSchema>;

export const createPublicThemeSchema = z.object({
    name: z.string().trim().min(1).max(60),
    theme: publicThemeSchema,
});
export type CreatePublicThemeInput = z.infer<typeof createPublicThemeSchema>;

export const updatePublicThemeSchema = z.object({
    name: z.string().trim().min(1).max(60).optional(),
    theme: publicThemeSchema.optional(),
});
export type UpdatePublicThemeInput = z.infer<typeof updatePublicThemeSchema>;

export interface PublicThemesDto {
    themes: SavedPublicTheme[];
    /** Tema con el que nacen los formularios nuevos (null = el clásico). */
    default_id: string | null;
}

/** Lee la lista de temas guardados de la empresa (lo que no valida se descarta). */
export function readSavedPublicThemes(raw: unknown): SavedPublicTheme[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((t) => {
        const r = savedPublicThemeSchema.safeParse(t);
        return r.success ? [r.data] : [];
    });
}
