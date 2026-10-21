import {
    evaluateFilterCondition,
    FALLBACK_TIME_ZONE,
    type ViewColorRule,
    type ViewRowColor,
} from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * v0.1.287 — Colores condicionales de la tabla: reglas por vista que pintan
 * la FILA entera o la CELDA de una columna cuando el registro cumple una
 * condición (los mismos operadores que los filtros). La condición se evalúa
 * en el navegador con el evaluador COMPARTIDO (`evaluateFilterCondition`, el
 * mismo de las automatizaciones), así «es», «contiene» o «hoy» significan lo
 * mismo que en el filtro — y las fechas relativas se cuentan en el reloj de
 * la empresa (ADR-S33).
 */

/** La paleta: un color base por clave; la tabla lo mezcla con el fondo del tema. */
export const ROW_COLOR_HEX: Record<ViewRowColor, string> = {
    red: '#ef4444',
    orange: '#f97316',
    amber: '#f59e0b',
    yellow: '#eab308',
    green: '#22c55e',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    blue: '#3b82f6',
    violet: '#8b5cf6',
    pink: '#ec4899',
    gray: '#6b7280',
};

export const ROW_COLOR_LABEL: Record<ViewRowColor, string> = {
    red: __('Rojo'),
    orange: __('Naranja'),
    amber: __('Ámbar'),
    yellow: __('Amarillo'),
    green: __('Verde'),
    teal: __('Verde azulado'),
    cyan: __('Cian'),
    blue: __('Azul'),
    violet: __('Violeta'),
    pink: __('Rosa'),
    gray: __('Gris'),
};

/** Qué color lleva una fila: el de la fila y el de cada celda pintada (field_id → color). */
export interface RowColors {
    row: ViewRowColor | null;
    cells: Map<number, ViewRowColor>;
}

const NONE: RowColors = { row: null, cells: new Map() };

/**
 * Los colores de UNA fila: gana la PRIMERA regla activa que se cumple, por
 * destino (una regla de fila y otra de celda pueden convivir; dos de celda
 * sobre la misma columna, gana la de arriba). Una condición que no aplica
 * (campo borrado, operador que el tipo no admite) no pinta.
 */
export function evaluateRowColors(
    rules: readonly ViewColorRule[],
    record: RecordEntity,
    fieldsById: ReadonlyMap<number, FieldEntity>,
    opts: { timeZone?: string | null; now?: Date } = {},
): RowColors {
    if (rules.length === 0) return NONE;
    const clock = { timeZone: opts.timeZone ?? FALLBACK_TIME_ZONE, now: opts.now ?? new Date() };
    let row: ViewRowColor | null = null;
    const cells = new Map<number, ViewRowColor>();
    for (const rule of rules) {
        if (!rule.enabled) continue;
        const target = rule.target === 'cell' ? rule.cell_field_id ?? rule.condition.field_id : null;
        if (target === null && row !== null) continue;
        if (target !== null && cells.has(target)) continue;
        const field = fieldsById.get(rule.condition.field_id);
        if (!field) continue;
        const value = field.type === 'relation' ? record.relations?.[field.slug] ?? [] : record.fields[field.slug];
        const hit = evaluateFilterCondition(rule.condition, { type: field.type, value }, clock);
        if (hit !== true) continue;
        if (target === null) row = rule.color;
        else cells.set(target, rule.color);
    }
    return row === null && cells.size === 0 ? NONE : { row, cells };
}

/** Las reglas que se pueden evaluar (activas y con un campo que existe). */
export function activeColorRules(rules: readonly ViewColorRule[] | undefined, fieldsById: ReadonlyMap<number, FieldEntity>): ViewColorRule[] {
    return (rules ?? []).filter((r) => r.enabled && fieldsById.has(r.condition.field_id));
}

/** Estilo de una fila pintada (variable CSS que leen las celdas, ver globals.css). */
export function rowTintStyle(color: ViewRowColor | null): React.CSSProperties | undefined {
    return color ? ({ ['--imcrm-row-color' as string]: ROW_COLOR_HEX[color] } as React.CSSProperties) : undefined;
}

/** Estilo de una celda pintada. */
export function cellTintStyle(color: ViewRowColor | undefined): React.CSSProperties | undefined {
    return color ? ({ ['--imcrm-cell-color' as string]: ROW_COLOR_HEX[color] } as React.CSSProperties) : undefined;
}

/** Un id nuevo para una regla. */
export function newColorRuleId(): string {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
