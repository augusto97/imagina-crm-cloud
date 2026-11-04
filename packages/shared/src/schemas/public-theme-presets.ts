import {
    publicBackgroundSchema,
    publicButtonSchema,
    publicCardSchema,
    publicChoicesSchema,
    publicCoverSchema,
    publicInputsSchema,
    publicLayoutSchema,
    publicPaletteSchema,
    publicSplitSchema,
    publicThemeSchema,
    publicTypographySchema,
    type PublicTheme,
    type PublicThemeInput,
} from './public-theme';
import { mixHex } from './public-theme-css';

/**
 * v0.1.351 (ADR-S94) — Plantillas de diseño de las páginas públicas. Cada
 * una es una FUNCIÓN del color de la marca: «toman tu marca» de verdad (el
 * acento queda en null = el de la empresa, y los fondos que lo necesitan se
 * tiñen con él). Aplicar una plantilla reemplaza el tema entero; después se
 * retoca como cualquier otro.
 */

export interface PublicThemePreset {
    id: string;
    name: string;
    description: string;
    /** Para la miniatura de la galería (sin calcular el CSS). */
    swatch: { background: string; card: string; text: string; accent: string; dark: boolean };
    theme: PublicTheme;
}

const SECTIONS = {
    colors: publicPaletteSchema,
    typography: publicTypographySchema,
    layout: publicLayoutSchema,
    cover: publicCoverSchema,
    split: publicSplitSchema,
    background: publicBackgroundSchema,
    card: publicCardSchema,
    inputs: publicInputsSchema,
    choices: publicChoicesSchema,
    button: publicButtonSchema,
} as const;

/**
 * El tema se lee con tolerancia (una sección rota cae entera a la de
 * fábrica), así que una plantilla con un valor fuera de rango perdería su
 * sección SIN avisar. Aquí cada sección se valida estricta: un error es de
 * código y lo atrapa el test de las plantillas.
 */
function build(id: string, input: PublicThemeInput): PublicTheme {
    for (const [key, schema] of Object.entries(SECTIONS)) {
        const value = (input as Record<string, unknown>)[key];
        if (value === undefined) continue;
        const r = schema.safeParse(value);
        if (!r.success) throw new Error(`Plantilla «${id}»: la sección ${key} no es válida (${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message})`);
    }
    return publicThemeSchema.parse({ ...input, preset: id });
}

/** Un acento demasiado claro para fondos claros se oscurece un poco (sólo para teñir). */
function safeBrand(brand: string): string {
    return /^#[0-9a-f]{6}$/i.test(brand) ? brand : '#0e7490';
}

