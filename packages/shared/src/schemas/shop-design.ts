import { z } from 'zod';
import { DESIGN_FONTS, DESIGN_FONT_DEFS, fontStack, selfHostedFontFaces, type DesignFont } from './design-style';
import { contrastRatio, ensureContrast, inkOnColor, luminance, mixHex, sanitizePublicCss } from './public-theme-css';

/**
 * v0.1.422 (ADR-S103) — El ESTILO de la tienda: plantillas, colores, modo
 * oscuro, letra, encabezado, portada, tarjetas, botones y CSS propio.
 *
 * Vive en `config.design` y se lee con tolerancia campo por campo: lo que no
 * se entiende toma su valor por defecto. Por defecto (sin tocar nada) la
 * tienda se ve exactamente como antes. El servidor arma el CSS una vez
 * (`buildShopDesignCss`) y lo sirve junto a la página; la vista previa del
 * editor lo recibe armado. La página sólo pone variables y clases en
 * `<body>`: la estructura vive en `SHOP_CSS` (apps/api/src/shop/shop-page.ts).
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX_RE);
const nullableHex = hex.nullable().catch(null).default(null);
const font = z.enum(DESIGN_FONTS).nullable().catch(null).default(null);

export const SHOP_DESIGN_MODES = ['light', 'dark', 'auto'] as const;
export type ShopDesignMode = (typeof SHOP_DESIGN_MODES)[number];
export const SHOP_CORNERS = ['square', 'soft', 'round'] as const;
export type ShopCorners = (typeof SHOP_CORNERS)[number];
export const SHOP_CARD_STYLES = ['border', 'shadow', 'flat', 'plain'] as const;
export type ShopCardStyle = (typeof SHOP_CARD_STYLES)[number];
export const SHOP_BUTTON_STYLES = ['solid', 'outline'] as const;
export const SHOP_GAPS = ['compact', 'normal', 'airy'] as const;
export const SHOP_WIDTHS = ['narrow', 'normal', 'wide'] as const;
export const SHOP_HEADER_STYLES = ['light', 'brand', 'dark', 'plain'] as const;
export type ShopHeaderStyle = (typeof SHOP_HEADER_STYLES)[number];
export const SHOP_HERO_STYLES = ['simple', 'banner', 'none'] as const;
export type ShopHeroStyle = (typeof SHOP_HERO_STYLES)[number];
export const SHOP_HERO_HEIGHTS = ['short', 'medium', 'tall'] as const;
export const SHOP_ALIGNS = ['left', 'center'] as const;
export const SHOP_TITLE_SIZES = ['small', 'normal', 'large'] as const;
/** Tope del CSS propio (como formularios). */
export const SHOP_CUSTOM_CSS_MAX = 20_000;

export const SHOP_CORNER_LABELS: Record<ShopCorners, string> = { square: 'Rectas', soft: 'Suaves', round: 'Redondas' };
export const SHOP_CARD_LABELS: Record<ShopCardStyle, string> = { border: 'Con borde', shadow: 'Con sombra', flat: 'Sin borde', plain: 'Sólo la foto' };
export const SHOP_HEADER_LABELS: Record<ShopHeaderStyle, string> = { light: 'Claro', brand: 'De tu color', dark: 'Oscuro', plain: 'Sin barra' };
export const SHOP_HERO_LABELS: Record<ShopHeroStyle, string> = { simple: 'Título y texto', banner: 'Portada', none: 'Sin título' };

export const shopDesignHeaderSchema = z.object({
    style: z.enum(SHOP_HEADER_STYLES).catch('light').default('light'),
    align: z.enum(SHOP_ALIGNS).catch('left').default('left'),
    /** Alto del logo (px). */
    logo_size: z.number().int().min(24).max(96).catch(38).default(38),
    /** Queda arriba al bajar (fija). */
    sticky: z.boolean().catch(true).default(true),
});
export type ShopDesignHeader = z.infer<typeof shopDesignHeaderSchema>;

