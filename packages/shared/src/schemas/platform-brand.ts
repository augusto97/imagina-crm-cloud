import { z } from 'zod';
import { APP_BAR_NEUTRAL, hexColorSchema } from './tenant';

/**
 * v0.1.327 — La marca de la PLATAFORMA (Plataforma → Marca): el nombre de la
 * app, el logo del login y la pantalla de arranque, y el ícono de la app
 * instalada, de la pestaña y del inicio del teléfono. Antes la app traía un
 * ícono genérico de fábrica que se leía como "el logo" de la marca del
 * operador sin serlo: ahora el operador sube el suyo y, sin subirlo, la app
 * muestra el NOMBRE (texto) y un ícono neutro.
 *
 * Vive en Redis `platform:brand` (viaja en el snapshot, ADR-S20). Las
 * imágenes se guardan en el almacenamiento de la plataforma y se sirven sin
 * sesión desde `/api/v1/public/brand/images/<hex>.png` (el login y el
 * manifiesto las necesitan antes de entrar). Siempre PNG: el navegador del
 * operador convierte lo que suba (SVG, JPG, WebP) y genera los tamaños del
 * ícono con un canvas; el servidor sólo acepta PNG reconocido por sus bytes.
 *
 * Una empresa con su propio logo (Ajustes → Marca) sigue mandando dentro de
 * la app; en el dominio propio de una empresa (white-label) la marca de la
 * plataforma NUNCA aparece.
 */

export const DEFAULT_PLATFORM_APP_NAME = 'Imagina Base';

/** v0.1.331 — el sitio del producto. Sólo https: el enlace sale en el login de todos. */
export const marketingUrlSchema = z
    .string()
    .trim()
    .max(500)
    .url('Escribe una dirección completa, con https://')
    .refine((v) => v.startsWith('https://'), 'La dirección tiene que empezar con https://');

/** URL de una imagen subida a la marca de la plataforma. */
export const PLATFORM_BRAND_IMAGE_RE = /^\/api\/v1\/public\/brand\/images\/[a-f0-9]{32}\.png$/;
const brandImageUrl = z.string().regex(PLATFORM_BRAND_IMAGE_RE, 'Imagen de marca inválida');

/**
 * Tamaños del ícono que arma el navegador del operador al subirlo.
 *
 * v0.1.329 — `maskable_dark_*`: el mismo ícono con el fondo del modo oscuro.
 * En Android 12+ la pantalla con la que abre la app instalada es el ícono
 * recortado en CÍRCULO sobre el color de fondo del manifiesto; si el fondo
 * del ícono no es el mismo, se ve un disco alrededor del logo. El manifiesto
 * oscuro (`?scheme=dark`) usa estos. Son opcionales: los íconos guardados
 * antes no los tienen (el manifiesto cae a los claros).
 */
export const PLATFORM_ICON_SIZES = {
    icon_192: { size: 192, maskable: false, dark: false },
    icon_512: { size: 512, maskable: false, dark: false },
    maskable_192: { size: 192, maskable: true, dark: false },
    maskable_512: { size: 512, maskable: true, dark: false },
    apple_180: { size: 180, maskable: true, dark: false },
    icon_96: { size: 96, maskable: false, dark: false },
    favicon_32: { size: 32, maskable: false, dark: false },
    maskable_dark_192: { size: 192, maskable: true, dark: true },
    maskable_dark_512: { size: 512, maskable: true, dark: true },
} as const;
export type PlatformIconKey = keyof typeof PLATFORM_ICON_SIZES;
export const PLATFORM_ICON_KEYS = Object.keys(PLATFORM_ICON_SIZES) as PlatformIconKey[];
/** Las que existían desde v0.1.327 (obligatorias en un juego guardado). */
export const PLATFORM_ICON_BASE_KEYS = PLATFORM_ICON_KEYS.filter((k) => !PLATFORM_ICON_SIZES[k].dark);

export const platformIconSetSchema = z.object({
    icon_192: brandImageUrl,
    icon_512: brandImageUrl,
    maskable_192: brandImageUrl,
    maskable_512: brandImageUrl,
    apple_180: brandImageUrl,
    icon_96: brandImageUrl,
    favicon_32: brandImageUrl,
    maskable_dark_192: brandImageUrl.optional(),
    maskable_dark_512: brandImageUrl.optional(),
});
export type PlatformIconSet = z.infer<typeof platformIconSetSchema>;

/**
 * v0.1.343 — El ícono como ÍCONO DE APP, no como un logo pegado sobre un
 * plato blanco. El fondo va de borde a borde (un degradado sacado de los
 * colores del logo, o un color sólido) y encima el dibujo, dentro de la zona
 * que ningún teléfono recorta:
 *  - `mark`: sólo la parte clara del logo (la marca blanca de un emblema
 *    redondo o cuadrado): el fondo de color del emblema pasa a ser el fondo
 *    del ícono, así no queda «un círculo dentro de otro».
 *  - `logo`: el logo completo, con sus colores.
 *  - `white`: la silueta del logo en blanco (un símbolo de un solo color).
 * `splash` decide la pantalla con que abre Android 12+: sobre el fondo de la
 * app (el ícono se ve como un círculo de color, como en las apps nativas) o
 * con el color del ícono de pantalla completa (sólo la marca, sin círculo;
 * entonces el fondo del ícono es sólido, si no se vería el borde).
 * null = el estilo de antes (el logo sobre el fondo de la app, ver
 * `icon_background_auto`).
 */
