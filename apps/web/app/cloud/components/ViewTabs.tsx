import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    type Field,
    type FilterCondition,
    type FilterGroup,
    type View,
    type ViewType,
} from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Tira de vistas guardadas de una lista. Persiste (nombre + tipo + filtros)
 * sobre el subsistema `views` del backend. Al seleccionar, aplica el tipo y
 * los filtros a la lista; al guardar, captura el modo y filtros actuales. El
 * `filter_tree` es AND (el mismo shape que arma la FilterBar).
 */
export function ViewTabs({
    listSlug,
    mode,
    filters,
    dataFields,
    onApply,
}: {
    listSlug: string;
    mode: ViewType;
    filters: FilterCondition[];
    dataFields: Field[];
    onApply: (type: ViewType, filters: FilterCondition[]) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const invalidate = () => qc.invalidateQueries({ queryKey: ['views', tenantId, listSlug] });

    const viewsQ = useQuery({
        queryKey: ['views', tenantId, listSlug],
        queryFn: () => api.listViews(listSlug),
    });

    const save = useMutation({
        mutationFn: () =>
            api.createView(listSlug, {
                name: name.trim(),
                type: mode,
                config: configFor(mode, filters, dataFields),
            }),
        onSuccess: (view) => {
            setNaming(false);
            setName('');
            setError(null);
            setActiveId(view.id);
            void invalidate();
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'No se pudo guardar la vista'),
    });

    const setDefault = useMutation({
        mutationFn: (id: number) => api.updateView(listSlug, id, { is_default: true }),
        onSuccess: () => void invalidate(),
    });
    const remove = useMutation({
        mutationFn: (id: number) => api.deleteView(listSlug, id),
        onSuccess: (_r, id) => {
            if (activeId === id) setActiveId(null);
            void invalidate();
        },
    });

    const select = (view: View) => {
        setActiveId(view.id);
        onApply(view.type, conditionsOf(view.config['filter_tree']));
    };

    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
            {viewsQ.data?.map((view) => (
                <div
                    key={view.id}
                    className={[
                        'imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-sm',
                        activeId === view.id
                            ? 'imcrm-border-primary imcrm-bg-primary/10'
                            : 'imcrm-border-border hover:imcrm-bg-muted',
                    ].join(' ')}
                >
                    <button onClick={() => select(view)} className="imcrm-font-medium">
                        {view.name}
                    </button>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{view.type}</span>
                    <button
                        onClick={() => setDefault.mutate(view.id)}
                        aria-label="Marcar como predeterminada"
                        title={view.is_default ? 'Predeterminada' : 'Marcar predeterminada'}
                        className={view.is_default ? 'imcrm-text-amber-500' : 'imcrm-text-muted-foreground'}
                    >
                        ★
                    </button>
                    <button
                        onClick={() => remove.mutate(view.id)}
                        aria-label={`Eliminar vista ${view.name}`}
                        className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                    >
                        ✕
                    </button>
                </div>
            ))}

            {naming ? (
                <form
                    className="imcrm-flex imcrm-items-center imcrm-gap-1"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim()) save.mutate();
                    }}
                >
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nombre de la vista…"
                        aria-label="Nombre de la vista"
                        autoFocus
                        className="imcrm-h-7 imcrm-w-40"
                    />
                    <Button type="submit" size="sm" disabled={!name.trim() || save.isPending}>
                        Guardar
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>
                        ✕
                    </Button>
                </form>
            ) : (
                <Button variant="ghost" size="sm" onClick={() => setNaming(true)}>
                    + Guardar vista
                </Button>
            )}
            {error && <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>}
        </div>
    );
}

/** Construye el `config` válido para el tipo (parseViewConfig lo valida en back). */
function configFor(
    type: ViewType,
    filters: FilterCondition[],
    dataFields: Field[],
): Record<string, unknown> {
    const filter_tree: FilterGroup | undefined =
        filters.length > 0 ? { type: 'group', logic: 'and', children: filters } : undefined;
    const base: Record<string, unknown> = filter_tree ? { filter_tree } : {};
    if (type === 'kanban') {
        const group = dataFields.find((f) => f.type === 'select');
        return { ...base, group_by_field_id: group?.id ?? dataFields[0]?.id ?? 0 };
    }
    if (type === 'calendar') {
        const date = dataFields.find((f) => f.type === 'date' || f.type === 'datetime');
        return { ...base, date_field_id: date?.id ?? dataFields[0]?.id ?? 0 };
    }
    return base;
}

/** Extrae las condiciones AND de nivel superior de un filter_tree guardado. */
function conditionsOf(tree: unknown): FilterCondition[] {
    if (typeof tree !== 'object' || tree === null) return [];
    const t = tree as { logic?: unknown; children?: unknown };
    if (t.logic !== 'and' || !Array.isArray(t.children)) return [];
    return t.children.filter(
        (c): c is FilterCondition =>
            typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'condition',
    );
}
