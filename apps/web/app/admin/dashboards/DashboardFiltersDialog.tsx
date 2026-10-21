import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { useUpdateDashboard } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isContentWidget, type DashboardEntity, type DashboardFilterDef } from '@/types/dashboard';

import { DASHBOARD_FILTER_TYPES, readDashboardFilterDefs } from './DashboardFiltersBar';

/**
 * v0.1.286 — Qué campos se pueden filtrar en este tablero (Responsable,
 * Estado…). Se guarda en `settings.filters`; quien mira elige el valor arriba
 * del tablero y se aplica a todos los widgets de la lista del campo.
 */
export function DashboardFiltersDialog({
    dashboard,
    open,
    onOpenChange,
}: {
    dashboard: DashboardEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): JSX.Element {
    const update = useUpdateDashboard(dashboard.id);
    const toast = useToast();
    const lists = useLists();
    const [defs, setDefs] = useState<DashboardFilterDef[]>([]);
    const usedListIds = useMemo(
        () => [...new Set(dashboard.widgets.filter((w) => !isContentWidget(w.type) && w.list_id > 0).map((w) => w.list_id))],
        [dashboard.widgets],
    );
    const [listId, setListId] = useState<number>(0);
    const [fieldId, setFieldId] = useState<number>(0);
    const fields = useFields(listId > 0 ? listId : undefined);
    const candidates = (fields.data ?? []).filter(
        (f) => (DASHBOARD_FILTER_TYPES as readonly string[]).includes(f.type) && !defs.some((d) => d.field_id === f.id),
    );

    useEffect(() => {
        if (!open) return;
        setDefs(readDashboardFilterDefs(dashboard.settings));
        setListId(usedListIds[0] ?? 0);
        setFieldId(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const save = async (): Promise<void> => {
        try {
            await update.mutateAsync({ settings: { ...dashboard.settings, filters: defs } });
            onOpenChange(false);
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo guardar'), err.message);
        }
    };

    const listName = (id: number): string => lists.data?.find((l) => l.id === id)?.name ?? `#${id}`;

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Filtros del tablero')}</Dialog.Title>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Elige qué campos se pueden filtrar arriba del tablero. Cada filtro se aplica a todos los widgets de su lista; quien mira elige el valor.')}
                    </Dialog.Description>

                    <ul className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        {defs.length === 0 && (
                            <li className="imcrm-text-xs imcrm-text-muted-foreground">{__('Todavía no hay filtros.')}</li>
                        )}
                        {defs.map((d) => (
                            <li key={d.field_id} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-1.5 imcrm-text-sm">
                                <DefLabel def={d} listName={listName(d.list_id)} />
                                <button
                                    type="button"
                                    onClick={() => setDefs((cur) => cur.filter((x) => x.field_id !== d.field_id))}
                                    className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                    aria-label={__('Quitar filtro')}
                                >
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>

                    {usedListIds.length > 0 ? (
                        <div className="imcrm-mt-4 imcrm-grid imcrm-grid-cols-[1fr_1fr_auto] imcrm-items-end imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="df-list" className="imcrm-text-xs">{__('Lista')}</Label>
                                <Select id="df-list" value={listId} onChange={(e) => { setListId(Number(e.target.value)); setFieldId(0); }}>
                                    {usedListIds.map((id) => (
                                        <option key={id} value={id}>{listName(id)}</option>
                                    ))}
                                </Select>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="df-field" className="imcrm-text-xs">{__('Campo')}</Label>
                                <Select id="df-field" value={fieldId} onChange={(e) => setFieldId(Number(e.target.value))}>
                                    <option value={0}>{__('Elige…')}</option>
                                    {candidates.map((f) => (
                                        <option key={f.id} value={f.id}>{f.label}</option>
                                    ))}
                                </Select>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className="imcrm-gap-1"
                                disabled={fieldId <= 0 || defs.length >= 10}
                                onClick={() => {
                                    setDefs((cur) => [...cur, { list_id: listId, field_id: fieldId }]);
                                    setFieldId(0);
                                }}
                            >
                                <Plus className="imcrm-h-4 imcrm-w-4" />
                                {__('Agregar')}
                            </Button>
                        </div>
                    ) : (
                        <p className="imcrm-mt-4 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Agrega primero un widget con datos: los filtros se eligen entre los campos de sus listas.')}
                        </p>
                    )}
                    <p className="imcrm-mt-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Se pueden filtrar campos de selección, de persona (con la opción «yo») y casillas.')}
                    </p>

                    <div className="imcrm-mt-5 imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                        <Dialog.Close asChild>
                            <Button type="button" variant="outline">{__('Cancelar')}</Button>
                        </Dialog.Close>
                        <Button type="button" onClick={() => void save()} disabled={update.isPending}>
                            {__('Guardar')}
                        </Button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function DefLabel({ def, listName }: { def: DashboardFilterDef; listName: string }): JSX.Element {
    const fields = useFields(def.list_id);
    const field = fields.data?.find((f) => f.id === def.field_id);
    return (
        <span className="imcrm-min-w-0 imcrm-truncate">
            <span className="imcrm-font-medium">{field?.label ?? `#${def.field_id}`}</span>
            <span className="imcrm-text-muted-foreground"> · {listName}</span>
        </span>
    );
}
