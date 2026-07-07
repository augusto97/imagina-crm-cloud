import { Trash2 } from 'lucide-react';

import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterCondition, FilterOperator } from '@/types/record';

import { FilterValueInput } from './FilterValueInput';
import { isNullaryOperator, operatorsForType } from './operators';

interface FilterRowProps {
    listId: number | undefined;
    fields: FieldEntity[];
    condition: FilterCondition;
    onChange: (next: FilterCondition) => void;
    onRemove: () => void;
}

/**
 * Una fila de condición en el panel de filtros (Field → Op → Value
 * → 🗑). Estilo ClickUp: todo inline, sin popover. Cuando el usuario
 * cambia el campo, reseteamos `value` (porque el tipo del valor cambia)
 * y, si el operador actual no aplica al nuevo tipo, también el
 * operador.
 */
export function FilterRow({
    listId,
    fields,
    condition,
    onChange,
    onRemove,
}: FilterRowProps): JSX.Element {
    const filterableFields = fields.filter((f) => f.type !== 'relation');
    const selected = fields.find((f) => f.id === condition.field_id) ?? null;
    const operators = selected ? operatorsForType(selected.type) : [];

    const setField = (fieldId: number): void => {
        const next = fields.find((f) => f.id === fieldId);
        if (!next) return;
        const ops = operatorsForType(next.type);
        const validOp = ops.some((o) => o.op === condition.op) ? condition.op : (ops[0]?.op ?? 'eq');
        onChange({
            type: 'condition',
            field_id: fieldId,
            op: validOp,
            value: '',
        });
    };

    const setOp = (op: FilterOperator): void => {
        let nextValue: unknown = condition.value;
        if (isNullaryOperator(op)) {
            nextValue = null;
        } else if (op === 'between_relative') {
            // El valor pasa de ser una fecha (string ISO) a un preset
            // slug. Si no es ya un preset válido, default a este mes.
            if (typeof condition.value !== 'string' || condition.value === '' || condition.value.includes('-')) {
                nextValue = 'this_month';
            }
        }
        onChange({
            ...condition,
            op,
            value: nextValue,
        });
    };

    const setValue = (value: unknown): void => {
        onChange({ ...condition, value });
    };

    const isNullary = isNullaryOperator(condition.op);

    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card/50 imcrm-px-2 imcrm-py-2',
            )}
        >
            <Select
                value={condition.field_id || ''}
                onChange={(e) => setField(Number(e.target.value))}
                className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1"
            >
                <option value="" disabled>
                    {__('Campo')}
                </option>
                {filterableFields.map((f) => (
                    <option key={f.id} value={f.id}>
                        {f.label}
                    </option>
                ))}
            </Select>

            {selected && (
                <Select
                    value={condition.op}
                    onChange={(e) => setOp(e.target.value as FilterOperator)}
                    className="imcrm-h-8 imcrm-min-w-[110px]"
                >
                    {operators.map((o) => (
                        <option key={o.op} value={o.op}>
                            {o.label}
                        </option>
                    ))}
                </Select>
            )}

            {selected && !isNullary && (
                <div className="imcrm-min-w-[180px] imcrm-flex-1">
                    <FilterValueInput
                        listId={listId}
                        field={selected}
                        op={condition.op}
                        value={condition.value}
                        onChange={setValue}
                    />
                </div>
            )}

            <button
                type="button"
                onClick={onRemove}
                className="imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                aria-label={__('Quitar filtro')}
            >
                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
        </div>
    );
}
