import { useMemo } from 'react';

import { chipSoftStyle, colorVar, type OptionColor } from '@/components/ui/color-picker';
import { useFields } from '@/hooks/useFields';
import { useMemberNames } from '@/hooks/useWpUsers';
import { __ } from '@/lib/i18n';
import { OTHERS_GROUP_KEY } from '@/types/dashboard';

import { groupDisplayLabels } from './widgetFormat';

/**
 * Paleta de fallback para categorías sin color definido (campos que
 * no son select, opciones sin color, buckets de fecha, etc.).
 * Ordenada para máximo contraste entre categorías adyacentes.
 */
export const CHART_PALETTE = [
    'blue', 'amber', 'green', 'violet', 'rose', 'cyan',
    'orange', 'teal', 'pink', 'lime', 'indigo', 'slate',
] as const;

export function paletteColor(i: number): string {
    return `hsl(var(--imcrm-opt-${CHART_PALETTE[i % CHART_PALETTE.length]}))`;
}

interface GroupOption {
    value: string;
    label: string;
    color: string | undefined;
    index: number;
}

/**
 * Opciones del campo select/multi_select por el que agrupa el widget,
 * indexadas por VALUE (la clave con la que el backend devuelve los
 * buckets: agrupa por el valor crudo de la columna, nunca por la
 * etiqueta) y también por etiqueta, para datos legacy donde value y label
 * coincidían. Vacío si el campo no es select.
 */
function useGroupOptions(listId: number | undefined, groupByFieldId: number | undefined): Map<string, GroupOption> {
    const fields = useFields(listId && listId > 0 ? listId : undefined);

    return useMemo(() => {
        const map = new Map<string, GroupOption>();
        if (! groupByFieldId || ! fields.data) return map;
        const field = fields.data.find((f) => f.id === groupByFieldId);
        if (! field) return map;
        if (field.type !== 'select' && field.type !== 'multi_select') return map;
        const options = (field.config as { options?: unknown }).options;
        if (! Array.isArray(options)) return map;
        options.forEach((opt, index) => {
            if (typeof opt !== 'object' || opt === null) return;
            const o = opt as { label?: unknown; value?: unknown; color?: unknown };
            const value = typeof o.value === 'string' ? o.value : '';
            const label = typeof o.label === 'string' && o.label !== '' ? o.label : value;
            if (value === '' && label === '') return;
            const entry: GroupOption = {
                value,
                label,
                color: typeof o.color === 'string' ? colorVar(o.color) : undefined,
                index,
            };
            if (value !== '' && ! map.has(value)) map.set(value, entry);
            if (label !== '' && ! map.has(label)) map.set(label, entry);
        });
        return map;
    }, [fields.data, groupByFieldId]);
}

/**
 * Mapa clave→color CSS para las categorías de un chart agrupado.
 *
 * Si el campo `groupByFieldId` es select/multi_select, usa los colores
 * REALES que el usuario definió en las opciones del campo — los mismos
 * que se ven en Kanban, chips de tabla y filtros. Así el dashboard es
 * coherente con el resto de la app: si "Activo" es verde en la lista,
 * es verde en el chart.
 *
 * Para labels sin color (campo no-select, opción sin color, buckets de
 * fecha) el consumidor cae a `paletteColor(i)`.
 *
 * v0.1.178 — indexado por VALUE (lo que devuelve el backend) además de
 * por etiqueta: antes sólo por etiqueta, así que una opción cuyo value no
 * coincidía con su label salía siempre con el color de la paleta.
 */
export function useGroupColorMap(
    listId: number | undefined,
    groupByFieldId: number | undefined,
): Map<string, string> {
    const options = useGroupOptions(listId, groupByFieldId);
    return useMemo(() => {
        const map = new Map<string, string>();
        for (const [key, o] of options) if (o.color) map.set(key, o.color);
        return map;
    }, [options]);
}

/**
 * v0.1.178 — Mapa value→ETIQUETA de las opciones del campo agrupado. Es lo
 * que se MUESTRA en leyenda, barras, etapas y tooltips: el usuario lee
 * "Gestión sitio web", no `gestion_sitio_web`. La clave del dato sigue
 * siendo el value crudo (click-through, colores, ocultar categorías).
 */
