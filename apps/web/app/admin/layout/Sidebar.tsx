import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useSearchParams } from 'react-router';
import {
    BarChart3,
    Bot,
    ChevronsLeft,
    ChevronsRight,
    AlarmClock,
    FileText,
    GraduationCap,
    LayoutGrid,
    ListChecks,
    List as ListIcon,
    Loader2,
    Settings,
    ShieldAlert,
    Pin,
    PinOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { DEFAULT_DASHBOARD_ICON, DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { resolveSettingsSection, settingsSectionGroups } from '@/cloud/settingsSections';
import { useBrandingData } from '@/hooks/useBranding';
import { useAppIdentity } from '@/hooks/useAppIdentity';
import { BrandMark } from '@/components/BrandMark';
import { useDashboards } from '@/hooks/useDashboards';
import { EMPTY_FAVORITES, favoriteViewPath, toggledFavorites, useFavoriteViews, useFavorites, useUpdateFavorites, type Favorites } from '@/hooks/useFavorites';
import { viewTypeIcon } from '@/admin/records/views/viewTypeIcon';
import { useLists, useReorderLists } from '@/hooks/useLists';
import { useMyWork } from '@/hooks/useNotifications';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useRecents } from '@/lib/recents';
import { getTenantTimeZone, browserTimeZone, formatDateStr, formatDateTimeStr } from '@/lib/tenantFormat';
import { DUE_GROUPS, groupChecklistWork, groupWork } from '@/admin/mywork/myWorkGroups';
import { useListGroups } from '@/hooks/useListGroups';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { moduleEnabled } from '@/lib/cloudFeatures';
import {
    FAVORITES_GROUPING_KEY,
    FAVORITES_GROUPINGS,
    favoriteSections,
    type FavoritesGrouping,
} from '@/lib/favoriteSections';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { usePersistedChoice } from '@/lib/usePersistedChoice';
import { cn } from '@/lib/utils';
import type { DashboardEntity } from '@/types/dashboard';
import type { ListSummary } from '@/types/list';
import { ViewSwitch } from '@/components/ui/view-switch';
import { FolderSquare } from '@/admin/lists/FolderBadge';
import { isPlatformTab, platformTabGroups } from '@/admin/platform/platformTabs';
import { AgentsPanel } from '@/admin/agents/AgentsPanel';

import { DashboardPanelItem } from './DashboardPanelItem';
import { DashboardsPanelList } from './DashboardsPanelList';
import { ListPanelItem } from './ListPanelItem';
import { ListsTree } from './ListsTree';
import { PeekHoldContext } from './peekHold';
import { WorkspaceSwitcherTitle } from './WorkspaceSwitcher';

/** Preferencia de colapso del panel interno (persistida por navegador). */
const PANEL_COLLAPSED_KEY = 'imcrm-panel-collapsed';

function readCollapsedPref(): boolean {
    try {
        return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

/** Sección del riel activa — derivada de la RUTA (no estado aparte). */
type RailSection = 'home' | 'mywork' | 'favorites' | 'dashboards' | 'agents' | 'learn' | 'settings' | 'platform';

// v0.1.322 — el índice del manual se baja sólo al abrir el centro de aprendizaje.
const LearnPanelNav = lazy(() => import('@/admin/learn/LearnNav'));

function railSectionFromPath(pathname: string): RailSection {
    if (pathname.startsWith('/my-work')) return 'mywork';
    if (pathname.startsWith('/favorites')) return 'favorites';
    if (pathname.startsWith('/dashboards')) return 'dashboards';
    if (pathname.startsWith('/agents')) return 'agents';
    if (pathname.startsWith('/aprende') || pathname.startsWith('/ideas')) return 'learn';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/platform')) return 'platform';
    return 'home';
}

/**
 * Sidebar doble estilo ClickUp:
 *  - RIEL (izquierda, fijo, ~68px, tema oscuro `--imcrm-sidebar*`): logo de la
 *    marca arriba (sólo el cuadrado, sin texto) + items verticales de icono
 *    con etiqueta chica debajo (Listas / Favoritos / Dashboards / Ajustes /
 *    Plataforma). Con el panel cerrado, arriba del todo aparece el botón de
 *    abrirlo (v0.1.145); con el panel abierto, el de cerrarlo vive en la
 *    cabecera del panel.
 *  - HOVER en un item del riel → su contenido aparece FLOTANDO sobre el área
 *    de trabajo (v0.1.145, como ClickUp), sin navegar ni abrir el panel.
 *  - PANEL interno (~240px, tema CLARO): CONTEXTUAL — su contenido depende
 *    del item activo del riel (derivado de la ruta con useLocation):
 *      · Inicio      → workspace + árbol de listas ("Espacio de trabajo").
 *      · Dashboards  → workspace + "Todos los dashboards" + árbol.
 *      · Ajustes     → secciones de SettingsPage (links a `/settings?s=`).
 *      · Plataforma  → pestañas de la consola (links a `/platform?tab=`).
 *  - Colapsado → el panel se oculta y queda el riel; la navegación NO lo
 *    re-expande.
 *  - v0.1.342 — SÓLO escritorio (≥1024 px). En el celular el shell no lo
 *    monta: manda la barra de pestañas de abajo (`MobileTabBar`) y la página
 *    «Más» (`/menu`). Antes era un cajón de dos columnas que había que abrir
 *    para cualquier cosa.
 */
export function Sidebar(): JSX.Element {
    const lists = useLists();
    const dashboards = useDashboards();
    const [collapsed, setCollapsed] = useState<boolean>(readCollapsedPref);
    // v0.1.107 — favoritos anclados + reorden del menú de listas.
    const favorites = useFavorites();
    const updateFavorites = useUpdateFavorites();
    const reorderLists = useReorderLists();
    const favs: Favorites = favorites.data ?? EMPTY_FAVORITES;
    const toggleFav = useEventCallback((kind: keyof Favorites, id: number): void => {
        updateFavorites.mutate(toggledFavorites(favs, kind, id));
    });
    const toggleListFav = useEventCallback((id: number): void => toggleFav('lists', id));
    // Drag & drop del árbol de listas (HTML5). El índice arrastrado vive en
    // un ref (no re-renderiza); al soltar se manda el orden completo.
    const dragIndexRef = useRef<number | null>(null);
    const handleListDrop = useEventCallback((targetIndex: number): void => {
        const from = dragIndexRef.current;
        dragIndexRef.current = null;
        if (from === null || !lists.data || from === targetIndex) return;
        const next = [...lists.data];
        const [moved] = next.splice(from, 1);
        if (!moved) return;
        next.splice(targetIndex, 0, moved);
        reorderLists.mutate(next.map((l) => l.id));
    });

    const { pathname } = useLocation();
    const [params] = useSearchParams();
    const routeSection = railSectionFromPath(pathname);

    const section: RailSection = routeSection;
    const [homeMounted, setHomeMounted] = useState(section === 'home');
    useEffect(() => {
        if (section === 'home') setHomeMounted(true);
    }, [section]);

    // v0.1.145 — al pasar el mouse por un item del riel, su contenido
    // aparece FLOTANDO (lo que hace ClickUp): con el panel cerrado es la
    // única forma de ojear otra sección sin abrirla, y con el panel abierto
    // sirve para espiar una sección distinta de la que estás viendo. Con
    // retardo de apertura/cierre para que no parpadee al cruzar el riel.
    const [hovered, setHovered] = useState<RailSection | null>(null);
    const openTimer = useRef<number | null>(null);
    const closeTimer = useRef<number | null>(null);
    const clearTimers = (): void => {
        if (openTimer.current !== null) window.clearTimeout(openTimer.current);
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
        openTimer.current = null;
        closeTimer.current = null;
    };
    const peek = (s: RailSection): void => {
        clearTimers();
        openTimer.current = window.setTimeout(() => setHovered(s), 120);
    };
    const unpeek = (): void => {
        clearTimers();
        closeTimer.current = window.setTimeout(() => setHovered(null), 180);
    };
    // Al navegar (o al desmontar) el flotante se va: si no, queda tapando
    // justo el contenido al que acabas de entrar.
    useEffect(() => {
        clearTimers();
        setHovered(null);
        return clearTimers;
    }, [pathname]);
    // Sólo flota lo que NO estás viendo ya en el panel acoplado.
    const peeking = hovered !== null && (collapsed || hovered !== section) ? hovered : null;
    // v0.1.172 — un menú contextual o un diálogo abierto DESDE el flotante
    // lo sostiene abierto (el menú va por portal: en el DOM el mouse "sale"
    // del flotante al entrar al menú, y cada click adentro burbujea hasta
    // aquí). Al soltarlo, el flotante se va: el mouse ya está en otro lado.
    const holdRef = useRef(false);
    const peekHold = useCallback((held: boolean): void => {
        if (holdRef.current === held) return;
        holdRef.current = held;
        if (!held) {
            clearTimers();
            setHovered(null);
        }
    }, []);
    const unpeekUnlessHeld = (): void => {
        if (!holdRef.current) unpeek();
    };

    // Branding white-label del tenant (logo + nombre). Lee del query cache
    // que puebla `useBranding` en AdminCloudApp; nulls → marca por defecto.
    const branding = useBrandingData();
    const brandAppName = branding.data?.app_name ?? null;

    // Workspace activo de la sesión (nombre del tenant para el header del
    // panel). Si el branding define un app_name white-label, manda ese.
    const activeTenantId = useSession((s) => s.activeTenantId);
    const memberships = useSession((s) => s.memberships);
    const membership = memberships.find((m) => m.tenant_id === activeTenantId);
    const workspaceName = membership?.tenant_name ?? null;
    const isAdmin = membership?.role === 'admin';
    const identity = useAppIdentity({ workspaceName });
    const workspaceTitle = brandAppName ?? workspaceName ?? identity.name;

    // Gating por capability (Fase 7 — 1.E). El backend ya filtra GET /lists
    // a las visibles para el user, así que "Tus listas" se auto-recorta.
    // Hooks siempre en el mismo orden (rules-of-hooks): resolvemos cada
    // capability por separado y recién después combinamos.
    const canManageDashboards = useCan(CAP.MANAGE_DASHBOARDS);
    // E6 — «Agentes» sólo para quien los administra.
    const canManageAgents = useCan(CAP.MANAGE_AI_AGENTS);
    const canAccessAdmin = useCan(CAP.ACCESS_ADMIN);
    const canManageLists = useCan(CAP.MANAGE_LISTS);
    // C2 — «Ver tableros» es una capacidad (rol propio); los roles base la tienen.
    const canViewDashboards = useCan(CAP.VIEW_DASHBOARDS);
    const canSeeDashboards = (canManageDashboards || (canAccessAdmin && canViewDashboards)) && moduleEnabled('dashboards');
    // v0.1.286 — "Ajustes" se ve SIEMPRE: agentes y lectores también tienen su
    // cuenta ahí (seguridad, avisos, firma, apariencia). Antes se ocultaba.
    // Sección de operador (superadmin de plataforma): `is_superadmin` de
    // `/auth/me` (no depende de la matriz de capabilities).
    const isSuperadmin = useIsSuperadmin();

    // Header del panel según la sección del riel: nombre del workspace para
    // los árboles de contenido, título fijo para las navs Ajustes/Plataforma.
    const titleFor = (sec: RailSection): string =>
        sec === 'settings'
            ? __('Ajustes')
            : sec === 'platform'
              ? __('Plataforma')
              : sec === 'favorites'
                ? __('Favoritos')
                : sec === 'mywork'
                  ? __('Mi trabajo')
                  : sec === 'agents'
                    ? __('Agentes de IA')
                    : sec === 'learn'
                      ? __('Aprende')
                      : workspaceTitle;

    /**
     * El CONTENIDO del panel para una sección. Lo usan las dos superficies
     * —el panel acoplado y el flotante del hover— así que agregar algo aquí
     * sale en ambas por construcción.
     */
    const panelBody = (sec: RailSection): JSX.Element => (
        <>
            {sec === 'home' && (
                <>
                    {/* v0.1.286 — lo abierto hace poco, arriba del árbol. */}
                    <RecentsPanelSection />
                    {/* v0.1.286 — también con CERO listas: la cabecera y
                        "Nueva lista" no pueden depender de que ya haya una
                        (un workspace nuevo quedaba con el panel en blanco). */}
                    {lists.data && (
                        <ListsTree
                            lists={lists.data}
                            canManageLists={canManageLists}
                            starredIds={favs.lists}
                            onToggleStar={toggleListFav}
                            onReorder={handleListDrop}
                            dragIndexRef={dragIndexRef}
                        />
                    )}
                    {lists.isLoading && <PanelLoading />}
                </>
            )}

            {sec === 'dashboards' && (
                <>
                    <PanelNavItem
                        to="/dashboards"
                        icon={LayoutGrid}
                        label={__('Todos los dashboards')}
                        active={pathname === '/dashboards'}
                    />
                    {dashboards.data && dashboards.data.length > 0 && (
                        <PanelSection label={__('Tus dashboards')}>
                            {/* v0.1.286 — reordenables arrastrando. */}
                            <DashboardsPanelList
                                dashboards={dashboards.data}
                                starredIds={favs.dashboards}
                                onToggleStar={(id) => toggleFav('dashboards', id)}
                            />
                        </PanelSection>
                    )}
                    {dashboards.isLoading && <PanelLoading />}
                </>
            )}

            {sec === 'mywork' && <MyWorkPanelSummary />}

            {sec === 'agents' && <AgentsPanel pathname={pathname} />}

            {sec === 'learn' && (
                <Suspense fallback={null}>
                    <LearnPanelNav pathname={pathname} />
                </Suspense>
            )}

            {sec === 'favorites' && (
                <>
                    <FavoritesSection
                        favs={favs}
                        lists={lists.data ?? []}
                        dashboards={dashboards.data ?? []}
                        onToggle={toggleFav}
                    />
                </>
            )}

            {sec === 'settings' && (
                <SettingsPanelNav
                    isAdmin={isAdmin}
                    // La página de una tienda sincronizada vive bajo Integraciones.
                    requested={pathname.startsWith('/settings/stores/') || pathname.startsWith('/settings/sites/') || pathname.startsWith('/settings/sql/') || pathname.startsWith('/settings/whatsapp/') || pathname.startsWith('/settings/sms/') || pathname.startsWith('/settings/collections/') ? 'conectores' : params.get('s')}
                />
            )}

            {sec === 'platform' && <PlatformPanelNav requested={params.get('tab')} />}
        </>
    );

    const toggleCollapsed = (): void => {
        setCollapsed((c) => {
            const next = !c;
            try {
                window.localStorage.setItem(PANEL_COLLAPSED_KEY, next ? '1' : '0');
            } catch {
                // storage bloqueado (modo privado): la preferencia no persiste.
            }
            return next;
        });
    };


    return (
        <div
            // `imcrm-admin-sidebar`: el modo fullscreen del template editor
            // oculta este chrome (globals.css) — riel + panel juntos.
            className="imcrm-admin-sidebar imcrm-flex imcrm-shrink-0"
        >
            {/* ── Riel oscuro de iconos ─────────────────────────────────── */}
            <nav
                aria-label={__('Navegación principal')}
                // El riel FLOTA: esquinas redondeadas y un respiro de 6px
                // contra los bordes de la ventana y contra el panel (v0.1.128,
                // estilo ClickUp).
                className="imcrm-scroll-on-dark imcrm-my-1.5 imcrm-ml-1.5 imcrm-mr-1.5 imcrm-flex imcrm-w-[68px] imcrm-shrink-0 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-xl imcrm-bg-sidebar imcrm-px-2 imcrm-py-3 imcrm-text-sidebar-foreground"
            >
                {/* Marca: sólo el cuadrado/logo (el nombre vive en el panel). */}
                <div className="imcrm-mb-1 imcrm-flex imcrm-shrink-0 imcrm-justify-center">
                    <BrandMark url={identity.markUrl} name={workspaceTitle} tone="rail" className="imcrm-h-9 imcrm-w-9" />
                </div>

                {/* Con el panel CERRADO, el botón de abrirlo vive arriba del
                    riel (v0.1.145, como ClickUp) — antes estaba al fondo,
                    lejos de donde se lo busca. Con el panel abierto, el de
                    cerrarlo vive en la cabecera del panel. */}
                {collapsed && (
                    <>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapsed();
                            }}
                            className="imcrm-hidden imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-py-1.5 imcrm-text-sidebar-foreground/70 imcrm-transition-colors hover:imcrm-bg-sidebar-accent hover:imcrm-text-sidebar-accent-foreground lg:imcrm-flex"
                            aria-label={__('Expandir panel')}
                            title={__('Expandir panel')}
                            aria-expanded={false}
                        >
                            <ChevronsRight className="imcrm-h-4 imcrm-w-4" />
                        </button>
                        <span
                            aria-hidden
                            className="imcrm-mx-auto imcrm-mb-1 imcrm-hidden imcrm-h-px imcrm-w-6 imcrm-bg-sidebar-foreground/20 lg:imcrm-block"
                        />
                    </>
                )}

                <RailItem
                    to="/lists"
                    tour="rail-lists"
                    active={section === 'home'}
                    icon={ListIcon}
                    label={__('Listas')}
                    onPeek={() => peek('home')}
                    onUnpeek={unpeek}
                />
                <RailItem
                    to="/my-work"
                    tour="rail-mywork"
                    active={section === 'mywork'}
                    icon={ListChecks}
                    label={__('Mi trabajo')}
                    onPeek={() => peek('mywork')}
                    onUnpeek={unpeek}
                />
                <RailItem
                    to="/favorites"
                    tour="rail-favorites"
                    active={section === 'favorites'}
                    icon={Pin}
                    label={__('Favoritos')}
                    onPeek={() => peek('favorites')}
                    onUnpeek={unpeek}
                />
                {canSeeDashboards && (
                    <RailItem
                        to="/dashboards"
                        tour="rail-dashboards"
                        active={section === 'dashboards'}
                        icon={BarChart3}
                        // v0.1.286 — en el riel (68px) «Dashboards» no entra
                        // ni en dos renglones: «Tableros», con el nombre
                        // completo en el tooltip.
                        label={__('Tableros')}
                        hint={__('Dashboards')}
                        onPeek={() => peek('dashboards')}
                        onUnpeek={unpeek}
                    />
                )}
                {canManageAgents && (
                    <RailItem
                        to="/agents"
                        tour="rail-agents"
                        active={section === 'agents'}
                        icon={Bot}
                        label={__('Agentes')}
                        hint={__('Agentes de IA')}
                        onPeek={() => peek('agents')}
                        onUnpeek={unpeek}
                    />
                )}
                <RailItem
                    to="/aprende"
                    tour="rail-learn"
                    active={section === 'learn'}
                    icon={GraduationCap}
                    label={__('Aprende')}
                    hint={__('Centro de aprendizaje')}
                    onPeek={() => peek('learn')}
                    onUnpeek={unpeek}
                />
                <RailItem
                    to="/settings"
                    tour="rail-settings"
                    active={section === 'settings'}
                    icon={Settings}
                    label={__('Ajustes')}
                    onPeek={() => peek('settings')}
                    onUnpeek={unpeek}
                />
                {isSuperadmin && (
                    <RailItem
                        to="/platform"
                        tour="rail-platform"
                        active={section === 'platform'}
                        icon={ShieldAlert}
                        label={__('Plataforma')}
                        onPeek={() => peek('platform')}
                        onUnpeek={unpeek}
                    />
                )}

                <div className="imcrm-flex-1" aria-hidden />
            </nav>

            {/* ── Panel FLOTANTE del hover (sólo escritorio) ─────────────── */}
            {/* Va por PORTAL al body (v0.1.145.1): dentro del sidebar el
                z-index del flotante no podía competir con el contenido, que al
                venir después en el DOM le quedaba encima (reporte del usuario). */}
            {peeking !== null && createPortal(
                <div
                    data-testid="imcrm-peek-panel"
                    onMouseEnter={clearTimers}
                    onMouseLeave={unpeekUnlessHeld}
                    // Al elegir algo, el flotante se va. No alcanza con
                    // reaccionar al cambio de ruta: clickear el item en el
                    // que YA estás no cambia el pathname y el panel quedaba
                    // abierto tapando el contenido.
                    onClick={() => {
                        if (holdRef.current) return;
                        clearTimers();
                        setHovered(null);
                    }}
                    className="imcrm-fixed imcrm-bottom-1.5 imcrm-left-[80px] imcrm-top-1.5 imcrm-z-40 imcrm-hidden imcrm-w-[248px] imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-shadow-imcrm-xl lg:imcrm-flex"
                >
                    <div className="imcrm-flex imcrm-h-10 imcrm-shrink-0 imcrm-items-center imcrm-border-b imcrm-border-border imcrm-px-4">
                        <span className="imcrm-truncate imcrm-text-[14px] imcrm-font-semibold imcrm-text-foreground">
                            {titleFor(peeking)}
                        </span>
                    </div>
                    <nav
                        aria-label={titleFor(peeking)}
                        className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-4"
                    >
                        <PeekHoldContext.Provider value={peekHold}>{panelBody(peeking)}</PeekHoldContext.Provider>
                    </nav>
                </div>,
                document.body,
            )}

            {/* ── Panel interno claro (contextual según el riel) ────────── */}
            <div
                className={cn(
                    'imcrm-flex imcrm-w-[240px] imcrm-min-w-0 imcrm-flex-none imcrm-flex-col imcrm-border-r imcrm-border-border imcrm-bg-canvas',
                    collapsed && 'imcrm-hidden',
                )}
            >
                <div className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-pl-4 imcrm-pr-2 lg:imcrm-h-10">
                    {/* v0.1.286 — en las secciones de contenido el título es
                        la empresa, y con más de una se cambia desde aquí. */}
                    {section === 'home' || section === 'dashboards' ? (
                        <WorkspaceSwitcherTitle title={titleFor(section)} />
                    ) : (
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground lg:imcrm-text-[14px]">
                            {titleFor(section)}
                        </span>
                    )}
                    {/* Cerrar el panel se hace DESDE el panel (v0.1.145,
                        como ClickUp): el botón vive en su cabecera, no
                        perdido al fondo del riel. */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapsed();
                        }}
                        className="imcrm-hidden imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-muted hover:imcrm-text-foreground lg:imcrm-flex"
                        aria-label={__('Colapsar panel')}
                        title={__('Colapsar panel')}
                        aria-expanded
                    >
                        <ChevronsLeft className="imcrm-h-4 imcrm-w-4" />
                    </button>
                </div>

                <nav
                    aria-label={__('Contenido de la empresa')}
                    className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-4"
                >
                    {/* v0.1.286 — el árbol de listas queda MONTADO (oculto)
                        al pasar a otra sección: con 300 listas, volver a
                        "Listas" lo reconstruía entero (tareas largas de
                        66-138 ms). Se monta la primera vez que se ve. */}
                    {homeMounted && (
                        <div
                            className={cn('imcrm-flex imcrm-flex-col imcrm-gap-5', section !== 'home' && 'imcrm-hidden')}
                            data-testid="panel-home"
                        >
                            {panelBody('home')}
                        </div>
                    )}
                    {section !== 'home' && panelBody(section)}
                </nav>
            </div>
        </div>
    );
}

