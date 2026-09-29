import { z } from 'zod';
import { idSchema } from './common';

/**
 * Sincronización con tiendas (v0.1.206, ADR-S24) — hoy WooCommerce.
 *
 * v0.1.213 — la tienda se trae a TRES listas: Clientes, Productos (cada
 * variación es una SUBTAREA de su producto) y Pedidos (cada línea es una
 * SUBTAREA de su pedido). Lo que la persona pregunta —"cuánto me compró este
 * cliente", "cuánto vendió este producto"— sale de rollups sobre esas
 * relaciones, no de un reporte de la tienda: así se puede filtrar, agrupar y
 * graficar como cualquier otro dato de la app.
 */

/**
 * Lo que se sincroniza. `variations` y `line_items` siguen siendo recursos
 * propios (tienen su id en la tienda y su progreso), pero viven en la lista
 * de su padre: las variaciones en Productos y las líneas en Pedidos.
 */
export const STORE_SYNC_RESOURCES = ['customers', 'products', 'variations', 'orders', 'line_items'] as const;
export const storeSyncResourceSchema = z.enum(STORE_SYNC_RESOURCES);
export type StoreSyncResource = z.infer<typeof storeSyncResourceSchema>;

export const STORE_SYNC_RESOURCE_LABEL: Record<StoreSyncResource, string> = {
    customers: 'Clientes',
    products: 'Productos',
    variations: 'Variaciones',
    orders: 'Pedidos',
    line_items: 'Líneas de pedido',
};

/** Los que traen `meta_data` (campos de otros plugins) que se pueden mapear. */
export const STORE_META_RESOURCES = ['customers', 'products', 'variations', 'orders'] as const;
export const storeMetaResourceSchema = z.enum(STORE_META_RESOURCES);
export type StoreMetaResource = z.infer<typeof storeMetaResourceSchema>;

/**
 * Cómo se mantiene al día:
 *  - `interval`: la app pregunta a la tienda cada N minutos qué cambió.
 *  - `realtime`: la tienda AVISA al instante (webhooks, fase 3) y, por las
 *    dudas, igual se pregunta cada hora (un aviso perdido no deja un hueco).
 */
export const STORE_SYNC_MODES = ['interval', 'realtime'] as const;
export const storeSyncModeSchema = z.enum(STORE_SYNC_MODES);
export type StoreSyncMode = z.infer<typeof storeSyncModeSchema>;

export const STORE_SYNC_INTERVALS = [5, 15, 30, 60, 180, 360, 1440] as const;
export const storeSyncIntervalSchema = z
    .number()
    .int()
    .refine((n) => (STORE_SYNC_INTERVALS as readonly number[]).includes(n), 'Intervalo no disponible');

export const setupStoreSyncSchema = z.object({
    resources: z
        .object({
            customers: z.boolean().default(true),
            products: z.boolean().default(true),
            orders: z.boolean().default(true),
        })
        .default({}),
    /** Pedidos creados desde esta fecha (AAAA-MM-DD). null = todo el histórico. */
    orders_since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
    mode: storeSyncModeSchema.default('interval'),
    interval_minutes: storeSyncIntervalSchema.default(15),
});
export type SetupStoreSyncInput = z.infer<typeof setupStoreSyncSchema>;

export const updateStoreSyncSchema = z.object({
    mode: storeSyncModeSchema.optional(),
    interval_minutes: storeSyncIntervalSchema.optional(),
    enabled: z.boolean().optional(),
    /** Fase 3: los cambios hechos en la app viajan a la tienda. */
    write_back: z.boolean().optional(),
});
export type UpdateStoreSyncInput = z.infer<typeof updateStoreSyncSchema>;

/**
 * Qué columnas se pueden editar en la app y viajan a la tienda (v0.1.213:
 * PRECIOS, STOCK y ESTADOS — y nada más). Todo lo demás se edita en
 * WooCommerce: el nombre, el SKU, las imágenes, el tipo de producto, las
 * variaciones, los datos del cliente. Lo que se puede cambiar además depende
 * de la FILA (un producto con variaciones no tiene precio propio): esas
 * reglas viven en `store-rules.ts`, compartidas por el backend (que rechaza)
 * y la interfaz (que bloquea la celda y dice por qué).
 */
export const STORE_WRITE_BACK_FIELDS: Record<StoreMetaResource, Array<{ slug: string; label: string }>> = {
    products: [
        { slug: 'precio_normal', label: 'Precio normal' },
        { slug: 'precio_rebajado', label: 'Precio rebajado' },
        { slug: 'stock', label: 'Stock' },
        { slug: 'controla_stock', label: 'Controla stock' },
        { slug: 'estado_stock', label: 'Estado del stock' },
        { slug: 'umbral_stock', label: 'Alerta de stock bajo' },
        { slug: 'estado', label: 'Publicación' },
    ],
    variations: [
        { slug: 'precio_normal', label: 'Precio normal' },
        { slug: 'precio_rebajado', label: 'Precio rebajado' },
        { slug: 'stock', label: 'Stock' },
        { slug: 'controla_stock', label: 'Controla stock' },
        { slug: 'estado_stock', label: 'Estado del stock' },
        { slug: 'umbral_stock', label: 'Alerta de stock bajo' },
        { slug: 'estado', label: 'Publicación' },
    ],
    orders: [{ slug: 'estado', label: 'Estado' }],
    customers: [],
};

export const runStoreSyncSchema = z.object({
    /** true = vuelve a recorrer TODO (no sólo lo que cambió). */
    full: z.boolean().default(false),
});
export type RunStoreSyncInput = z.infer<typeof runStoreSyncSchema>;

