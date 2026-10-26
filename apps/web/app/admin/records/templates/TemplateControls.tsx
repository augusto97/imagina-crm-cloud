import { Minus, Plus } from 'lucide-react';
import type { RelativeDate, TemplatePerson } from '@imagina-base/shared';

import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { ChecklistAssignee } from '../checklists/ChecklistAssignee';
import { isDateField, isUserField } from './templateModel';

/**
 * C6 — Controles del editor de plantillas: una FECHA RELATIVA («+3 días
 * hábiles desde la creación a las 09:00») y una PERSONA («quien crea el
 * registro», el valor de un campo Persona o alguien fijo).
 */

export function RelativeDateControl({
    value,
    onChange,
    fields,
    withTime,
    excludeFieldId,
    className,
}: {
    value: RelativeDate;
    onChange: (next: RelativeDate) => void;
    fields: readonly FieldEntity[];
    /** El destino lleva hora: se ofrece «a las HH:MM». */
    withTime: boolean;
    /** No ofrecer como origen el propio campo destino. */
    excludeFieldId?: number;
    className?: string;
}): JSX.Element {
    const sources = fields.filter((f) => isDateField(f) && f.id !== excludeFieldId);
    const sign = value.days < 0 ? -1 : 1;
    const abs = Math.abs(value.days);
    return (
        <div className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-sm', className)} data-testid="imcrm-relative-date">
            <button
                type="button"
                onClick={() => onChange({ ...value, days: -value.days })}
                className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-input imcrm-text-muted-foreground hover:imcrm-bg-accent"
                title={sign < 0 ? __('Antes (cambiar a después)') : __('Después (cambiar a antes)')}
                aria-label={sign < 0 ? __('Antes') : __('Después')}
            >
                {sign < 0 ? <Minus className="imcrm-h-3.5 imcrm-w-3.5" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
            </button>
            <input
                type="number"
                min={0}
                max={3650}
                value={abs}
                onChange={(e) => {
                    const n = Math.max(0, Math.min(3650, Math.trunc(Number(e.target.value) || 0)));
                    onChange({ ...value, days: sign * n });
                }}
                className="imcrm-h-8 imcrm-w-16 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm imcrm-tabular-nums"
                aria-label={__('Cantidad de días')}
            />
            <Select
                value={value.business_days ? 'business' : 'calendar'}
                onChange={(e) => onChange({ ...value, business_days: e.target.value === 'business' })}
                className="imcrm-h-8 imcrm-w-auto"
                aria-label={__('Tipo de días')}
            >
                <option value="calendar">{__('días')}</option>
                <option value="business">{__('días hábiles')}</option>
            </Select>
            <Select
                value={value.from_field_id === null ? '' : String(value.from_field_id)}
                onChange={(e) => onChange({ ...value, from_field_id: e.target.value === '' ? null : Number(e.target.value) })}
                className="imcrm-h-8 imcrm-w-auto imcrm-max-w-[14rem]"
                aria-label={__('Desde')}
            >
                <option value="">{__('desde que se crea')}</option>
                {sources.map((f) => (
                    <option key={f.id} value={f.id}>
                        {`${__('desde')} «${f.label}»`}
                    </option>
                ))}
            </Select>
            {withTime && (
                <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('a las')}
                    <input
                        type="time"
                        value={value.time ?? ''}
                        onChange={(e) => onChange({ ...value, time: e.target.value === '' ? null : e.target.value })}
                        className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                        aria-label={__('Hora')}
                    />
                </label>
            )}
        </div>
    );
}

export function PersonControl({
    value,
    onChange,
    fields,
    allowNone,
    excludeFieldId,
    className,
}: {
    value: TemplatePerson | null;
    onChange: (next: TemplatePerson | null) => void;
    fields: readonly FieldEntity[];
    /** Ofrecer «Nadie» (ítems y subtareas: el responsable es opcional). */
    allowNone: boolean;
    excludeFieldId?: number;
    className?: string;
}): JSX.Element {
    const userFields = fields.filter((f) => isUserField(f) && f.id !== excludeFieldId);
    const key = value === null ? '' : value.kind === 'creator' ? 'creator' : value.kind === 'field' ? `field:${value.field_id}` : 'user';
    return (
        <div className={cn('imcrm-flex imcrm-items-center imcrm-gap-1.5', className)} data-testid="imcrm-person-control">
            <Select
                value={key}
                onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') onChange(null);
                    else if (v === 'creator') onChange({ kind: 'creator' });
                    else if (v === 'user') onChange(value?.kind === 'user' ? value : { kind: 'user', user_id: 0 });
                    else onChange({ kind: 'field', field_id: Number(v.slice(6)) });
                }}
                className="imcrm-h-8 imcrm-w-auto imcrm-max-w-[16rem]"
                aria-label={__('Responsable')}
            >
                {allowNone && <option value="">{__('Sin responsable')}</option>}
                <option value="creator">{__('Quien crea el registro')}</option>
                {userFields.map((f) => (
                    <option key={f.id} value={`field:${f.id}`}>
                        {`${__('El de')} «${f.label}»`}
                    </option>
                ))}
                <option value="user">{__('Una persona fija…')}</option>
            </Select>
            {value?.kind === 'user' && (
                <ChecklistAssignee
                    value={value.user_id > 0 ? value.user_id : null}
                    onChange={(id) => onChange(id ? { kind: 'user', user_id: id } : allowNone ? null : { kind: 'creator' })}
                />
            )}
        </div>
    );
}