export const shopDesignHeroSchema = z.object({
    style: z.enum(SHOP_HERO_STYLES).catch('simple').default('simple'),
    /** La foto de la portada (un archivo de la empresa; null = el color de la tienda). */
    image_file_id: z.number().int().positive().nullable().catch(null).default(null),
    height: z.enum(SHOP_HERO_HEIGHTS).catch('medium').default('medium'),
    align: z.enum(SHOP_ALIGNS).catch('left').default('left'),
    /** Cuánto se oscurece la foto para que se lea el título (0 a 80 %). */
    overlay: z.number().int().min(0).max(80).catch(35).default(35),
    title_size: z.enum(SHOP_TITLE_SIZES).catch('normal').default('normal'),
});
export type ShopDesignHero = z.infer<typeof shopDesignHeroSchema>;

export const shopDesignColorsSchema = z.object({
    /** El fondo de la página (null = el de la plantilla o el modo). */
    background: nullableHex,
    /** Tarjetas, carrito y ventanas. */
    surface: nullableHex,
    text: nullableHex,
    /** El encabezado cuando es «De tu color» u «Oscuro» (null = el color de la tienda o casi negro). */
    header: nullableHex,
});
export type ShopDesignColors = z.infer<typeof shopDesignColorsSchema>;

/**
 * v0.1.424 — La FICHA del producto (lo que se abre al tocar un producto):
 * cómo se acomodan la foto, los datos, la compra y la descripción.
 */
export const SHOP_PRODUCT_LAYOUTS = ['classic', 'wide', 'stacked', 'compact', 'full'] as const;
export type ShopProductLayout = (typeof SHOP_PRODUCT_LAYOUTS)[number];
export const SHOP_PRODUCT_LAYOUT_LABELS: Record<ShopProductLayout, string> = {
    classic: 'Clásica',
    wide: 'Descripción abajo',
    stacked: 'Foto arriba',
    compact: 'Compacta',
    full: 'Pantalla completa',
};
export const SHOP_PRODUCT_LAYOUT_HINTS: Record<ShopProductLayout, string> = {
    classic: 'Las fotos a la izquierda (quedan a la vista al bajar) y todo lo demás a la derecha.',
    wide: 'Foto y compra arriba, lado a lado; la descripción completa abajo, a todo el ancho.',
    stacked: 'Una sola columna: la foto grande arriba y todo lo demás debajo.',
    compact: 'Una ventana angosta con la foto chica junto al nombre. Para servicios o un menú.',
    full: 'Como la clásica, pero ocupa toda la pantalla, como una página del producto.',
};
export const SHOP_PRODUCT_IMAGE_RATIOS = ['auto', 'square', 'portrait', 'landscape'] as const;
export type ShopProductImageRatio = (typeof SHOP_PRODUCT_IMAGE_RATIOS)[number];
export const SHOP_PRODUCT_IMAGE_RATIO_LABELS: Record<ShopProductImageRatio, string> = {
    auto: 'Como es la foto',
    square: 'Cuadrada',
    portrait: 'Vertical',
    landscape: 'Horizontal',
};

export const shopDesignProductSchema = z.object({
    layout: z.enum(SHOP_PRODUCT_LAYOUTS).catch('classic').default('classic'),
    /** El recuadro de la foto grande («auto» = la proporción de la foto, sin bandas). */
    image_ratio: z.enum(SHOP_PRODUCT_IMAGE_RATIOS).catch('auto').default('auto'),
    /** Con un recuadro fijo: la foto lo llena (recortada) o entra completa. */
    image_fit: z.enum(['cover', 'contain']).catch('contain').default('contain'),
    /** Cómo se entrega (envío, recoger, descarga…) junto al botón de comprar. */
    show_delivery: z.boolean().catch(true).default(true),
    /** En el celular, el precio y el botón quedan fijos abajo al bajar. */
    sticky_bar: z.boolean().catch(true).default(true),
});
export type ShopDesignProduct = z.infer<typeof shopDesignProductSchema>;

