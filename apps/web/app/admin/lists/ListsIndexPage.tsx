import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
    AlertCircle,
    Calendar,
    ChevronDown,
    ChevronRight,
    Database,
    FileStack,
    FileText,
    Folder,
    FolderOpen,
    LayoutGrid,
    Pin,
    Plus,
    Search,
    Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { StatTile } from '@/components/ui/stat-tile';
import { ViewSwitch } from '@/components/ui/view-switch';
import { EMPTY_FAVORITES, toggledFavorites, useFavorites, useUpdateFavorites } from '@/hooks/useFavorites';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { useOnboardingStatus, useUpdateOnboardingPrefs } from '@/hooks/useOnboarding';
import { useIsGuest } from '@/lib/guest';
import { matchesListQuery, sectionsByFolder } from '@/lib/folderSections';
import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_DASHBOARD_ICON, DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { CAP, useCan } from '@/lib/permissions';
import { formatNumber } from '@/lib/tenantFormat';
import { usePersistedChoice } from '@/lib/usePersistedChoice';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRecents } from '@/lib/recents';
import { useSession } from '@/cloud/session';
import { parseUtcDate } from '@/lib/utcDate';
import type { ListGroup, ListSummary } from '@/types/list';
import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';
import { useFinishWelcome } from '@/admin/onboarding/useFinishWelcome';

import { FolderSquare, IconSquare } from './FolderBadge';
import { CardGrid, ListCard } from './ListCard';

// F7 — la bienvenida sólo la ve una empresa sin listas: se baja a pedido.
const WelcomeFlow = lazy(() => import('@/admin/onboarding/WelcomeFlow').then((m) => ({ default: m.WelcomeFlow })));

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
    const isGuest = useIsGuest();
    const onboarding = useOnboardingStatus(!isGuest);
    const updatePrefs = useUpdateOnboardingPrefs();
    const finishWelcome = useFinishWelcome();

    const [dialog, setDialog] = useState<{ group?: ListGroup; blank?: boolean } | null>(null);
    const [query, setQuery] = useState('');
    const [view, setView] = usePersistedChoice<IndexView>(VIEW_KEY, ['folders', 'all'], 'folders');
    const [collapsed, setCollapsed] = useState<number[]>(readCollapsed);

    const allLists = useMemo(() => lists.data ?? [], [lists.data]);
    const allGroups = useMemo(() => groups.data ?? [], [groups.data]);
    const groupById = useMemo(() => new Map(allGroups.map((g) => [g.id, g])), [allGroups]);
    const favs = favorites.data ?? EMPTY_FAVORITES;
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

    // F7 (ADR-S72) — una empresa sin listas, con alguien que puede crearlas:
    // en vez del estado vacío, la bienvenida «Armemos tu espacio».
    const noLists = !lists.isLoading && !lists.isError && allLists.length === 0;
    if (noLists && canCreateList && onboarding.isLoading) {
        return <SkeletonGrid />;
    }
    if (noLists && canCreateList && onboarding.data?.welcome) {
        return (
            <>
                <Suspense fallback={<SkeletonGrid />}>
                    <WelcomeFlow
                        variant="page"
                        onCreated={finishWelcome}
                        onBlank={() => {
                            updatePrefs.mutate({ welcome_dismissed: true });
                            setDialog({ blank: true });
                        }}
                    />
                </Suspense>
                {dialog !== null && <ListCreateDialog open onOpenChange={(o) => !o && setDialog(null)} initialMode="blank" />}
            </>
        );
    }

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
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-x-4 imcrm-gap-y-2 sm:imcrm-items-end">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-leading-none imcrm-tracking-tight imcrm-text-foreground">
                        {__('Listas')}
                    </h1>
                    <p className="imcrm-hidden imcrm-text-[13px] imcrm-text-muted-foreground sm:imcrm-block">
                        {hasFolders
                            ? __('Tus listas, ordenadas por carpeta como en el menú. Cada una es un contenedor de registros con campos y vistas.')
                            : __('Haz clic en una lista para abrirla. Cada una guarda registros con sus campos y vistas.')}
                    </p>
                </div>
                {canCreateList && (
                    <Button className="imcrm-gap-1.5" onClick={() => setDialog({})} data-tour="lists-new">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva lista')}
                    </Button>
                )}
            </header>

            {/* v0.1.342 — en el celular estas cifras ocupaban toda la primera
                pantalla antes de mostrar una sola lista: ahí no van. */}
            <div className="imcrm-hidden imcrm-grid-cols-2 imcrm-gap-3 md:imcrm-grid md:imcrm-grid-cols-4">
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
                <ListsEmpty
                    onCreate={() => setDialog({})}
                    adminName={onboarding.data?.admin_name ?? null}
                    onShowWelcome={onboarding.data ? () => updatePrefs.mutate({ welcome_dismissed: false }) : undefined}
                />
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    {!searching && (
                        <QuickAccess
                            lists={allLists}
                            pinnedIds={favs.lists}
                        />
                    )}
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
                                        {s.group && (
                                            <Button asChild variant="ghost" size="sm" className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs">
                                                <Link
                                                    to={`/folders/${s.group.id}`}
                                                    data-testid="lists-index-section-open"
                                                    aria-label={sprintf(__('Abrir la carpeta %s'), s.group.name)}
                                                    title={__('Abrir la carpeta')}
                                                >
                                                    <FolderOpen className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    <span className="imcrm-hidden sm:imcrm-inline">{__('Abrir')}</span>
                                                </Link>
                                            </Button>
                                        )}
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
                    initialMode={dialog.blank ? 'blank' : undefined}
                />
            )}
        </div>
    );
}

