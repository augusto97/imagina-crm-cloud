import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { jsonbKeyForField, type PortalBoot, type RecordLayoutV3 } from '@imagina-base/shared';

import { LayoutContext, type LayoutCtx } from '@/admin/records/layout/LayoutContext';
import { resolveTheme } from '@/admin/records/layout/layoutTheme';
import { LayoutBody } from '@/admin/records/layout/RecordLayoutView';
import { portalApi } from '@/cloud-portal/portalClient';
import { WidgetDataOverrideContext, widgetErrorOf, type WidgetDataOverride } from '@/hooks/useDashboards';
import { fieldsKeys } from '@/hooks/useFields';
import { listsKeys } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import type { WidgetData } from '@/types/dashboard';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

const DELAY_MS = 700;

/**
 * v0.1.233 — El portal del cliente dibujado con la MISMA vista que la ficha
 * del equipo (ADR-S26 fase C): cabecera, pestañas, secciones con columnas,
 * cada campo con su forma, gráficos y tablas de lo vinculado. Lo distinto es
 * de dónde salen las cosas:
 *  - los datos de los gráficos y tablas llegan en `GET /portal/me` (ya
 *    acotados al cliente); las definiciones de campos/listas que usan se
 *    siembran en el cache para que los componentes de los tableros pinten
 *    colores y etiquetas SIN pedirle nada a la API del equipo;
 *  - sólo se editan los campos de los bloques marcados `editable` y se
 *    guardan solos contra `PATCH /portal/me`.
 */
export function PortalLayout({ boot, layout }: { boot: PortalBoot; layout: RecordLayoutV3 }): JSX.Element {
    const qc = useQueryClient();
    // Antes del primer render: los widgets leen el cache al montar.
    useState(() => seedCaches(qc, boot));
    useEffect(() => seedCaches(qc, boot), [qc, boot]);

    const fields = boot.fields as unknown as FieldEntity[];
    const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const record = useMemo<RecordEntity>(() => {
        const bySlug: Record<string, unknown> = {};
        for (const f of boot.fields) {
            const key = jsonbKeyForField(f.id);
            if (key in boot.record.data) bySlug[f.slug] = boot.record.data[key];
        }
        return {
            id: boot.record.id,
            fields: bySlug,
            relations: {},
            parent_id: null,
            subtask_count: 0,
            has_description: false,
            created_by: 0,
            created_at: boot.record.created_at,
            updated_at: boot.record.updated_at,
        };
    }, [boot]);
    const editable = useMemo(() => new Set(boot.editable_field_ids ?? []), [boot.editable_field_ids]);
    const save = usePortalAutosave(record);
    const data = boot.layout_data?.data;
    const theme = resolveTheme(layout.theme);

    const override = useMemo<WidgetDataOverride>(
        () => ({
            get(widgetId) {
                const raw = data?.[widgetId];
                const failed = widgetErrorOf(raw);
                return {
                    data: failed === null ? (raw as WidgetData | undefined) : undefined,
                    isLoading: false,
                    error: failed !== null ? new Error(failed) : null,
                };
            },
        }),
        [data],
    );

    const ctx: LayoutCtx = {
        list: { id: boot.list_id, slug: boot.list_slug, name: boot.list_name } as ListSummary,
        record,
        fields,
        fieldsById,
        values: save.values,
        setValue: save.setValue,
        errors: save.errors,
        lockedReasons: {},
        canEdit: editable.size > 0,
        theme,
        currentUserId: boot.user_id,
        isAdmin: false,
        data,
        dataLoading: false,
        mode: 'portal',
        canEditField: (f) => editable.has(f.id),
        portalBoot: { rest_root: '/api/v1', list_slug: boot.list_slug, user_id: boot.user_id, record_id: boot.record.id },
        blockLists: boot.layout_data?.block_lists,
    };

    return (
        <LayoutContext.Provider value={ctx}>
            <WidgetDataOverrideContext.Provider value={override}>
                <div className="imcrm-lay-root imcrm-flex imcrm-flex-col" style={{ gap: theme.gap }} data-testid="imcrm-portal-layout">
                    {save.saving && (
                        <span className="imcrm-self-end imcrm-text-xs imcrm-text-muted-foreground" aria-live="polite">
                            Guardando…
                        </span>
                    )}
                    <LayoutBody layout={layout} />
                </div>
            </WidgetDataOverrideContext.Provider>
        </LayoutContext.Provider>
    );
}

/** Siembra las definiciones que usan los bloques (no se piden: no caducan). */
function seedCaches(qc: QueryClient, boot: PortalBoot): void {
    const ld = boot.layout_data;
    if (!ld) return;
    qc.setQueryDefaults(fieldsKeys.all, { staleTime: Infinity, retry: false });
    qc.setQueryDefaults(listsKeys.all, { staleTime: Infinity, retry: false });
    for (const [listId, fs] of Object.entries(ld.fields)) qc.setQueryData(fieldsKeys.forList(listId), fs);
    // La lista del portal también (cabeceras de los gráficos de la propia lista).
    qc.setQueryData(fieldsKeys.forList(boot.list_id), boot.fields);
    qc.setQueryData(listsKeys.list(), [
        { id: boot.list_id, slug: boot.list_slug, name: boot.list_name },
        ...Object.values(ld.lists).filter((l) => l.id !== boot.list_id),
    ]);
}

/**
 * Guarda sola lo que el cliente corrige (como la ficha del equipo): junta
 * los cambios unos instantes y manda sólo esos campos. El servidor vuelve a
 * chequear la whitelist del diseño.
 */
function usePortalAutosave(record: RecordEntity) {
    const qc = useQueryClient();
    const server = record.fields;
    const [values, setValues] = useState<Record<string, unknown>>(server);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const pending = useRef<Record<string, unknown>>({});
    const timer = useRef<number | null>(null);

    useEffect(() => {
        setValues((local) => {
            const next = { ...server };
            for (const k of Object.keys(pending.current)) next[k] = local[k];
            return next;
        });
    }, [server]);

    const flush = useCallback(async (): Promise<void> => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        const patch = pending.current;
        if (Object.keys(patch).length === 0) return;
        pending.current = {};
        setSaving(true);
        try {
            await portalApi.portalUpdateMe(patch);
            setErrors((e) => {
                const next = { ...e };
                for (const k of Object.keys(patch)) delete next[k];
                return next;
            });
            // Los gráficos pueden depender de lo que cambió.
            void qc.invalidateQueries({ queryKey: ['portal-me'] });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'No se pudo guardar';
            const byField = err instanceof CloudApiError && Object.keys(err.errors).length > 0 ? err.errors : null;
            setErrors((e) => ({ ...e, ...(byField ?? Object.fromEntries(Object.keys(patch).map((k) => [k, msg]))) }));
        } finally {
            setSaving(false);
        }
    }, [qc]);

    const setValue = useCallback(
        (slug: string, value: unknown): void => {
            setValues((v) => ({ ...v, [slug]: value }));
            pending.current = { ...pending.current, [slug]: value };
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void flush(), DELAY_MS);
        },
        [flush],
    );

    const flushRef = useRef(flush);
    flushRef.current = flush;
    useEffect(() => () => void flushRef.current(), []);

    return { values, setValue, errors, saving };
}
