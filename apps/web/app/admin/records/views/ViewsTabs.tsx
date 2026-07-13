import { useState } from 'react';
import { Calendar, Columns3, LayoutGrid, MoreHorizontal, Pencil, Plus, Save, Star, Table, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeleteSavedView, useUpdateSavedView } from '@/hooks/useSavedViews';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SavedViewConfig, SavedViewEntity } from '@/types/view';

import { EditCardsViewDialog } from './EditCardsViewDialog';
import { EditKanbanViewDialog } from './EditKanbanViewDialog';

interface ViewsTabsProps {
    listId: number;
    views: SavedViewEntity[];
    activeViewId: number | null;
    onSelectView: (view: SavedViewEntity | null) => void;
    isDirty: boolean;
    currentConfig: SavedViewConfig;
    onAskCreateView: () => void;
}

/**
 * Tab bar de vistas guardadas tipo ClickUp (subrayado 2px en la activa).
 *
 * - Tab "Todos" virtual al inicio: vista neutra sin filters/sort/search.
 * - Tabs por cada vista persistida (icono por view_type + nombre);
 *   estrella si es default.
 * - Tab activa con subrayado primary + dropdown "..." con acciones
 *   (editar config, set default, eliminar). Inactivas en muted.
 * - "+ Vista" al final para crear vista a partir del estado actual
 *   (abre el SaveViewDialog del padre).
 * - Cuando el estado actual difiere de la vista activa: badge "modificado"
 *   + botones "Guardar" (PATCH) y "Descartar" (re-aplica config persistida).
 * - Mobile: scroll horizontal (sin wrap).
 */