/**
 * v0.1.425 — El PAGO (finalizar compra): cómo se acomodan los datos, la
 * entrega, el pago y el resumen del pedido. «Clásico» es el de siempre (no
 * cambia nada); los demás son páginas limpias con el pedido y sus fotos.
 */
export const SHOP_CHECKOUT_LAYOUTS = ['classic', 'split', 'steps', 'single'] as const;
export type ShopCheckoutLayout = (typeof SHOP_CHECKOUT_LAYOUTS)[number];
export const SHOP_CHECKOUT_LAYOUT_LABELS: Record<ShopCheckoutLayout, string> = {
    classic: 'Clásico',
    split: 'Dos columnas',
    steps: 'Por pasos',
    single: 'Una columna',
};
export const SHOP_CHECKOUT_LAYOUT_HINTS: Record<ShopCheckoutLayout, string> = {
    classic: 'El de siempre: el formulario a la izquierda y el resumen en una tarjeta a la derecha, con el encabezado de la tienda.',
    split: 'Una página limpia, como en las tiendas más conocidas: el formulario a la izquierda y el pedido con sus fotos en una columna aparte a la derecha.',
    steps: 'Como «Dos columnas», pero de a un paso: tus datos, la entrega y el pago, con lo ya llenado a la vista.',
    single: 'Todo en una columna angosta: el pedido arriba (se despliega) y después los datos y el pago. Muy cómodo en el celular.',
};
export const SHOP_CHECKOUT_HEADERS = ['minimal', 'store'] as const;
export const SHOP_CHECKOUT_LABEL_STYLES = ['above', 'inside'] as const;
export type ShopCheckoutLabelStyle = (typeof SHOP_CHECKOUT_LABEL_STYLES)[number];

export const shopDesignCheckoutSchema = z.object({
    layout: z.enum(SHOP_CHECKOUT_LAYOUTS).catch('classic').default('classic'),
    /** Arriba del pago (salvo en el clásico): sólo el logo, o el encabezado de la tienda. */
    header: z.enum(SHOP_CHECKOUT_HEADERS).catch('minimal').default('minimal'),
    /** Los nombres de los campos: arriba, o adentro (se achican al escribir). */
    labels: z.enum(SHOP_CHECKOUT_LABEL_STYLES).catch('above').default('above'),
    /** Las fotos de los productos en el resumen (salvo en el clásico). */
    thumbnails: z.boolean().catch(true).default(true),
    /** En el celular, el resumen del pedido arranca abierto. */
    summary_open: z.boolean().catch(false).default(false),
    /** «Pago seguro» con un candado bajo el botón de pagar (salvo en el clásico). */
    trust: z.boolean().catch(true).default(true),
    /** El fondo de la columna del pedido (null = un gris suave). */
    summary_color: nullableHex,
});
export type ShopDesignCheckout = z.infer<typeof shopDesignCheckoutSchema>;

export const shopDesignSchema = z.object({
    /** La plantilla de la que se partió (sólo para marcarla en el editor). */
    preset: z.string().max(40).nullable().catch(null).default(null),
    mode: z.enum(SHOP_DESIGN_MODES).catch('light').default('light'),
    colors: shopDesignColorsSchema.catch(() => shopDesignColorsSchema.parse({})).default({}),
    /** La letra del texto (null = la del sistema, como antes). */
    font,
    /** La de los títulos (null = la misma del texto). */
    heading_font: font,
    /** Tamaño del texto (px). */
    font_size: z.number().int().min(14).max(18).catch(15).default(15),
    heading_weight: z.union([z.literal(600), z.literal(700), z.literal(800)]).catch(700).default(700),
    corners: z.enum(SHOP_CORNERS).catch('soft').default('soft'),
    cards: z.enum(SHOP_CARD_STYLES).catch('border').default('border'),
    card_align: z.enum(SHOP_ALIGNS).catch('left').default('left'),
    /** El botón de las tarjetas: relleno o con contorno (el de pagar siempre va relleno). */
    buttons: z.enum(SHOP_BUTTON_STYLES).catch('solid').default('solid'),
    gap: z.enum(SHOP_GAPS).catch('normal').default('normal'),
    width: z.enum(SHOP_WIDTHS).catch('normal').default('normal'),
    header: shopDesignHeaderSchema.catch(() => shopDesignHeaderSchema.parse({})).default({}),
    hero: shopDesignHeroSchema.catch(() => shopDesignHeroSchema.parse({})).default({}),
    /** v0.1.424 — La ficha del producto. */
    product: shopDesignProductSchema.catch(() => shopDesignProductSchema.parse({})).default({}),
    /** v0.1.425 — El pago. */
    checkout: shopDesignCheckoutSchema.catch(() => shopDesignCheckoutSchema.parse({})).default({}),
    /** CSS propio (sólo lo cambia un administrador; se guarda limpio). */
    custom_css: z.string().max(SHOP_CUSTOM_CSS_MAX).catch('').default(''),
});
export type ShopDesign = z.infer<typeof shopDesignSchema>;

