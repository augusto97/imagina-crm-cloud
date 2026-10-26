import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDown,
    ArrowUp,
    BookmarkPlus,
    CalendarDays,
    ChevronDown,
    Eye,
    EyeOff,
    GitBranch,
    GripVertical,
    ListTodo,
    Loader2,
    MoreHorizontal,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';
import {
    DEFAULT_CHECKLIST_NAME,
    checklistDueHasTime,
    checklistPercent,
    parseChecklistLines,
    type Checklist,
    type ChecklistItem,
} from '@imagina-base/shared';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useChecklistItemToSubtask, useChecklistOps, useRecordChecklists } from '@/hooks/useChecklists';
import { useRecordTemplates, useTemplateFromChecklist } from '@/hooks/useRecordTemplates';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { DateCellEditor } from '../DateCellEditor';
import { useStoreRules } from '../storeRules';
import { ChecklistAssignee } from './ChecklistAssignee';
import { dueStateOf, formatDue, HOVER_REVEAL, moveId, shiftId } from './checklistModel';

interface RecordChecklistsProps {
    listId: number;
    recordId: number;
    /** El registro es una subtarea: «Convertir en subtarea» no aplica (un solo nivel). */
    isSubtask?: boolean;
    /** Lista de una tienda: los checklists sí, pero no se crean registros (subtareas). */
    storeManaged?: boolean;
    /** Abrir la subtarea recién creada (el modal cambia de registro). */
    onOpenRecord?: (id: number) => void;
    /** Sin edición (vista previa del editor de la ficha). */
    readOnly?: boolean;
    /** Sin el encabezado (el bloque de la ficha diseñada ya pone su título). */
    hideHeading?: boolean;
    className?: string;
}

const HIDE_DONE_KEY = 'imcrm:checklists:hide-done';

function readHideDone(): boolean {
    try {
        return window.localStorage.getItem(HIDE_DONE_KEY) === '1';
    } catch {
        return false;
    }
}

function writeHideDone(v: boolean): void {
    try {
        if (v) window.localStorage.setItem(HIDE_DONE_KEY, '1');
        else window.localStorage.removeItem(HIDE_DONE_KEY);
    } catch {
        /* sin almacenamiento: queda sólo en esta pantalla */
    }
}

function errorText(err: unknown): string {
    return err instanceof ApiError || err instanceof Error ? err.message : __('Inténtalo de nuevo.');
}

/**
 * A9 — Sección «Checklists» de la ficha (modal, página y bloque de la ficha
 * diseñada): uno o varios checklists con nombre, cada uno con su barra de
 * progreso; ítems con casilla, responsable y fecha. Enter agrega el
 * siguiente ítem (pegar varias líneas agrega uno por línea), un click en el
 * texto lo edita, se reordenan arrastrando (o con «Subir / Bajar» en el
 * menú, en táctil), y un ítem se puede convertir en subtarea. Marcar y
 * editar exige poder editar el registro (lo valida el servidor).
 */
