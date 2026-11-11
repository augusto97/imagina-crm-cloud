import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
    AlertCircle,
    ArrowDown,
    ArrowDownUp,
    ArrowLeft,
    ArrowUp,
    ChevronRight,
    Folder,
    FolderOpen,
    FolderPlus,
    LayoutTemplate,
    Layers,
    Lightbulb,
    MoreHorizontal,
    Pause,
    PencilLine,
    Play,
    Plus,
    Search,
    Trash2,
    X,
    Zap,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { folderKey } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { IdeasForList } from '@/admin/ideas/IdeasForList';
import {
    automationsKeys,
    useAutomationFolderOp,
    useAutomationFolders,
    useAutomations,
    useDeleteAutomation,
    useDuplicateAutomation,
    useMoveAutomations,
    useUpdateAutomation,
} from '@/hooks/useAutomations';
import { useTrashedToast } from '@/hooks/useTrash';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { useFields } from '@/hooks/useFields';
import { useList, useLists } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { usePersistedChoice } from '@/lib/usePersistedChoice';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import type { AutomationEntity } from '@/types/automation';

import { AutomationRow, FolderTargets, type AutomationRowSummary } from './AutomationRow';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';
import { AutomationTemplateDialog } from './AutomationTemplateDialog';
import { FolderNameDialog } from './FolderNameDialog';
import { SaveAutomationTemplateDialog } from './SaveAutomationTemplateDialog';
import {
    AUTOMATION_GROUP_BY,
    AUTOMATION_SORT_BY,
    activeCount,
    folderSectionKey,
    lastRunFailed,
    groupAutomations,
    matchesAutomationQuery,
    matchesStatus,
    moveFolder,
    sortAutomations,
    statusCounts,
    type AutomationGroupBy,
    type AutomationSection,
    type AutomationSortBy,
    type AutomationStatusFilter,
} from './automationIndex';
import { summarizeAction, summarizeTrigger, triggerMetaFor } from './automationMeta';

const DRAG_TYPE = 'application/x-imcrm-automations';

const GROUP_LABELS: Record<AutomationGroupBy, string> = {
    folder: __('Por carpeta'),
    trigger: __('Por disparador'),
    none: __('Sin agrupar'),
};

const SORT_LABELS: Record<AutomationSortBy, string> = {
    name: __('Nombre (A-Z)'),
    recent: __('Las más nuevas'),
    updated: __('Editadas hace poco'),
    last_run: __('Última corrida'),
};

type FolderDialogState = { mode: 'create' } | { mode: 'move'; ids: number[] } | null;

/** Secciones plegadas (por lista, en este dispositivo). */
function useCollapsed(listId: number | undefined): [Set<string>, (key: string, on?: boolean) => void, (from: string, to: string) => void] {
    const storageKey = `imcrm:automations-collapsed:${listId ?? 0}`;
    const [state, setState] = useState<{ key: string; set: Set<string> }>(() => ({ key: storageKey, set: readCollapsed(storageKey) }));
    const current = state.key === storageKey ? state.set : readCollapsed(storageKey);
    const save = useCallback(
        (next: Set<string>) => {
            setState({ key: storageKey, set: next });
            try {
                window.localStorage.setItem(storageKey, JSON.stringify([...next]));
            } catch {
                // modo privado: no se recuerda.
            }
        },
        [storageKey],
    );
    const toggle = useCallback(
        (key: string, on?: boolean) => {
            const next = new Set(current);
            const want = on ?? !next.has(key);
            if (want) next.add(key);
            else next.delete(key);
            save(next);
        },
        [current, save],
    );
    const rename = useCallback(
        (from: string, to: string) => {
            if (!current.has(from)) return;
            const next = new Set(current);
            next.delete(from);
            next.add(to);
            save(next);
        },
        [current, save],
    );
    return [current, toggle, rename];
}

function readCollapsed(key: string): Set<string> {
    try {
        const raw = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
        return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
    } catch {
        return new Set();
    }
}

/**
 * Página `/lists/:listSlug/automations` — rediseñada en v0.1.411.
 *
 * Con muchas automatizaciones la tarjeta grande de antes no escalaba: ahora
 * cada una es una fila compacta (interruptor, qué la dispara y qué hace en
 * una línea, cuándo corrió) y se organizan en CARPETAS que cada empresa arma
 * a su gusto (se crean, renombran, ordenan y borran; se mueve arrastrando, por
 * el menú de cada una o varias a la vez). Arriba, buscador, filtro por estado,
 * agrupar (carpeta / disparador / nada) y ordenar. Crear y editar siguen en el
 * editor de página completa (`AutomationEditorPage`).
 */
