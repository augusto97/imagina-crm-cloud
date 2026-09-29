import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
    AlertCircle,
    Calendar,
    ChevronDown,
    ChevronRight,
    Database,
    FileStack,
    Folder,
    LayoutGrid,
    Pin,
    PinOff,
    Plus,
    Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { StatTile } from '@/components/ui/stat-tile';
import { ViewSwitch } from '@/components/ui/view-switch';
import { toggledFavorites, useFavorites, useUpdateFavorites } from '@/hooks/useFavorites';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { matchesListQuery, sectionsByFolder } from '@/lib/folderSections';
import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { CAP, useCan } from '@/lib/permissions';
import { formatDateStr, formatNumber } from '@/lib/tenantFormat';
import { usePersistedChoice } from '@/lib/usePersistedChoice';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';
import type { ListGroup, ListSummary } from '@/types/list';
import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';

import { FolderSquare, IconSquare } from './FolderBadge';

type IndexView = 'folders' | 'all';
const VIEW_KEY = 'imcrm:lists-index:view';
const COLLAPSED_KEY = 'imcrm:lists-index:collapsed';
/** Clave de la sección "Sin carpeta" en el set de colapsadas. */
const ROOT = 0;

function readCollapsed(): number[] {
    try {
        const raw = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]') as unknown;
        return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [];
    } catch {
        return [];
    }
}

/**
 * Índice de listas (v0.1.211): agrupado por CARPETA —las mismas del menú
 * lateral (v0.1.130), en el mismo orden y con su icono y color— con la
 * opción de verlas todas juntas, buscador y anclar a favoritos desde la
 * tarjeta. Antes era una grilla plana de todas las listas.
 */
