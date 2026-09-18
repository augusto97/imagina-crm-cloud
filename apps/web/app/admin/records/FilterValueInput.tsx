import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';
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
import { FilterOptionPicker } from './FilterOptionPicker';
import { FilterUserPicker } from './FilterUserPicker';
import { isMultiValueOperator, toValueList } from './filterValue';

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
 * v0.1.191 — regla: donde el campo YA sabe cuáles son sus valores posibles
 * (opciones de un select, miembros del workspace, estrellas de una
 * calificación, marcado/no marcado), el usuario ELIGE, no tipea. Vale para
 * todos los operadores: "es alguno de" abre el mismo picker en modo
 * múltiple en vez del cuadro "valor1, valor2…" donde había que escribir
 * los `value` internos a mano. Texto, números y fechas siguen siendo
 * inputs (ahí tipear es lo correcto).
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

    const multi = isMultiValueOperator(op);

    switch (field.type) {
        case 'select':
        case 'multi_select': {
            const options = extractFieldOptions(field);
            return (
                <FilterOptionPicker
                    mode={multi ? 'multi' : 'single'}
                    options={options}
                    value={multi ? toValueList(value) : (typeof value === 'string' ? value : null)}
                    onChange={(next) => onChange(multi ? (next ?? []) : (next ?? ''))}
                    aria-label={__('Valor')}
                    data-testid="imcrm-filter-option-picker"
                />
            );
        }
        case 'user':
            return (
                <FilterUserPicker
                    mode={multi ? 'multi' : 'single'}
                    value={value}
                    onChange={(next) => onChange(next ?? (multi ? [] : ''))}
                />
            );
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
        case 'rating': {
            const cfg = field.config as { max?: unknown; icon?: unknown };
            const max = typeof cfg.max === 'number' ? cfg.max : 5;
            const icon = (typeof cfg.icon === 'string' ? cfg.icon : 'star') as RatingIcon;
            const current = typeof value === 'number' ? value : (typeof value === 'string' && value !== '' ? Number(value) : null);
            return (
                <div
                    className="imcrm-flex imcrm-min-h-9 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2"
                    data-testid="imcrm-filter-rating-picker"
                >
                    <RatingControl
                        value={current}
                        max={max}
                        icon={icon}
                        size="md"
                        onChange={(next) => onChange(next ?? '')}
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {current === null ? __('Elegí una calificación') : `${current} / ${max}`}
                    </span>
                </div>
            );
        }
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
        case 'percent':
        case 'duration':
        case 'rollup':
            // v0.1.158 — percent/duration son números: el filtro compara el
            // VALOR guardado (0-100, minutos).
            return (
                <Input
                    type="number"
                    step="any"
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
                />
            );
        default:
            if (multi) {
                // Tipos sin catálogo de valores: lista escrita a mano (CSV).
                const text = Array.isArray(value)
                    ? value.join(', ')
                    : (typeof value === 'string' ? value : '');
                return (
                    <Input
                        value={text}
                        onChange={(e) => onChange(toValueList(e.target.value))}
                        placeholder={__('valor1, valor2…')}
                    />
                );
            }
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