/* ── Contenidos contextuales del panel ─────────────────────────────────── */

/**
 * Ajustes: la MISMA estructura de secciones que renderiza SettingsPage
 * (fuente única `settingsSectionGroups`, mismos gates), como links a
 * `/settings?s=<id>`. Este panel ES la nav de Ajustes en escritorio.
 */
function SettingsPanelNav({
    isAdmin,
    requested,
}: {
    isAdmin: boolean;
    requested: string | null;
}): JSX.Element {
    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS);
    const canManageTeams = useCan(CAP.MANAGE_TEAMS);
    // v0.1.196 — Conectores no es admin-only: quien arma automatizaciones
    // necesita ver el inventario de conexiones para elegir una.
    const groups = settingsSectionGroups({
        isAdmin,
        canManageAutomations: canManageAutomations,
        canManageTeams,
    });
    const active = resolveSettingsSection(groups, requested);
    return (
        <>
            {groups.map((g) => (
                <PanelSection key={g.label} label={g.label}>
                    {g.items.map((i) => (
                        <PanelNavItem
                            key={i.id}
                            to={`/settings?s=${i.id}`}
                            icon={i.icon}
                            label={i.label}
                            active={i.id === active}
                        />
                    ))}
                </PanelSection>
            ))}
        </>
    );
}