/** Tipos en los que se puede recibir un campo de otro plugin. */
export const STORE_META_FIELD_TYPES = ['text', 'long_text', 'number', 'date', 'checkbox', 'url'] as const;

export const mapStoreMetaSchema = z.object({
    resource: storeMetaResourceSchema,
    key: z.string().min(1).max(190),
    label: z.string().trim().min(1).max(190),
    type: z.enum(STORE_META_FIELD_TYPES).optional(),
});
export type MapStoreMetaInput = z.infer<typeof mapStoreMetaSchema>;

export const unmapStoreMetaSchema = z.object({
    resource: storeMetaResourceSchema,
    key: z.string().min(1).max(190),
});
export type UnmapStoreMetaInput = z.infer<typeof unmapStoreMetaSchema>;

const listRefSchema = z.object({ id: idSchema, slug: z.string(), name: z.string() }).nullable();

/**
 * Marca que el pack deja en `lists.settings.store_sync` de cada lista de la
 * tienda (v0.1.209; v0.1.213 lleva además QUÉ columnas son de la tienda).
 * Con ella el backend rechaza lo que WooCommerce no permitiría (crear o
 * borrar registros, editar una columna de sólo lectura) y la interfaz lo
 * muestra antes de que alguien lo intente. NO viaja al duplicar una lista ni
 * en una plantilla (la copia no es de la tienda).
 */
export const STORE_LIST_ROLES = ['customers', 'products', 'orders'] as const;
export type StoreListRole = (typeof STORE_LIST_ROLES)[number];
export const storeListMarkerSchema = z.object({
    connection_id: idSchema,
    role: z.enum(STORE_LIST_ROLES),
    store_name: z.string().default(''),
    /** Dirección de la tienda (para «Crear en WooCommerce»). */
    store_url: z.string().default(''),
    /** «Editar desde la app» activado: sin eso, TODA columna de la tienda es de sólo lectura. */
    write_back: z.boolean().default(false),
    /** slug del pack → id del campo: las columnas que son de la tienda. */
    fields: z.record(z.string(), idSchema).default({}),
    /** Campos de otros plugins traídos a columnas (también de la tienda, de sólo lectura). */
    meta_fields: z.array(idSchema).default([]),
});
export type StoreListMarker = z.infer<typeof storeListMarkerSchema>;

/** Lectura tolerante del marcador (un settings viejo o ajeno no rompe la UI). */
export function readStoreListMarker(settings: unknown): StoreListMarker | null {
    const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).store_sync : null;
    const parsed = storeListMarkerSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

export const storeMetaKeySchema = z.object({
    key: z.string(),
    /** En cuántos registros apareció (en lo que lleva visto la sincronización). */
    count: z.number().int().nonnegative(),
    sample: z.string().nullable(),
    /** Tipo sugerido según los valores vistos. */
    suggested_type: z.enum(STORE_META_FIELD_TYPES),
    /** Empieza con `_`: casi siempre interno del plugin (se muestra plegado). */
    private: z.boolean(),
    /** Si ya se trae a un campo, cuál. */
    field_id: idSchema.nullable(),
});
export type StoreMetaKey = z.infer<typeof storeMetaKeySchema>;

export const storeSyncResourceStateSchema = z.object({
    /** Registros vinculados hoy en la app. */
    count: z.number().int().nonnegative(),
    /** Durante una corrida: cuántos lleva y cuántos hay (si la tienda lo dijo). */
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
});

export const storeSyncStatusSchema = z.object({
    configured: z.boolean(),
    connection_id: idSchema,
    store_name: z.string(),
    enabled: z.boolean(),
    mode: storeSyncModeSchema,
    interval_minutes: z.number().int(),
    write_back: z.boolean(),
    orders_since: z.string().nullable(),
    resources: z.object({ customers: z.boolean(), products: z.boolean(), orders: z.boolean() }),
    lists: z.record(storeSyncResourceSchema, listRefSchema),
    dashboard_id: idSchema.nullable(),
    /** v0.1.208 — tablero de inventario. */
    inventory_dashboard_id: idSchema.nullable().default(null),
    folder_id: idSchema.nullable(),
    running: z.boolean(),
    /** Qué está haciendo ahora («Trayendo pedidos…»). */
    current: storeSyncResourceSchema.nullable(),
    progress: z.record(storeSyncResourceSchema, storeSyncResourceStateSchema),
    initial_done: z.boolean(),
    last_run_at: z.string().nullable(),
    last_success_at: z.string().nullable(),
    next_run_at: z.string().nullable(),
    last_error: z.string().nullable(),
    /** Avisos no bloqueantes de la última corrida (valores que no se pudieron guardar). */
    warnings: z.array(z.string()),
    meta_keys: z.record(storeMetaResourceSchema, z.array(storeMetaKeySchema)),
    /** Fase 3: tiempo real. */
    realtime: z.object({
        active: z.boolean(),
        /** Avisos recibidos de la tienda. */
        received: z.number().int().nonnegative(),
        last_received_at: z.string().nullable(),
        error: z.string().nullable(),
        /** Cuántos avisos quedaron registrados en la tienda (uno por tema). */
        webhooks: z.number().int().nonnegative().default(0),
    }),
    /** Fase 3: lo editado en la app que viajó (o no) a la tienda. */
    write_back_status: z
        .object({
            pushed: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            last_at: z.string().nullable(),
            last_error: z.string().nullable(),
        })
        .default({ pushed: 0, failed: 0, last_at: null, last_error: null }),
});
export type StoreSyncStatus = z.infer<typeof storeSyncStatusSchema>;