export function publicThemePresets(brandColor: string): PublicThemePreset[] {
    const brand = safeBrand(brandColor);
    const tint = (t: number): string => mixHex('#ffffff', brand, t);

    const list: Array<Omit<PublicThemePreset, 'swatch'> & { swatch?: Partial<PublicThemePreset['swatch']> }> = [
        {
            id: 'classic',
            name: 'Clásico',
            description: 'Tarjeta blanca sobre gris, con la franja de tu marca. El de siempre.',
            theme: build('classic', {}),
        },
        {
            id: 'minimal',
            name: 'Minimalista',
            description: 'Sin tarjeta ni bordes: líneas finas, mucho aire y la fuente Inter.',
            theme: build('minimal', {
                colors: { background: '#ffffff', card: '#ffffff', border: '#e7e9ee', input_border: '#cfd4dc', muted: '#6b7280', text: '#111827' },
                typography: { font: 'inter', title_size: 30, title_weight: 700, question_weight: 500, base_size: 15 },
                layout: { container: 'plain', band: false, gap: 26, width: 600 },
                inputs: { style: 'underline', border_width: 1.5 },
                choices: { style: 'buttons', radius: 999 },
                button: { radius: 999, size: 'lg' },
            }),
        },
        {
            id: 'soft',
            name: 'Suave',
            description: 'Esquinas redondeadas, campos con relleno y un fondo con un toque de tu color.',
            theme: build('soft', {
                colors: { background: tint(0.08), card: '#ffffff', border: tint(0.18), input_bg: tint(0.05), input_border: tint(0.05) },
                typography: { font: 'nunito', title_size: 28, question_weight: 700 },
                layout: { band: false, padding: 32, gap: 22 },
                card: { radius: 24, border_width: 0, shadow: 'lg' },
                inputs: { style: 'filled', radius: 14, size: 'lg' },
                choices: { style: 'buttons', radius: 999 },
                button: { radius: 999, size: 'lg', full_width: true, shadow: true },
            }),
        },
        {
            id: 'corporate',
            name: 'Corporativo',
            description: 'Formal y ordenado: esquinas rectas, etiquetas a la izquierda y Roboto.',
            theme: build('corporate', {
                colors: { background: '#eef1f5', card: '#ffffff', border: '#d4d9e1', input_border: '#c4cbd6', text: '#17202e', muted: '#5b6676' },
                typography: { font: 'roboto', title_size: 24, title_weight: 700, question_weight: 500, question_size: 14, base_size: 14 },
                layout: { width: 760, padding: 36 },
                card: { radius: 4, border_width: 1, shadow: 'sm' },
                inputs: { style: 'outlined', radius: 3, label_position: 'left' },
                choices: { style: 'list', radius: 3, columns: 2 },
                button: { radius: 3, uppercase: true },
            }),
        },
        {
            id: 'dark',
            name: 'Oscuro',
            description: 'Fondo oscuro y elegante, con tu color destacando en los botones.',
            theme: build('dark', {
                mode: 'dark',
                colors: {
                    background: '#0d0f14',
                    card: '#161a22',
                    text: '#eceef2',
                    muted: '#9aa3b2',
                    border: '#2a2f3a',
                    input_bg: '#10131a',
                    input_border: '#343a46',
                    error: '#f97066',
                },
                typography: { font: 'inter', title_size: 28 },
                layout: { band: false },
                card: { radius: 16, border_width: 1, shadow: 'lg' },
                inputs: { style: 'outlined', radius: 10 },
                choices: { style: 'list', radius: 10 },
                button: { radius: 10, size: 'lg', shadow: true },
            }),
            swatch: { dark: true },
        },
        {
            id: 'elegant',
            name: 'Elegante',
            description: 'Títulos con serifa (Playfair), fondo crema y líneas finas. Para eventos o marcas premium.',
            theme: build('elegant', {
                colors: { background: '#f6f1ea', card: '#fffdf9', text: '#2b2520', muted: '#7a6e63', border: '#e6ddd1', input_bg: '#fffdf9', input_border: '#cdbfae' },
                typography: { font: 'lora', heading_font: 'playfair', title_size: 36, title_weight: 700, question_weight: 600, line_height: 1.6, title_letter_spacing: 0 },
                layout: { header_align: 'center', band: false, padding: 44, gap: 24, width: 620 },
                card: { radius: 2, border_width: 1, shadow: 'sm' },
                inputs: { style: 'underline', border_width: 1 },
                choices: { style: 'list', radius: 2 },
                button: { style: 'outline', radius: 2, uppercase: true, align: 'center', size: 'lg' },
            }),
        },
        {
            id: 'vibrant',
            name: 'Vibrante',
            description: 'Fondo en degradado de tu color, tarjeta flotante y botones redondos. Llama la atención.',
            theme: build('vibrant', {
                colors: { background: brand, card: '#ffffff' },
                typography: { font: 'poppins', title_size: 30, title_weight: 700 },
                layout: { band: false, padding: 34, vertical_center: true, embed_background: false },
                background: { kind: 'gradient', gradient_to: mixHex(brand, '#7c3aed', 0.55), gradient_angle: 135 },
                card: { radius: 24, border_width: 0, shadow: 'lg' },
                inputs: { style: 'filled', radius: 12, size: 'lg' },
                choices: { style: 'buttons', radius: 999 },
                button: { radius: 999, size: 'lg', full_width: true, shadow: true, icon: 'arrow' },
            }),
            swatch: { background: brand },
        },
        {
            id: 'cards',
            name: 'Tarjetas',
            description: 'Las opciones se eligen tocando tarjetas grandes, ideal con imágenes. Montserrat.',
            theme: build('cards', {
                colors: { background: '#f3f4f6', card: '#ffffff', border: '#e3e6ea' },
                typography: { font: 'montserrat', title_size: 26, question_size: 16, question_weight: 700 },
                layout: { width: 780, band: true },
                card: { radius: 18, border_width: 0, shadow: 'md' },
                inputs: { style: 'outlined', radius: 12, size: 'lg' },
                choices: { style: 'cards', columns: 3, radius: 14, image_ratio: 'landscape' },
                button: { radius: 12, size: 'lg' },
            }),
        },
        {
            id: 'pills',
            name: 'Píldoras',
            description: 'Campos y botones totalmente redondeados, con etiquetas que se suben al escribir.',
            theme: build('pills', {
                colors: { background: tint(0.05), card: '#ffffff', border: '#e5e7eb', input_border: '#d6dae0' },
                typography: { font: 'open_sans', title_size: 26 },
                layout: { band: false, padding: 32 },
                card: { radius: 28, border_width: 0, shadow: 'md' },
                inputs: { style: 'pill', size: 'lg', label_position: 'floating' },
                choices: { style: 'buttons', radius: 999 },
                button: { radius: 999, size: 'lg', full_width: true },
            }),
        },
        {
            id: 'natural',
            name: 'Natural',
            description: 'Tonos cálidos de papel, títulos con serifa (Merriweather) y bordes suaves.',
            theme: build('natural', {
                colors: { background: '#f3efe6', card: '#fffef9', text: '#2e2a22', muted: '#77705f', border: '#e2dccd', input_bg: '#fffef9', input_border: '#d4ccb9' },
                typography: { font: 'open_sans', heading_font: 'merriweather', title_size: 28, title_letter_spacing: 0 },
                layout: { band: false, padding: 34 },
                background: { kind: 'color', pattern: 'dots' },
                card: { radius: 12, border_width: 1, shadow: 'sm' },
                inputs: { style: 'outlined', radius: 10 },
                choices: { style: 'list', radius: 10 },
                button: { radius: 10, size: 'lg' },
            }),
        },
        {
            id: 'tech',
            name: 'Tecnológico',
            description: 'Fondo azul noche con cuadrícula, tipografía Inter y detalles en tu color.',
            theme: build('tech', {
                mode: 'dark',
                colors: {
                    background: '#0a0f1e',
                    card: '#101830',
                    text: '#e6ebf5',
                    muted: '#8d9ab4',
                    border: '#22305a',
                    input_bg: '#0c1326',
                    input_border: '#2a3a68',
                    error: '#ff7a7a',
                },
                typography: { font: 'inter', heading_font: 'mono', title_size: 26, title_weight: 700, title_letter_spacing: 0 },
                layout: { band: true },
                background: { kind: 'color', pattern: 'grid' },
                card: { radius: 8, border_width: 1, shadow: 'lg' },
                inputs: { style: 'outlined', radius: 6 },
                choices: { style: 'list', radius: 6, columns: 2 },
                button: { radius: 6, icon: 'arrow' },
            }),
            swatch: { dark: true },
        },
        {
            id: 'cover',
            name: 'Con portada',
            description: 'Una portada arriba de la tarjeta (tu imagen o un degradado de tu color) y el encabezado centrado.',
            theme: build('cover', {
                colors: { background: '#f1f3f6' },
                typography: { font: 'raleway', title_size: 30, title_weight: 700 },
                layout: { header_align: 'center', band: false, padding: 34 },
                cover: { enabled: true, height: 200 },
                card: { radius: 18, border_width: 0, shadow: 'lg' },
                inputs: { style: 'outlined', radius: 10, size: 'lg' },
                choices: { style: 'buttons', radius: 999 },
                button: { radius: 999, size: 'lg', align: 'center' },
            }),
        },
        {
            id: 'split',
            name: 'Dividido',
            description: 'Media pantalla con tu imagen (o tu color) y el formulario al lado. En el celular, arriba.',
            theme: build('split', {
                colors: { background: '#ffffff', card: '#ffffff' },
                typography: { font: 'inter', title_size: 30, title_weight: 700 },
                layout: { container: 'plain', band: false, width: 520, vertical_center: true },
                split: { enabled: true, side: 'left', headline: '' },
                inputs: { style: 'outlined', radius: 10, size: 'lg' },
                choices: { style: 'list', radius: 10 },
                button: { radius: 10, size: 'lg', full_width: true },
            }),
        },
    ];

    return list.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        theme: p.theme,
        swatch: {
            background: p.swatch?.background ?? p.theme.colors.background,
            card: p.theme.colors.card,
            text: p.theme.colors.text,
            accent: p.theme.colors.accent ?? brand,
            dark: p.swatch?.dark ?? false,
        },
    }));
}

export const PUBLIC_THEME_PRESET_IDS = [
    'classic',
    'minimal',
    'soft',
    'corporate',
    'dark',
    'elegant',
    'vibrant',
    'cards',
    'pills',
    'natural',
    'tech',
    'cover',
    'split',
] as const;
