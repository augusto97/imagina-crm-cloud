export type FieldTypeSlug =
    | 'text'
    | 'long_text'
    | 'number'
    | 'currency'
    | 'select'
    | 'multi_select'
    | 'date'
    | 'datetime'
    | 'checkbox'
    | 'url'
    | 'email'
    | 'user'
    | 'relation'
    | 'file'
    | 'computed'
    | 'phone'
    | 'rating'
    | 'percent'
    | 'duration'
    // v0.1.170 — a través de una relación (lookup / rollup, ADR-S19).
    | 'lookup'
    | 'rollup'
    // v0.1.277 — campo con IA (ADR-S41).
    | 'ai'
    // v0.1.291 — tiempo registrado (suma de las entradas de tiempo, minutos).
    | 'time_tracked'
    // v0.1.300 — ID automático y columnas de sistema.
    | 'autonumber'
    | 'created_at'
    | 'updated_at'
    | 'created_by'
    | 'updated_by'
    // Campo «Botón» (A5): acciones al presionarlo, sin valor.
    | 'button'
    // Fórmulas (A1): se calcula sola con una fórmula en español.
    | 'formula'
    // C5 — estado de la última solicitud de aprobación (derivado, sólo lectura).
    | 'approval'
    // A9 — progreso de los checklists del registro (0-100, sólo lectura).
    | 'checklist_progress'
    // Equipos (C1): uno o varios equipos del workspace (ids).
    | 'team';

/**
 * Relación RESUELTA de un lookup/rollup (v0.1.170). La deriva el backend
 * en cada listado de campos: dirección, lista del otro lado y el campo
 * destino con su config — lo que hace falta para formatear el valor
 * (moneda, opciones con color, fecha) sin otra request. `null` si la
 * config apunta a algo que ya no existe.
 */
export interface ThroughInfo {
    direction: 'forward' | 'reverse';
    relation_label: string;
    other_list_id: number;
    other_list_name: string;
    target_field: {
        id: number;
        label: string;
        type: FieldTypeSlug;
        config: Record<string, unknown>;
    } | null;
}

export interface FieldTypeMeta {
    slug: FieldTypeSlug;
    label: string;
    has_column: boolean;
    supports_unique: boolean;
    config_schema: Record<string, Record<string, unknown>>;
}

export interface FieldEntity {
    id: number;
    list_id: number;
    slug: string;
    label: string;
    type: FieldTypeSlug;
    config: Record<string, unknown>;
    is_required: boolean;
    is_unique: boolean;
    is_primary: boolean;
    /**
     * Toggle opt-in para crear un índice MySQL no-único sobre la
     * columna del field — acelera filtros y sort al pasar de
     * table-scan a index-seek. Tradeoff: cuesta storage (~10% de la
     * tabla) y lentifica writes ~5%. Por eso es opt-in.
     */
    is_indexed: boolean;
    position: number;
    created_at: string;
    updated_at: string;
    /** Ayuda para el equipo (v0.1.163): "cómo se usa este campo". */
    description?: string | null;
    column_name?: string;
    /** Sólo lookup/rollup (v0.1.170). */
    through?: ThroughInfo | null;
    /**
     * Sólo fórmulas (A1): la fórmula por nombre, el tipo del resultado, cómo
     * se muestra y si el servidor la puede filtrar/ordenar/sumar (y si no, por
     * qué). Lo deriva el backend en cada listado de campos.
     */
    formula?: FormulaInfo | null;
}

export interface FormulaInfo {
    /** La fórmula como se escribe (por nombre). */
    display: string;
    /** Cómo se muestra: el elegido o el inferido. */
    result_type: 'number' | 'currency' | 'percent' | 'duration' | 'text' | 'date' | 'datetime' | 'checkbox';
    inferred_type: FormulaInfo['result_type'];
    /** Config del tipo del resultado (moneda y decimales). */
    display_config: Record<string, unknown>;
    /** ¿El servidor la compila a SQL (filtrar, ordenar, agrupar, sumar)? */
    sql: boolean;
    /** Por qué no compila (para explicarlo donde no se ofrece). */
    sql_reason: string | null;
    /** La fórmula no se puede calcular (campo borrado, ciclo…). */
    error: string | null;
    /** Ids de los campos que usa. */
    dependencies: number[];
}

export interface CreateFieldInput {
    label: string;
    type: FieldTypeSlug;
    slug?: string;
    config?: Record<string, unknown>;
    is_required?: boolean;
    is_unique?: boolean;
    is_primary?: boolean;
    description?: string | null;
    is_indexed?: boolean;
    position?: number;
}

export interface UpdateFieldInput {
    label?: string;
    slug?: string;
    /**
     * Cambio de tipo. Solo se envía cuando difiere del tipo actual del
     * campo. El backend (FieldService::changeType) valida que la
     * transición esté permitida en `FieldTypeMigration::MATRIX` y
     * migra los valores existentes — `app/lib/fieldTypeMigration.ts`
     * mantiene un mirror del matrix para filtrar el dropdown del editor.
     */
    type?: FieldTypeSlug;
    config?: Record<string, unknown>;
    is_required?: boolean;
    is_unique?: boolean;
    is_primary?: boolean;
    description?: string | null;
    is_indexed?: boolean;
    position?: number;
}
