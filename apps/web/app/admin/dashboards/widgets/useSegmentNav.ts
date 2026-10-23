import { useContext } from 'react';
import { asDisplayField } from '@/lib/fieldTypeCatalog';
import { useNavigate } from 'react-router';

import { DashboardBundleContext, WidgetDataOverrideContext } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { getBootData } from '@/lib/boot';
import type { FieldEntity } from '@/types/field';
import { OTHERS_GROUP_KEY, type DashboardFilterValue, type WidgetSpec } from '@/types/dashboard';
import type { FilterNode, FilterTree } from '@/types/record';

/**
 * Click-through de charts (v0.1.100): click en una barra/sector/etapa →
 * abre la lista filtrada a ese segmento.
 *
 * v0.1.286 — la lista abre con EXACTAMENTE lo que contó el gráfico: el filtro
 * del widget + su período (o el global del tablero) + los filtros del
 * tablero + la condición del segmento. Antes sólo viajaba el segmento
 * (`?gf=&gv=`) y la lista mostraba otro conjunto (sin los filtros, sin el
 * período). Viaja como `?ft=<filter_tree JSON>` (RecordsPage lo aplica
 * encima de la vista y limpia el parámetro).
 */
/**
 * v0.1.292 — Con un segundo campo (barras apiladas, una celda de la tabla
 * dinámica) el click abre la lista filtrada por los DOS valores: el grupo y
 * la serie / la fila y la columna. `subLabel` es la clave de la serie.
 */
export type SegmentNav = (label: string, subLabel?: string) => void;

export function useSegmentNav(widget: WidgetSpec): SegmentNav | null {
    // v0.1.230 — en la ficha (datos inyectados, acotados a los vinculados) el
    // click-through abriría la lista ENTERA filtrada por el valor: engañoso.
    const injected = useContext(WidgetDataOverrideContext) !== null;
    const scope = useContext(DashboardBundleContext);
    const navigate = useNavigate();
    const lists = useLists();
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);

    const groupFieldId = typeof widget.config.group_by_field_id === 'number'
        ? widget.config.group_by_field_id
        : typeof widget.config.date_field_id === 'number' ? widget.config.date_field_id : undefined;
    if (injected || groupFieldId === undefined || !fields.data) return null;

    const field = fields.data.find((f) => f.id === groupFieldId);
    if (!field) return null;
    const slug = lists.data?.find((l) => l.id === widget.list_id)?.slug;
    if (slug === undefined) return null;
    const subFieldId = typeof widget.config.sub_group_by_field_id === 'number' ? widget.config.sub_group_by_field_id : undefined;
    const subField = subFieldId !== undefined ? fields.data.find((f) => f.id === subFieldId) : undefined;

    return (label: string, subLabel?: string): void => {
        if (subLabel !== undefined && subField === undefined) return;
        const tree = segmentFilterTree({
            widget,
            field,
            label,
            listFields: fields.data ?? [],
            period: scope.period,
            filters: scope.filters,
            userId: getBootData().user.id,
            ...(subLabel !== undefined && subField ? { sub: { field: subField, label: subLabel } } : {}),
        });
        if (tree === null) return;
        navigate(`/lists/${slug}/records?ft=${encodeURIComponent(JSON.stringify(tree))}`);
    };
}

const CUSTOM_RE = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

/** Rango YYYY-MM-DD (inclusive) de un bucket temporal, o null si no lo es. */
export function bucketRange(label: string): { from: string; to: string } | null {
    const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
    if (m) return { from: label, to: label };
    m = /^(\d{4})-W(\d{2})$/.exec(label);
    if (m) {
        const year = Number(m[1]);
        const jan4 = new Date(Date.UTC(year, 0, 4));
        const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000);
        const from = monday.toISOString().slice(0, 10);
        const to = new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
        return { from, to };
    }
    m = /^(\d{4})-(\d{2})$/.exec(label);
    if (m) return { from: ymd(Number(m[1]), Number(m[2]), 1), to: ymd(Number(m[1]), Number(m[2]) + 1, 0) };
    m = /^(\d{4})-Q([1-4])$/.exec(label);
    if (m) {
        const q = Number(m[2]);
        return { from: ymd(Number(m[1]), (q - 1) * 3 + 1, 1), to: ymd(Number(m[1]), q * 3 + 1, 0) };
    }
    m = /^(\d{4})$/.exec(label);
    if (m) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
    return null;
}

/**
 * El filter_tree que reproduce un segmento del gráfico. `null` = el segmento
 * no se puede abrir como lista ("Otros" junta varios grupos).
 */
