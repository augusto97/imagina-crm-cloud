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

/**
 * Mapa label→color CSS para las categorías de un chart agrupado.
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
 * El backend de widgets devuelve los buckets por LABEL de la opción
 * (no por value), así que el mapa se indexa por label.
 */
export function useGroupColorMap(
    listId: number | undefined,
    groupByFieldId: number | undefined,
): Map<string, string> {
    const fields = useFields(listId && listId > 0 ? listId : undefined);

    return useMemo(() => {
        const map = new Map<string, string>();
        if (! groupByFieldId || ! fields.data) return map;
        const field = fields.data.find((f) => f.id === groupByFieldId);
        if (! field) return map;
        if (field.type !== 'select' && field.type !== 'multi_select') return map;
        const options = (field.config as { options?: unknown }).options;
        if (! Array.isArray(options)) return map;
        for (const opt of options) {
            if (typeof opt !== 'object' || opt === null) continue;
            const o = opt as { label?: unknown; value?: unknown; color?: unknown };
            const label = typeof o.label === 'string' && o.label !== ''
                ? o.label
                : typeof o.value === 'string' ? o.value : '';
            if (label === '') continue;
            const css = typeof o.color === 'string' ? colorVar(o.color) : undefined;
            if (css) map.set(label, css);
        }
        return map;
    }, [fields.data, groupByFieldId]);
}

/**
 * Resuelve el color de una categoría: color real de la opción si
 * existe, sino el i-ésimo de la paleta de fallback. Prueba también el
 * label "bonito" (multi_select agrupado devuelve JSON crudo `["a"]` —
 * la opción está registrada por su label plano).
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
    if (label.startsWith('[') && label.endsWith(']')) {
        try {
            const arr: unknown = JSON.parse(label);
            if (Array.isArray(arr)) {
                const joined = arr.map((v) => String(v)).join(', ');
                return joined === '' ? '(sin valor)' : joined;
            }
        } catch {
            // no era JSON — se muestra tal cual
        }
    }
    return label;
}

/**
 * Orden de las opciones del select agrupado: label → índice.
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
    const fields = useFields(listId && listId > 0 ? listId : undefined);

    return useMemo(() => {
        const map = new Map<string, number>();
        if (! groupByFieldId || ! fields.data) return map;
        const field = fields.data.find((f) => f.id === groupByFieldId);
        if (! field) return map;
        if (field.type !== 'select' && field.type !== 'multi_select') return map;
        const options = (field.config as { options?: unknown }).options;
        if (! Array.isArray(options)) return map;
        options.forEach((opt, i) => {
            if (typeof opt !== 'object' || opt === null) return;
            const o = opt as { label?: unknown; value?: unknown };
            const label = typeof o.label === 'string' && o.label !== ''
                ? o.label
                : typeof o.value === 'string' ? o.value : '';
            if (label !== '') map.set(label, i);
        });
        return map;
    }, [fields.data, groupByFieldId]);
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
