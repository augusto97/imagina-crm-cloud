import { useNavigate } from 'react-router-dom';

import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import type { WidgetSpec } from '@/types/dashboard';

/**
 * Click-through de charts (v0.1.100): click en una barra/sector/etapa →
 * abre la lista filtrada a ese segmento (`?gf=<field>&gv=<valor>`, que
 * RecordsPage traduce a un filtro eq / is_null).
 *
 * Devuelve null cuando el segmento NO es navegable: sin campo de grupo,
 * o grupo por fecha bucketeada (un label `2026-07` no es un valor eq).
 */
export function useSegmentNav(widget: WidgetSpec): ((label: string) => void) | null {
    const navigate = useNavigate();
    const lists = useLists();
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);

    const groupFieldId = typeof widget.config.group_by_field_id === 'number'
        ? widget.config.group_by_field_id
        : undefined;
    if (groupFieldId === undefined) return null;

    const field = fields.data?.find((f) => f.id === groupFieldId);
    if (!field || field.type === 'date' || field.type === 'datetime') return null;

    const slug = lists.data?.find((l) => l.id === widget.list_id)?.slug;
    if (slug === undefined) return null;

    const isMulti = field.type === 'multi_select';

    return (label: string): void => {
        const value = label === '(sin valor)' ? '' : label;
        // v0.1.103 — multi_select: el grupo es el JSON crudo del set
        // (`["a","b"]`). Un eq con esa CADENA jamás matchea (el operador
        // compara elementos, no el JSON) → iba a "0 registros". Se navega
        // con `gvs` (lista de valores) y RecordsPage arma un AND de
        // `contains` por valor.
        if (isMulti && value !== '') {
            try {
                const arr: unknown = JSON.parse(value);
                if (Array.isArray(arr) && arr.length > 0) {
                    const vals = arr.map((v) => String(v));
                    navigate(`/lists/${slug}/records?gf=${groupFieldId}&gvs=${encodeURIComponent(JSON.stringify(vals))}`);
                    return;
                }
            } catch {
                // no era JSON — cae al eq normal
            }
        }
        navigate(`/lists/${slug}/records?gf=${groupFieldId}&gv=${encodeURIComponent(value)}`);
    };
}
