import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
    integratedLayoutFlavor,
    integratedRecordLayout,
    INTEGRATED_LAYOUT_RELATIONS,
    migrateCrmV2ToV3,
    readRecordLayoutV3,
    toLayoutFieldLite,
    type AutoLayoutFlavor,
    type LayoutFieldLite,
    type RecordLayoutV3,
} from '@imagina-base/shared';

import { fieldsKeys } from '@/hooks/useFields';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { api } from '@/lib/api';
import { getV2Config } from '@/lib/crmTemplates';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

export type LayoutOrigin = 'saved' | 'converted' | 'auto';

/**
 * v0.1.230 — La plantilla v3 que usa la ficha de una lista, en este orden:
 *  1. la guardada (`settings.record_layout_v3`);
 *  2. la del editor anterior (`custom`), convertida al vuelo — nadie pierde
 *     su diseño;
 *  3. la automática, armada con los campos y las relaciones de la lista
 *     (con los campos de las listas del otro lado, para sus gráficos). Las
 *     integradas (contacto, negocio, tarea, soporte) son variantes de ésta
 *     desde v0.1.234: su grilla vieja (3 · 6 · 3) dejaba columnas angostas
 *     que escondían los valores.
 */
export function useRecordLayout(
    list: ListSummary,
    fields: FieldEntity[],
    /** v0.1.470 — «Probar»: una plantilla integrada, sin mirar lo guardado. */
    previewTemplate?: AutoLayoutFlavor,
): { layout: RecordLayoutV3 | null; origin: LayoutOrigin } {
    const settings = useMemo(() => (list.settings ?? {}) as Record<string, unknown>, [list.settings]);
    const savedLayout = useMemo(() => readRecordLayoutV3(settings), [settings]);
    const saved = previewTemplate !== undefined ? null : savedLayout;
    // v0.1.472 — la misma función que usa el servidor (el bundle de la ficha
    // trae los datos de sus gráficos con la misma firma de bloques).
    const flavor = integratedLayoutFlavor(settings, previewTemplate);
    const needsAuto = saved === null && flavor !== null;

    const paths = useRelationPaths(needsAuto ? list.id : undefined);
    const relations = (paths.data ?? []).slice(0, INTEGRATED_LAYOUT_RELATIONS);
    const otherFields = useQueries({
        queries: relations.map((p) => ({
            queryKey: fieldsKeys.forList(p.other_list_id),
            queryFn: async () => (await api.get<FieldEntity[]>(`/lists/${p.other_list_id}/fields`)).data,
            staleTime: 60_000,
        })),
    });
    const othersReady = otherFields.every((q) => q.data !== undefined || q.isError);
    const othersKey = otherFields.map((q) => q.dataUpdatedAt).join(',');

    return useMemo(() => {
        const lite = fields.map(toLite);
        if (saved) return { layout: saved, origin: 'saved' as const };
        if (flavor === null) {
            return {
                layout: migrateCrmV2ToV3(getV2Config(settings as never, fields), lite),
                origin: 'converted' as const,
            };
        }
        if (paths.isLoading || !othersReady) return { layout: null, origin: 'auto' as const };
        const byList = new Map(relations.map((p, i) => [p.other_list_id, (otherFields[i]?.data ?? []).map(toLite)]));
        return {
            layout: integratedRecordLayout({ flavor, fields: lite, paths: relations, otherFields: (id) => byList.get(id) ?? [] }),
            origin: 'auto' as const,
        };
        // othersKey resume el estado de las queries de campos del otro lado.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saved, flavor, fields, paths.isLoading, paths.data, othersReady, othersKey]);
}

export function toLite(f: FieldEntity): LayoutFieldLite {
    return toLayoutFieldLite(f);
}
