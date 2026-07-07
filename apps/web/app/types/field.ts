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
    | 'computed';

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
    column_name?: string;
}

export interface CreateFieldInput {
    label: string;
    type: FieldTypeSlug;
    slug?: string;
    config?: Record<string, unknown>;
    is_required?: boolean;
    is_unique?: boolean;
    is_primary?: boolean;
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
    is_indexed?: boolean;
    position?: number;
}
