import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';
import { RelationPicker } from '@/components/fields/RelationPicker';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { asDisplayField } from '@/lib/fieldTypeCatalog';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { FilterOperator } from '@/types/record';

import { extractFieldOptions } from './fieldOptions';
import { FilterOptionPicker } from './FilterOptionPicker';
import { datetimeFilterToInput, datetimeInputToFilter } from './filterDatetime';
import { FilterTeamPicker } from './FilterTeamPicker';
import { FilterUserPicker } from './FilterUserPicker';
import { isMultiValueOperator, toValueList } from './filterValue';
import { RelativeDateRangeInput } from './RelativeDateRangeInput';

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
    field: rawField,
    op,
    value,
    onChange,
}: FilterValueInputProps): JSX.Element {
    // v0.1.300 — las columnas de sistema se filtran como lo que son: una fecha (se
    // elige el DÍA: el servidor lo cuenta en el reloj de la empresa) o una
    // persona; el ID automático, como texto.
    const field: FieldEntity =
        rawField.type === 'created_at' || rawField.type === 'updated_at' ? { ...rawField, type: 'date' } : asDisplayField(rawField);
    // Operador "rango relativo" (`es en…`): un preset (`this_month`), cualquier
    // cantidad de días (`{days, dir}`, v0.1.469) o un rango fijo (`{from, to}`).
    // Se guarda la REGLA, no las fechas resueltas: el servidor las calcula en
    // cada consulta, en el reloj de la empresa.
    if (op === 'between_relative') {
        return <RelativeDateRangeInput value={value} onChange={onChange} aria-label={__('Rango de fechas')} />;
    }

    const multi = isMultiValueOperator(op);

    switch (field.type) {
        case 'relation':
            // v0.1.286 — se ELIGE el registro con el buscador de la lista
            // destino (el mismo selector de la celda), no se tipea un id.
            return (
                <RelationPicker
                    field={field}
                    value={toValueList(value).map(Number).filter((n) => Number.isInteger(n) && n > 0)}
                    onChange={(ids) => onChange(ids)}
                />
            );
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
        case 'team':
            return (
                <FilterTeamPicker
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
                        {current === null ? __('Elige una calificación') : `${current} / ${max}`}
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
            // v0.1.286 — viaja con zona (antes el servidor leía la hora local
            // como UTC); «es» abarca el minuto elegido.
            return (
                <Input
                    type="datetime-local"
                    value={datetimeFilterToInput(value)}
                    onChange={(e) => onChange(datetimeInputToFilter(e.target.value))}
                />
            );
        case 'number':
        case 'currency':
        case 'percent':
        case 'duration':
        case 'time_tracked':
        case 'checklist_progress':
        case 'rollup':
        case 'computed':
            // v0.1.158 — percent/duration son números: el filtro compara el
            // VALOR guardado (0-100, minutos).
            return (
                <Input
                    type="number"
                    step="any"
                    aria-label={__('Valor')}
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