export function ListsIndexPage(): JSX.Element {
    const lists = useLists();
    const groups = useListGroups();
    const favorites = useFavorites();
    const updateFavorites = useUpdateFavorites();
    const canCreateList = useCan(CAP.MANAGE_LISTS);

    const [dialog, setDialog] = useState<{ group?: ListGroup } | null>(null);
    const [query, setQuery] = useState('');
    const [view, setView] = usePersistedChoice<IndexView>(VIEW_KEY, ['folders', 'all'], 'folders');
    const [collapsed, setCollapsed] = useState<number[]>(readCollapsed);

    const allLists = useMemo(() => lists.data ?? [], [lists.data]);
    const allGroups = useMemo(() => groups.data ?? [], [groups.data]);
    const groupById = useMemo(() => new Map(allGroups.map((g) => [g.id, g])), [allGroups]);
    const favs = favorites.data ?? { lists: [], dashboards: [] };
    const hasFolders = allGroups.length > 0;
    const grouped = view === 'folders' && hasFolders;

    const visible = useMemo(
        () =>
            allLists.filter((l) =>
                matchesListQuery(l, query, l.group_id !== null ? groupById.get(l.group_id)?.name : undefined),
            ),
        [allLists, query, groupById],
    );
    const sections = useMemo(() => sectionsByFolder(visible, allGroups), [visible, allGroups]);

    const stats = useMemo(() => {
        const last7d = allLists.filter(
            (l) => Date.now() - parseUtcDate(l.updated_at).getTime() < 7 * 24 * 60 * 60 * 1000,
        ).length;
        return {
            total: allLists.length,
            last7d,
            folders: allGroups.length,
            inRoot: allLists.filter((l) => l.group_id === null || !groupById.has(l.group_id)).length,
            pinned: favs.lists.filter((id) => allLists.some((l) => l.id === id)).length,
        };
    }, [allLists, allGroups, groupById, favs.lists]);

    const toggleSection = (key: number): void => {
        setCollapsed((prev) => {
            const next = prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key];
            try {
                window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
            } catch {
                /* storage bloqueado: la preferencia no persiste */
            }
            return next;
        });
    };

    const togglePin = (id: number): void => updateFavorites.mutate(toggledFavorites(favs, 'lists', id));
    const searching = query.trim() !== '';

    const card = (l: ListSummary, showFolder: boolean): JSX.Element => (
        <ListCard
            key={l.id}
            list={l}
            folder={showFolder && l.group_id !== null ? groupById.get(l.group_id) : undefined}
            pinned={favs.lists.includes(l.id)}
            onTogglePin={() => togglePin(l.id)}
        />
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-leading-none imcrm-tracking-tight imcrm-text-foreground">
                        {__('Listas')}
                    </h1>
                    <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                        {hasFolders
                            ? __('Tus listas, ordenadas por carpeta como en el menú. Cada una es un contenedor de registros con campos y vistas.')
                            : __('Click en una lista para abrirla. Cada una es un contenedor de registros con campos y vistas configurables.')}
                    </p>
                </div>
                {canCreateList && (
                    <Button className="imcrm-gap-1.5" onClick={() => setDialog({})}>
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva lista')}
                    </Button>
                )}
            </header>

            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 md:imcrm-grid-cols-4">
                <StatTile icon={FileStack} label={__('Total')} value={stats.total} tone="cyan" />
                <StatTile
                    icon={Calendar}
                    label={__('Últimos 7 días')}
                    value={stats.last7d}
                    tone="mint"
                    hint={stats.last7d === 1 ? __('1 lista actualizada') : sprintf(__('%d listas actualizadas'), stats.last7d)}
                />
                <StatTile
                    icon={Folder}
                    label={__('Carpetas')}
                    value={stats.folders}
                    tone="violet"
                    hint={
                        stats.inRoot === 1
                            ? __('1 lista sin carpeta')
                            : sprintf(__('%d listas sin carpeta'), stats.inRoot)
                    }
                />
                <StatTile
                    icon={Pin}
                    label={__('Ancladas')}
                    value={stats.pinned}
                    tone="slate"
                    hint={__('En tus favoritos')}
                />
            </div>

            {lists.isError && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3.5 imcrm-text-sm imcrm-text-destructive">
                    <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <span>
                        {sprintf(__('No se pudieron cargar las listas: %s'), (lists.error as Error).message)}
                    </span>
                </div>
            )}

            {lists.isLoading ? (
                <SkeletonGrid />
            ) : allLists.length === 0 ? (
                <ListsEmpty onCreate={() => setDialog({})} />
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <div className="imcrm-relative imcrm-min-w-[12rem] imcrm-flex-1 sm:imcrm-max-w-xs">
                            <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={__('Buscar lista o carpeta…')}
                                className="imcrm-h-8 imcrm-pl-8 imcrm-text-[13px]"
                                data-testid="lists-index-search"
                            />
                        </div>
                        {hasFolders && (
                            <ViewSwitch<IndexView>
                                label={__('Agrupar listas')}
                                value={view}
                                onChange={setView}
                                testId="lists-index-view"
                                options={[
                                    { value: 'folders', label: __('Por carpeta'), icon: Folder },
                                    { value: 'all', label: __('Todas'), icon: LayoutGrid },
                                ]}
                            />
                        )}
                    </div>

                    {visible.length === 0 ? (
                        <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                            {sprintf(__('Ninguna lista coincide con «%s».'), query.trim())}
                        </p>
                    ) : grouped ? (
                        sections.map((s) => {
                            const key = s.group?.id ?? ROOT;
                            // Buscando, todo se muestra abierto: esconder un
                            // resultado detrás de una carpeta plegada confunde.
                            const isOpen = searching || !collapsed.includes(key);
                            return (
                                <section
                                    key={key}
                                    className="imcrm-flex imcrm-flex-col imcrm-gap-3"
                                    data-testid="lists-index-section"
                                    data-folder={s.group?.name ?? ''}
                                >
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-pb-2">
                                        <button
                                            type="button"
                                            onClick={() => toggleSection(key)}
                                            aria-expanded={isOpen}
                                            className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-left"
                                            data-testid="lists-index-section-toggle"
                                        >
                                            {isOpen ? (
                                                <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                            )}
                                            {s.group ? (
                                                <FolderSquare group={s.group} size="sm" />
                                            ) : (
                                                <IconSquare icon={DEFAULT_LIST_ICON} color={undefined} size="sm" />
                                            )}
                                            <h2 className="imcrm-truncate imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">
                                                {s.group ? s.group.name : __('Sin carpeta')}
                                            </h2>
                                            <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">
                                                {formatNumber(s.items.length)}
                                            </span>
                                        </button>
                                        {canCreateList && s.group && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs"
                                                onClick={() => setDialog({ group: s.group ?? undefined })}
                                                data-testid="lists-index-section-add"
                                                aria-label={__('Nueva lista aquí')}
                                                title={__('Nueva lista aquí')}
                                            >
                                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {/* En celular sólo el "+": el nombre de la carpeta necesita el ancho. */}
                                                <span className="imcrm-hidden sm:imcrm-inline">{__('Nueva lista aquí')}</span>
                                            </Button>
                                        )}
                                    </div>
                                    {isOpen && <CardGrid>{s.items.map((l) => card(l, false))}</CardGrid>}
                                </section>
                            );
                        })
                    ) : (
                        <CardGrid>{visible.map((l) => card(l, true))}</CardGrid>
                    )}
                </div>
            )}

            {dialog !== null && (
                <ListCreateDialog
                    open
                    onOpenChange={(o) => !o && setDialog(null)}
                    groupId={dialog.group?.id}
                    groupName={dialog.group?.name}
                />
            )}
        </div>
    );
}

