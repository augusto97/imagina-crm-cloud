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
    /** Descripción corta para el catálogo visual (modal de creación
     *  de campos estilo ClickUp). */
    description: string;
    supportsUnique: boolean;
}

// Orden pensado para el dropdown: primero los más usados.
const ENTRIES: CatalogEntry[] = [
    { slug: 'text', label: 'Texto', description: 'Una línea de texto corto.', supportsUnique: true },
    { slug: 'long_text', label: 'Texto largo', description: 'Párrafos de texto sin límite.', supportsUnique: true },
    { slug: 'number', label: 'Número', description: 'Valor numérico con decimales configurables.', supportsUnique: true },
    { slug: 'currency', label: 'Moneda', description: 'Importe monetario con moneda y decimales.', supportsUnique: true },
    { slug: 'select', label: 'Selección', description: 'Una opción de una lista predefinida.', supportsUnique: false },
    { slug: 'multi_select', label: 'Selección múltiple', description: 'Varias opciones de una lista predefinida.', supportsUnique: false },
    { slug: 'date', label: 'Fecha', description: 'Una fecha del calendario.', supportsUnique: true },
    { slug: 'datetime', label: 'Fecha y hora', description: 'Fecha del calendario con hora.', supportsUnique: true },
    { slug: 'checkbox', label: 'Casilla', description: 'Sí o no (marcado / sin marcar).', supportsUnique: false },
    { slug: 'email', label: 'Email', description: 'Dirección de correo validada.', supportsUnique: true },
    { slug: 'url', label: 'URL', description: 'Enlace web validado.', supportsUnique: true },
    { slug: 'user', label: 'Usuario', description: 'Un miembro del workspace.', supportsUnique: false },
    { slug: 'relation', label: 'Relación', description: 'Vincula registros de otra lista.', supportsUnique: false },
    { slug: 'file', label: 'Archivo', description: 'Archivos adjuntos al registro.', supportsUnique: false },
    { slug: 'computed', label: 'Calculado', description: 'Se calcula a partir de otros campos.', supportsUnique: false },
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

/**
 * Shape para catálogos VISUALES de tipos (grid con icono + label +
 * descripción — modal de creación de campos). Deriva de las mismas
 * ENTRIES que `FIELD_TYPE_CATALOG` para que ambas superficies (List
 * Builder y modal de la tabla) siempre listen los mismos tipos.
 */
export interface FieldTypeOption {
    type: FieldTypeSlug;
    label: string;
    description: string;
}

export const FIELD_TYPE_OPTIONS: FieldTypeOption[] = ENTRIES.map((e) => ({
    type: e.slug,
    label: e.label,
    description: e.description,
}));