export function useGroupLabelMap(
    listId: number | undefined,
    groupByFieldId: number | undefined,
    /** v0.1.252 — claves de los grupos: con un campo persona son ids de usuario. */
    keys: string[] = [],
): Map<string, string> {
    const options = useGroupOptions(listId, groupByFieldId);
    const fields = useFields(listId && listId > 0 ? listId : undefined);
    const groupField = fields.data?.find((f) => f.id === groupByFieldId);
    const isUser = groupField?.type === 'user';
    const names = useMemberNames(isUser ? keys.filter((k) => /^\d+$/.test(k)).map((k) => Number(k)) : []);
    const keysSig = keys.join('\u0000');
    return useMemo(() => {
        const map = new Map<string, string>();
        for (const [key, o] of options) map.set(key, o.label);
        for (const [id, name] of names.data ?? []) map.set(String(id), name);
        // v0.1.286 — buckets de fecha legibles ("oct 2026", "Sem 43 · 2026",
        // "T3 2026") y la casilla como «Sí» / «No» (antes "true"/"false").
        for (const [key, label] of groupDisplayLabels(keysSig === '' ? [] : keysSig.split('\u0000'), groupField)) map.set(key, label);
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options, names.data, keysSig, groupField?.type]);
}

/**
 * Resuelve el color de una categoría: color real de la opción si
 * existe, sino el i-ésimo de la paleta de fallback. Prueba también el
 * label "bonito" (multi_select agrupado devuelve JSON crudo `["a"]` —
 * la opción está registrada por su value plano).
 */
export function categoryColor(
    map: Map<string, string>,
    label: string,
    index: number,
): string {
    // v0.1.286 — "Otros" (el resto de los grupos) en un gris neutro.
    if (label === OTHERS_GROUP_KEY) return 'hsl(var(--imcrm-muted-foreground) / 0.55)';
    return map.get(label) ?? map.get(prettyGroupLabel(label)) ?? paletteColor(index);
}

/**
 * v0.1.286 — Tinta legible SOBRE un color de categoría (la cifra dentro de
 * una etapa del embudo): la de mayor contraste WCAG, la misma regla de los
 * chips de opción. Antes era siempre blanca (2,1:1 sobre ámbar o verde).
 */
export function inkOn(color: string): string {
    const preset = /^hsl\(var\(--imcrm-opt-([a-z]+)\)\)$/.exec(color);
    const raw = preset ? preset[1] : /^#[0-9a-f]{3,6}$/i.test(color) ? color : null;
    if (raw === null || raw === undefined) return 'hsl(var(--imcrm-foreground))';
    const style = chipSoftStyle(raw as OptionColor);
    return typeof style?.color === 'string' ? style.color : '#ffffff';
}

/** v0.1.286 — Nombre de un grupo; "Otros" dice cuántos grupos junta. */
export function othersAwareLabel(row: { label: string; others?: number }, labels: Map<string, string> | undefined): string {
    if (row.label === OTHERS_GROUP_KEY && typeof row.others === 'number') {
        return `${__('Otros')} (${row.others})`;
    }
    return displayGroupLabel(row.label, labels);
}

/** v0.1.286 — ¿Es el grupo "Otros" (no navegable, sin opción)? */
export function isOthersGroup(label: string): boolean {
    return label === OTHERS_GROUP_KEY;
}

/**
 * Label legible para el grupo de un chart (v0.1.101). Los campos
 * multi_select agrupan por el JSON crudo de la columna (`["hosting_2gb"]`,
 * `["a","b"]`) — para MOSTRAR lo convertimos a `hosting_2gb` / `a, b`.
 * OJO: solo para display; el valor CRUDO sigue siendo la clave del dato
 * (click-through filtra por el valor real).
 */
export function prettyGroupLabel(label: string): string {
    return displayGroupLabel(label, undefined);
}

/**
 * v0.1.178 — Texto a mostrar para la clave de un grupo: traduce cada
 * value a su ETIQUETA con el mapa del campo (`useGroupLabelMap`) — un
 * multi_select `["a","b"]` sale como "Etiqueta A, Etiqueta B" — y cae al
 * value crudo cuando la opción ya no existe (datos legacy) o el campo no
 * es select (buckets de fecha, textos). `[]` / vacío → "(sin valor)".
 */
