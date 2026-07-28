import { useMemo, useState } from 'react';
import { ChevronRight, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

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
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ListGroup, ListSummary } from '@/types/list';

import { PanelListLink } from './PanelListLink';

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
    const updateGroup = useUpdateListGroup();
    const deleteGroup = useDeleteListGroup();
    const move = useMoveListToGroup();
    const confirm = useConfirm();

    const [collapsed, setCollapsed] = useState<number[]>(readCollapsed);
    const [creating, setCreating] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [renaming, setRenaming] = useState<ListGroup | null>(null);
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

    const submitNewGroup = (): void => {
        const name = draftName.trim();
        setCreating(false);
        setDraftName('');
        if (name !== '') createGroup.mutate(name);
    };

    const submitRename = (): void => {
        const name = draftName.trim();
        const target = renaming;
        setRenaming(null);
        setDraftName('');
        if (target && name !== '' && name !== target.name) {
            updateGroup.mutate({ id: target.id, name });
        }
    };

    const removeGroup = async (group: ListGroup): Promise<void> => {
        const inside = byGroup.get(group.id)?.length ?? 0;
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: folder name */
                __('¿Eliminar la carpeta "%s"?'),
                group.name,
            ),
            description:
                inside > 0
                    ? sprintf(
                          /* translators: %d: list count */
                          __('Las %d listas que tiene adentro no se borran: vuelven al nivel de arriba.'),
                          inside,
                      )
                    : __('La carpeta está vacía.'),
            confirmLabel: __('Eliminar carpeta'),
            destructive: true,
        });
        if (ok) deleteGroup.mutate(group.id);
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
            <PanelListLink
                to={`/lists/${list.slug}/records`}
                name={list.name}
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
                            setDraftName('');
                            setCreating(true);
                        }}
                        className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    >
                        <FolderPlus className="imcrm-h-3.5 imcrm-w-3.5" />
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
                        <div
                            onDragOver={(e) => {
                                if (!canManageLists) return;
                                e.preventDefault();
                                setDropTarget(group.id);
                            }}
                            onDragLeave={() => setDropTarget((t) => (t === group.id ? null : t))}
                            onDrop={dropOn(group.id)}
                            className={cn(
                                'imcrm-group/gr imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1',
                                dropTarget === group.id
                                    ? 'imcrm-bg-primary/10 imcrm-ring-1 imcrm-ring-primary/40'
                                    : 'hover:imcrm-bg-accent/40',
                            )}
                        >
                            {renaming?.id === group.id ? (
                                <Input
                                    autoFocus
                                    value={draftName}
                                    onChange={(e) => setDraftName(e.target.value)}
                                    onBlur={submitRename}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitRename();
                                        if (e.key === 'Escape') {
                                            setRenaming(null);
                                            setDraftName('');
                                        }
                                    }}
                                    className="imcrm-h-6 imcrm-text-[13px]"
                                />
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleCollapsed(group.id);
                                        }}
                                        aria-expanded={!isCollapsed}
                                        className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-left"
                                    >
                                        <ChevronRight
                                            aria-hidden
                                            className={cn(
                                                'imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform',
                                                !isCollapsed && 'imcrm-rotate-90',
                                            )}
                                        />
                                        <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-medium">
                                            {group.name}
                                        </span>
                                        <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">
                                            {inside.length}
                                        </span>
                                    </button>
                                    {canManageLists && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    aria-label={sprintf(
                                                        /* translators: %s: folder name */
                                                        __('Acciones de %s'),
                                                        group.name,
                                                    )}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="imcrm-shrink-0 imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground imcrm-opacity-0 hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover/gr:imcrm-opacity-100"
                                                >
                                                    <MoreHorizontal className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start">
                                                <DropdownMenuItem
                                                    onSelect={() => {
                                                        setDraftName(group.name);
                                                        setRenaming(group);
                                                    }}
                                                >
                                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Cambiar el nombre')}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem danger onSelect={() => void removeGroup(group)}>
                                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Eliminar carpeta')}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </>
                            )}
                        </div>

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
