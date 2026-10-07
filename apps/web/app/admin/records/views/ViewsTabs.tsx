import { useState } from 'react';
import { Calendar, Columns3, Grid3x3, LayoutGrid, MoreHorizontal, Pencil, Plus, Save, Settings2, Star, Table, Trash2, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useDeleteSavedView, useReorderSavedViews, useUpdateSavedView } from '@/hooks/useSavedViews';
import { listColor, listIcon } from '@/lib/listIcons';
import { CAP, useCan } from '@/lib/permissions';
import { IconColorSubmenu } from '@/admin/layout/IconColorSubmenu';
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

    const reorder = useReorderSavedViews(listId);
    const confirm = useConfirm();
    const canManage = useCan(CAP.MANAGE_VIEWS);
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [dragId, setDragId] = useState<number | null>(null);
    const [dropAt, setDropAt] = useState<{ id: number; after: boolean } | null>(null);

    // v0.1.259 — manda la posición (se reordena arrastrando). Antes la vista
    // por defecto iba siempre primero; la migración 0065 fijó ese orden como
    // posición, así que nadie ve sus pestañas moverse.
    const sortedViews = [...views].sort((a, b) => (a.position !== b.position ? a.position - b.position : a.id - b.id));

    const dropOn = (targetId: number, after: boolean): void => {
        if (dragId === null || dragId === targetId) return;
        const ids = sortedViews.map((v) => v.id).filter((id) => id !== dragId);
        const at = ids.indexOf(targetId);
        if (at < 0) return;
        ids.splice(after ? at + 1 : at, 0, dragId);
        if (ids.join(',') !== sortedViews.map((v) => v.id).join(',')) reorder.mutate(ids);
    };

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
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: saved view name */
                __('¿Eliminar la vista "%s"?'),
                view.name,
            ),
            description: __('Los registros no se tocan: sólo se borra esta forma de verlos.'),
            confirmLabel: __('Eliminar vista'),
            destructive: true,
        });
        if (!ok) return;
        await remove.mutateAsync(view.id);
        if (activeViewId === view.id) onSelectView(null);
    };

    return (
        // `overflow-x-auto` a secas NO deja el eje Y en `visible`: el CSS lo
        // convierte a `auto`, y como el contenido mide 1px más que la caja el
        // navegador dibujaba una barra vertical diminuta en el borde derecho
        // de esta fila (v0.1.124). La tira de pestañas sólo scrollea en
        // horizontal.
        <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-border-b imcrm-border-border">
            <ViewTab
                label={__('Todos')}
                active={activeViewId === null}
                onClick={() => onSelectView(null)}
                typeIcon={<Table className="imcrm-h-3.5 imcrm-w-3.5" />}
            />

            {sortedViews.map((view) => {
                const isActive = view.id === activeViewId;
                const Custom = listIcon(view.icon);
                const color = listColor(view.color);
                if (renamingId === view.id) {
                    return (
                        <RenameTab
                            key={view.id}
                            name={view.name}
                            onDone={(name) => {
                                setRenamingId(null);
                                if (name !== null && name !== view.name) update.mutate({ id: view.id, name });
                            }}
                        />
                    );
                }
                return (
                    <ViewTab
                        key={view.id}
                        label={view.name}
                        active={isActive}
                        onClick={() => onSelectView(view)}
                        isDefault={view.is_default}
                        onRename={canManage ? () => setRenamingId(view.id) : undefined}
                        draggable={canManage}
                        dragging={dragId === view.id}
                        dropHint={dropAt?.id === view.id ? (dropAt.after ? 'after' : 'before') : null}
                        onDragStart={() => setDragId(view.id)}
                        onDragEnd={() => {
                            setDragId(null);
                            setDropAt(null);
                        }}
                        onDragOverTab={(after) => {
                            if (dragId !== null && dragId !== view.id) setDropAt({ id: view.id, after });
                        }}
                        onDropTab={(after) => {
                            dropOn(view.id, after);
                            setDragId(null);
                            setDropAt(null);
                        }}
                        typeIcon={
                            Custom ? (
                                <Custom className="imcrm-h-3.5 imcrm-w-3.5" style={color ? { color } : undefined} />
                            ) : view.type === 'kanban' ? (
                                <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : view.type === 'calendar' ? (
                                <Calendar className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : view.type === 'cards' ? (
                                <LayoutGrid className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : view.config.spreadsheet === true ? (
                                // Hoja de cálculo: es una vista `table` con
                                // otra presentación, pero para el usuario es
                                // otro tipo de vista y merece su icono.
                                <Grid3x3 className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : (
                                <Table className="imcrm-h-3.5 imcrm-w-3.5" />
                            )
                        }
                        renderMenu={
                            canManage
                                ? (close) => (
                                      <>
                                          <DropdownMenuItem
                                              data-testid="view-rename-item"
                                              onSelect={() => {
                                                  close();
                                                  setRenamingId(view.id);
                                              }}
                                          >
                                              <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                              {__('Cambiar el nombre')}
                                          </DropdownMenuItem>
                                          <IconColorSubmenu
                                              icon={view.icon ?? null}
                                              color={view.color ?? null}
                                              onChange={(n) => update.mutate({ id: view.id, ...n })}
                                          />
                                          {view.type === 'cards' && (
                                              <DropdownMenuItem onSelect={() => setEditingCardsView(view)}>
                                                  <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                  {__('Editar configuración')}
                                              </DropdownMenuItem>
                                          )}
                                          {view.type === 'kanban' && (
                                              <DropdownMenuItem onSelect={() => setEditingKanbanView(view)}>
                                                  <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
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
                                              <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                              {__('Eliminar vista')}
                                          </DropdownMenuItem>
                                      </>
                                  )
                                : undefined
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
                className="imcrm-flex imcrm-h-8 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-whitespace-nowrap imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
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
    /** Ítems del menú de la pestaña ("···" y click derecho). */
    renderMenu?: (close: () => void) => React.ReactNode;
    /** Doble click en el nombre = cambiarlo (como ClickUp). */
    onRename?: () => void;
    draggable?: boolean;
    dragging?: boolean;
    dropHint?: 'before' | 'after' | null;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onDragOverTab?: (after: boolean) => void;
    onDropTab?: (after: boolean) => void;
}

/** ¿El puntero está en la mitad derecha de la pestaña? */
function isAfter(e: React.DragEvent<HTMLElement>): boolean {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
}

function ViewTab({
    label,
    active,
    onClick,
    isDefault,
    typeIcon,
    renderMenu,
    onRename,
    draggable = false,
    dragging = false,
    dropHint = null,
    onDragStart,
    onDragEnd,
    onDragOverTab,
    onDropTab,
}: ViewTabProps): JSX.Element {
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <div
            draggable={draggable}
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                // Firefox no arranca el drag sin datos.
                e.dataTransfer.setData('text/plain', label);
                onDragStart?.();
            }}
            onDragEnd={onDragEnd}
            onDragOver={
                onDragOverTab
                    ? (e) => {
                          e.preventDefault();
                          onDragOverTab(isAfter(e));
                      }
                    : undefined
            }
            onDrop={
                onDropTab
                    ? (e) => {
                          e.preventDefault();
                          onDropTab(isAfter(e));
                      }
                    : undefined
            }
            onContextMenu={
                renderMenu
                    ? (e) => {
                          e.preventDefault();
                          setMenuOpen(true);
                      }
                    : undefined
            }
            data-testid="view-tab"
            className={cn(
                // Tab estilo ClickUp: fila de 32px, nombre 13px medium,
                // subrayado 2px que pisa (-mb-px) el border-b del
                // contenedor. Sin wrap: la tab bar scrollea horizontal en
                // mobile.
                'imcrm-group/tab imcrm-relative imcrm--mb-px imcrm-flex imcrm-h-8 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-whitespace-nowrap imcrm-border-b-2 imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-text-foreground'
                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-bg-muted/40 hover:imcrm-text-foreground',
                dragging && 'imcrm-opacity-40',
            )}
        >
            {dropHint && (
                <span
                    aria-hidden
                    className={cn(
                        'imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-1 imcrm-w-0.5 imcrm-rounded imcrm-bg-primary',
                        dropHint === 'before' ? 'imcrm-left-0' : 'imcrm-right-0',
                    )}
                />
            )}
            <button
                type="button"
                onClick={onClick}
                onDoubleClick={onRename}
                title={onRename ? __('Doble click para cambiar el nombre · arrastrá para reordenar') : undefined}
                className="imcrm-flex imcrm-items-center imcrm-gap-1.5"
            >
                {isDefault && <Star className="imcrm-h-3 imcrm-w-3 imcrm-text-warning" aria-label={__('Vista por defecto')} />}
                {typeIcon && (
                    <span aria-hidden className="imcrm-flex imcrm-text-muted-foreground">
                        {typeIcon}
                    </span>
                )}
                <span>{label}</span>
            </button>
            {renderMenu && (
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={__('Acciones de la vista')}
                            data-testid="view-tab-menu"
                            className={cn(
                                'imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                                // Visible en la activa, al pasar el mouse o con
                                // el menú abierto; tenue en táctil.
                                active || menuOpen
                                    ? 'imcrm-opacity-100'
                                    : 'imcrm-opacity-40 lg:imcrm-opacity-0 group-hover/tab:imcrm-opacity-100',
                            )}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="imcrm-min-w-[13rem]">
                        {renderMenu(() => setMenuOpen(false))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

/** Pestaña en modo "cambiar el nombre": Enter guarda, Escape cancela. */
function RenameTab({ name, onDone }: { name: string; onDone: (next: string | null) => void }): JSX.Element {
    const [draft, setDraft] = useState(name);
    const finish = (save: boolean): void => {
        const next = draft.trim();
        onDone(save && next !== '' ? next : null);
    };
    return (
        <div className="imcrm--mb-px imcrm-flex imcrm-h-8 imcrm-shrink-0 imcrm-items-center imcrm-border-b-2 imcrm-border-primary imcrm-px-1">
            <Input
                autoFocus
                value={draft}
                maxLength={190}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => finish(true)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') finish(true);
                    if (e.key === 'Escape') finish(false);
                }}
                aria-label={__('Nombre de la vista')}
                data-testid="view-rename"
                className="imcrm-h-6 imcrm-w-40 imcrm-text-[13px]"
            />
        </div>
    );
}