function CardGrid({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">{children}</div>
    );
}

/** Fecha local `YYYY-MM-DD` de un timestamp, en el formato de la empresa. */
function localDate(ts: string): string {
    const d = parseUtcDate(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const p = (n: number) => String(n).padStart(2, '0');
    return formatDateStr(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
}

function ListCard({
    list,
    folder,
    pinned,
    onTogglePin,
}: {
    list: ListSummary;
    /** Sólo en la vista "Todas": la carpeta de la lista como chip. */
    folder: ListGroup | undefined;
    pinned: boolean;
    onTogglePin: () => void;
}): JSX.Element {
    return (
        <div
            className="imcrm-group/card imcrm-relative imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-transition-all imcrm-duration-200 hover:imcrm--translate-y-0.5 hover:imcrm-border-primary/30 hover:imcrm-shadow-imcrm-md"
            data-testid="lists-index-card"
            data-list={list.slug}
        >
            <Link to={`/lists/${list.slug}/records`} className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-p-5">
                <IconSquare icon={listIcon(list.icon) ?? DEFAULT_LIST_ICON} color={listColor(list.color)} size="lg" />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <h3 className="imcrm-truncate imcrm-pr-6 imcrm-text-[15px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
                        {list.name}
                    </h3>
                    {list.description ? (
                        <p className="imcrm-line-clamp-2 imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                            {list.description}
                        </p>
                    ) : (
                        <p className="imcrm-text-[13px] imcrm-italic imcrm-text-muted-foreground/60">{__('Sin descripción')}</p>
                    )}
                </div>

                <footer className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3 imcrm-text-[11px]">
                    {folder ? (
                        <span
                            className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground"
                            data-testid="lists-index-card-folder"
                        >
                            <FolderSquare group={folder} size="sm" />
                            <span className="imcrm-truncate">{folder.name}</span>
                        </span>
                    ) : (
                        <code className="imcrm-truncate imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-muted-foreground">
                            /{list.slug}
                        </code>
                    )}
                    <span className="imcrm-shrink-0 imcrm-text-muted-foreground">
                        {sprintf(__('Editado %s'), localDate(list.updated_at))}
                    </span>
                </footer>
            </Link>
            <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={pinned}
                aria-label={pinned ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                title={pinned ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                data-testid="lists-index-card-pin"
                className={cn(
                    'imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1.5 imcrm-transition-opacity hover:imcrm-bg-accent',
                    // Anclada: visible fija en tinta suave. Sin anclar: al
                    // hover; en táctil (sin hover) queda visible tenue.
                    pinned
                        ? 'imcrm-text-foreground/70 hover:imcrm-text-foreground'
                        : 'imcrm-text-muted-foreground imcrm-opacity-40 hover:imcrm-text-foreground focus-visible:imcrm-opacity-100 group-hover/card:imcrm-opacity-100 lg:imcrm-opacity-0',
                )}
            >
                {pinned ? <PinOff className="imcrm-h-4 imcrm-w-4" /> : <Pin className="imcrm-h-4 imcrm-w-4" />}
            </button>
        </div>
    );
}

function SkeletonGrid(): JSX.Element {
    return (
        <CardGrid>
            {[0, 1, 2].map((i) => (
                <div key={i} className="imcrm-h-44 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />
            ))}
        </CardGrid>
    );
}

function ListsEmpty({ onCreate }: { onCreate: () => void }): JSX.Element {
    const canCreate = useCan(CAP.MANAGE_LISTS);
    return (
        <EmptyState
            icon={Database}
            title={__('Aún no hay listas')}
            description={
                canCreate
                    ? __('Crea tu primera lista para empezar a capturar registros.')
                    : __('Tu rol no tiene listas asignadas todavía. Contacta al administrador.')
            }
            action={
                canCreate ? (
                    <Button onClick={onCreate} className="imcrm-gap-2">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva lista')}
                    </Button>
                ) : undefined
            }
        />
    );
}