/**
 * Plataforma: pestañas de la consola como links a `/platform?tab=<id>`,
 * agrupadas por tema (v0.1.342: Clientes · La app · Servidor; antes era una
 * sola lista de 16).
 */
function PlatformPanelNav({ requested }: { requested: string | null }): JSX.Element {
    const active = isPlatformTab(requested) ? requested : 'tenants';
    return (
        <>
            {platformTabGroups().map((g) => (
                <PanelSection key={g.label} label={__(g.label)}>
                    {g.items.map((t) => (
                        <PanelNavItem
                            key={t.id}
                            to={`/platform?tab=${t.id}`}
                            icon={t.icon}
                            label={__(t.label)}
                            active={t.id === active}
                        />
                    ))}
                </PanelSection>
            ))}
        </>
    );
}

/* ── Primitivas del riel/panel ─────────────────────────────────────────── */

/** Item del riel: icono 20px + etiqueta chica debajo. Activo por SECCIÓN
 *  derivada de la ruta (no NavLink.isActive: /lists/* también es "Inicio"). */
function RailItem({
    to,
    icon: Icon,
    label,
    hint,
    active,
    onPeek,
    onUnpeek,
    tour,
}: {
    to: string;
    icon: LucideIcon;
    label: string;
    /** Fase 7 — ancla de los recorridos (`data-tour`). */
    tour?: string;
    /** Tooltip / nombre accesible cuando la etiqueta del riel es abreviada. */
    hint?: string;
    active: boolean;
    /** Hover: abre el panel flotante de esta sección (v0.1.145). */
    onPeek?: () => void;
    onUnpeek?: () => void;
}): JSX.Element {
    return (
        <Link
            to={to}
            title={hint ?? label}
            aria-label={hint}
            data-tour={tour}
            onMouseEnter={onPeek}
            onMouseLeave={onUnpeek}
            aria-current={active ? 'page' : undefined}
            className={cn(
                // Mobile: objetivo táctil más alto y etiqueta legible; lg:
                // las medidas compactas del escritorio.
                'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-0.5 imcrm-py-3 imcrm-transition-colors imcrm-duration-100 lg:imcrm-px-0 lg:imcrm-py-2',
                // v0.1.176 — velo y tinta salen de los tokens del riel (no de
                // blanco fijo): un riel CLARO elegido en Marca lleva tinta
                // oscura y velo oscuro; el default oscuro se ve igual que antes.
                active
                    ? 'imcrm-bg-sidebar-foreground/10 imcrm-text-sidebar-accent-foreground'
                    : 'imcrm-text-sidebar-foreground/80 hover:imcrm-bg-sidebar-accent hover:imcrm-text-sidebar-accent-foreground',
            )}
        >
            <Icon className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0" />
            {/* v0.1.286 — la etiqueta entra entera: hasta dos renglones
                centrados (antes "Mi trab…", "Dashb…" truncadas). */}
            <span className="imcrm-line-clamp-2 imcrm-max-w-full imcrm-text-center imcrm-text-[11px] imcrm-font-medium imcrm-leading-[1.15] lg:imcrm-text-[10px] lg:imcrm-tracking-[-0.01em]">
                {label}
            </span>
        </Link>
    );
}