/** Lectura tolerante (lo roto toma su valor por defecto, campo por campo). */
export function readShopDesign(raw: unknown): ShopDesign {
    const r = shopDesignSchema.safeParse(raw ?? {});
    return r.success ? r.data : shopDesignSchema.parse({});
}

export function defaultShopDesign(): ShopDesign {
    return shopDesignSchema.parse({});
}

// ── Plantillas ──────────────────────────────────────────────────────────

export interface ShopDesignPreset {
    id: string;
    label: string;
    description: string;
    /** Lo que cambia la plantilla (el resto queda como por defecto). */
    design: Partial<Omit<ShopDesign, 'header' | 'hero' | 'colors' | 'custom_css' | 'preset' | 'product' | 'checkout'>> & {
        colors: ShopDesignColors;
        header?: Partial<ShopDesignHeader>;
        hero?: Partial<Omit<ShopDesignHero, 'image_file_id'>>;
    };
}

export const SHOP_DESIGN_PRESETS: readonly ShopDesignPreset[] = [
    {
        id: 'clasica',
        label: 'Clásica',
        description: 'Clara y ordenada, con tarjetas con borde. La de siempre.',
        design: { colors: { background: null, surface: null, text: null, header: null } },
    },
    {
        id: 'minimal',
        label: 'Minimalista',
        description: 'Fondo blanco, mucho aire y sólo las fotos. Para productos que se lucen solos.',
        design: {
            colors: { background: '#ffffff', surface: '#ffffff', text: '#0a0a0a', header: null },
            font: 'inter',
            cards: 'plain',
            buttons: 'outline',
            gap: 'airy',
            header: { style: 'plain', align: 'center' },
            hero: { style: 'simple', align: 'center', title_size: 'large' },
        },
    },
    {
        id: 'boutique',
        label: 'Boutique',
        description: 'Tonos cálidos, títulos con serifa y una portada grande. Moda, regalos y diseño.',
        design: {
            colors: { background: '#faf6f0', surface: '#fffdf9', text: '#2b2118', header: null },
            font: 'lato',
            heading_font: 'playfair',
            corners: 'square',
            cards: 'flat',
            card_align: 'center',
            buttons: 'outline',
            gap: 'airy',
            header: { style: 'light', align: 'center', logo_size: 46 },
            hero: { style: 'banner', align: 'center', height: 'tall', title_size: 'large', overlay: 30 },
        },
    },
    {
        id: 'moderna',
        label: 'Moderna',
        description: 'Encabezado de tu color, tarjetas con sombra y esquinas redondas.',
        design: {
            colors: { background: '#f4f4f5', surface: '#ffffff', text: '#18181b', header: null },
            font: 'poppins',
            heading_weight: 800,
            corners: 'round',
            cards: 'shadow',
            header: { style: 'brand' },
            hero: { style: 'banner', height: 'medium' },
        },
    },
    {
        id: 'mercado',
        label: 'Mercado',
        description: 'Alegre y compacta: más productos a la vista, precios al centro.',
        design: {
            colors: { background: '#fff7ed', surface: '#ffffff', text: '#1f2937', header: null },
            font: 'nunito',
            heading_weight: 800,
            corners: 'round',
            cards: 'shadow',
            card_align: 'center',
            gap: 'compact',
            header: { style: 'brand' },
            hero: { style: 'banner', align: 'center', height: 'short' },
        },
    },
    {
        id: 'noche',
        label: 'Noche',
        description: 'Oscura y elegante. Tecnología, música, bebidas y todo lo que brilla de noche.',
        design: {
            mode: 'dark',
            colors: { background: '#0b0d12', surface: '#151922', text: '#eef0f4', header: null },
            font: 'montserrat',
            cards: 'border',
            header: { style: 'plain' },
            hero: { style: 'banner', height: 'medium', overlay: 45 },
        },
    },
];

