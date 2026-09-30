import { z } from 'zod';
import { idSchema, isoDateSchema } from './common';
import { filterTreeSchema } from './filter';

/**
 * Edición masiva DE LA TIENDA (v0.1.217, ADR-S24). La edición masiva común
 * (ADR-S25) cambia columnas de la app; ésta cambia PRODUCTOS de WooCommerce
 * —incluidos los datos que la app no guarda como columna: atributos,
 * visibilidad, destacado, envío, impuestos, reservas, rebajas programadas— y
 * lo hace con la API por lotes de la tienda (`/products/batch`, 100 por
 * pedido), partiendo de lo que la tienda tiene EN ESE MOMENTO (no del espejo).
 *
 * Los productos con variaciones se editan por variación: «subir 10 % el
 * precio» de una camiseta sube el de cada talla (el producto variable no
 * tiene precio propio).
 */

/** Cuántos registros de la app se mandan por pedido de «aplicar». */
export const STORE_BULK_APPLY_CHUNK = 25;
export const STORE_BULK_MAX_TARGET = 5000;

const roundSchema = z.object({
    multiple: z.number().positive().finite(),
    mode: z.enum(['nearest', 'up', 'down']).default('up'),
    adjust: z.number().finite().default(0),
});

const numChangeSchema = z.object({
    kind: z.enum(['set', 'add', 'subtract', 'percent']),
    /** En `percent`, +10 sube 10 % y −15 baja 15 %. */
    amount: z.number().finite(),
    round: roundSchema.optional(),
});

const salePriceChangeSchema = z.object({
    /**
     * `percent_off`: el rebajado es el normal con un descuento («20 % off»).
     * `clear`: sin rebaja.
     */
    kind: z.enum(['set', 'add', 'subtract', 'percent', 'percent_off', 'clear']),
    amount: z.number().finite().default(0),
    round: roundSchema.optional(),
});

const termsSchema = z.object({
    mode: z.enum(['add', 'remove', 'replace']),
    /** Slugs (los valores de las opciones de la columna) o nombres nuevos. */
    values: z.array(z.string().trim().min(1).max(190)).max(100),
});

export const STORE_PRODUCT_STATUSES = ['publish', 'draft', 'pending', 'private'] as const;
export const STORE_CATALOG_VISIBILITY = ['visible', 'catalog', 'search', 'hidden'] as const;
export const STORE_STOCK_STATUSES = ['instock', 'outofstock', 'onbackorder'] as const;
export const STORE_BACKORDERS = ['no', 'notify', 'yes'] as const;
export const STORE_TAX_STATUSES = ['taxable', 'shipping', 'none'] as const;