/** Sección del panel claro (label small-caps + children). */
function PanelSection({
    label,
    icon,
    children,
}: {
    label: string;
    /** v0.1.211 — el cuadrado de la carpeta en las secciones de Favoritos. */
    icon?: React.ReactNode;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <h3 className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-px-2.5 imcrm-pb-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground">
                {icon}
                <span className="imcrm-truncate">{label}</span>
            </h3>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">{children}</div>
        </div>
    );
}

/**
 * Sección "Favoritos" del panel: listas y dashboards ANCLADOS (v0.1.107).
 * v0.1.211 — agrupados por CARPETA (como el menú de Listas; dashboards al
 * final) o por tipo. La elección es la misma de la página de Favoritos
 * (store compartido): cambiarla en un lado repinta el otro.
 */
function FavoritesSection({
    favs,
    lists,
    dashboards,
    onToggle,
}: {
    favs: Favorites;
    lists: ListSummary[];
    dashboards: DashboardEntity[];
    onToggle: (kind: keyof Favorites, id: number) => void;
}): JSX.Element | null {
    const groups = useListGroups();
    const [grouping, setGrouping] = usePersistedChoice<FavoritesGrouping>(
        FAVORITES_GROUPING_KEY,
        FAVORITES_GROUPINGS,
        'folders',
    );
    const sections = favoriteSections(favs, lists, dashboards, groups.data ?? [], grouping);
    // v0.1.260 — vistas ancladas desde el menú de su pestaña.
    const viewsQ = useFavoriteViews(favs.views.length > 0);
    const favViews = favs.views.length > 0 ? viewsQ.data ?? [] : [];
    if (sections.length === 0 && favViews.length === 0) {
        return (
            <p className="imcrm-px-2.5 imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Toca el pin de una lista o un dashboard en su menú para anclarlo aquí. Las vistas se anclan desde el menú de su pestaña.')}
            </p>
        );
    }
    const hasFolders = (groups.data ?? []).length > 0;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="favorites-panel">
            {hasFolders && (
                <div className="imcrm-px-1.5">
                    <ViewSwitch<FavoritesGrouping>
                        label={__('Agrupar favoritos')}
                        value={grouping}
                        onChange={setGrouping}
                        testId="favorites-panel-grouping"
                        options={[
                            { value: 'folders', label: __('Por carpeta') },
                            { value: 'type', label: __('Por tipo') },
                        ]}
                    />
                </div>
            )}
            {sections.map((s) => (
                <PanelSection
                    key={s.key}
                    label={
                        s.kind === 'folder'
                            ? s.group.name
                            : s.kind === 'root'
                              ? __('Sin carpeta')
                              : s.kind === 'lists'
                                ? __('Listas')
                                : __('Dashboards')
                    }
                    icon={s.kind === 'folder' ? <FolderSquare group={s.group} size="sm" /> : undefined}
                >
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {s.lists.map((l) => (
                            <li key={`l-${l.id}`}>
                                <ListPanelItem list={l} starred onToggleStar={(id) => onToggle('lists', id)} />
                            </li>
                        ))}
                        {s.dashboards.map((d) => (
                            <li key={`d-${d.id}`}>
                                <DashboardPanelItem dashboard={d} starred onToggleStar={() => onToggle('dashboards', d.id)} />
                            </li>
                        ))}
                    </ul>
                </PanelSection>
            ))}
            {favViews.length > 0 && (
                <PanelSection label={__('Vistas')}>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="favorites-panel-views">
                        {favViews.map((v) => {
                            const Icon = listIcon(v.icon) ?? viewTypeIcon(v.type);
                            const color = listColor(v.color);
                            return (
                                <li key={`v-${v.id}`} className="imcrm-group/fv imcrm-flex imcrm-items-center">
                                    <Link
                                        to={favoriteViewPath(v)}
                                        title={`${v.name} · ${v.list_name}`}
                                        className="imcrm-flex imcrm-min-h-10 imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground lg:imcrm-min-h-0 lg:imcrm-text-[13px]"
                                    >
                                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" style={color ? { color } : undefined} aria-hidden />
                                        <span className="imcrm-min-w-0 imcrm-truncate">{v.name}</span>
                                        <span className="imcrm-ml-auto imcrm-max-w-[45%] imcrm-shrink-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground/80">{v.list_name}</span>
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => onToggle('views', v.id)}
                                        aria-label={__('Quitar de favoritos')}
                                        title={__('Quitar de favoritos')}
                                        className="imcrm-shrink-0 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground imcrm-opacity-50 hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover/fv:imcrm-opacity-100 lg:imcrm-opacity-0"
                                    >
                                        <PinOff className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </PanelSection>
            )}
        </div>
    );
}



/** Link del panel con icono y activo EXPLÍCITO (para rutas con query param,
 *  donde NavLink.isActive no distingue `?s=`/`?tab=`). */
function PanelNavItem({
    to,
    icon: Icon,
    label,
    active,
}: {
    to: string;
    icon: LucideIcon;
    label: string;
    active: boolean;
}): JSX.Element {
    return (
        <Link
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
                // v0.1.169 — filas de 40px y 14px en mobile (objetivo táctil);
                // en escritorio las medidas compactas de siempre.
                'imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-transition-colors imcrm-duration-100 lg:imcrm-min-h-0 lg:imcrm-text-[13px]',
                active
                    ? 'imcrm-bg-background imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border'
                    : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
            )}
        >
            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
            <span className="imcrm-truncate">{label}</span>
        </Link>
    );
}

