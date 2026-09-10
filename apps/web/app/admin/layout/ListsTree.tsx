import { useEffect, useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    FolderPlus,
    MoreHorizontal,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
    useCreateListGroup,
    useDeleteListGroup,
    useListGroups,
    useMoveListToGroup,
    useUpdateListGroup,
} from '@/hooks/useListGroups';
import { DEFAULT_FOLDER_ICON, listColor, listIcon } from '@/lib/listIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ListGroup, ListSummary } from '@/types/list';

import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';

import { IconColorSubmenu } from './IconColorSubmenu';
import { ListPanelItem } from './ListPanelItem';
import { usePeekHold } from './peekHold';

const COLLAPSED_KEY = 'imcrm:list-groups:collapsed';

function readCollapsed(): number[] {
    try {
        const raw = localStorage.getItem(COLLAPSED_KEY);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
    } catch {
        return [];
    }
}

interface ListsTreeProps {
    lists: ListSummary[];
    canManageLists: boolean;
    starredIds: number[];
    onToggleStar: (listId: number) => void;
    /** Reordenar dentro de la raíz (drop de una lista sobre otra). */
    onReorder: (targetIndex: number) => void;
    dragIndexRef: React.MutableRefObject<number | null>;
}

/**
 * Árbol del panel de listas con CARPETAS (v0.1.130).
 *
 * Un solo nivel, como pidió el usuario mirando ClickUp: una carpeta agrupa
 * listas y lo que no está en ninguna cuelga de la raíz. La jerarquía completa
 * de ClickUp (espacio → carpeta → lista) agrega dos niveles de navegación
 * para el mismo resultado.
 *
 * Arrastrar una lista SOBRE OTRA la reordena (comportamiento de v0.1.107);
 * arrastrarla sobre el encabezado de una carpeta la mueve ahí, y sobre el
 * encabezado de la raíz la saca de la carpeta. Son dos gestos distintos
 * sobre destinos distintos, así que no se pisan.
 *
 * v0.1.173 — la carpeta tiene ICONO con color (como los espacios de ClickUp:
 * un cuadrado de color con el icono, que al pasar el mouse se convierte en
 * la flecha de plegar) y su propio MENÚ CONTEXTUAL ("…" al hover y click
 * derecho): renombrar, color e ícono, nueva lista adentro, plegar/desplegar,
 * carpeta nueva y eliminar. Y un "+" al hover que crea una lista adentro.
 */
