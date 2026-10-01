import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
    autoRecordLayout,
    migrateCrmV2ToV3,
    readRecordLayoutV3,
    type AutoLayoutFlavor,
    type AutoLayoutRelation,
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
const FLAVORS: ReadonlySet<string> = new Set(['contact', 'deal', 'task', 'support']);

export function useRecordLayout(
    list: ListSummary,
    fields: FieldEntity[],
): { layout: RecordLayoutV3 | null; origin: LayoutOrigin } {
    const settings = useMemo(() => (list.settings ?? {}) as Record<string, unknown>, [list.settings]);
    const saved = useMemo(() => readRecordLayoutV3(settings), [settings]);
    const templateId = typeof settings.crm_template_id === 'string' ? settings.crm_template_id : 'auto';
    const needsAuto = saved === null && templateId !== 'custom';
    const flavor = (FLAVORS.has(templateId) ? templateId : 'auto') as AutoLayoutFlavor;

    const paths = useRelationPaths(needsAuto ? list.id : undefined);
    const relations = (paths.data ?? []).slice(0, 4);
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
        if (templateId === 'custom') {
            return {
                layout: migrateCrmV2ToV3(getV2Config(settings as never, fields), lite),
                origin: 'converted' as const,
            };
        }
        if (paths.isLoading || !othersReady) return { layout: null, origin: 'auto' as const };
        const rels: AutoLayoutRelation[] = relations.map((p, i) => ({
            relation_field_id: p.relation_field_id,
            direction: p.direction,
            relation_label: p.relation_label,
            other_list_name: p.other_list_name,
            other_fields: (otherFields[i]?.data ?? []).map(toLite),
        }));
        return { layout: autoRecordLayout({ fields: lite, relations: rels, flavor }), origin: 'auto' as const };
        // othersKey resume el estado de las queries de campos del otro lado.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saved, templateId, flavor, fields, paths.isLoading, paths.data, othersReady, othersKey]);
}

export function toLite(f: FieldEntity): LayoutFieldLite {
    return {
        id: f.id,
        slug: f.slug,
        label: f.label,
        type: f.type,
        config: f.config as Record<string, unknown>,
        is_primary: f.is_primary,
    };
}
