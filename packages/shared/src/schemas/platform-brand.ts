import { z } from 'zod';
import { hexColorSchema } from './tenant';

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

/** URL de una imagen subida a la marca de la plataforma. */
export const PLATFORM_BRAND_IMAGE_RE = /^\/api\/v1\/public\/brand\/images\/[a-f0-9]{32}\.png$/;
const brandImageUrl = z.string().regex(PLATFORM_BRAND_IMAGE_RE, 'Imagen de marca inválida');

/** Tamaños del ícono que arma el navegador del operador al subirlo. */
export const PLATFORM_ICON_SIZES = {
    icon_192: { size: 192, maskable: false },
    icon_512: { size: 512, maskable: false },
    maskable_192: { size: 192, maskable: true },
    maskable_512: { size: 512, maskable: true },
    apple_180: { size: 180, maskable: true },
    icon_96: { size: 96, maskable: false },
    favicon_32: { size: 32, maskable: false },
} as const;
export type PlatformIconKey = keyof typeof PLATFORM_ICON_SIZES;
export const PLATFORM_ICON_KEYS = Object.keys(PLATFORM_ICON_SIZES) as PlatformIconKey[];

export const platformIconSetSchema = z.object(
    Object.fromEntries(PLATFORM_ICON_KEYS.map((k) => [k, brandImageUrl])) as Record<PlatformIconKey, typeof brandImageUrl>,
);
export type PlatformIconSet = z.infer<typeof platformIconSetSchema>;

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
    if (brand.icons) urls.push(...Object.values(brand.icons));
    return urls;
}