/**
 * v0.1.286 — panel de «Mi trabajo»: antes repetía las tres pestañas de la
 * página. Ahora es un RESUMEN que sirve sin abrirla: cuánto está vencido,
 * para hoy y para la semana, y lo más urgente con enlace directo al registro.
 */
function MyWorkPanelSummary(): JSX.Element {
    const work = useMyWork();
    const tz = getTenantTimeZone() ?? browserTimeZone() ?? 'UTC';
    if (work.isLoading) return <PanelLoading />;
    const assigned = work.data?.assigned ?? [];
    const groups = groupWork(assigned, tz);
    const urgent = [...(groups.get('overdue') ?? []), ...(groups.get('today') ?? []), ...(groups.get('week') ?? [])].slice(0, 6);
    const overdueIds = new Set((groups.get('overdue') ?? []).map((i) => i.record_id));
    // A9 — los ítems de checklist asignados también cuentan.
    const itemGroups = groupChecklistWork(work.data?.checklist_items ?? [], tz);
    const counts = DUE_GROUPS.filter((g) => g.key === 'overdue' || g.key === 'today' || g.key === 'week').map((g) => ({
        ...g,
        n: (groups.get(g.key)?.length ?? 0) + (itemGroups.get(g.key)?.length ?? 0),
    }));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="mywork-panel">
            <dl className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1.5 imcrm-px-1">
                {counts.map((c) => (
                    <div key={c.key} className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-rounded-md imcrm-bg-background imcrm-px-1 imcrm-py-2 imcrm-ring-1 imcrm-ring-border">
                        <dd
                            className={cn(
                                'imcrm-text-lg imcrm-font-semibold imcrm-tabular-nums imcrm-leading-none',
                                c.key === 'overdue' && c.n > 0 && 'imcrm-text-destructive',
                            )}
                        >
                            {c.n}
                        </dd>
                        <dt className="imcrm-mt-1 imcrm-text-center imcrm-text-[10px] imcrm-leading-tight imcrm-text-muted-foreground">{__(c.label)}</dt>
                    </div>
                ))}
            </dl>
            <PanelSection label={__('Lo más urgente')}>
                {urgent.length === 0 ? (
                    <p className="imcrm-px-2.5 imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                        {assigned.length === 0
                            ? __('No tienes nada asignado. Cuando alguien te asigne un registro, aparece aquí.')
                            : __('Nada vence esta semana.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {urgent.map((item) => {
                            const Icon = listIcon(item.list_icon) ?? DEFAULT_LIST_ICON;
                            const due = item.due ? (item.due_is_datetime ? formatDateTimeStr(item.due) : formatDateStr(item.due.slice(0, 10))) : null;
                            return (
                                <li key={`${item.list_id}-${item.record_id}`}>
                                    <Link
                                        to={`/lists/${item.list_slug}/records?record=${item.record_id}`}
                                        title={`${item.title} · ${item.list_name}`}
                                        className="imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground lg:imcrm-min-h-0 lg:imcrm-text-[13px]"
                                    >
                                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" style={listColor(item.list_color) ? { color: listColor(item.list_color) } : undefined} aria-hidden />
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{item.title}</span>
                                        {due && (
                                            <span
                                                className={cn(
                                                    'imcrm-shrink-0 imcrm-text-[11px] imcrm-tabular-nums',
                                                    overdueIds.has(item.record_id) ? 'imcrm-font-medium imcrm-text-destructive' : 'imcrm-text-muted-foreground',
                                                )}
                                            >
                                                {due}
                                            </span>
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </PanelSection>
            {(work.data?.reminders.length ?? 0) > 0 && (
                <PanelNavItem
                    to="/my-work?tab=reminders"
                    icon={AlarmClock}
                    label={`${__('Recordatorios')} (${work.data?.reminders.length ?? 0})`}
                    active={false}
                />
            )}
        </div>
    );
}

/**
 * v0.1.286 — «Recientes» arriba del árbol de listas: lo último abierto (listas,
 * registros, tableros), por empresa y por navegador. Máximo 4: es un atajo,
 * no un historial (el completo está en la paleta, Ctrl+K).
 */
const RecentsPanelSection = memo(function RecentsPanelSection(): JSX.Element | null {
    const tenantId = useSession((s) => s.activeTenantId);
    const recents = useRecents(tenantId).slice(0, 4);
    if (recents.length === 0) return null;
    return (
        <PanelSection label={__('Recientes')}>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="panel-recents">
                {recents.map((r) => {
                    const Icon =
                        r.kind === 'record'
                            ? FileText
                            : (listIcon(r.icon) ?? (r.kind === 'dashboard' ? DEFAULT_DASHBOARD_ICON : DEFAULT_LIST_ICON));
                    const color = r.kind === 'record' ? undefined : listColor(r.color);
                    return (
                        <li key={`${r.kind}-${r.id}`}>
                            <a
                                href={`#${r.href}`}
                                title={r.context ? `${r.label} · ${r.context}` : r.label}
                                className="imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground lg:imcrm-min-h-0 lg:imcrm-text-[13px]"
                            >
                                <Icon className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', !color && 'imcrm-opacity-60')} style={color ? { color } : undefined} aria-hidden />
                                <span className="imcrm-min-w-0 imcrm-truncate">{r.label}</span>
                                {r.context && (
                                    <span className="imcrm-ml-auto imcrm-max-w-[40%] imcrm-shrink-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {r.context}
                                    </span>
                                )}
                            </a>
                        </li>
                    );
                })}
            </ul>
        </PanelSection>
    );
});

/** Spinner chico para los árboles que aún cargan. */
function PanelLoading(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
            {__('Cargando…')}
        </div>
    );
}