function SkeletonGrid(): JSX.Element {
    return (
        <CardGrid>
            {[0, 1, 2].map((i) => (
                <div key={i} className="imcrm-h-16 sm:imcrm-h-44 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />
            ))}
        </CardGrid>
    );
}

function ListsEmpty({
    onCreate,
    adminName,
    onShowWelcome,
}: {
    onCreate: () => void;
    adminName: string | null;
    onShowWelcome?: () => void;
}): JSX.Element {
    const canCreate = useCan(CAP.MANAGE_LISTS);
    return (
        <EmptyState
            icon={Database}
            title={__('Aún no hay listas')}
            description={
                canCreate
                    ? __('Crea tu primera lista para empezar a cargar registros.')
                    : adminName
                      ? sprintf(__('Pídele a %s que cree la primera lista. Cuando la cree, aparecerá aquí.'), adminName)
                      : __('Pídele a quien administra tu empresa que cree la primera lista. Cuando la cree, aparecerá aquí.')
            }
            action={
                canCreate ? (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                        <Button onClick={onCreate} className="imcrm-gap-2" data-tour="lists-new">
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('Nueva lista')}
                        </Button>
                        {onShowWelcome && (
                            <Button variant="outline" onClick={onShowWelcome} className="imcrm-gap-2" data-testid="lists-show-welcome">
                                <Sparkles className="imcrm-h-4 imcrm-w-4" />
                                {__('Armar mi espacio con ayuda')}
                            </Button>
                        )}
                    </div>
                ) : undefined
            }
        />
    );
}

/**
 * v0.1.342 — En el celular (y en tablet, donde no está el panel lateral), lo
 * abierto hace poco y las listas ancladas, ARRIBA del índice: es lo que el
 * panel lateral del escritorio muestra y lo que más se vuelve a abrir. Con un
 * toque se llega, sin buscar entre todas las carpetas.
 */
function QuickAccess({ lists, pinnedIds }: { lists: ListSummary[]; pinnedIds: number[] }): JSX.Element | null {
    const narrow = useMediaQuery('(max-width: 1023px)');
    const tenantId = useSession((st) => st.activeTenantId);
    const recents = useRecents(tenantId).slice(0, 4);
    if (!narrow) return null;
    const byId = new Map(lists.map((l) => [l.id, l]));
    const pinned = pinnedIds.map((id) => byId.get(id)).filter((l): l is ListSummary => l !== undefined).slice(0, 6);
    if (recents.length === 0 && pinned.length === 0) return null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="lists-quick-access">
            {recents.length > 0 && (
                <QuickGroup label={__('Recientes')}>
                    {recents.map((r) => {
                        const Icon =
                            r.kind === 'record'
                                ? FileText
                                : (listIcon(r.icon) ?? (r.kind === 'dashboard' ? DEFAULT_DASHBOARD_ICON : DEFAULT_LIST_ICON));
                        const color = r.kind === 'record' ? undefined : listColor(r.color);
                        return (
                            <QuickRow key={`${r.kind}-${r.id}`} to={r.href} label={r.label} sub={r.context ?? null}>
                                <Icon className="imcrm-h-[18px] imcrm-w-[18px]" style={color ? { color } : undefined} aria-hidden />
                            </QuickRow>
                        );
                    })}
                </QuickGroup>
            )}
            {pinned.length > 0 && (
                <QuickGroup label={__('Favoritos')}>
                    {pinned.map((l) => (
                        <QuickRow key={l.id} to={`/lists/${l.slug}/records`} label={l.name} sub={null}>
                            <IconSquare icon={listIcon(l.icon) ?? DEFAULT_LIST_ICON} color={listColor(l.color)} size="sm" />
                        </QuickRow>
                    ))}
                </QuickGroup>
            )}
        </div>
    );
}

function QuickGroup({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <h2 className="imcrm-px-1 imcrm-text-[12px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">{label}</h2>
            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">
                {children}
            </ul>
        </section>
    );
}

function QuickRow({ to, label, sub, children }: { to: string; label: string; sub: string | null; children: React.ReactNode }): JSX.Element {
    return (
        <li>
            <Link
                to={to}
                className="imcrm-flex imcrm-min-h-12 imcrm-items-center imcrm-gap-3 imcrm-px-3.5 imcrm-py-2 imcrm-transition-colors active:imcrm-bg-muted/60"
            >
                <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">{children}</span>
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[15px]">{label}</span>
                {sub && <span className="imcrm-max-w-[40%] imcrm-shrink-0 imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{sub}</span>}
            </Link>
        </li>
    );
}