export const storeBulkOperationSchema = z.discriminatedUnion('op', [
    // Precios
    z.object({ op: z.literal('regular_price'), change: numChangeSchema }),
    z.object({ op: z.literal('sale_price'), change: salePriceChangeSchema }),
    z.object({ op: z.literal('sale_dates'), from: isoDateSchema.nullable(), to: isoDateSchema.nullable() }),
    /**
     * v0.1.223 — Precio A PARTIR DE UNA COLUMNA de la app (típicamente el
     * costo, una columna propia «sólo en Imagina»): `valor × factor + suma`,
     * con redondeo opcional. En un producto con variaciones se usa la columna
     * de CADA variación (cada talla puede costar distinto).
     */
    z.object({
        op: z.literal('price_from_field'),
        price: z.enum(['regular', 'sale']).default('regular'),
        field_id: idSchema,
        factor: z.number().positive().finite().default(1),
        add: z.number().finite().default(0),
        round: roundSchema.optional(),
    }),
    // Inventario
    z.object({ op: z.literal('stock'), kind: z.enum(['set', 'add', 'subtract']), amount: z.number().int().min(-1_000_000).max(1_000_000) }),
    z.object({ op: z.literal('manage_stock'), value: z.boolean() }),
    z.object({ op: z.literal('stock_status'), value: z.enum(STORE_STOCK_STATUSES) }),
    z.object({ op: z.literal('backorders'), value: z.enum(STORE_BACKORDERS) }),
    z.object({ op: z.literal('low_stock'), value: z.number().int().min(0).max(1_000_000).nullable() }),
    // Publicación
    z.object({ op: z.literal('status'), value: z.enum(STORE_PRODUCT_STATUSES) }),
    z.object({ op: z.literal('catalog_visibility'), value: z.enum(STORE_CATALOG_VISIBILITY) }),
    z.object({ op: z.literal('featured'), value: z.boolean() }),
    // Organización
    z.object({ op: z.literal('categories'), ...termsSchema.shape }),
    z.object({ op: z.literal('tags'), ...termsSchema.shape }),
    z.object({
        op: z.literal('attribute'),
        mode: z.enum(['add', 'replace', 'remove']),
        /** `id` de un atributo global de la tienda (Color, Talla…) o sólo `name` para uno propio del producto. */
        attribute: z.object({ id: z.number().int().nonnegative().default(0), name: z.string().trim().min(1).max(190) }),
        options: z.array(z.string().trim().min(1).max(190)).max(100).default([]),
        visible: z.boolean().default(true),
    }),
    // Envío e impuestos
    z.object({ op: z.literal('weight'), value: z.number().nonnegative().finite().nullable() }),
    z.object({
        op: z.literal('dimensions'),
        length: z.number().nonnegative().finite().nullable().optional(),
        width: z.number().nonnegative().finite().nullable().optional(),
        height: z.number().nonnegative().finite().nullable().optional(),
    }),
    z.object({ op: z.literal('shipping_class'), value: z.string().max(190) }),
    z.object({ op: z.literal('tax_status'), value: z.enum(STORE_TAX_STATUSES) }),
    z.object({ op: z.literal('tax_class'), value: z.string().max(190) }),
    // Textos
    z.object({
        op: z.literal('name'),
        kind: z.enum(['prepend', 'append', 'replace']),
        text: z.string().max(400).default(''),
        find: z.string().max(400).default(''),
    }),
    // Campos de otros plugins (meta_data): `null` lo borra.
    z.object({ op: z.literal('meta'), key: z.string().trim().min(1).max(190), value: z.string().max(4000).nullable() }),
]);
export type StoreBulkOperation = z.infer<typeof storeBulkOperationSchema>;
export type StoreBulkOperationInput = z.input<typeof storeBulkOperationSchema>;
export type StoreBulkOpKind = StoreBulkOperation['op'];

const opsSchema = z.array(storeBulkOperationSchema).min(1).max(15);

export const storeBulkTargetSchema = z.union([
    z.object({ ids: z.array(idSchema).min(1).max(STORE_BULK_MAX_TARGET) }).strict(),
    z.object({ filter_tree: filterTreeSchema.optional(), search: z.string().trim().max(200).optional() }).strict(),
]);
export type StoreBulkTarget = z.infer<typeof storeBulkTargetSchema>;

export const storeBulkPreviewSchema = z.object({
    target: storeBulkTargetSchema,
    operations: opsSchema,
    /** Los productos con variaciones se editan en cada variación. */
    include_variations: z.boolean().default(true),
});
export type StoreBulkPreviewInput = z.infer<typeof storeBulkPreviewSchema>;

export const storeBulkApplySchema = z.object({
    ids: z.array(idSchema).min(1).max(STORE_BULK_APPLY_CHUNK),
    operations: opsSchema,
    include_variations: z.boolean().default(true),
    /** v0.1.218 — La edición del historial (la primera tanda no lo manda). */
    edit_id: idSchema.optional(),
});
export type StoreBulkApplyInput = z.infer<typeof storeBulkApplySchema>;

export interface StoreBulkChange {
    label: string;
    before: string;
    after: string;
}

