import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { FilterOperator } from '@/types/record';

import {
    DATE_RANGE_PRESETS,
    computePresetRange,
    type DateRangePresetId,
} from './dateRangePresets';
import { extractFieldOptions } from './fieldOptions';

interface FilterValueInputProps {
    listId: number | undefined;
    field: FieldEntity;
    op: FilterOperator;
    value: unknown;
    onChange: (v: unknown) => void;
}

/**
 * Input apropiado al tipo del campo para el lado "valor" de un filtro.
 *
 * Antes vivía dentro de `FilterPopover` — extraído acá para que la
 * versión nueva del panel inline (`FilterRow`) lo reuse sin duplicar
 * la lógica por tipo (text vs date vs select vs etc.).
 */
export function FilterValueInput({
    listId,
    field,
    op,
    value,
    onChange,
}: FilterValueInputProps): JSX.Element {
    // Operador "rango relativo": el valor es el slug del preset
    // (`this_month`, `last_year`, etc.). Persistimos el slug, no las
    // fechas resueltas — el backend las computa en cada query.
    if (op === 'between_relative') {
        const current = typeof value === 'string' && value !== '' ? value : 'this_month';
        const fieldType = field.type === 'datetime' ? 'datetime' : 'date';
        // Preview del rango actual para que el usuario sepa qué
        // está filtrando (especialmente útil para "esta semana" /
        // "este trimestre" donde la lectura mental no es obvia).
        const previewRange = computePresetRange(current as DateRangePresetId, fieldType);
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Select
                    value={current}
                    onChange={(e) => onChange(e.target.value)}
                >
                    {DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </Select>
                {previewRange && (
                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">
                        {previewRange.from.slice(0, 10)} → {previewRange.to.slice(0, 10)}
                    </span>
                )}
            </div>
        );
    }

    if (op === 'in' || op === 'nin') {
        // Acepta CSV; el QueryBuilder backend trabaja con array.
        const text = Array.isArray(value)
            ? value.join(', ')
            : (typeof value === 'string' ? value : '');
        return (
            <Input
                value={text}
                onChange={(e) =>
                    onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
                }
                placeholder={__('valor1, valor2…')}
            />
        );
    }

    switch (field.type) {
        case 'select':
        case 'multi_select': {
            const options = extractFieldOptions(field);
            return (
                <Select
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value="" disabled>
                        {__('Selecciona…')}
                    </option>
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </Select>
            );
        }
        case 'checkbox':
            return (
                <Select
                    value={value === true || value === '1' ? '1' : '0'}
                    onChange={(e) => onChange(e.target.value === '1')}
                >
                    <option value="1">{__('Marcado')}</option>
                    <option value="0">{__('No marcado')}</option>
                </Select>
            );
        case 'date':
            return (
                <Input
                    type="date"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'datetime':
            return (
                <Input
                    type="datetime-local"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'number':
        case 'currency':
        case 'user':
        case 'file':
            return (
                <Input
                    type="number"
                    step="any"
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
                />
            );
        default:
            return (
                <AutocompleteInput
                    listId={listId}
                    fieldId={field.id}
                    value={typeof value === 'string' ? value : ''}
                    onChange={onChange}
                    aria-label={__('Valor')}
                />
            );
    }
}