export function segmentFilterTree(args: {
    widget: WidgetSpec;
    field: Pick<FieldEntity, 'id' | 'type'>;
    label: string;
    listFields: ReadonlyArray<Pick<FieldEntity, 'id' | 'type'>>;
    period: string;
    filters: DashboardFilterValue[];
    userId: number;
    /** v0.1.292 — el segundo valor (serie de un desglose, columna de una tabla dinámica). */
    sub?: { field: Pick<FieldEntity, 'id' | 'type'>; label: string };
}): FilterTree | null {
    const { widget, field, label } = args;
    if (label === OTHERS_GROUP_KEY) return null;
    if (args.sub !== undefined && args.sub.label === OTHERS_GROUP_KEY) return null;
    const cfg = widget.config as Record<string, unknown>;
    const children: FilterNode[] = [];

    // 1. El filtro propio del widget (una plantilla vieja lo guardaba suelto).
    const own = cfg.filter_tree as FilterNode | undefined;
    if (own && typeof own === 'object' && own.type === 'group' && own.children.length > 0) children.push(own);
    else if (own && typeof own === 'object' && own.type === 'condition') children.push(own);

    // 2. El período: el global del tablero pisa el del widget.
    const period = cfg.period as { field_id?: unknown; preset?: unknown; from?: unknown; to?: unknown } | null | undefined;
    const periodField = typeof period?.field_id === 'number' && period.field_id > 0 ? period.field_id : undefined;
    const dateField = typeof cfg.date_field_id === 'number' && cfg.date_field_id > 0 ? cfg.date_field_id : undefined;
    let periodValue: unknown;
    let periodFieldId: number | undefined;
    if (args.period !== '') {
        const custom = CUSTOM_RE.exec(args.period);
        periodValue = custom ? { from: custom[1], to: custom[2] } : args.period;
        periodFieldId = periodField ?? dateField;
    } else if (periodField !== undefined && typeof period?.preset === 'string') {
        periodFieldId = periodField;
        periodValue = period.preset === 'custom'
            ? (typeof period.from === 'string' && typeof period.to === 'string' ? { from: period.from, to: period.to } : undefined)
            : period.preset;
    }
    if (periodFieldId !== undefined && periodValue !== undefined) {
        children.push({ type: 'condition', field_id: periodFieldId, op: 'between_relative', value: periodValue });
    }

    // 3. Los filtros del tablero que aplican a esta lista.
    const byId = new Map(args.listFields.map((f) => [f.id, f]));
    for (const flt of args.filters) {
        const f = byId.get(flt.field_id);
        if (!f) continue;
        const node = dashboardFilterNode(f, flt.value, args.userId);
        if (node) children.push(node);
    }

    // 4. La condición del segmento.
    const seg = segmentCondition(field, label, typeof cfg.time_bucket === 'string');
    if (seg === null) return null;
    children.push(seg);
    // 5. v0.1.292 — y la de la serie (o la columna). Un segundo campo de
    // fecha siempre va por bucket (sin elegir, por mes).
    if (args.sub !== undefined) {
        const subSeg = segmentCondition(args.sub.field, args.sub.label, true);
        if (subSeg === null) return null;
        children.push(subSeg);
    }
    return { type: 'group', logic: 'and', children };
}

/** Lo mismo que el servidor hace con un filtro del tablero (`dashboardFilterNodes`). */
export function dashboardFilterNode(
    rawField: Pick<FieldEntity, 'id' | 'type'>,
    value: DashboardFilterValue['value'],
    userId: number,
): FilterNode | null {
    const field = asDisplayField(rawField);
    if (value === '' || (Array.isArray(value) && value.length === 0)) return null;
    if (field.type === 'user') {
        const ids = (Array.isArray(value) ? value : [value])
            .map((v) => (v === 'me' ? userId : Number(v)))
            .filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return null;
        return ids.length === 1
            ? { type: 'condition', field_id: field.id, op: 'eq', value: ids[0] }
            : { type: 'condition', field_id: field.id, op: 'in', value: ids };
    }
    if (field.type === 'checkbox') {
        return { type: 'condition', field_id: field.id, op: 'eq', value: value === true || value === 'true' || value === '1' };
    }
    if (field.type === 'multi_select') {
        const vals = (Array.isArray(value) ? value : [value]).map(String);
        return vals.length === 1
            ? { type: 'condition', field_id: field.id, op: 'contains', value: vals[0] }
            : { type: 'group', logic: 'or', children: vals.map((v) => ({ type: 'condition' as const, field_id: field.id, op: 'contains' as const, value: v })) };
    }
    if (Array.isArray(value)) return { type: 'condition', field_id: field.id, op: 'in', value };
    const textual = ['text', 'long_text', 'email', 'url', 'phone'].includes(field.type);
    return { type: 'condition', field_id: field.id, op: textual ? 'contains' : 'eq', value };
}

function segmentCondition(rawField: Pick<FieldEntity, 'id' | 'type'>, label: string, bucketed: boolean): FilterNode | null {
    // v0.1.300 — una columna de sistema filtra como fecha y hora o como persona.
    const field = asDisplayField(rawField);
    const empty = label === '(sin valor)' || label === '';
    if (field.type === 'checkbox') {
        if (empty) return { type: 'condition', field_id: field.id, op: 'is_null', value: null };
        return { type: 'condition', field_id: field.id, op: 'eq', value: label === 'true' };
    }
    if (empty) return { type: 'condition', field_id: field.id, op: 'is_null', value: null };
    if (field.type === 'date' || field.type === 'datetime') {
        // Un bucket ("2026-07", "2026-W30"…) es un RANGO de fechas.
        const range = bucketRange(label);
        if (range) return { type: 'condition', field_id: field.id, op: 'between_relative', value: range };
        if (bucketed) return null;
        return { type: 'condition', field_id: field.id, op: 'eq', value: label };
    }
    if (field.type === 'multi_select') {
        // v0.1.190 — el grupo es el SET exacto: `eq` con un array compara
        // conjuntos (sin importar orden), igual que la vista agrupada.
        try {
            const arr: unknown = JSON.parse(label);
            if (Array.isArray(arr)) return { type: 'condition', field_id: field.id, op: 'eq', value: arr.map(String) };
        } catch {
            // no era JSON — un valor suelto
        }
        return { type: 'condition', field_id: field.id, op: 'eq', value: [label] };
    }
    if (field.type === 'user' || ['number', 'currency', 'rating', 'percent', 'duration'].includes(field.type)) {
        const n = Number(label);
        return Number.isFinite(n) ? { type: 'condition', field_id: field.id, op: 'eq', value: n } : null;
    }
    return { type: 'condition', field_id: field.id, op: 'eq', value: label };
}
