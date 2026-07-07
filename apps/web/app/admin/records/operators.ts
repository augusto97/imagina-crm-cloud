import { __ } from '@/lib/i18n';
import type { FieldTypeSlug } from '@/types/field';
import type { FilterOperator } from '@/types/record';

interface OperatorMeta {
    op: FilterOperator;
    label: string;
    /** El operador no requiere valor (is_null, is_not_null). */
    nullary?: boolean;
}

const TEXT_LIKE: OperatorMeta[] = [
    { op: 'contains', label: __('contiene') },
    { op: 'not_contains', label: __('no contiene') },
    { op: 'eq', label: __('es') },
    { op: 'neq', label: __('no es') },
    { op: 'starts_with', label: __('empieza con') },
    { op: 'ends_with', label: __('termina con') },
    { op: 'is_not_null', label: __('está establecido'), nullary: true },
    { op: 'is_null', label: __('no está establecido'), nullary: true },
];

const NUMERIC: OperatorMeta[] = [
    { op: 'eq', label: '=' },
    { op: 'neq', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
    { op: 'is_not_null', label: __('está establecido'), nullary: true },
    { op: 'is_null', label: __('no está establecido'), nullary: true },
];

const DATE_LIKE: OperatorMeta[] = [
    { op: 'eq', label: __('es') },
    { op: 'neq', label: __('no es') },
    { op: 'gte', label: __('desde') },
    { op: 'lte', label: __('hasta') },
    // Rango relativo dinámico: persiste el preset (this_month,
    // last_year, etc.) en lugar de fechas fijas. Imprescindible
    // para widgets de dashboard que tienen que seguir mostrando
    // "este mes" la próxima semana.
    { op: 'between_relative', label: __('en') },
    { op: 'is_not_null', label: __('está establecido'), nullary: true },
    { op: 'is_null', label: __('no está establecido'), nullary: true },
];

const SELECT_LIKE: OperatorMeta[] = [
    { op: 'eq', label: __('es') },
    { op: 'neq', label: __('no es') },
    { op: 'in', label: __('es alguno de') },
    { op: 'nin', label: __('no es ninguno de') },
    { op: 'is_not_null', label: __('está establecido'), nullary: true },
    { op: 'is_null', label: __('no está establecido'), nullary: true },
];

const ID_LIKE: OperatorMeta[] = [
    { op: 'eq', label: '=' },
    { op: 'neq', label: '≠' },
    { op: 'in', label: __('es alguno de') },
    { op: 'nin', label: __('no es ninguno de') },
    { op: 'is_not_null', label: __('está establecido'), nullary: true },
    { op: 'is_null', label: __('no está establecido'), nullary: true },
];

export function operatorsForType(type: FieldTypeSlug): OperatorMeta[] {
    switch (type) {
        case 'text':
        case 'long_text':
        case 'email':
        case 'url':
            return TEXT_LIKE;
        case 'number':
        case 'currency':
            return NUMERIC;
        case 'date':
        case 'datetime':
            return DATE_LIKE;
        case 'select':
        case 'multi_select':
            return SELECT_LIKE;
        case 'checkbox':
            return [{ op: 'eq', label: '=' }];
        case 'user':
        case 'file':
            return ID_LIKE;
        case 'relation':
            // No filtrable en MVP (CLAUDE.md §9.4 — relation vive en wp_imcrm_relations).
            return [];
        case 'computed':
            // No filtrable: no tiene columna SQL, su valor lo deriva
            // el backend en cada lectura. El QueryBuilder rechazaría
            // cualquier filtro contra este field por whitelist de
            // columnas físicas.
            return [];
    }
}

export function isNullaryOperator(op: FilterOperator): boolean {
    return op === 'is_null' || op === 'is_not_null';
}