export interface StoreBulkPreview {
    /** Registros de la app abarcados (los que se aplican, en tandas). */
    record_ids: number[];
    products: number;
    variations: number;
    sample: Array<{ title: string; kind: 'product' | 'variation'; changes: StoreBulkChange[]; notes: string[] }>;
    /** Cuántos de la muestra no cambian nada (ya estaban así o no aplica). */
    sample_unchanged: number;
    warnings: string[];
}

export interface StoreBulkResult {
    updated: number;
    unchanged: number;
    failed: Array<{ title: string; message: string }>;
    skipped: Array<{ title: string; reason: string }>;
    /** La edición del historial (v0.1.218), para las tandas siguientes y para deshacer. */
    edit_id: number | null;
}

export interface StoreBulkCatalog {
    categories: Array<{ slug: string; name: string }>;
    tags: Array<{ slug: string; name: string }>;
    attributes: Array<{ id: number; name: string; slug: string }>;
    shipping_classes: Array<{ slug: string; name: string }>;
    tax_classes: Array<{ slug: string; name: string }>;
    /** Decimales de la moneda de la tienda (para redondear precios). */
    price_decimals: number;
    currency: string;
}

// ── Crear variaciones en lote (v0.1.223) ───────────────────────────────────

/** Tope de variaciones nuevas por producto (combinaciones de atributos). */
export const STORE_VARIATIONS_MAX_PER_PRODUCT = 100;

export const storeVariationAttributeSchema = z.object({
    /** Atributo global de la tienda (Color, Talla…); `0` = propio del producto (por nombre). */
    id: z.number().int().nonnegative().default(0),
    name: z.string().trim().min(1).max(190),
    /** Los valores (nombres de los términos) que se combinan. */
    options: z.array(z.string().trim().min(1).max(190)).min(1).max(50),
});
export type StoreVariationAttribute = z.infer<typeof storeVariationAttributeSchema>;

const variationsSpec = {
    attributes: z.array(storeVariationAttributeSchema).min(1).max(3),
    /** Precio normal de las variaciones nuevas (null = sin precio: quedan sin publicar en la tienda). */
    regular_price: z.number().nonnegative().finite().nullable().default(null),
    /** Stock inicial (activa «controlar stock» en la variación); null = no se controla. */
    stock: z.number().int().min(0).max(1_000_000).nullable().default(null),
    status: z.enum(['publish', 'private']).default('publish'),
};

export const storeVariationsPreviewSchema = z.object({ target: storeBulkTargetSchema, ...variationsSpec });
export type StoreVariationsPreviewInput = z.infer<typeof storeVariationsPreviewSchema>;

export const storeVariationsApplySchema = z.object({
    ids: z.array(idSchema).min(1).max(STORE_BULK_APPLY_CHUNK),
    ...variationsSpec,
    edit_id: idSchema.optional(),
});
export type StoreVariationsApplyInput = z.infer<typeof storeVariationsApplySchema>;

export interface StoreVariationsPreview {
    record_ids: number[];
    /** Productos variables abarcados (los únicos que reciben variaciones). */
    products: number;
    /** Variaciones que se van a crear en total. */
    to_create: number;
    /** Combinaciones que ya existían (se saltean). */
    existing: number;
    sample: Array<{ title: string; create: string[]; existing: number; notes: string[] }>;
    warnings: string[];
}

export interface StoreVariationsResult {
    created: number;
    skipped: Array<{ title: string; reason: string }>;
    failed: Array<{ title: string; message: string }>;
    edit_id: number | null;
}

/**
 * Todas las combinaciones de los valores de los atributos, en orden
 * (Rojo/S, Rojo/M, Azul/S…). PURO: lo usan la vista previa y la creación.
 */
export function variationCombos(attrs: readonly StoreVariationAttribute[]): Array<Array<{ id: number; name: string; option: string }>> {
    let out: Array<Array<{ id: number; name: string; option: string }>> = [[]];
    for (const a of attrs) {
        const opts = [...new Set(a.options)];
        out = out.flatMap((combo) => opts.map((option) => [...combo, { id: a.id, name: a.name, option }]));
    }
    return out.filter((c) => c.length > 0);
}
