import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterOperator } from '@/types/record';

import { DateRangePresetButtons } from '@/admin/records/DateRangePresetButtons';
import {
    computePresetRange,
    type DateRangePresetId,
} from '@/admin/records/dateRangePresets';
import { FilterValueInput } from '@/admin/records/FilterValueInput';
import { isNullaryOperator, operatorsForType } from '@/admin/records/operators';

/**
 * Una condición individual con operador. Reemplaza al viejo shape
 * `{slug: value}` que solo soportaba `eq`. Persistida como array de
 * estos objetos, evaluada por `ConditionEvaluator::matches` en backend.
 */
export interface ConditionRule {
    slug: string;
    op: FilterOperator;
    value: unknown;
}

/**
 * Acepta cualquiera de los dos shapes legacy:
 *  - `{slug: value, ...}` (eq-only, automations <0.20).
 *  - `[{slug, op, value}, ...]` (rico, 0.20+).
 * Si viene undefined, lista vacía.
 */
export type ConditionValue =
    | ConditionRule[]
    | Record<string, unknown>
    | undefined
    | null;

export function rulesFromValue(value: ConditionValue): ConditionRule[] {
    if (Array.isArray(value)) {
        const out: ConditionRule[] = [];
        for (const r of value) {
            if (r === null || typeof r !== 'object') continue;
            const rec = r as unknown as Record<string, unknown>;
            const slug = String(rec.slug ?? rec.field ?? '');
            out.push({
                slug,
                op: (typeof rec.op === 'string' ? rec.op : 'eq') as FilterOperator,
                value: rec.value,
            });
        }
        return out;
    }
    if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).map(([slug, val]) => ({
            slug,
            op: 'eq' as FilterOperator,
            value: val,
        }));
    }
    return [];
}

interface ConditionEditorProps {
    listId?: number;
    value: ConditionValue;
    onChange: (next: ConditionRule[]) => void;
    fields: FieldEntity[];
    /** Texto del CTA "Añadir …" (default: "Añadir condición"). */
    addLabel?: string;
    /** Si true, muestra una nota explicativa arriba. */
    helperText?: string;
}

/**
 * Editor unificado de condiciones para automatizaciones (triggers,
 * actions, if_else). Cada fila tiene Campo / Operador / Valor y, para
 * campos de fecha, los chips de rangos rápidos (hoy, esta semana, etc.)
 * que generan un par `gte`+`lte`.
 *
 * Buffer local: filas con slug vacío persisten visualmente durante la
 * edición — sin esto "Añadir" parecía no hacer nada porque la fila
 * vacía se descartaba antes del re-render.
 */
export function ConditionEditor({
    listId,
    value,
    onChange,
    fields,
    addLabel,
    helperText,
}: ConditionEditorProps): JSX.Element {
    const [rows, setRows] = useState<ConditionRule[]>(() => rulesFromValue(value));

    const commit = (next: ConditionRule[]): void => {
        setRows(next);
        // Solo persistimos las filas con slug válido (descarta las
        // recién añadidas-en-progreso del buffer local).
        onChange(next.filter((r) => r.slug !== ''));
    };

    const updateRow = (idx: number, patch: Partial<ConditionRule>): void => {
        const next = [...rows];
        next[idx] = { ...next[idx]!, ...patch };
        commit(next);
    };

    const removeRow = (idx: number): void => {
        commit(rows.filter((_, i) => i !== idx));
    };

    const addRow = (): void => {
        commit([...rows, { slug: '', op: 'eq', value: '' }]);
    };

    /**
     * Inserta gte+lte (fechas fijas) para un preset, reemplazando el
     * row idx. Las automatizaciones evalúan condiciones contra un
     * snapshot del registro en el momento del trigger, así que tener
     * un rango "este mes" dinámico no aplica acá — el momento de la
     * evaluación ES el momento del trigger.
     */
    const applyDateRange = (
        idx: number,
        slug: string,
        fieldType: 'date' | 'datetime',
        preset: DateRangePresetId,
    ): void => {
        const range = computePresetRange(preset, fieldType, new Date());
        if (range === null) return;
        const next = [...rows];
        next.splice(idx, 1, {
            slug,
            op: 'gte',
            value: range.from,
        }, {
            slug,
            op: 'lte',
            value: range.to,
        });
        commit(next);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {helperText !== undefined && helperText !== '' && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{helperText}</p>
            )}

            {rows.map((rule, i) => {
                const field = fields.find((f) => f.slug === rule.slug);
                const operators = field ? operatorsForType(field.type) : [];
                const isNullary = isNullaryOperator(rule.op);
                const isDate = field?.type === 'date' || field?.type === 'datetime';

                return (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <div
                            className={cn(
                                'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2',
                                'imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card/50 imcrm-px-2 imcrm-py-2',
                            )}
                        >
                            <Select
                                value={rule.slug}
                                onChange={(e) => {
                                    const newSlug = e.target.value;
                                    const newField = fields.find((f) => f.slug === newSlug);
                                    const newOps = newField ? operatorsForType(newField.type) : [];
                                    const validOp = newOps.some((o) => o.op === rule.op)
                                        ? rule.op
                                        : (newOps[0]?.op ?? 'eq');
                                    updateRow(i, {
                                        slug: newSlug,
                                        op: validOp,
                                        value: '',
                                    });
                                }}
                                aria-label={__('Campo')}
                                className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1"
                            >
                                <option value="">{__('— Campo —')}</option>
                                {fields
                                    .filter((f) => f.type !== 'relation')
                                    .map((f) => (
                                        <option key={f.id} value={f.slug}>
                                            {f.label}
                                        </option>
                                    ))}
                            </Select>

                            {field && (
                                <Select
                                    value={rule.op}
                                    onChange={(e) =>
                                        updateRow(i, {
                                            op: e.target.value as FilterOperator,
                                            value: isNullaryOperator(e.target.value as FilterOperator)
                                                ? null
                                                : rule.value,
                                        })
                                    }
                                    aria-label={__('Operador')}
                                    className="imcrm-h-8 imcrm-min-w-[110px]"
                                >
                                    {operators.map((o) => (
                                        <option key={o.op} value={o.op}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            )}

                            {field && !isNullary && (
                                <div className="imcrm-min-w-[180px] imcrm-flex-1">
                                    <FilterValueInput
                                        listId={listId}
                                        field={field}
                                        op={rule.op}
                                        value={rule.value}
                                        onChange={(next) => updateRow(i, { value: next })}
                                    />
                                </div>
                            )}

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeRow(i)}
                                aria-label={__('Eliminar condición')}
                                className="imcrm-shrink-0"
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>

                        {isDate && field && (
                            <DateRangePresetButtons
                                onPick={(preset) =>
                                    applyDateRange(
                                        i,
                                        field.slug,
                                        field.type as 'date' | 'datetime',
                                        preset,
                                    )
                                }
                            />
                        )}
                    </div>
                );
            })}

            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addRow}
                className="imcrm-self-start imcrm-gap-2"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {addLabel ?? __('Añadir condición')}
            </Button>
        </div>
    );
}