export function ViewsTabs({
    listId,
    views,
    activeViewId,
    onSelectView,
    isDirty,
    currentConfig,
    onAskCreateView,
}: ViewsTabsProps): JSX.Element {
    const update = useUpdateSavedView(listId);
    const remove = useDeleteSavedView(listId);
    const [editingCardsView, setEditingCardsView] = useState<SavedViewEntity | null>(null);
    const [editingKanbanView, setEditingKanbanView] = useState<SavedViewEntity | null>(null);

    const sortedViews = [...views].sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        if (a.position !== b.position) return a.position - b.position;
        return a.id - b.id;
    });

    const activeView = activeViewId !== null ? views.find((v) => v.id === activeViewId) ?? null : null;

    const handleSaveChanges = async (): Promise<void> => {
        if (!activeView) return;
        await update.mutateAsync({ id: activeView.id, config: currentConfig });
    };

    const handleDiscardChanges = (): void => {
        if (!activeView) return;
        // Reaplica la vista actual: el padre recibe el evento y restaura.
        onSelectView(activeView);
    };

    const handleSetDefault = async (view: SavedViewEntity): Promise<void> => {
        await update.mutateAsync({ id: view.id, is_default: true });
    };

    const handleDelete = async (view: SavedViewEntity): Promise<void> => {
        if (
            !confirm(
                sprintf(
                    /* translators: %s: saved view name */
                    __('Eliminar la vista "%s"? Esta acción no afecta los registros.'),
                    view.name,
                ),
            )
        )
            return;
        await remove.mutateAsync(view.id);
        if (activeViewId === view.id) onSelectView(null);
    };

    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-overflow-x-auto imcrm-border-b imcrm-border-border">
            <ViewTab
                label={__('Todos')}
                active={activeViewId === null}
                onClick={() => onSelectView(null)}
                typeIcon={<Table className="imcrm-h-3.5 imcrm-w-3.5" />}
            />

            {sortedViews.map((view) => {
                const isActive = view.id === activeViewId;
                return (
                    <ViewTab
                        key={view.id}
                        label={view.name}
                        active={isActive}
                        onClick={() => onSelectView(view)}
                        isDefault={view.is_default}
                        typeIcon={
                            view.type === 'kanban' ? (
                                <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : view.type === 'calendar' ? (
                                <Calendar className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : view.type === 'cards' ? (
                                <LayoutGrid className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : (
                                <Table className="imcrm-h-3.5 imcrm-w-3.5" />
                            )
                        }
                        rightAction={
                            isActive ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label={__('Acciones de la vista')}
                                            className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <MoreHorizontal className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        {view.type === 'cards' && (
                                            <DropdownMenuItem onSelect={() => setEditingCardsView(view)}>
                                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Editar configuración')}
                                            </DropdownMenuItem>
                                        )}
                                        {view.type === 'kanban' && (
                                            <DropdownMenuItem onSelect={() => setEditingKanbanView(view)}>
                                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Editar configuración')}
                                            </DropdownMenuItem>
                                        )}
                                        {!view.is_default && (
                                            <DropdownMenuItem onSelect={() => void handleSetDefault(view)}>
                                                <Star className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Establecer por defecto')}
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem danger onSelect={() => void handleDelete(view)}>
                                            {__('Eliminar vista')}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : null
                        }
                    />
                );
            })}

            {/*
              "+ Vista" al final de la tab bar (patrón ClickUp): guarda
              el estado actual (filtros/orden/columnas) como una vista
              nombrada via el SaveViewDialog del padre.
            */}
            <button
                type="button"
                onClick={onAskCreateView}
                title={__('Guardar filtros, ordenamiento y columnas como una vista nombrada')}
                className="imcrm-flex imcrm-h-9 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-whitespace-nowrap imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                aria-label={__('Crear vista nueva')}
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Vista')}
            </button>

            {isDirty && activeView !== null && (
                <div className="imcrm-ml-auto imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-pl-3">
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cambios sin guardar')}</span>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDiscardChanges}
                        disabled={update.isPending}
                        className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                    >
                        <Undo2 className="imcrm-h-3 imcrm-w-3" />
                        {__('Descartar')}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => void handleSaveChanges()}
                        disabled={update.isPending}
                        className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                    >
                        <Save className="imcrm-h-3 imcrm-w-3" />
                        {update.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                </div>
            )}

            {isDirty && activeView === null && (
                <div className="imcrm-ml-auto imcrm-shrink-0 imcrm-pl-3">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onAskCreateView}
                        className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                    >
                        <Save className="imcrm-h-3 imcrm-w-3" />
                        {__('Guardar como vista…')}
                    </Button>
                </div>
            )}

            {editingCardsView && (
                <EditCardsViewDialog
                    listId={listId}
                    view={editingCardsView}
                    open={editingCardsView !== null}
                    onOpenChange={(open) => {
                        if (! open) setEditingCardsView(null);
                    }}
                />
            )}

            {editingKanbanView && (
                <EditKanbanViewDialog
                    listId={listId}
                    view={editingKanbanView}
                    open={editingKanbanView !== null}
                    onOpenChange={(open) => {
                        if (! open) setEditingKanbanView(null);
                    }}
                />
            )}
        </div>
    );
}

interface ViewTabProps {
    label: string;
    active: boolean;
    onClick: () => void;
    isDefault?: boolean;
    typeIcon?: React.ReactNode;
    rightAction?: React.ReactNode;
}

function ViewTab({ label, active, onClick, isDefault, typeIcon, rightAction }: ViewTabProps): JSX.Element {
    return (
        <div
            className={cn(
                // Tab estilo ClickUp: fila de ~36px (h-9), nombre 13px
                // medium, subrayado 2px que pisa (-mb-px) el border-b
                // del contenedor. Sin wrap: la tab bar scrollea
                // horizontal en mobile.
                'imcrm--mb-px imcrm-flex imcrm-h-9 imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-border-b-2 imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-text-foreground'
                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-bg-muted/40 hover:imcrm-text-foreground',
            )}
        >
            <button type="button" onClick={onClick} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                {isDefault && <Star className="imcrm-h-3 imcrm-w-3 imcrm-text-warning" />}
                {typeIcon && (
                    <span aria-hidden className="imcrm-text-muted-foreground">
                        {typeIcon}
                    </span>
                )}
                <span>{label}</span>
            </button>
            {rightAction}
        </div>
    );
}