/**
 * Aplica una plantilla: cambia colores, letra, formas, encabezado y portada.
 * Conserva la foto de la portada, el tamaño del logo si la plantilla no lo
 * fija, el ancho y el CSS propio.
 */
export function applyShopDesignPreset(current: ShopDesign, presetId: string): ShopDesign {
    const p = SHOP_DESIGN_PRESETS.find((x) => x.id === presetId);
    if (!p) return current;
    const base = defaultShopDesign();
    return readShopDesign({
        ...base,
        ...p.design,
        width: current.width,
        header: { ...base.header, logo_size: current.header.logo_size, ...(p.design.header ?? {}) },
        hero: { ...base.hero, ...(p.design.hero ?? {}), image_file_id: current.hero.image_file_id },
        custom_css: current.custom_css,
        // v0.1.424 — La ficha del producto no la cambia una plantilla.
        product: current.product,
        // v0.1.425 — El pago tampoco.
        checkout: current.checkout,
        preset: p.id,
    });
}

/** Los archivos que usa el diseño (para validarlos y servirlos). */
export function shopDesignFileIds(d: ShopDesign): number[] {
    return d.hero.style === 'banner' && d.hero.image_file_id !== null ? [d.hero.image_file_id] : [];
}

// ── CSS ─────────────────────────────────────────────────────────────────

const LIGHT = { background: '#f6f7f9', surface: '#ffffff', text: '#111827' };
const DARK = { background: '#0f1115', surface: '#171a21', text: '#e8eaef' };

interface Palette {
    bg: string;
    card: string;
    text: string;
    dark: boolean;
}

function palette(d: ShopDesign, dark: boolean): Palette {
    const base = dark ? DARK : LIGHT;
    // En «automático» la versión oscura usa los colores oscuros de siempre
    // (los elegidos son para el modo claro); en «oscuro» manda lo elegido.
    const pick = (k: 'background' | 'surface' | 'text'): string => (d.mode === 'auto' && dark ? base[k] : (d.colors[k] ?? base[k]));
    const bg = pick('background');
    const card = pick('surface');
    let text = pick('text');
    if (contrastRatio(text, card) < 4.5) text = inkOnColor(card) === '#ffffff' ? '#f3f4f6' : '#111827';
    return { bg, card, text, dark: luminance(card) < 0.18 };
}

const RADIUS: Record<ShopCorners, { card: string; btn: string; sm: string; chip: string }> = {
    square: { card: '4px', btn: '6px', sm: '4px', chip: '6px' },
    soft: { card: '14px', btn: '10px', sm: '10px', chip: '999px' },
    round: { card: '22px', btn: '999px', sm: '14px', chip: '999px' },
};
const GAP: Record<ShopDesign['gap'], string> = { compact: '10px', normal: '18px', airy: '28px' };
const WIDTH: Record<ShopDesign['width'], string> = { narrow: '1000px', normal: '1180px', wide: '1400px' };
const HERO_H: Record<ShopDesign['hero']['height'], string> = { short: '180px', medium: '280px', tall: '420px' };
const TITLE: Record<ShopDesign['hero']['title_size'], string> = {
    small: 'clamp(22px,3.2vw,30px)',
    normal: 'clamp(26px,4vw,38px)',
    large: 'clamp(30px,5.4vw,54px)',
};