export function AutomationsPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const navigate = useNavigate();
    const list = useList(listSlug);
    const listId = list.data?.id;
    const automations = useAutomations(listId);
    const foldersQ = useAutomationFolders(listId);
    const fields = useFields(listId);
    const lists = useLists();
    const relationPaths = useRelationPaths(listId);

    const narrow = useMediaQuery('(max-width: 639px)');
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<AutomationStatusFilter>('all');
    const [groupBy, setGroupBy] = usePersistedChoice<AutomationGroupBy>('imcrm:automations-group', AUTOMATION_GROUP_BY, 'folder');
    const [sortBy, setSortBy] = usePersistedChoice<AutomationSortBy>('imcrm:automations-sort', AUTOMATION_SORT_BY, 'name');
    const [collapsed, toggleCollapsed, renameCollapsed] = useCollapsed(listId);
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const lastClicked = useRef<number | null>(null);
    const [runsFor, setRunsFor] = useState<AutomationEntity | null>(null);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [saveTemplateFor, setSaveTemplateFor] = useState<AutomationEntity | null>(null);
    const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
    const [folderError, setFolderError] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [pendingToggles, setPendingToggles] = useState<Set<number>>(() => new Set());

    const deleteMutation = useDeleteAutomation(listId ?? 0);
    const duplicateMutation = useDuplicateAutomation(listId ?? 0);
    const update = useUpdateAutomation(listId ?? 0);
    const folderOp = useAutomationFolderOp(listId ?? 0);
    const move = useMoveAutomations(listId ?? 0);
    const trashed = useTrashedToast();
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();

    const all = useMemo(() => automations.data ?? [], [automations.data]);
    const folders = useMemo(() => foldersQ.data ?? [], [foldersQ.data]);

    // El resumen (qué la dispara y qué hace) se arma una vez: lo usan la fila y la búsqueda.
    const summaries = useMemo(() => {
        const out = new Map<number, AutomationRowSummary & { text: string }>();
        for (const a of all) {
            const trigger = summarizeTrigger(a.trigger_type, a.trigger_config, fields.data ?? []);
            const actions = a.actions.map((spec) => ({
                type: spec.type,
                text: summarizeAction(spec, fields.data ?? [], lists.data ?? [], undefined, relationPaths.data),
            }));
            out.set(a.id, { trigger, actions, text: [trigger, ...actions.map((x) => x.text)].join(' ') });
        }
        return out;
    }, [all, fields.data, lists.data, relationPaths.data]);

    const counts = useMemo(() => statusCounts(all), [all]);
    const filtering = status !== 'all' || query.trim() !== '';
    const visible = useMemo(
        () =>
            sortAutomations(
                all.filter((a) => matchesStatus(a, status) && matchesAutomationQuery(a, query, summaries.get(a.id)?.text)),
                sortBy,
            ),
        [all, status, query, sortBy, summaries],
    );
    const sections = useMemo(
        () => groupAutomations(visible, groupBy, folders, !filtering),
        [visible, groupBy, folders, filtering],
    );
    const orderedIds = useMemo(() => sections.flatMap((s) => s.items.map((a) => a.id)), [sections]);
    // Sin ninguna carpeta, «Por carpeta» es una lista sola: no se dibuja el título «Sin carpeta».
    const bareFolderList = groupBy === 'folder' && sections.length === 1 && sections[0]!.kind === 'none';

    const selectedList = useMemo(() => all.filter((a) => selected.has(a.id)), [all, selected]);
    const selectedCurrentFolder = useMemo(() => {
        const keys = new Set(selectedList.map((a) => (a.folder ? folderKey(a.folder) : null)));
        return keys.size === 1 ? [...keys][0]! : undefined;
    }, [selectedList]);

    const open = useCallback(
        (a: AutomationEntity) => {
            if (list.data) navigate(`/lists/${list.data.slug}/automations/${a.id}`);
        },
        [list.data, navigate],
    );

    const setActive = useCallback(
        async (ids: number[], active: boolean): Promise<number> => {
            if (listId === undefined) return 0;
            const key = automationsKeys.forList(listId);
            const prev = qc.getQueryData<AutomationEntity[]>(key);
            const targets = (prev ?? []).filter((a) => ids.includes(a.id) && a.is_active !== active);
            if (targets.length === 0) return 0;
            // Optimista: el interruptor se mueve al tocarlo.
            const flip = new Set(targets.map((a) => a.id));
            qc.setQueryData<AutomationEntity[]>(key, (old) => old?.map((a) => (flip.has(a.id) ? { ...a, is_active: active } : a)));
            setPendingToggles((s) => new Set([...s, ...flip]));
            let ok = 0;
            const failures: string[] = [];
            for (const a of targets) {
                try {
                    await update.mutateAsync({ id: a.id, input: { is_active: active } });
                    ok++;
                } catch (err) {
                    failures.push(err instanceof Error ? `${a.name}: ${err.message}` : a.name);
                    qc.setQueryData<AutomationEntity[]>(key, (old) => old?.map((x) => (x.id === a.id ? { ...x, is_active: !active } : x)));
                }
            }
            setPendingToggles((s) => {
                const next = new Set(s);
                flip.forEach((id) => next.delete(id));
                return next;
            });
            if (failures.length > 0) {
                toast.error(
                    active ? __('No se pudo activar') : __('No se pudo pausar'),
                    failures.slice(0, 3).join(' · '),
                );
            }
            return ok;
        },
        [listId, qc, update, toast],
    );

    const toggleActive = useCallback((a: AutomationEntity) => void setActive([a.id], !a.is_active), [setActive]);

    const onSelect = useCallback(
        (a: AutomationEntity, on: boolean, range: boolean) => {
            setSelected((prev) => {
                const next = new Set(prev);
                if (range && lastClicked.current !== null) {
                    const i = orderedIds.indexOf(lastClicked.current);
                    const j = orderedIds.indexOf(a.id);
                    if (i >= 0 && j >= 0) {
                        for (const id of orderedIds.slice(Math.min(i, j), Math.max(i, j) + 1)) {
                            if (on) next.add(id);
                            else next.delete(id);
                        }
                        return next;
                    }
                }
                if (on) next.add(a.id);
                else next.delete(a.id);
                return next;
            });
            lastClicked.current = a.id;
        },
        [orderedIds],
    );

    const doMove = useCallback(
        (ids: number[], folder: string | null) => {
            if (ids.length === 0) return;
            move.mutate(
                { ids, folder },
                {
                    onSuccess: (res) => {
                        const n = res.moved;
                        const target = folder === null ? __('Sin carpeta') : (res.folders.find((f) => folderKey(f) === folderKey(folder)) ?? folder);
                        toast.success(
                            n === 1 ? sprintf(__('Se movió a «%s»'), target) : sprintf(__('Se movieron %1$d a «%2$s»'), n, target),
                        );
                        setSelected(new Set());
                    },
                    onError: (err) => toast.error(__('No se pudo mover'), err instanceof Error ? err.message : undefined),
                },
            );
        },
        [move, toast],
    );

    const onNewFolderFor = useCallback((ids: number[]) => {
        setFolderError(null);
        setFolderDialog({ mode: 'move', ids });
    }, []);

    const submitFolderDialog = async (name: string): Promise<void> => {
        if (!folderDialog) return;
        setFolderError(null);
        try {
            if (folderDialog.mode === 'create') {
                await folderOp.mutateAsync({ op: 'create', name });
                toast.success(sprintf(__('Carpeta «%s» creada'), name));
            } else {
                await move.mutateAsync({ ids: folderDialog.ids, folder: name });
                toast.success(
                    folderDialog.ids.length === 1
                        ? sprintf(__('Se movió a «%s»'), name)
                        : sprintf(__('Se movieron %1$d a «%2$s»'), folderDialog.ids.length, name),
                );
                setSelected(new Set());
            }
            setFolderDialog(null);
        } catch (err) {
            setFolderError(folderErrorText(err));
        }
    };

    const renameFolder = async (from: string, to: string): Promise<void> => {
        const clean = to.trim();
        setRenaming(null);
        if (clean === '' || clean === from) return;
        try {
            await folderOp.mutateAsync({ op: 'rename', name: from, to: clean });
            renameCollapsed(folderSectionKey(from), folderSectionKey(clean));
        } catch (err) {
            toast.error(__('No se pudo cambiar el nombre'), folderErrorText(err));
        }
    };

    const deleteFolder = async (section: AutomationSection): Promise<void> => {
        const n = all.filter((a) => a.folder && folderKey(a.folder) === folderKey(section.name)).length;
        const ok = await confirm({
            title: sprintf(__('Eliminar la carpeta «%s»'), section.name),
            description:
                n === 0
                    ? __('La carpeta está vacía.')
                    : n === 1
                      ? __('Su automatización queda sin carpeta: no se borra ni se pausa.')
                      : sprintf(__('Sus %d automatizaciones quedan sin carpeta: no se borra ni se pausa ninguna.'), n),
            destructive: true,
            confirmLabel: __('Eliminar carpeta'),
        });
        if (!ok) return;
        try {
            await folderOp.mutateAsync({ op: 'delete', name: section.name });
        } catch (err) {
            toast.error(__('No se pudo eliminar la carpeta'), folderErrorText(err));
        }
    };

    const reorderFolder = (name: string, delta: -1 | 1): void => {
        folderOp.mutate(
            { op: 'reorder', order: moveFolder(folders, name, delta) },
            { onError: (err) => toast.error(__('No se pudo ordenar'), folderErrorText(err)) },
        );
    };

    const handleDuplicate = useCallback(
        async (a: AutomationEntity): Promise<void> => {
            if (!list.data) return;
            try {
                const copy = await duplicateMutation.mutateAsync(a.id);
                qc.setQueryData<AutomationEntity[]>(automationsKeys.forList(list.data.id), (old) =>
                    old ? [...old.filter((x) => x.id !== copy.id), copy] : [copy],
                );
                toast.success(__('Copia creada. Quedó pausada: actívala cuando esté lista.'));
                navigate(`/lists/${list.data.slug}/automations/${copy.id}`);
            } catch (err) {
                toast.error(__('No se pudo duplicar'), err instanceof Error ? err.message : undefined);
            }
        },
        [list.data, duplicateMutation, qc, toast, navigate],
    );

    const handleDelete = useCallback(
        async (a: AutomationEntity): Promise<void> => {
            const ok = await confirm({
                title: __('Eliminar automatización'),
                description: __('Deja de correr al instante y va a la papelera con su historial: puedes recuperarla durante 30 días.'),
                destructive: true,
                confirmLabel: __('Eliminar'),
            });
            if (!ok) return;
            try {
                await deleteMutation.mutateAsync(a.id);
                trashed({ type: 'automation', id: a.id, name: a.name });
                setSelected((s) => {
                    const next = new Set(s);
                    next.delete(a.id);
                    return next;
                });
            } catch (err) {
                if (err instanceof Error) toast.error(__('No se pudo eliminar'), err.message);
            }
        },
        [confirm, deleteMutation, trashed, toast],
    );

    const onDragStart = useCallback(
        (a: AutomationEntity, e: React.DragEvent) => {
            const ids = selected.has(a.id) ? [...selected] : [a.id];
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
            e.dataTransfer.effectAllowed = 'move';
        },
        [selected],
    );

    const dropProps = (section: AutomationSection) =>
        groupBy === 'folder' && (section.kind === 'folder' || section.kind === 'none')
            ? {
                  onDragOver: (e: React.DragEvent) => {
                      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTarget !== section.key) setDropTarget(section.key);
                  },
                  onDragLeave: (e: React.DragEvent) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                  },
                  onDrop: (e: React.DragEvent) => {
                      setDropTarget(null);
                      const raw = e.dataTransfer.getData(DRAG_TYPE);
                      if (!raw) return;
                      e.preventDefault();
                      let ids: number[] = [];
                      try {
                          ids = (JSON.parse(raw) as unknown[]).filter((x): x is number => typeof x === 'number');
                      } catch {
                          return;
                      }
                      const target = section.kind === 'none' ? null : section.name;
                      const moving = ids.filter((id) => {
                          const a = all.find((x) => x.id === id);
                          const cur = a?.folder ? folderKey(a.folder) : null;
                          return cur !== (target === null ? null : folderKey(target));
                      });
                      doMove(moving, target);
                  },
              }
            : {};

    if (list.isLoading) return <PageSkeleton />;

    if (!list.data) {
        return (
            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-4 imcrm-text-sm imcrm-text-destructive">
                {__('Lista no encontrada.')}
            </div>
        );
    }

    const newHref = `/lists/${list.data.slug}/automations/new`;
    const hasAny = all.length > 0;
    const selecting = selected.size > 0;

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[1040px] imcrm-flex-col imcrm-gap-5" data-testid="automations-index">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-justify-between sm:imcrm-gap-4">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-3">
                    <Button asChild variant="ghost" size="icon" aria-label={__('Volver a registros')}>
                        <Link to={`/lists/${list.data.slug}/records`}>
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        </Link>
                    </Button>
                    <div className="imcrm-min-w-0">
                        <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Automatizaciones')}</h1>
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground" data-testid="automations-subtitle">
                            {hasAny
                                ? sprintf(
                                      counts.all === 1
                                          ? __('1 automatización en «%2$s» · %3$d activa')
                                          : __('%1$d automatizaciones en «%2$s» · %3$d activas'),
                                      counts.all,
                                      list.data.name,
                                      counts.active,
                                  )
                                : sprintf(__('Reglas que se disparan cuando algo cambia en %s.'), list.data.name)}
                        </p>
                    </div>
                </div>
                {/* v0.1.168 — la plantilla es la opción principal; "En blanco" la segunda. */}
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-gap-2 imcrm-self-start" data-tour="automations-new">
                    <Button className="imcrm-gap-2" onClick={() => setTemplatesOpen(true)}>
                        <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                        {__('Desde plantilla')}
                    </Button>
                    <Button asChild variant="outline" className="imcrm-gap-2">
                        <Link to={newHref}>
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('En blanco')}
                        </Link>
                    </Button>
                    <Button asChild variant="ghost" className="imcrm-gap-2" data-testid="automations-ideas-btn">
                        <Link to="/ideas">
                            <Lightbulb className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-500" />
                            {__('Ideas')}
                        </Link>
                    </Button>
                </div>
            </header>

            {automations.isError && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" />
                    <span>
                        {sprintf(__('No se pudieron cargar las automatizaciones: %s'), (automations.error as Error).message)}
                    </span>
                </div>
            )}

            {automations.isLoading ? (
                <ListSkeleton />
            ) : !hasAny ? (
                <EmptyState
                    icon={Zap}
                    title={__('Aún no hay automatizaciones')}
                    description={__('Crea reglas que reaccionen a los cambios en tus registros: enviar correos, actualizar campos, crear registros en otras listas, avisar a otras apps…')}
                    action={
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                            <Button className="imcrm-gap-2" onClick={() => setTemplatesOpen(true)}>
                                <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                                {__('Elegir una plantilla')}
                            </Button>
                            <Button asChild variant="outline" className="imcrm-gap-2">
                                <Link to={newHref}>
                                    <Plus className="imcrm-h-4 imcrm-w-4" />
                                    {__('En blanco')}
                                </Link>
                            </Button>
                        </div>
                    }
                />
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    {/* Barra: buscar, estado, agrupar, ordenar, carpeta nueva. */}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5" data-tour="automations-toolbar">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <div className="imcrm-relative imcrm-min-w-0 imcrm-flex-1 sm:imcrm-max-w-sm">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 imcrm--translate-y-1/2 imcrm-text-muted-foreground" />
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') setQuery('');
                                    }}
                                    placeholder={narrow ? __('Buscar…') : __('Buscar por nombre, carpeta o lo que hace…')}
                                    aria-label={__('Buscar automatizaciones')}
                                    className="imcrm-h-9 imcrm-w-full imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-background imcrm-pl-8 imcrm-pr-8 imcrm-text-sm focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring [&::-webkit-search-cancel-button]:imcrm-hidden"
                                    data-testid="automations-search"
                                />
                                {query !== '' && (
                                    <button
                                        type="button"
                                        className="imcrm-absolute imcrm-right-1.5 imcrm-top-1/2 imcrm--translate-y-1/2 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                        onClick={() => setQuery('')}
                                        aria-label={__('Limpiar búsqueda')}
                                    >
                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <ChoiceMenu
                                    icon={Layers}
                                    label={GROUP_LABELS[groupBy]}
                                    title={__('Agrupar')}
                                    options={AUTOMATION_GROUP_BY.map((v) => ({ value: v, label: GROUP_LABELS[v] }))}
                                    value={groupBy}
                                    onChange={setGroupBy}
                                    testId="automations-group"
                                />
                                <ChoiceMenu
                                    icon={ArrowDownUp}
                                    label={SORT_LABELS[sortBy]}
                                    title={__('Ordenar')}
                                    options={AUTOMATION_SORT_BY.map((v) => ({ value: v, label: SORT_LABELS[v] }))}
                                    value={sortBy}
                                    onChange={setSortBy}
                                    testId="automations-sort"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-h-9 imcrm-gap-1.5"
                                    onClick={() => {
                                        setFolderError(null);
                                        setFolderDialog({ mode: 'create' });
                                    }}
                                    data-testid="automations-new-folder"
                                    data-tour="automations-new-folder"
                                    title={__('Nueva carpeta')}
                                >
                                    <FolderPlus className="imcrm-h-4 imcrm-w-4" />
                                    <span className="imcrm-hidden md:imcrm-inline">{__('Nueva carpeta')}</span>
                                </Button>
                            </div>
                        </div>
                        <div className="imcrm--mx-1 imcrm-flex imcrm-gap-1.5 imcrm-overflow-x-auto imcrm-px-1 imcrm-pb-0.5" role="tablist" aria-label={__('Filtrar por estado')}>
                            <StatusChip value="all" current={status} count={counts.all} label={__('Todas')} onPick={setStatus} />
                            <StatusChip value="active" current={status} count={counts.active} label={__('Activas')} onPick={setStatus} />
                            <StatusChip value="paused" current={status} count={counts.paused} label={__('Pausadas')} onPick={setStatus} />
                            <StatusChip value="failed" current={status} count={counts.failed} label={__('Con fallas')} onPick={setStatus} danger />
                        </div>
                    </div>

                    {/* Selección: mover, activar o pausar varias a la vez. */}
                    {selecting && (
                        <div
                            className="imcrm-sticky imcrm-top-0 imcrm-z-20 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-primary/30 imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-shadow-imcrm-md"
                            data-testid="automations-bulk"
                        >
                            <span className="imcrm-text-sm imcrm-font-medium">
                                {selected.size === 1 ? __('1 seleccionada') : sprintf(__('%d seleccionadas'), selected.size)}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="imcrm-h-8 imcrm-text-xs"
                                onClick={() => setSelected(new Set(orderedIds))}
                                disabled={selected.size === orderedIds.length}
                            >
                                {sprintf(__('Seleccionar las %d'), orderedIds.length)}
                            </Button>
                            <div className="imcrm-ml-auto imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" className="imcrm-h-8 imcrm-gap-1.5" data-testid="automations-bulk-move">
                                            <FolderOpen className="imcrm-h-4 imcrm-w-4" />
                                            {__('Mover a carpeta')}
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="imcrm-max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] imcrm-w-56 imcrm-overflow-y-auto">
                                        <FolderTargets
                                            current={selectedCurrentFolder}
                                            folders={folders}
                                            onMove={(folder) => doMove([...selected], folder)}
                                            onNewFolder={() => onNewFolderFor([...selected])}
                                        />
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-h-8 imcrm-gap-1.5"
                                    disabled={selectedList.every((a) => a.is_active)}
                                    onClick={async () => {
                                        const n = await setActive([...selected], true);
                                        if (n > 0) toast.success(n === 1 ? __('Se activó 1') : sprintf(__('Se activaron %d'), n));
                                    }}
                                    data-testid="automations-bulk-activate"
                                >
                                    <Play className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Activar')}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-h-8 imcrm-gap-1.5"
                                    disabled={selectedList.every((a) => !a.is_active)}
                                    onClick={async () => {
                                        const n = await setActive([...selected], false);
                                        if (n > 0) toast.success(n === 1 ? __('Se pausó 1') : sprintf(__('Se pausaron %d'), n));
                                    }}
                                    data-testid="automations-bulk-pause"
                                >
                                    <Pause className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Pausar')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="imcrm-h-8 imcrm-w-8"
                                    onClick={() => setSelected(new Set())}
                                    aria-label={__('Quitar la selección')}
                                    title={__('Quitar la selección')}
                                >
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {visible.length === 0 && filtering && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-10 imcrm-text-center" data-testid="automations-no-match">
                            <Search className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                            <p className="imcrm-text-sm imcrm-font-medium">{__('Ninguna coincide')}</p>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Prueba con otra palabra o quita el filtro.')}</p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setQuery('');
                                    setStatus('all');
                                }}
                            >
                                {__('Ver todas')}
                            </Button>
                        </div>
                    )}

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="automations-sections">
                        {sections.map((section) => {
                            const isCollapsed = !filtering && section.kind !== 'all' && collapsed.has(section.key);
                            const showHeader = section.kind !== 'all' && !bareFolderList;
                            const folderIndex = section.kind === 'folder' ? folders.findIndex((f) => folderKey(f) === folderKey(section.name)) : -1;
                            const drop = dropProps(section);
                            const isDrop = dropTarget === section.key;
                            return (
                                <section
                                    key={section.key}
                                    data-testid="automation-section"
                                    data-key={section.key}
                                    data-kind={section.kind}
                                    className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-xl imcrm-transition-shadow', isDrop && 'imcrm-ring-2 imcrm-ring-primary/50 imcrm-ring-offset-2 imcrm-ring-offset-background')}
                                    {...drop}
                                >
                                    {showHeader && (
                                        <SectionHeader
                                            section={section}
                                            collapsed={isCollapsed}
                                            canCollapse={!filtering}
                                            renaming={renaming !== null && section.kind === 'folder' && folderKey(renaming) === folderKey(section.name)}
                                            onToggle={() => toggleCollapsed(section.key)}
                                            onRename={() => setRenaming(section.name)}
                                            onRenameDone={(to) => void renameFolder(section.name, to)}
                                            onRenameCancel={() => setRenaming(null)}
                                            onDelete={() => void deleteFolder(section)}
                                            onMoveUp={folderIndex > 0 ? () => reorderFolder(section.name, -1) : undefined}
                                            onMoveDown={folderIndex >= 0 && folderIndex < folders.length - 1 ? () => reorderFolder(section.name, 1) : undefined}
                                            onSelectAll={() => setSelected((s) => new Set([...s, ...section.items.map((a) => a.id)]))}
                                        />
                                    )}
                                    {!isCollapsed &&
                                        (section.items.length > 0 ? (
                                            <ul
                                                className="imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm"
                                                data-testid="automation-section-rows"
                                            >
                                                {section.items.map((a) => (
                                                    <AutomationRow
                                                        key={a.id}
                                                        automation={a}
                                                        summary={summaries.get(a.id) ?? { trigger: '', actions: [] }}
                                                        folders={folders}
                                                        selected={selected.has(a.id)}
                                                        selecting={selecting}
                                                        draggable={groupBy === 'folder'}
                                                        togglePending={pendingToggles.has(a.id)}
                                                        onOpen={open}
                                                        onToggleActive={toggleActive}
                                                        onSelect={onSelect}
                                                        onShowRuns={setRunsFor}
                                                        onMove={doMove}
                                                        onNewFolderFor={onNewFolderFor}
                                                        onDuplicate={handleDuplicate}
                                                        onSaveTemplate={setSaveTemplateFor}
                                                        onDelete={handleDelete}
                                                        onDragStart={onDragStart}
                                                    />
                                                ))}
                                            </ul>
                                        ) : (
                                            <div
                                                className={cn(
                                                    'imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-px-4 imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground',
                                                    isDrop ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border',
                                                )}
                                                data-testid="automation-section-empty"
                                            >
                                                {__('Carpeta vacía. Arrastra automatizaciones hasta aquí o usa «Mover a carpeta» en su menú.')}
                                            </div>
                                        ))}
                                </section>
                            );
                        })}
                    </div>

                    {groupBy === 'folder' && folders.length === 0 && counts.all >= 4 && !filtering && (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="automations-folder-hint">
                            <Folder className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('¿Muchas automatizaciones? Ordénalas en carpetas (por ejemplo «Cobros» o «Avisos al equipo») con «Nueva carpeta».')}
                        </p>
                    )}
                </div>
            )}

            {!automations.isLoading && <IdeasForList list={list.data} fields={fields.data ?? []} />}

            <FolderNameDialog
                open={folderDialog !== null}
                title={folderDialog?.mode === 'move' ? __('Mover a una carpeta nueva') : __('Nueva carpeta')}
                description={
                    folderDialog?.mode === 'move'
                        ? folderDialog.ids.length === 1
                            ? __('Se crea la carpeta y la automatización pasa a ella.')
                            : sprintf(__('Se crea la carpeta y las %d automatizaciones pasan a ella.'), folderDialog.ids.length)
                        : __('Las carpetas sólo ordenan esta pantalla: no cambian cómo corren las automatizaciones.')
                }
                confirmLabel={folderDialog?.mode === 'move' ? __('Crear y mover') : __('Crear carpeta')}
                pending={folderOp.isPending || move.isPending}
                error={folderError}
                onOpenChange={(o) => !o && setFolderDialog(null)}
                onSubmit={(name) => void submitFolderDialog(name)}
            />

            <AutomationTemplateDialog open={templatesOpen} onOpenChange={setTemplatesOpen} list={list.data} fields={fields.data ?? []} />
            {saveTemplateFor !== null && (
                <SaveAutomationTemplateDialog
                    automation={saveTemplateFor}
                    open={saveTemplateFor !== null}
                    onOpenChange={(o) => !o && setSaveTemplateFor(null)}
                />
            )}
            {runsFor !== null && (
                <AutomationRunsDrawer automation={runsFor} open={runsFor !== null} onOpenChange={(o) => !o && setRunsFor(null)} />
            )}
        </div>
    );
}