export function displayGroupLabel(label: string, labels: Map<string, string> | undefined): string {
    if (label === OTHERS_GROUP_KEY) return __('Otros');
    const one = (v: string): string => labels?.get(v) ?? v;
    if (label.startsWith('[') && label.endsWith(']')) {
        try {
            const arr: unknown = JSON.parse(label);
            if (Array.isArray(arr)) {
                const joined = arr.map((v) => one(String(v))).join(', ');
                return joined === '' ? '(sin valor)' : joined;
            }
        } catch {
            // no era JSON — se muestra tal cual
        }
    }
    return one(label);
}

/**
 * Orden de las opciones del select agrupado: value (o label) → índice.
 *
 * El funnel lo usa para ordenar las etapas según el orden que el
 * usuario definió en las opciones del campo (el orden del pipeline),
 * no por valor. Si el campo no es select devuelve un Map vacío y el
 * consumidor cae a orden por valor descendente.
 */
export function useGroupOptionOrder(
    listId: number | undefined,
    groupByFieldId: number | undefined,
): Map<string, number> {
    const options = useGroupOptions(listId, groupByFieldId);
    return useMemo(() => {
        const map = new Map<string, number>();
        for (const [key, o] of options) map.set(key, o.index);
        return map;
    }, [options]);
}

/**
 * v0.1.102 — "Ocultar grupos en cero" (`config.hide_zero_groups`):
 * condición sobre el RESULTADO del chart. Los grupos cuya métrica dio 0
 * no se dibujan ni aparecen en la leyenda.
 */
export function applyHideZero<T extends { label: string; value: number }>(
    rows: T[],
    enabled: boolean,
): T[] {
    if (! enabled) return rows;
    const filtered = rows.filter((r) => r.value !== 0);
    // Si TODO es 0, mejor mostrar los datos que un chart vacío confuso.
    return filtered.length > 0 ? filtered : rows;
}

/**
 * v0.1.286 — Orden de las categorías de un chart (`config.sort`): por valor
 * (mayor o menor primero), alfabético por la etiqueta, o por el ORDEN DE LAS
 * OPCIONES del campo (el de un pipeline). Sin elegir: las opciones si el campo
 * las tiene, si no por valor. "Otros" siempre al final.
 */
export type ChartSort = 'value_desc' | 'value_asc' | 'label' | 'options';

export function sortChartRows<T extends { label: string; value: number }>(
    rows: T[],
    sort: ChartSort | undefined,
    optionOrder: Map<string, number>,
    labelOf: (label: string) => string,
): T[] {
    const others = rows.filter((r) => r.label === OTHERS_GROUP_KEY);
    const rest = rows.filter((r) => r.label !== OTHERS_GROUP_KEY);
    const mode: ChartSort = sort ?? (optionOrder.size > 0 ? 'options' : 'value_desc');
    const byOption = (r: T): number | undefined => {
        const direct = optionOrder.get(r.label);
        if (direct !== undefined) return direct;
        // multi_select: el combo se ordena por su primera opción.
        if (r.label.startsWith('[')) {
            try {
                const arr: unknown = JSON.parse(r.label);
                if (Array.isArray(arr) && arr.length > 0) return optionOrder.get(String(arr[0]));
            } catch { /* no era JSON */ }
        }
        return undefined;
    };
    const sorted = [...rest].sort((a, b) => {
        if (mode === 'value_asc') return a.value - b.value;
        if (mode === 'label') return labelOf(a.label).localeCompare(labelOf(b.label), 'es');
        if (mode === 'options') {
            const ia = byOption(a);
            const ib = byOption(b);
            if (ia !== undefined && ib !== undefined && ia !== ib) return ia - ib;
            if (ia !== undefined && ib === undefined) return -1;
            if (ia === undefined && ib !== undefined) return 1;
        }
        return b.value - a.value;
    });
    return [...sorted, ...others];
}

/** v0.1.252 — Claves de grupo de la respuesta de un widget (para `useGroupLabelMap`). */
export function groupKeysOf(payload: unknown): string[] {
    if (payload === null || typeof payload !== 'object' || !('data' in payload)) return [];
    const rows = (payload as { data: unknown }).data;
    return Array.isArray(rows)
        ? rows.map((r) => String((r as { label?: unknown }).label ?? ''))
        : [];
}
