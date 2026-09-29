import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';
import { RelationPicker } from '@/components/fields/RelationPicker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { extractFieldOptions } from '../fieldOptions';
import { FilterOptionPicker } from '../FilterOptionPicker';
import { FilterUserPicker } from '../FilterUserPicker';
import { toValueList } from '../filterValue';

/**
 * El valor de «Poner este valor» en una edición masiva, con el control que
 * corresponde al tipo: las opciones se ELIGEN con sus chips de color, el
 * usuario se busca por nombre, los registros vinculados por su título. Los
 * números se tipean con los separadores de la empresa (los interpreta el
 * backend al validar).
 */
export function BulkValueInput({
    field,
    value,
    onChange,
}: {
    field: FieldEntity;
    value: unknown;
    onChange: (v: unknown) => void;
}): JSX.Element {
    if (field.type === 'select' || field.type === 'multi_select') {
        const multi = field.type === 'multi_select';
        return (
            <FilterOptionPicker
                mode={multi ? 'multi' : 'single'}
                options={extractFieldOptions(field)}
                value={multi ? toValueList(value) : typeof value === 'string' ? value : null}
                onChange={(next) => onChange(multi ? (next ?? []) : (next ?? ''))}
                aria-label={__('Nuevo valor')}
                data-testid="imcrm-bulk-option-picker"
            />
        );
    }
    if (field.type === 'relation') {
        return <RelationPicker field={field} value={value} onChange={(ids) => onChange(ids)} />;
    }
    if (field.type === 'user') {
        return <FilterUserPicker mode="single" value={value} onChange={(next) => onChange(next ?? '')} />;
    }
    if (field.type === 'rating') {
        const cfg = field.config as { max?: unknown; icon?: unknown };
        return (
            <div className="imcrm-flex imcrm-min-h-9 imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2">
                <RatingControl
                    value={typeof value === 'number' ? value : null}
                    max={typeof cfg.max === 'number' ? cfg.max : 5}
                    icon={(typeof cfg.icon === 'string' ? cfg.icon : 'star') as RatingIcon}
                    size="md"
                    onChange={(next) => onChange(next ?? '')}
                />
            </div>
        );
    }
    if (field.type === 'checkbox') {
        return (
            <Select value={value === true ? '1' : '0'} onChange={(e) => onChange(e.target.value === '1')}>
                <option value="1">{__('Marcado')}</option>
                <option value="0">{__('Sin marcar')}</option>
            </Select>
        );
    }
    if (field.type === 'date') {
        return <Input type="date" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
    }
    if (field.type === 'datetime') {
        // El input local se manda como ISO con la zona del navegador.
        const local = typeof value === 'string' && value !== '' ? toLocalInput(value) : '';
        return (
            <Input
                type="datetime-local"
                value={local}
                onChange={(e) => onChange(e.target.value === '' ? '' : new Date(e.target.value).toISOString().replace(/\.\d{3}Z$/, 'Z'))}
            />
        );
    }
    if (field.type === 'long_text') {
        return <Textarea rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
    }
    return (
        <Input
            value={value === null || value === undefined ? '' : String(value)}
            inputMode={['number', 'currency', 'percent'].includes(field.type) ? 'decimal' : undefined}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.type === 'duration' ? __('1h 30m') : __('Nuevo valor')}
        />
    );
}

function toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
