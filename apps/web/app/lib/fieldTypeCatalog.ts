import type { FieldTypeMeta, FieldTypeSlug } from '@/types/field';

/**
 * Catálogo de los 14 tipos de campo (Imagina Base cloud).
 *
 * En el plugin este catálogo lo servía el endpoint WordPress `GET /field-types`
 * (SystemController → FieldTypeRegistry). En la app cloud ese endpoint nunca se
 * portó, así que el dropdown de tipos quedaba VACÍO y no se podía crear ningún
 * campo. Como es metadata estática de UI (no cambia por tenant), la resolvemos
 * en el cliente — sin round-trip ni riesgo de 404.
 *
 *  - `has_column`: el valor vive en la columna JSONB `data` (todos menos
 *    relation/computed, que son derivados/referencias — ver isDataField/
 *    NON_DATA_FIELD_TYPES en el backend).
 *  - `supports_unique`: el tipo admite restricción de unicidad (texto/números/
 *    fechas/url/email); no aplica a selección/casilla/usuario/relación/archivo/
 *    calculado.
 *  - `config_schema`: la UI de config (FieldConfigEditor) ramifica por `type`,
 *    no lee este objeto → se deja vacío por compatibilidad de shape.
 */

interface CatalogEntry {
    slug: FieldTypeSlug;
    label: string;
    supportsUnique: boolean;
}

// Orden pensado para el dropdown: primero los más usados.
const ENTRIES: CatalogEntry[] = [
    { slug: 'text', label: 'Texto', supportsUnique: true },
    { slug: 'long_text', label: 'Texto largo', supportsUnique: true },
    { slug: 'number', label: 'Número', supportsUnique: true },
    { slug: 'currency', label: 'Moneda', supportsUnique: true },
    { slug: 'select', label: 'Selección', supportsUnique: false },
    { slug: 'multi_select', label: 'Selección múltiple', supportsUnique: false },
    { slug: 'date', label: 'Fecha', supportsUnique: true },
    { slug: 'datetime', label: 'Fecha y hora', supportsUnique: true },
    { slug: 'checkbox', label: 'Casilla', supportsUnique: false },
    { slug: 'email', label: 'Email', supportsUnique: true },
    { slug: 'url', label: 'URL', supportsUnique: true },
    { slug: 'user', label: 'Usuario', supportsUnique: false },
    { slug: 'relation', label: 'Relación', supportsUnique: false },
    { slug: 'file', label: 'Archivo', supportsUnique: false },
    { slug: 'computed', label: 'Calculado', supportsUnique: false },
];

/** Tipos que NO viven en la columna de datos (referencias / derivados). */
const NON_DATA: ReadonlySet<FieldTypeSlug> = new Set<FieldTypeSlug>(['relation', 'computed']);

export const FIELD_TYPE_CATALOG: FieldTypeMeta[] = ENTRIES.map((e) => ({
    slug: e.slug,
    label: e.label,
    has_column: !NON_DATA.has(e.slug),
    supports_unique: e.supportsUnique,
    config_schema: {},
}));
