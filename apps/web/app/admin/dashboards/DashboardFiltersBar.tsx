import { useState } from 'react';
import { X } from 'lucide-react';

import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { FilterUserPicker } from '@/admin/records/FilterUserPicker';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import type { DashboardFilterDef, DashboardFilterValue } from '@/types/dashboard';

/** Tipos de campo que se pueden usar como filtro del tablero. */
export const DASHBOARD_FILTER_TYPES = ['select', 'multi_select', 'user', 'checkbox'] as const;

/** Lee `settings.filters` (tolerante a datos viejos o rotos). */
export function readDashboardFilterDefs(settings: Record<string, unknown> | undefined): DashboardFilterDef[] {
    const raw = settings?.filters;
    if (!Array.isArray(raw)) return [];
    const out: DashboardFilterDef[] = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const listId = Number((r as { list_id?: unknown }).list_id);
        const fieldId = Number((r as { field_id?: unknown }).field_id);
        if (Number.isInteger(listId) && listId > 0 && Number.isInteger(fieldId) && fieldId > 0) {
            out.push({ list_id: listId, field_id: fieldId });
        }
    }
    return out;
}

/** Los valores elegidos → lo que viaja en el body del bundle. */
export function activeFilterValues(
    defs: DashboardFilterDef[],
    values: Record<string, DashboardFilterValue['value']>,
): DashboardFilterValue[] {
    const out: DashboardFilterValue[] = [];
    for (const d of defs) {
        const v = values[String(d.field_id)];
        if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
        out.push({ field_id: d.field_id, value: v });
    }
    return out;
}

/**
 * v0.1.286 — Filtros del TABLERO (Responsable, Estado, "Yo"…): uno por campo
 * declarado en `settings.filters`. El valor lo elige quien mira (se recuerda
 * en este navegador) y se aplica a todos los widgets de la lista del campo.
 */
export function DashboardFiltersBar({
    defs,
    values,
    onChange,
}: {
    defs: DashboardFilterDef[];
    values: Record<string, DashboardFilterValue['value']>;
    onChange: (fieldId: number, value: DashboardFilterValue['value'] | null) => void;
}): JSX.Element | null {
    if (defs.length === 0) return null;
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2" data-testid="imcrm-dashboard-filters">
            {defs.map((d) => (
                <FilterControl key={d.field_id} def={d} value={values[String(d.field_id)]} onChange={(v) => onChange(d.field_id, v)} />
            ))}
        </div>
    );
}

function FilterControl({
    def,
    value,
    onChange,
}: {
    def: DashboardFilterDef;
    value: DashboardFilterValue['value'] | undefined;
    onChange: (next: DashboardFilterValue['value'] | null) => void;
}): JSX.Element | null {
    const fields = useFields(def.list_id);
    const field = fields.data?.find((f) => f.id === def.field_id);
    const [picking, setPicking] = useState(typeof value === 'number');
    if (!field) return null;
    const active = value !== undefined && value !== '';
    const label = (text: string): string => sprintf(__('%1$s: %2$s'), field.label, text);
    const clear = active ? (
        <button
            type="button"
            onClick={() => { setPicking(false); onChange(null); }}
            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
            aria-label={sprintf(__('Quitar el filtro «%s»'), field.label)}
            title={__('Quitar el filtro')}
        >
            <X className="imcrm-h-3.5 imcrm-w-3.5" />
        </button>
    ) : null;

    if (field.type === 'user') {
        const mode = value === 'me' ? 'me' : picking || typeof value === 'number' ? 'pick' : '';
        return (
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Select
                    value={mode}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'pick') {
                            setPicking(true);
                            return;
                        }
                        setPicking(false);
                        onChange(v === '' ? null : 'me');
                    }}
                    className="imcrm-h-9 imcrm-w-auto"
                    aria-label={field.label}
                >
                    <option value="">{label(__('todos'))}</option>
                    <option value="me">{label(__('yo'))}</option>
                    <option value="pick">{label(__('otra persona…'))}</option>
                </Select>
                {mode === 'pick' && (
                    <span className="imcrm-w-48">
                        <FilterUserPicker mode="single" value={typeof value === 'number' ? value : null} onChange={(n) => onChange(typeof n === 'number' ? n : null)} />
                    </span>
                )}
                {clear}
            </span>
        );
    }

    if (field.type === 'checkbox') {
        return (
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Select
                    value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''}
                    onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
                    className="imcrm-h-9 imcrm-w-auto"
                    aria-label={field.label}
                >
                    <option value="">{label(__('todos'))}</option>
                    <option value="true">{label(__('Sí'))}</option>
                    <option value="false">{label(__('No'))}</option>
                </Select>
                {clear}
            </span>
        );
    }

    const options = extractFieldOptions(field);
    return (
        <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
            <Select
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
                className="imcrm-h-9 imcrm-w-auto"
                aria-label={field.label}
            >
                <option value="">{label(__('todos'))}</option>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{label(o.label)}</option>
                ))}
            </Select>
            {clear}
        </span>
    );
}
