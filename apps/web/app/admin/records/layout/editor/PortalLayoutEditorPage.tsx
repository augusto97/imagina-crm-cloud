import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { PortalRelatedList, RecordLayoutV3 } from '@imagina-base/shared';

import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { useRecords } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { RecordEntity } from '@/types/record';

import { LayoutEditor } from './LayoutEditor';

/**
 * v0.1.233 — El editor del PORTAL DEL CLIENTE (`/lists/:slug/portal-editor`):
 * el mismo editor de la ficha (ADR-S26 fase C), apuntado a
 * `portal_layout_v3`. Arranca con el diseño que el servidor resuelve para el
 * cliente (guardado, convertido de la plantilla anterior o automático): lo
 * que se diseña y lo que el cliente ve salen de la misma función.
 */
export function PortalLayoutEditorPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const list = useList(listSlug);
    const fields = useFields(list.data?.id);
    const sample = useRecords(list.data?.id, { page: 1, per_page: 1 });
    const start = useQuery({
        queryKey: ['portal-layout', list.data?.id],
        queryFn: async () => (await api.get<{ layout: RecordLayoutV3; origin: 'saved' | 'legacy' | 'auto' }>(`/lists/${list.data!.slug}/portal/layout`)).data,
        enabled: list.data !== undefined,
        // La foto de arranque se toma una vez: lo que llegue después no pisa lo que se diseña.
        staleTime: Infinity,
        gcTime: 0,
    });
    const related = useQuery({
        queryKey: ['portal-related-options', list.data?.id],
        queryFn: async () => (await api.get<{ options: PortalRelatedList[] }>(`/lists/${list.data!.slug}/portal/related-options`)).data.options,
        enabled: list.data !== undefined,
    });
    const portalLists = useMemo(
        () => (related.data ?? []).filter((r) => r.via === 'user').map((r) => ({ list_id: r.list_id, name: r.name })),
        [related.data],
    );
    const placeholder = useMemo<RecordEntity>(
        () => ({
            id: 0,
            fields: {},
            relations: {},
            parent_id: null,
            subtask_count: 0,
            has_description: false,
            created_by: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }),
        [],
    );

    if (list.isError || start.isError) {
        return <p className="imcrm-p-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar el portal de esta lista.')}</p>;
    }
    if (!list.data || !fields.data || sample.isLoading || !start.data || related.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-10 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Abriendo el editor del portal…')}
            </div>
        );
    }
    return (
        <LayoutEditor
            key={`portal-${list.data.id}`}
            target="portal"
            list={list.data}
            fields={fields.data}
            initial={start.data.layout}
            origin={start.data.origin}
            initialRecord={sample.data?.data[0] ?? placeholder}
            portalLists={portalLists}
        />
    );
}