export function ListsTree({
    lists,
    canManageLists,
    starredIds,
    onToggleStar,
    onReorder,
    dragIndexRef,
}: ListsTreeProps): JSX.Element {
    const groups = useListGroups();
    const createGroup = useCreateListGroup();
    const move = useMoveListToGroup();

    const [collapsed, setCollapsed] = useState<number[]>(readCollapsed);
    const [creating, setCreating] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [dropTarget, setDropTarget] = useState<number | 'root' | null>(null);

    const toggleCollapsed = (id: number): void => {
        setCollapsed((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            try {
                localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
            } catch {
                /* storage bloqueado: la preferencia no persiste */
            }
            return next;
        });
    };

    const byGroup = useMemo(() => {
        const map = new Map<number | null, ListSummary[]>();
        for (const l of lists) {
            const key = l.group_id ?? null;
            const arr = map.get(key);
            if (arr) arr.push(l);
            else map.set(key, [l]);
        }
        return map;
    }, [lists]);

    const rootLists = byGroup.get(null) ?? [];
    const sortedGroups = [...(groups.data ?? [])].sort(
        (a, b) => a.position - b.position || a.id - b.id,
    );

    /** Índice de la lista dentro del array COMPLETO (lo que espera el reorder). */
    const indexOf = (list: ListSummary): number => lists.findIndex((l) => l.id === list.id);

    const startCreating = (): void => {
        setDraftName('');
        setCreating(true);
    };

    const submitNewGroup = (): void => {
        const name = draftName.trim();
        setCreating(false);
        setDraftName('');
        if (name !== '') createGroup.mutate(name);
    };

    const dropOn = (groupId: number | null) => (e: React.DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);
        const from = dragIndexRef.current;
        dragIndexRef.current = null;
        const dragged = from !== null ? lists[from] : undefined;
        if (!dragged || (dragged.group_id ?? null) === groupId) return;
        move.mutate({ listId: dragged.id, groupId });
    };

    const renderList = (list: ListSummary): JSX.Element => (
        <li
            key={list.id}
            draggable={canManageLists}
            onDragStart={() => {
                dragIndexRef.current = indexOf(list);
            }}
            onDragOver={(e) => {
                if (canManageLists) e.preventDefault();
            }}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onReorder(indexOf(list));
            }}
        >
            {/* v0.1.172 — con menú contextual ("…" + click derecho). */}
            <ListPanelItem
                list={list}
                starred={starredIds.includes(list.id)}
                onToggleStar={() => onToggleStar(list.id)}
            />
        </li>
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-px-2.5 imcrm-pb-1">
                <h3 className="imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground">
                    {__('Espacio de trabajo')}
                </h3>
                {canManageLists && (
                    <button
                        type="button"
                        title={__('Nueva carpeta')}
                        aria-label={__('Nueva carpeta')}
                        onClick={(e) => {
                            e.stopPropagation();
                            startCreating();
                        }}
                        className="imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground lg:imcrm-p-0.5"
                    >
                        <FolderPlus className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
                    </button>
                )}
            </div>

            {creating && (
                <div className="imcrm-px-1 imcrm-pb-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={submitNewGroup}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitNewGroup();
                            if (e.key === 'Escape') {
                                setCreating(false);
                                setDraftName('');
                            }
                        }}
                        placeholder={__('Nombre de la carpeta')}
                        className="imcrm-h-7 imcrm-text-[13px]"
                    />
                </div>
            )}

            {sortedGroups.map((group) => {
                const inside = byGroup.get(group.id) ?? [];
                const isCollapsed = collapsed.includes(group.id);
                return (
                    <div key={group.id} className="imcrm-flex imcrm-flex-col">
                        <FolderHeader
                            group={group}
                            count={inside.length}
                            collapsed={isCollapsed}
                            canManage={canManageLists}
                            isDropTarget={dropTarget === group.id}
                            onToggle={() => toggleCollapsed(group.id)}
                            onNewFolder={startCreating}
                            onDragOver={(e) => {
                                if (!canManageLists) return;
                                e.preventDefault();
                                setDropTarget(group.id);
                            }}
                            onDragLeave={() => setDropTarget((t) => (t === group.id ? null : t))}
                            onDrop={dropOn(group.id)}
                        />

                        {!isCollapsed && (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-pl-3">
                                {inside.length === 0 ? (
                                    <li className="imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__('Arrastrá listas acá')}
                                    </li>
                                ) : (
                                    inside.map(renderList)
                                )}
                            </ul>
                        )}
                    </div>
                );
            })}

            {/* Raíz: además de listar, es el destino para SACAR de una carpeta. */}
            <ul
                onDragOver={(e) => {
                    if (!canManageLists) return;
                    e.preventDefault();
                    setDropTarget('root');
                }}
                onDragLeave={() => setDropTarget((t) => (t === 'root' ? null : t))}
                onDrop={dropOn(null)}
                className={cn(
                    'imcrm-flex imcrm-min-h-[8px] imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-md',
                    dropTarget === 'root' && 'imcrm-bg-primary/10 imcrm-ring-1 imcrm-ring-primary/40',
                )}
            >
                {rootLists.map(renderList)}
            </ul>
        </div>
    );
}

/**
 * Cabecera de una carpeta (v0.1.173): icono de color que se vuelve chevron al
 * hover, nombre, contador, "+" (nueva lista adentro) y menú contextual —
 * el mismo patrón de fila que `PanelListLink`, con click derecho incluido.
 */
