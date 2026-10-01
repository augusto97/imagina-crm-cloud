import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Loader2 } from 'lucide-react';

import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { useRecords } from '@/hooks/useRecords';
import { __ } from '@/lib/i18n';
import type { RecordEntity } from '@/types/record';

import { useRecordLayout } from '../useRecordLayout';
import { LayoutEditor } from './LayoutEditor';

/**
 * v0.1.231 — Ruta del editor de la ficha (`/lists/:slug/template-editor`).
 * Espera lista, campos y la plantilla de arranque (la guardada, la
 * convertida del editor anterior o la automática) y monta el editor UNA vez
 * con esa foto: lo que llegue después del servidor no pisa lo que se está
 * diseñando.
 */
export function RecordLayoutEditorPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const list = useList(listSlug);
    const fields = useFields(list.data?.id);
    const sample = useRecords(list.data?.id, { page: 1, per_page: 1 });

    if (list.isError) {
        return <p className="imcrm-p-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar la lista.')}</p>;
    }
    if (!list.data || !fields.data || sample.isLoading) return <Loading />;
    return <Loaded key={list.data.id} list={list.data} fields={fields.data} sample={sample.data?.data[0] ?? null} />;
}

function Loaded({ list, fields, sample }: Pick<Parameters<typeof LayoutEditor>[0], 'list' | 'fields'> & { sample: RecordEntity | null }): JSX.Element {
    const { layout, origin } = useRecordLayout(list, fields);
    // La foto de arranque se toma una sola vez.
    const [initial, setInitial] = useState(layout);
    useEffect(() => {
        if (initial === null && layout !== null) setInitial(layout);
    }, [initial, layout]);
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
    if (initial === null) return <Loading />;
    return <LayoutEditor list={list} fields={fields} initial={initial} origin={origin} initialRecord={sample ?? placeholder} />;
}

function Loading(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-10 imcrm-text-sm imcrm-text-muted-foreground">
            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Abriendo el editor…')}
        </div>
    );
}