export const ICON_ART_KINDS = ['mark', 'logo', 'white'] as const;
export type IconArtKind = (typeof ICON_ART_KINDS)[number];
export const ICON_SCALE_MIN = 0.6;
export const ICON_SCALE_MAX = 1.4;

export const iconDesignSchema = z.object({
    art: z.enum(ICON_ART_KINDS).default('logo'),
    bg_from: hexColorSchema.default('#0f766e'),
    /** Segundo color del degradado (null = color sólido). */
    bg_to: hexColorSchema.nullable().default(null),
    /** Hacia dónde va el degradado, en grados (0 = a la derecha, 90 = hacia abajo). */
    bg_angle: z.number().int().min(0).max(359).default(135),
    /** Tamaño del dibujo: 1 = el que sugiere la app. */
    scale: z.number().min(ICON_SCALE_MIN).max(ICON_SCALE_MAX).default(1),
    splash: z.enum(['app', 'icon']).default('app'),
});
export type IconDesign = z.infer<typeof iconDesignSchema>;

/** El fondo con que se pinta el ícono: con la apertura en el color del ícono, sólido. */
export function iconDesignBackground(design: IconDesign): { from: string; to: string | null; angle: number } {
    return { from: design.bg_from, to: design.splash === 'icon' ? null : design.bg_to, angle: design.bg_angle };
}

export const platformBrandSchema = z.object({
    app_name: z.string().trim().min(1).max(60).default(DEFAULT_PLATFORM_APP_NAME),
    /** Logo horizontal (login, pantalla de arranque). */
    logo_url: brandImageUrl.nullable().default(null),
    /** Versión para fondos oscuros (opcional; sin ella se usa el logo normal). */
    logo_dark_url: brandImageUrl.nullable().default(null),
    /**
     * El ícono original (PNG de 512, transparente) del que salen los tamaños:
     * cambiar el color de fondo los vuelve a generar sin pedir otra vez el archivo.
     */
    icon_source_url: brandImageUrl.nullable().default(null),
    /** El ícono en todos sus tamaños (null = el ícono neutro de fábrica). */
    icons: platformIconSetSchema.nullable().default(null),
    /** Fondo del ícono (el teléfono recorta el ícono en círculo o cuadrado). */
    icon_background: hexColorSchema.default('#ffffff'),
    /**
     * v0.1.329 — true = el fondo del ícono es el MISMO que el de la app
     * (blanco en claro, #121212 en oscuro): al abrir la app instalada, Android
     * muestra el logo solo, sin un disco de otro color alrededor. false = el
     * color de `icon_background` (útil si el logo necesita un fondo propio).
     */
    icon_background_auto: z.boolean().default(true),
    /** v0.1.343 — el ícono diseñado (ver `iconDesignSchema`); null = el estilo de antes. */
    icon_design: iconDesignSchema.nullable().default(null),
    /**
     * v0.1.331 — el sitio del producto (la landing, p. ej.
     * `https://imagina.cloud/base`). El login muestra «Conoce …» con un enlace
     * ahí — sólo en el dominio de la plataforma, nunca en el de una empresa.
     */
    marketing_url: marketingUrlSchema.nullable().default(null),
});
export type PlatformBrand = z.infer<typeof platformBrandSchema>;

export const updatePlatformBrandSchema = platformBrandSchema;
export type UpdatePlatformBrandInput = z.input<typeof updatePlatformBrandSchema>;

export const platformBrandImageSchema = z.object({
    url: brandImageUrl,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
});
export type PlatformBrandImage = z.infer<typeof platformBrandImageSchema>;

/** Lectura tolerante: un valor raro (o de una versión vieja) cae a la de fábrica campo por campo. */
export function parsePlatformBrand(raw: unknown): PlatformBrand {
    const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = platformBrandSchema.parse({});
    for (const key of Object.keys(out) as (keyof PlatformBrand)[]) {
        const field = platformBrandSchema.shape[key].safeParse(obj[key]);
        if (field.success) (out as Record<string, unknown>)[key] = field.data;
    }
    return out;
}

/** Todas las URLs de imagen que usa una marca (para borrar las que quedan sin uso). */
export function platformBrandImageUrls(brand: PlatformBrand): string[] {
    const urls: string[] = [];
    if (brand.logo_url) urls.push(brand.logo_url);
    if (brand.logo_dark_url) urls.push(brand.logo_dark_url);
    if (brand.icon_source_url) urls.push(brand.icon_source_url);
    if (brand.icons) urls.push(...Object.values(brand.icons).filter((u): u is string => typeof u === 'string'));
    return urls;
}

/**
 * v0.1.343 — El color de la pantalla con que abre la app instalada en
 * Android (el `background_color` del manifiesto) cuando el operador eligió
 * abrir con el color del ícono. null = el fondo de la app (blanco / #121212).
 */
export function iconSplashColor(brand: Pick<PlatformBrand, 'icon_design' | 'icons'>): string | null {
    const d = brand.icon_design;
    return d && brand.icons && d.splash === 'icon' ? d.bg_from.toLowerCase() : null;
}

/**
 * El fondo con que se pinta cada juego de íconos (claro y oscuro). En modo
 * automático es el `background_color` del manifiesto de cada tema.
 */
export function iconBackgrounds(brand: Pick<PlatformBrand, 'icon_background' | 'icon_background_auto'>): {
    light: string;
    dark: string;
} {
    return brand.icon_background_auto
        ? { light: APP_BAR_NEUTRAL.light, dark: APP_BAR_NEUTRAL.dark }
        : { light: brand.icon_background, dark: brand.icon_background };
}