export function RecordChecklists({
    listId,
    recordId,
    isSubtask = false,
    storeManaged = false,
    onOpenRecord,
    readOnly = false,
    hideHeading = false,
    className,
}: RecordChecklistsProps): JSX.Element | null {
    const query = useRecordChecklists(listId, recordId);
    const ops = useChecklistOps(listId, recordId);
    const toSubtask = useChecklistItemToSubtask(listId, recordId);
    const saveTemplate = useTemplateFromChecklist(listId);
    const toast = useToast();
    const confirm = useConfirm();
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS) && !readOnly;
    const store = useStoreRules();
    const canCreate = useCanAny(CAP.CREATE_RECORDS) && !readOnly && !storeManaged && store === null;
    const canTemplates = useCanAny(CAP.MANAGE_LISTS, CAP.MANAGE_VIEWS, 'workspace_admin') && !readOnly;
    const templates = useRecordTemplates(canEdit ? listId : undefined, 'checklist');
    const [hideDone, setHideDone] = useState(readHideDone);
    const [focusChecklist, setFocusChecklist] = useState<number | null>(null);

    const data = query.data;
    const checklists = data?.checklists ?? [];
    const total = data?.total ?? 0;
    const done = data?.done ?? 0;

    if (!query.isLoading && checklists.length === 0 && !canEdit) return null;

    const fail = (title: string) => (err: unknown) => toast.error(title, errorText(err));

    const createChecklist = (input: { name?: string; template_id?: number }): void => {
        const before = new Set(checklists.map((c) => c.id));
        ops.mutate(
            { kind: 'create', input },
            {
                onSuccess: (res) => {
                    const created = res.checklists.find((c) => !before.has(c.id));
                    if (created) setFocusChecklist(created.id);
                },
                onError: fail(__('No se pudo crear el checklist')),
            },
        );
    };

    const nextName = (): string => {
        if (checklists.length === 0) return DEFAULT_CHECKLIST_NAME;
        return sprintf(__('Checklist %d'), checklists.length + 1);
    };

    const toggleHideDone = (): void => {
        setHideDone((v) => {
            writeHideDone(!v);
            return !v;
        });
    };

    return (
        <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2', className)} data-testid="imcrm-record-checklists">
            {(!hideHeading || canEdit || total > 0) && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1">
                    {!hideHeading && (
                        <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            <ListTodo className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Checklists')}
                            {total > 0 && (
                                <span className="imcrm-font-normal imcrm-normal-case imcrm-tabular-nums imcrm-text-muted-foreground/80" data-testid="imcrm-checklists-count">
                                    {done}/{total}
                                </span>
                            )}
                        </h3>
                    )}
                    <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1">
                        {done > 0 && (
                            <button
                                type="button"
                                onClick={toggleHideDone}
                                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                data-testid="imcrm-checklists-hide-done"
                                aria-pressed={hideDone}
                            >
                                {hideDone ? <Eye className="imcrm-h-3.5 imcrm-w-3.5" /> : <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {hideDone ? sprintf(__('Mostrar hechos (%d)'), done) : __('Ocultar hechos')}
                            </button>
                        )}
                        {canEdit && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                        data-testid="imcrm-checklists-add"
                                        disabled={ops.isPending && ops.variables?.kind === 'create'}
                                    >
                                        {ops.isPending && ops.variables?.kind === 'create' ? (
                                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                        ) : (
                                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                        )}
                                        {__('Checklist')}
                                        <ChevronDown className="imcrm-h-3 imcrm-w-3" />
                                    </button>
                                </DropdownMenuTrigger>
                                {/* El foco va al «Agregar un ítem» del checklist nuevo, no de vuelta al botón. */}
                                <DropdownMenuContent align="end" className="imcrm-w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
                                    <DropdownMenuItem onSelect={() => createChecklist({ name: nextName() })} data-testid="imcrm-checklists-new">
                                        <Plus className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                        {__('Checklist vacío')}
                                    </DropdownMenuItem>
                                    {(templates.data ?? []).length > 0 && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel>{__('Desde una plantilla')}</DropdownMenuLabel>
                                            {(templates.data ?? []).map((t) => (
                                                <DropdownMenuItem
                                                    key={t.id}
                                                    onSelect={() => createChecklist({ template_id: t.id })}
                                                    data-testid="imcrm-checklists-from-template"
                                                >
                                                    <ListTodo className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                                    <span className="imcrm-truncate">{t.name}</span>
                                                    <span className="imcrm-ml-auto imcrm-pl-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                                                        {t.content.checklists[0]?.items.length ?? 0}
                                                    </span>
                                                </DropdownMenuItem>
                                            ))}
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </div>
            )}

            {query.isLoading ? (
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
            ) : checklists.length === 0 ? (
                <button
                    type="button"
                    onClick={() => createChecklist({ name: DEFAULT_CHECKLIST_NAME })}
                    className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-border-primary/40 hover:imcrm-text-foreground"
                    data-testid="imcrm-checklists-empty-add"
                >
                    <ListTodo className="imcrm-h-4 imcrm-w-4" />
                    {__('Agregar un checklist: pasos, requisitos, lo que falta…')}
                </button>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {checklists.map((c, idx) => (
                        <ChecklistCard
                            key={c.id}
                            listId={listId}
                            checklist={c}
                            position={idx}
                            count={checklists.length}
                            canEdit={canEdit}
                            canConvert={canCreate && !isSubtask}
                            canTemplates={canTemplates}
                            hideDone={hideDone}
                            autoFocus={focusChecklist === c.id}
                            onFocused={() => setFocusChecklist(null)}
                            ops={ops}
                            onRenameError={fail(__('No se pudo cambiar el nombre'))}
                            onToSubtask={(item) =>
                                toSubtask.mutate(item.id, {
                                    onSuccess: (res) => {
                                        toast.success(sprintf(__('«%s» ahora es una subtarea'), item.text));
                                        if (onOpenRecord) onOpenRecord(res.record.id);
                                    },
                                    onError: fail(__('No se pudo convertir en subtarea')),
                                })
                            }
                            onSaveTemplate={() =>
                                saveTemplate.mutate(
                                    { checklist_id: c.id },
                                    {
                                        onSuccess: (t) => toast.success(sprintf(__('Se guardó la plantilla «%s»'), t.name), __('La encuentras en «Checklist ▾» de cualquier registro de la lista.')),
                                        onError: fail(__('No se pudo guardar la plantilla')),
                                    },
                                )
                            }
                            onDelete={async () => {
                                const ok = await confirm({
                                    title: sprintf(__('¿Eliminar el checklist «%s»?'), c.name),
                                    description: c.items.length > 0 ? sprintf(__('Se borran también sus %d ítems.'), c.items.length) : undefined,
                                    confirmLabel: __('Eliminar'),
                                    destructive: true,
                                });
                                if (ok) ops.mutate({ kind: 'remove', checklistId: c.id }, { onError: fail(__('No se pudo eliminar el checklist')) });
                            }}
                            onMoveChecklist={(delta) => {
                                const ids = checklists.map((x) => x.id);
                                const next = shiftId(ids, c.id, delta);
                                if (next) ops.mutate({ kind: 'reorderChecklists', ids: next }, { onError: fail(__('No se pudo reordenar')) });
                            }}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

// ─────────────────────────── Un checklist ───────────────────────────

interface ChecklistCardProps {
    listId: number;
    checklist: Checklist;
    position: number;
    count: number;
    canEdit: boolean;
    canConvert: boolean;
    canTemplates: boolean;
    hideDone: boolean;
    autoFocus: boolean;
    onFocused: () => void;
    ops: ReturnType<typeof useChecklistOps>;
    onRenameError: (err: unknown) => void;
    onToSubtask: (item: ChecklistItem) => void;
    onSaveTemplate: () => void;
    onDelete: () => void;
    onMoveChecklist: (delta: -1 | 1) => void;
}

function ChecklistCard({
    listId,
    checklist,
    position,
    count,
    canEdit,
    canConvert,
    canTemplates,
    hideDone,
    autoFocus,
    onFocused,
    ops,
    onRenameError,
    onToSubtask,
    onSaveTemplate,
    onDelete,
    onMoveChecklist,
}: ChecklistCardProps): JSX.Element {
    const toast = useToast();
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState(checklist.name);
    const [dragging, setDragging] = useState<number | null>(null);
    const [over, setOver] = useState<number | null>(null);
    const items = checklist.items;
    const done = items.filter((i) => i.done).length;
    const pct = checklistPercent({ done, total: items.length }) ?? 0;
    const visible = hideDone ? items.filter((i) => !i.done) : items;
    const ids = items.map((i) => i.id);

    const commitName = (): void => {
        setRenaming(false);
        const name = nameDraft.trim();
        if (name === '' || name === checklist.name) {
            setNameDraft(checklist.name);
            return;
        }
        ops.mutate({ kind: 'rename', checklistId: checklist.id, patch: { name } }, { onError: onRenameError });
    };

    const fail = (title: string) => (err: unknown) => toast.error(title, errorText(err));

    const drop = (target: number): void => {
        if (dragging === null) return;
        const next = moveId(ids, dragging, target);
        setDragging(null);
        setOver(null);
        if (next) ops.mutate({ kind: 'reorderItems', checklistId: checklist.id, ids: next }, { onError: fail(__('No se pudo reordenar')) });
    };

    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" data-testid="imcrm-checklist" data-checklist-name={checklist.name}>
            <div className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-pb-1.5 imcrm-pt-2.5">
                {renaming ? (
                    <input
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitName();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                setNameDraft(checklist.name);
                                setRenaming(false);
                            }
                        }}
                        maxLength={120}
                        className="imcrm-min-w-0 imcrm-flex-1 imcrm-rounded imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-1.5 imcrm-py-0.5 imcrm-text-sm imcrm-font-semibold"
                        aria-label={__('Nombre del checklist')}
                    />
                ) : (
                    <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                            setNameDraft(checklist.name);
                            setRenaming(true);
                        }}
                        className="imcrm-min-w-0 imcrm-truncate imcrm-text-left imcrm-text-sm imcrm-font-semibold disabled:imcrm-cursor-default"
                        data-testid="imcrm-checklist-name"
                    >
                        {checklist.name}
                    </button>
                )}
                <span className="imcrm-shrink-0 imcrm-tabular-nums imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-checklist-progress">
                    {done}/{items.length}
                </span>
                <div className="imcrm-ml-auto imcrm-flex imcrm-shrink-0 imcrm-items-center">
                    {canEdit && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    className={cn('imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground', HOVER_REVEAL)}
                                    aria-label={sprintf(__('Opciones de «%s»'), checklist.name)}
                                    data-testid="imcrm-checklist-menu"
                                >
                                    <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="imcrm-w-56">
                                <DropdownMenuItem
                                    onSelect={() => {
                                        setNameDraft(checklist.name);
                                        setRenaming(true);
                                    }}
                                >
                                    <Pencil className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                    {__('Cambiar el nombre')}
                                </DropdownMenuItem>
                                {count > 1 && position > 0 && (
                                    <DropdownMenuItem onSelect={() => onMoveChecklist(-1)}>
                                        <ArrowUp className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                        {__('Subir')}
                                    </DropdownMenuItem>
                                )}
                                {count > 1 && position < count - 1 && (
                                    <DropdownMenuItem onSelect={() => onMoveChecklist(1)}>
                                        <ArrowDown className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                        {__('Bajar')}
                                    </DropdownMenuItem>
                                )}
                                {canTemplates && items.length > 0 && (
                                    <DropdownMenuItem onSelect={onSaveTemplate} data-testid="imcrm-checklist-save-template">
                                        <BookmarkPlus className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                        {__('Guardar como plantilla')}
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={onDelete} className="imcrm-text-destructive focus:imcrm-text-destructive" data-testid="imcrm-checklist-delete">
                                    <Trash2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                    {__('Eliminar checklist')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>
            <div className="imcrm-mx-3 imcrm-mb-1.5 imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={__('Progreso')}>
                <div
                    className={cn('imcrm-h-full imcrm-rounded-full imcrm-transition-[width] imcrm-duration-300', pct === 100 ? 'imcrm-bg-emerald-500' : 'imcrm-bg-primary')}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <ul className="imcrm-flex imcrm-flex-col imcrm-pb-1">
                {visible.map((item) => (
                    <ChecklistItemRow
                        key={item.id}
                        listId={listId}
                        item={item}
                        index={ids.indexOf(item.id)}
                        count={ids.length}
                        canEdit={canEdit}
                        canConvert={canConvert}
                        dragging={dragging === item.id}
                        dropTarget={over === item.id && dragging !== null && dragging !== item.id}
                        onDragStart={() => setDragging(item.id)}
                        onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                        }}
                        onDragOver={() => setOver(item.id)}
                        onDrop={() => drop(item.id)}
                        onPatch={(patch, settled) =>
                            ops.mutate({ kind: 'updateItem', itemId: item.id, patch }, { onError: fail(__('No se pudo guardar el ítem')), onSettled: settled })
                        }
                        onMove={(delta) => {
                            const next = shiftId(ids, item.id, delta);
                            if (next) ops.mutate({ kind: 'reorderItems', checklistId: checklist.id, ids: next }, { onError: fail(__('No se pudo reordenar')) });
                        }}
                        onRemove={() => ops.mutate({ kind: 'removeItem', itemId: item.id }, { onError: fail(__('No se pudo eliminar el ítem')) })}
                        onToSubtask={() => onToSubtask(item)}
                    />
                ))}
                {hideDone && done > 0 && visible.length === 0 && (
                    <li className="imcrm-px-3 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground">{__('Todo hecho. Los ítems hechos están ocultos.')}</li>
                )}
            </ul>
            {canEdit && (
                <AddItemInput
                    autoFocus={autoFocus}
                    onFocused={onFocused}
                    pending={ops.isPending && ops.variables?.kind === 'addItems' && ops.variables.checklistId === checklist.id}
                    onAdd={(lines) =>
                        ops.mutate(
                            { kind: 'addItems', checklistId: checklist.id, input: { items: lines.map((l) => ({ text: l.text, done: l.done })) } },
                            { onError: fail(__('No se pudo agregar el ítem')) },
                        )
                    }
                />
            )}
        </div>
    );
}

// ─────────────────────────── Un ítem ───────────────────────────

interface ChecklistItemRowProps {
    listId: number;
    item: ChecklistItem;
    index: number;
    count: number;
    canEdit: boolean;
    canConvert: boolean;
    dragging: boolean;
    dropTarget: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDragOver: () => void;
    onDrop: () => void;
    /** `settled` corre cuando el servidor ya contestó (y el cache tiene su respuesta). */
    onPatch: (patch: { text?: string; done?: boolean; assignee_id?: number | null; due?: string | null }, settled?: () => void) => void;
    onMove: (delta: -1 | 1) => void;
    onRemove: () => void;
    onToSubtask: () => void;
}

function dueFieldFor(listId: number, withTime: boolean): FieldEntity {
    return {
        id: -1,
        list_id: listId,
        slug: '__checklist_due',
        label: __('Fecha'),
        type: withTime ? 'datetime' : 'date',
        config: {},
        is_required: false,
        is_unique: false,
        is_primary: false,
        is_indexed: false,
        position: 0,
        created_at: '',
        updated_at: '',
    };
}

function ChecklistItemRow({
    listId,
    item,
    index,
    count,
    canEdit,
    canConvert,
    dragging,
    dropTarget,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    onPatch,
    onMove,
    onRemove,
    onToSubtask,
}: ChecklistItemRowProps): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(item.text);
    // La casilla cambia EN EL ACTO (lección de v0.1.207: un control atado sólo
    // al cache vuelve a su valor hasta que llega la respuesta); cuando el
    // servidor contesta, manda lo que dice el cache.
    const [localDone, setLocalDone] = useState<boolean | null>(null);
    const done = localDone ?? item.done;
    const due = dueStateOf(item.due, done);
    const withTime = checklistDueHasTime(item.due);
    const dueField = useMemo(() => dueFieldFor(listId, withTime), [listId, withTime]);

    const commit = (): void => {
        setEditing(false);
        const text = draft.trim();
        if (text === '' || text === item.text) {
            setDraft(item.text);
            return;
        }
        onPatch({ text });
    };

    return (
        <li
            className={cn(
                'imcrm-group imcrm-relative imcrm-flex imcrm-min-h-[32px] imcrm-items-center imcrm-gap-1.5 imcrm-px-1.5 imcrm-py-0.5 hover:imcrm-bg-accent/40',
                dragging && 'imcrm-opacity-40',
                dropTarget && 'imcrm-shadow-[inset_0_2px_0_0_hsl(var(--imcrm-primary))]',
            )}
            onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                onDragOver();
            }}
            onDrop={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                onDrop();
            }}
            data-testid="imcrm-checklist-item"
            data-done={done ? '1' : '0'}
        >
            {canEdit ? (
                <span
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(item.id));
                        onDragStart();
                    }}
                    onDragEnd={onDragEnd}
                    className={cn('imcrm-hidden imcrm-cursor-grab imcrm-text-muted-foreground sm:imcrm-inline-flex', HOVER_REVEAL)}
                    title={__('Arrastrar para reordenar')}
                    aria-hidden
                    data-testid="imcrm-checklist-drag"
                >
                    <GripVertical className="imcrm-h-3.5 imcrm-w-3.5" />
                </span>
            ) : (
                <span className="imcrm-hidden imcrm-w-3.5 sm:imcrm-inline-block" />
            )}
            <input
                type="checkbox"
                checked={done}
                disabled={!canEdit}
                onChange={(e) => {
                    setLocalDone(e.target.checked);
                    onPatch({ done: e.target.checked }, () => setLocalDone(null));
                }}
                className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded imcrm-accent-[hsl(var(--imcrm-primary))] disabled:imcrm-cursor-default"
                aria-label={sprintf(done ? __('Desmarcar «%s»') : __('Marcar «%s» como hecho'), item.text)}
                data-testid="imcrm-checklist-check"
            />
            {editing ? (
                <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commit();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setDraft(item.text);
                            setEditing(false);
                        }
                    }}
                    maxLength={500}
                    className="imcrm-min-w-0 imcrm-flex-1 imcrm-rounded imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-1.5 imcrm-py-0.5 imcrm-text-sm"
                    aria-label={__('Texto del ítem')}
                    data-testid="imcrm-checklist-item-input"
                />
            ) : (
                <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                        setDraft(item.text);
                        setEditing(true);
                    }}
                    className={cn(
                        'imcrm-min-w-0 imcrm-flex-1 imcrm-whitespace-pre-wrap imcrm-break-words imcrm-text-left imcrm-text-sm disabled:imcrm-cursor-default',
                        done && 'imcrm-text-muted-foreground imcrm-line-through',
                    )}
                    data-testid="imcrm-checklist-item-text"
                >
                    {item.text}
                </button>
            )}
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                {canEdit ? (
                    <DateCellEditor listId={listId} field={dueField} value={item.due} onCommit={(next) => onPatch({ due: next })}>
                        <button
                            type="button"
                            className={cn(
                                'imcrm-inline-flex imcrm-h-6 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1 imcrm-text-[11.5px] imcrm-tabular-nums hover:imcrm-bg-accent',
                                !item.due && cn('imcrm-w-6 imcrm-justify-center imcrm-text-muted-foreground', HOVER_REVEAL),
                                due === 'overdue' && 'imcrm-font-medium imcrm-text-rose-600 dark:imcrm-text-rose-400',
                                due === 'today' && 'imcrm-font-medium imcrm-text-amber-600 dark:imcrm-text-amber-400',
                                (due === 'upcoming' || (item.due && item.done)) && 'imcrm-text-muted-foreground',
                            )}
                            aria-label={item.due ? sprintf(__('Fecha: %s'), formatDue(item.due)) : __('Poner fecha')}
                            title={item.due ? sprintf(__('Fecha: %s'), formatDue(item.due)) : __('Poner fecha')}
                            data-testid="imcrm-checklist-due"
                        >
                            <CalendarDays className="imcrm-h-3.5 imcrm-w-3.5" />
                            {item.due && <span>{formatDue(item.due)}</span>}
                        </button>
                    </DateCellEditor>
                ) : item.due ? (
                    <span
                        className={cn(
                            'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-px-1 imcrm-text-[11.5px] imcrm-tabular-nums imcrm-text-muted-foreground',
                            due === 'overdue' && 'imcrm-text-rose-600 dark:imcrm-text-rose-400',
                        )}
                    >
                        <CalendarDays className="imcrm-h-3.5 imcrm-w-3.5" />
                        {formatDue(item.due)}
                    </span>
                ) : null}
                {(canEdit || item.assignee_id !== null) && (
                    <ChecklistAssignee value={item.assignee_id} disabled={!canEdit} onChange={(id) => onPatch({ assignee_id: id })} />
                )}
                {canEdit && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className={cn('imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground', HOVER_REVEAL)}
                                aria-label={sprintf(__('Opciones de «%s»'), item.text)}
                                data-testid="imcrm-checklist-item-menu"
                            >
                                <MoreHorizontal className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="imcrm-w-56">
                            <DropdownMenuItem
                                onSelect={() => {
                                    setDraft(item.text);
                                    setEditing(true);
                                }}
                            >
                                <Pencil className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                {__('Editar el texto')}
                            </DropdownMenuItem>
                            {index > 0 && (
                                <DropdownMenuItem onSelect={() => onMove(-1)}>
                                    <ArrowUp className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                    {__('Subir')}
                                </DropdownMenuItem>
                            )}
                            {index < count - 1 && (
                                <DropdownMenuItem onSelect={() => onMove(1)}>
                                    <ArrowDown className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                    {__('Bajar')}
                                </DropdownMenuItem>
                            )}
                            {canConvert && (
                                <DropdownMenuItem onSelect={onToSubtask} data-testid="imcrm-checklist-to-subtask">
                                    <GitBranch className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                    {__('Convertir en subtarea')}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={onRemove} className="imcrm-text-destructive focus:imcrm-text-destructive" data-testid="imcrm-checklist-item-delete">
                                <Trash2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                {__('Eliminar ítem')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </li>
    );
}

// ─────────────────────────── Agregar ítems ───────────────────────────

function AddItemInput({
    autoFocus,
    onFocused,
    pending,
    onAdd,
}: {
    autoFocus: boolean;
    onFocused: () => void;
    pending: boolean;
    onAdd: (lines: Array<{ text: string; done: boolean }>) => void;
}): JSX.Element {
    const [text, setText] = useState('');
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!autoFocus) return;
        ref.current?.focus({ preventScroll: false });
        onFocused();
    }, [autoFocus, onFocused]);

    const submit = (): void => {
        const value = text.trim();
        if (value === '') return;
        onAdd([{ text: value, done: false }]);
        setText('');
    };

    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-border-t imcrm-border-border/60 imcrm-px-3 imcrm-py-1.5">
            {pending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />}
            <input
                ref={ref}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    } else if (e.key === 'Escape' && text !== '') {
                        e.preventDefault();
                        e.stopPropagation();
                        setText('');
                    }
                }}
                onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text/plain');
                    if (!pasted.includes('\n')) return;
                    const lines = parseChecklistLines(pasted);
                    if (lines.length === 0) return;
                    e.preventDefault();
                    onAdd(lines);
                    setText('');
                }}
                maxLength={500}
                placeholder={__('Agregar un ítem (Enter agrega el siguiente; pega varias líneas para agregar varios)')}
                className="imcrm-min-w-0 imcrm-flex-1 imcrm-bg-transparent imcrm-py-1 imcrm-text-sm imcrm-outline-none placeholder:imcrm-text-muted-foreground/70"
                aria-label={__('Agregar un ítem')}
                data-testid="imcrm-checklist-add-item"
            />
        </div>
    );
}