function FolderHeader({
    group,
    count,
    collapsed,
    canManage,
    isDropTarget,
    onToggle,
    onNewFolder,
    onDragOver,
    onDragLeave,
    onDrop,
}: {
    group: ListGroup;
    count: number;
    collapsed: boolean;
    canManage: boolean;
    isDropTarget: boolean;
    onToggle: () => void;
    onNewFolder: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
}): JSX.Element {
    const updateGroup = useUpdateListGroup();
    const deleteGroup = useDeleteListGroup();
    const confirm = useConfirm();
    const peekHold = usePeekHold();

    const [menuOpen, setMenuOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(group.name);
    const [createOpen, setCreateOpen] = useState(false);

    // El flotante del riel se sostiene mientras el menú o el diálogo de
    // "nueva lista" sigan abiertos (mismo criterio que las filas de lista).
    const held = menuOpen || createOpen;
    useEffect(() => {
        peekHold(held);
    }, [held, peekHold]);
    useEffect(() => () => peekHold(false), [peekHold]);

    const Icon = listIcon(group.icon) ?? DEFAULT_FOLDER_ICON;
    const color = listColor(group.color);

    const submitRename = (): void => {
        const name = draft.trim();
        setRenaming(false);
        if (name !== '' && name !== group.name) updateGroup.mutate({ id: group.id, name });
    };

    const removeGroup = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: folder name */
                __('¿Eliminar la carpeta "%s"?'),
                group.name,
            ),
            description:
                count > 0
                    ? sprintf(
                          /* translators: %d: list count */
                          __('Las %d listas que tiene adentro no se borran: vuelven al nivel de arriba.'),
                          count,
                      )
                    : __('La carpeta está vacía.'),
            confirmLabel: __('Eliminar carpeta'),
            destructive: true,
        });
        if (ok) deleteGroup.mutate(group.id);
    };

    if (renaming) {
        return (
            <div className="imcrm-px-1 imcrm-py-0.5" onClick={(e) => e.stopPropagation()}>
                <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={submitRename}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename();
                        if (e.key === 'Escape') setRenaming(false);
                    }}
                    data-testid="folder-rename"
                    className="imcrm-h-7 imcrm-text-[13px]"
                />
            </div>
        );
    }

    return (
        <>
            <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onContextMenu={
                    canManage
                        ? (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMenuOpen(true);
                          }
                        : undefined
                }
                data-testid="folder-header"
                className={cn(
                    // v0.1.169 — cabecera de carpeta a 40px en mobile (objetivo
                    // táctil), compacta en lg.
                    'imcrm-group/gr imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 lg:imcrm-min-h-0',
                    isDropTarget
                        ? 'imcrm-bg-primary/10 imcrm-ring-1 imcrm-ring-primary/40'
                        : menuOpen
                          ? 'imcrm-bg-accent/60'
                          : 'hover:imcrm-bg-accent/40',
                )}
            >
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                    }}
                    aria-expanded={!collapsed}
                    className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-left"
                >
                    {/* Icono de color que se vuelve chevron al hover (ClickUp).
                        En táctil no hay hover: queda el icono, y el toque en
                        la fila pliega igual. */}
                    <span
                        aria-hidden
                        data-testid="folder-icon"
                        className={cn(
                            'imcrm-relative imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-[5px] imcrm-text-white',
                            color === undefined && 'imcrm-bg-muted-foreground/70',
                        )}
                        style={color !== undefined ? { backgroundColor: color } : undefined}
                    >
                        <Icon className="imcrm-h-3 imcrm-w-3 group-hover/gr:imcrm-hidden" />
                        <span
                            className={cn(
                                'imcrm-hidden imcrm-items-center imcrm-justify-center group-hover/gr:imcrm-flex',
                            )}
                        >
                            {collapsed ? (
                                <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />
                            ) : (
                                <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />
                            )}
                        </span>
                    </span>
                    <span className="imcrm-truncate imcrm-text-[14px] imcrm-font-medium lg:imcrm-text-[13px]">
                        {group.name}
                    </span>
                    <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground group-hover/gr:imcrm-hidden">
                        {count}
                    </span>
                </button>
                {canManage && (
                    <>
                        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={sprintf(
                                        /* translators: %s: folder name */
                                        __('Acciones de %s'),
                                        group.name,
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid="folder-menu"
                                    // En táctil no hay hover: el menú queda
                                    // visible tenue (v0.1.169).
                                    className={cn(
                                        'imcrm-shrink-0 imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground imcrm-opacity-50 hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover/gr:imcrm-opacity-100 lg:imcrm-p-0.5 lg:imcrm-opacity-0',
                                        menuOpen && 'imcrm-text-foreground lg:imcrm-opacity-100',
                                    )}
                                >
                                    <MoreHorizontal className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="imcrm-min-w-[13rem]"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <DropdownMenuItem
                                    onSelect={() => {
                                        setDraft(group.name);
                                        setRenaming(true);
                                    }}
                                    data-testid="folder-rename-item"
                                >
                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Cambiar el nombre')}
                                </DropdownMenuItem>
                                <IconColorSubmenu
                                    icon={group.icon}
                                    color={group.color}
                                    onChange={(n) => updateGroup.mutate({ id: group.id, ...n })}
                                />
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => setCreateOpen(true)} data-testid="folder-new-list">
                                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Nueva lista en esta carpeta')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={onNewFolder}>
                                    <FolderPlus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Nueva carpeta')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={onToggle}>
                                    {collapsed ? (
                                        <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                    ) : (
                                        <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />
                                    )}
                                    {collapsed ? __('Desplegar') : __('Plegar')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem danger onSelect={() => void removeGroup()} data-testid="folder-delete">
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Eliminar carpeta')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {/* "+" al hover: nueva lista adentro (como ClickUp). */}
                        <button
                            type="button"
                            title={__('Nueva lista en esta carpeta')}
                            aria-label={sprintf(
                                /* translators: %s: folder name */
                                __('Nueva lista en %s'),
                                group.name,
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                setCreateOpen(true);
                            }}
                            data-testid="folder-add"
                            className={cn(
                                'imcrm-shrink-0 imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground imcrm-opacity-50 hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover/gr:imcrm-opacity-100 lg:imcrm-p-0.5 lg:imcrm-opacity-0',
                                menuOpen && 'lg:imcrm-opacity-100',
                            )}
                        >
                            <Plus className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
                        </button>
                    </>
                )}
            </div>
            {createOpen && (
                <ListCreateDialog
                    open
                    onOpenChange={setCreateOpen}
                    groupId={group.id}
                    groupName={group.name}
                />
            )}
        </>
    );
}