function folderErrorText(err: unknown): string {
    if (err instanceof ApiError) {
        if (err.code === 'folder_exists') return __('Ya hay una carpeta con ese nombre.');
        if (err.code === 'folder_not_found') return __('Esa carpeta ya no existe (alguien la cambió). Recarga la página.');
        if (err.code === 'too_many_folders') return __('Esta lista llegó al máximo de carpetas.');
        return err.message;
    }
    return err instanceof Error ? err.message : __('Inténtalo de nuevo.');
}

function SectionHeader({
    section,
    collapsed,
    canCollapse,
    renaming,
    onToggle,
    onRename,
    onRenameDone,
    onRenameCancel,
    onDelete,
    onMoveUp,
    onMoveDown,
    onSelectAll,
}: {
    section: AutomationSection;
    collapsed: boolean;
    canCollapse: boolean;
    renaming: boolean;
    onToggle: () => void;
    onRename: () => void;
    onRenameDone: (to: string) => void;
    onRenameCancel: () => void;
    onDelete: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onSelectAll: () => void;
}): JSX.Element {
    const isFolder = section.kind === 'folder';
    const meta = section.kind === 'trigger' ? triggerMetaFor(section.name) : null;
    const Icon = meta ? meta.icon : isFolder ? (collapsed ? Folder : FolderOpen) : Folder;
    const title = meta ? meta.title : isFolder ? section.name : __('Sin carpeta');
    const active = activeCount(section.items);
    const total = section.items.length;
    const failedHere = section.items.filter(lastRunFailed).length;

    return (
        <div className="imcrm-group/sec imcrm-flex imcrm-min-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-px-1" data-testid="automation-section-header">
            <button
                type="button"
                className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-py-1 imcrm-pr-1.5 imcrm-text-left disabled:imcrm-cursor-default"
                onClick={onToggle}
                disabled={!canCollapse || renaming}
                aria-expanded={!collapsed}
                data-testid="automation-section-toggle"
            >
                <ChevronRight
                    className={cn(
                        'imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform',
                        !collapsed && 'imcrm-rotate-90',
                        !canCollapse && 'imcrm-opacity-0',
                    )}
                    aria-hidden
                />
                <Icon
                    className={cn(
                        'imcrm-h-4 imcrm-w-4 imcrm-shrink-0',
                        isFolder ? 'imcrm-text-amber-500' : 'imcrm-text-muted-foreground',
                    )}
                    aria-hidden
                />
                {!renaming && (
                    <span
                        className={cn('imcrm-truncate imcrm-text-sm imcrm-font-semibold', section.kind === 'none' && 'imcrm-text-muted-foreground')}
                        data-testid="automation-section-name"
                    >
                        {title}
                    </span>
                )}
            </button>
            {renaming && (
                <input
                    autoFocus
                    defaultValue={section.name}
                    maxLength={60}
                    className="imcrm-h-7 imcrm-min-w-0 imcrm-max-w-xs imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm imcrm-font-semibold focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameDone(e.currentTarget.value);
                        if (e.key === 'Escape') onRenameCancel();
                    }}
                    onBlur={(e) => onRenameDone(e.currentTarget.value)}
                    aria-label={__('Nombre de la carpeta')}
                    data-testid="automation-section-rename"
                />
            )}
            <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground" data-testid="automation-section-count">
                {total}
            </span>
            {total > 0 && (
                <span className="imcrm-hidden imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground sm:imcrm-inline">
                    {active === total
                        ? total === 1
                            ? __('activa')
                            : __('todas activas')
                        : active === 0
                          ? total === 1
                              ? __('pausada')
                              : __('todas pausadas')
                          : active === 1
                            ? __('1 activa')
                            : sprintf(__('%d activas'), active)}
                </span>
            )}
            {failedHere > 0 && (
                <span className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-destructive" data-testid="automation-section-failed">
                    <AlertCircle className="imcrm-h-3 imcrm-w-3" aria-hidden />
                    {failedHere === 1 ? __('1 con falla') : sprintf(__('%d con fallas'), failedHere)}
                </span>
            )}
            <div className="imcrm-ml-auto imcrm-flex imcrm-items-center">
                {(isFolder || total > 0) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground imcrm-opacity-60 hover:imcrm-text-foreground group-hover/sec:imcrm-opacity-100 focus-visible:imcrm-opacity-100"
                                aria-label={__('Opciones de la sección')}
                                data-testid="automation-section-menu"
                            >
                                <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="imcrm-w-52">
                            {total > 0 && (
                                <DropdownMenuItem className="imcrm-gap-2" onSelect={onSelectAll}>
                                    <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-items-center imcrm-justify-center">
                                        <span className="imcrm-h-3 imcrm-w-3 imcrm-rounded-sm imcrm-border imcrm-border-current" />
                                    </span>
                                    {__('Seleccionar todas')}
                                </DropdownMenuItem>
                            )}
                            {isFolder && (
                                <>
                                    {total > 0 && <DropdownMenuSeparator />}
                                    <DropdownMenuLabel className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                        {__('Carpeta')}
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem className="imcrm-gap-2" onSelect={onRename} data-testid="automation-folder-rename">
                                        <PencilLine className="imcrm-h-4 imcrm-w-4" />
                                        {__('Cambiar el nombre')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="imcrm-gap-2" disabled={!onMoveUp} onSelect={() => onMoveUp?.()} data-testid="automation-folder-up">
                                        <ArrowUp className="imcrm-h-4 imcrm-w-4" />
                                        {__('Subir')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="imcrm-gap-2" disabled={!onMoveDown} onSelect={() => onMoveDown?.()} data-testid="automation-folder-down">
                                        <ArrowDown className="imcrm-h-4 imcrm-w-4" />
                                        {__('Bajar')}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="imcrm-gap-2 imcrm-text-destructive" onSelect={onDelete} data-testid="automation-folder-delete">
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                        {__('Eliminar carpeta')}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
}

function StatusChip({
    value,
    current,
    count,
    label,
    danger,
    onPick,
}: {
    value: AutomationStatusFilter;
    current: AutomationStatusFilter;
    count: number;
    label: string;
    danger?: boolean;
    onPick: (v: AutomationStatusFilter) => void;
}): JSX.Element {
    const on = value === current;
    const alarm = danger && count > 0;
    return (
        <button
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(value)}
            data-testid={`automations-status-${value}`}
            className={cn(
                'imcrm-flex imcrm-h-8 imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                on
                    ? alarm
                        ? 'imcrm-border-destructive imcrm-bg-destructive imcrm-text-destructive-foreground'
                        : 'imcrm-border-foreground imcrm-bg-foreground imcrm-text-background'
                    : alarm
                      ? 'imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-text-destructive hover:imcrm-bg-destructive/10'
                      : 'imcrm-border-border imcrm-bg-card imcrm-text-foreground/80 hover:imcrm-bg-accent',
            )}
        >
            {label}
            <span className={cn('imcrm-tabular-nums', on ? 'imcrm-opacity-80' : 'imcrm-text-muted-foreground', alarm && !on && 'imcrm-text-destructive')}>
                {count}
            </span>
        </button>
    );
}

function ChoiceMenu<T extends string>({
    icon: Icon,
    label,
    title,
    options,
    value,
    onChange,
    testId,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    title: string;
    options: Array<{ value: T; label: string }>;
    value: T;
    onChange: (v: T) => void;
    testId: string;
}): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="imcrm-h-9 imcrm-gap-1.5" data-testid={testId} title={`${title}: ${label}`}>
                    <Icon className="imcrm-h-4 imcrm-w-4" />
                    <span className="imcrm-hidden lg:imcrm-inline">{label}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-w-52">
                <DropdownMenuLabel className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{title}</DropdownMenuLabel>
                {options.map((o) => (
                    <DropdownMenuItem
                        key={o.value}
                        onSelect={() => onChange(o.value)}
                        className="imcrm-justify-between"
                        data-testid={`${testId}-${o.value}`}
                    >
                        {o.label}
                        {o.value === value && <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary" aria-hidden />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function PageSkeleton(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-h-7 imcrm-w-40 imcrm-animate-pulse imcrm-rounded imcrm-bg-muted" />
            <div className="imcrm-h-20 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />
        </div>
    );
}

function ListSkeleton(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-h-9 imcrm-w-full imcrm-max-w-sm imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/50" />
            <ul className="imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border">
                {[0, 1, 2, 3].map((i) => (
                    <li key={i} className="imcrm-h-16 imcrm-animate-pulse imcrm-bg-muted/20" />
                ))}
            </ul>
        </div>
    );
}