function rgba(h: string, a: number): string {
    const n = parseInt(h.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Las variables de color de una paleta (claras u oscuras). */
function colorVars(d: ShopDesign, p: Palette, accent: string): string {
    const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#0e7490';
    const accentText = ensureContrast(a, p.card, 4.5);
    const v: Array<[string, string]> = [
        ['--s-bg', p.bg],
        ['--s-card', p.card],
        ['--s-field', p.card],
        ['--s-text', p.text],
        ['--s-text2', mixHex(p.text, p.card, 0.2)],
        ['--s-muted', mixHex(p.text, p.card, 0.45)],
        ['--s-line', mixHex(p.text, p.card, p.dark ? 0.82 : 0.88)],
        ['--s-soft', mixHex(p.text, p.card, p.dark ? 0.9 : 0.95)],
        ['--s-noimg', mixHex(p.text, p.card, 0.7)],
        ['--s-accent-text', accentText],
        ['--s-shadow', p.dark ? 'rgba(0,0,0,.45)' : 'rgba(15,23,42,.10)'],
        ['--s-ok-ink', p.dark ? '#86efac' : '#166534'],
        ['--s-warn-ink', p.dark ? '#fcd34d' : '#92400e'],
        ['--s-danger-ink', p.dark ? '#fca5a5' : '#991b1b'],
        ['--s-info-ink', p.dark ? '#93c5fd' : '#1d4ed8'],
    ];
    // El encabezado.
    const hs = d.header.style;
    if (hs === 'brand' || hs === 'dark') {
        const bg = d.colors.header ?? (hs === 'brand' ? a : p.dark ? '#05070a' : '#111827');
        const ink = inkOnColor(bg);
        v.push(['--s-head-bg', bg], ['--s-head-ink', ink], ['--s-head-line', 'transparent']);
        // El botón del carrito invierte sobre un encabezado de color (si no, se pierde).
        const btnBg = bg.toLowerCase() === a.toLowerCase() || contrastRatio(a, bg) < 2 ? ink : a;
        v.push(['--s-cbtn-bg', btnBg], ['--s-cbtn-ink', btnBg === ink ? bg : inkOnColor(a)]);
        v.push(['--s-hbtn-bg', rgba(ink === '#ffffff' ? '#ffffff' : '#000000', 0.12)], ['--s-hbtn-ink', ink], ['--s-hbtn-line', 'transparent']);
    } else {
        const bg = hs === 'plain' ? p.bg : p.card;
        v.push(['--s-head-bg', rgba(bg, 0.92)], ['--s-head-ink', p.text], ['--s-head-line', hs === 'plain' ? 'transparent' : 'var(--s-line)']);
        v.push(['--s-cbtn-bg', a], ['--s-cbtn-ink', inkOnColor(a)]);
        v.push(['--s-hbtn-bg', 'var(--s-card)'], ['--s-hbtn-ink', 'var(--s-text)'], ['--s-hbtn-line', 'var(--s-line)']);
    }
    // La portada sin foto: el color de la tienda en degradé.
    v.push(['--s-hero-bg', `linear-gradient(135deg,${a},${mixHex(a, p.dark ? '#000000' : '#0b1220', 0.3)})`], ['--s-hero-ink', inkOnColor(a)]);
    // v0.1.425 — La columna del pedido en el pago: el color elegido (sólo en
    // la versión clara de «automático») o un gris apenas distinto del fondo.
    const chosen = d.checkout.summary_color && !(d.mode === 'auto' && p.dark) ? d.checkout.summary_color : null;
    const side = chosen ?? mixHex(p.text, p.card, p.dark ? 0.93 : 0.965);
    const sideInk = contrastRatio(p.text, side) >= 4.5 ? p.text : inkOnColor(side) === '#ffffff' ? '#f3f4f6' : '#111827';
    v.push(
        ['--s-cx-side', side],
        ['--s-cx-ink', sideInk],
        ['--s-cx-muted', mixHex(sideInk, side, 0.4)],
        ['--s-cx-line', mixHex(sideInk, side, p.dark ? 0.8 : 0.86)],
        ['--s-cx-thumb', mixHex(sideInk, side, 0.92)],
    );
    return v.map(([k, x]) => `${k}:${x}`).join(';');
}

/** Las variables de forma (no cambian con el modo). */
function shapeVars(d: ShopDesign): string {
    const r = RADIUS[d.corners];
    const body = d.font ? fontStack(d.font) : '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    const head = d.heading_font ? fontStack(d.heading_font) : 'var(--s-font)';
    return [
        `--s-radius:${r.card}`,
        `--s-radius-btn:${r.btn}`,
        `--s-radius-sm:${r.sm}`,
        `--s-radius-chip:${r.chip}`,
        `--s-gap:${GAP[d.gap]}`,
        `--s-width:${WIDTH[d.width]}`,
        `--s-font:${body}`,
        `--s-font-h:${head}`,
        `--s-fs:${d.font_size}px`,
        `--s-hw:${d.heading_weight}`,
        `--s-logo-h:${d.header.logo_size}px`,
        `--s-hero-h:${HERO_H[d.hero.height]}`,
        `--s-hero-ov:${(d.hero.overlay / 100).toFixed(2)}`,
        `--s-title:${TITLE[d.hero.title_size]}`,
    ].join(';');
}

/** Las clases de `<body>` (la estructura de cada variante vive en SHOP_CSS). */
export function shopDesignClasses(d: ShopDesign): string {
    return [
        `s-cards-${d.cards}`,
        d.card_align === 'center' ? 's-al-center' : '',
        d.buttons === 'outline' ? 's-btn-outline' : '',
        `s-head-${d.header.style}`,
        d.header.align === 'center' ? 's-head-center' : '',
        d.header.sticky ? '' : 's-head-static',
        `s-hero-${d.hero.style}`,
        d.hero.align === 'center' ? 's-hero-center' : '',
        d.hero.style === 'banner' && d.hero.image_file_id !== null ? 's-hero-img' : '',
        d.corners === 'square' ? 's-square' : '',
    ]
        .filter(Boolean)
        .join(' ');
}

/** Las fuentes web que hace falta cargar. */
export function shopDesignWebFonts(d: ShopDesign): DesignFont[] {
    const out = new Set<DesignFont>();
    for (const f of [d.font, d.heading_font]) if (f && DESIGN_FONT_DEFS[f]?.kind === 'web') out.add(f);
    return [...out];
}

/**
 * El CSS del diseño: fuentes, variables (claras, oscuras o según el
 * dispositivo) y el CSS propio limpio. `accent` = el color de la tienda (el
 * elegido o el de la marca).
 */
export function buildShopDesignCss(d: ShopDesign, accent: string, opts: { fontBase?: string; includeCustom?: boolean } = {}): string {
    const parts: string[] = [];
    const fonts = shopDesignWebFonts(d);
    if (fonts.length > 0) parts.push(selfHostedFontFaces(fonts, opts.fontBase ?? ''));
    const light = palette(d, d.mode === 'dark');
    parts.push(`:root{${colorVars(d, light, accent)};${shapeVars(d)}${light.dark ? ';color-scheme:dark' : ''}}`);
    if (d.mode === 'auto') {
        const dark = colorVars(d, palette(d, true), accent);
        // Según el dispositivo… salvo que la vista previa fuerce uno (`data-scheme`).
        parts.push(`@media (prefers-color-scheme: dark){:root:not([data-scheme=light]){${dark};color-scheme:dark}}`);
        parts.push(`:root[data-scheme=dark]{${dark};color-scheme:dark}`);
    }
    if (opts.includeCustom !== false && d.custom_css.trim() !== '') {
        const clean = sanitizePublicCss(d.custom_css).css;
        if (clean) parts.push(`/* CSS propio */\n${clean}`);
    }
    return parts.join('\n');
}

/** Tipos de imagen que puede usar la portada (nada de SVG: puede llevar script). */
export const SHOP_DESIGN_IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
