import { useMemo } from 'react';

import { colorVar } from '@/components/ui/color-picker';
import { useFields } from '@/hooks/useFields';

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
): Map<string, string> {
    const options = useGroupOptions(listId, groupByFieldId);
    return useMemo(() => {
        const map = new Map<string, string>();
        for (const [key, o] of options) map.set(key, o.label);
        return map;
    }, [options]);
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
    return map.get(label) ?? map.get(prettyGroupLabel(label)) ?? paletteColor(index);
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
export function applyHideZero(
    rows: Array<{ label: string; value: number }>,
    enabled: boolean,
): Array<{ label: string; value: number }> {
    if (! enabled) return rows;
    const filtered = rows.filter((r) => r.value !== 0);
    // Si TODO es 0, mejor mostrar los datos que un chart vacío confuso.
    return filtered.length > 0 ? filtered : rows;
}
