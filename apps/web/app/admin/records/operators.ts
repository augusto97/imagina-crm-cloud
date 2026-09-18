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

/**
 * v0.1.191 — multi_select con sus verbos: `eq` escalar compila a "contiene
 * la opción" (no a igualdad del set), así que decir "es" mentía.
 */
const MULTI_SELECT_LIKE: OperatorMeta[] = [
    { op: 'eq', label: __('incluye') },
    { op: 'neq', label: __('no incluye') },
    { op: 'in', label: __('incluye alguno de') },
    { op: 'nin', label: __('no incluye ninguno de') },
    { op: 'is_not_null', label: __('tiene opciones'), nullary: true },
    { op: 'is_null', label: __('sin opciones'), nullary: true },
];

const USER_LIKE: OperatorMeta[] = [
    { op: 'eq', label: __('es') },
    { op: 'neq', label: __('no es') },
    { op: 'in', label: __('es alguno de') },
    { op: 'nin', label: __('no es ninguno de') },
    { op: 'is_not_null', label: __('está asignado'), nullary: true },
    { op: 'is_null', label: __('sin asignar'), nullary: true },
];

/**
 * v0.1.191 — un campo de archivos guarda una LISTA de ids de adjuntos:
 * compararla con un número tipeado a mano nunca matcheaba nada. Lo único
 * que tiene sentido filtrar es si hay archivos o no.
 */
const FILE_LIKE: OperatorMeta[] = [
    { op: 'is_not_null', label: __('tiene archivos'), nullary: true },
    { op: 'is_null', label: __('sin archivos'), nullary: true },
];

export function operatorsForType(type: FieldTypeSlug): OperatorMeta[] {
    switch (type) {
        case 'text':
        case 'long_text':
        case 'email':
        case 'url':
        case 'phone':
            // v0.1.158 — el teléfono se guarda como texto canónico:
            // "empieza con +57" es justo lo que se filtra en un CRM.
            return TEXT_LIKE;
        case 'number':
        case 'currency':
        case 'rating':
        case 'percent':
        case 'duration':
            return NUMERIC;
        case 'date':
        case 'datetime':
            return DATE_LIKE;
        case 'select':
            return SELECT_LIKE;
        case 'multi_select':
            return MULTI_SELECT_LIKE;
        case 'checkbox':
            return [{ op: 'eq', label: __('es') }];
        case 'user':
            return USER_LIKE;
        case 'file':
            return FILE_LIKE;
        case 'relation':
            // No filtrable en MVP (CLAUDE.md §9.4 — relation vive en wp_imcrm_relations).
            return [];
        case 'computed':
            // No filtrable: no tiene columna SQL, su valor lo deriva
            // el backend en cada lectura. El QueryBuilder rechazaría
            // cualquier filtro contra este field por whitelist de
            // columnas físicas.
            return [];
        case 'lookup':
            // Un lookup es una lista de valores del otro lado: no se filtra
            // (filtrá por el campo original en la otra lista).
            return [];
        case 'rollup':
            // v0.1.170 — el backend compila el rollup a una subconsulta
            // correlacionada: "deuda > 0" funciona de verdad.
            return NUMERIC;
    }
}

export function isNullaryOperator(op: FilterOperator): boolean {
    return op === 'is_null' || op === 'is_not_null';
}
