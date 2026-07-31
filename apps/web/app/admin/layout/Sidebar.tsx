import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useSearchParams } from 'react-router';
import {
    BarChart3,
    ChevronsLeft,
    ChevronsRight,
    LayoutGrid,
    List as ListIcon,
    Loader2,
    Settings,
    ShieldAlert,
    Pin,
    Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { resolveSettingsSection, settingsSectionGroups } from '@/cloud/settingsSections';
import { useBrandingData } from '@/hooks/useBranding';
import { useDashboards } from '@/hooks/useDashboards';
import { toggledFavorites, useFavorites, useUpdateFavorites, type Favorites } from '@/hooks/useFavorites';
import { useLists, useReorderLists } from '@/hooks/useLists';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { dashboardColor, dashboardIcon } from '@/lib/dashboardIcon';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { isPlatformTab, PLATFORM_TABS } from '@/admin/platform/platformTabs';

import { ListsTree } from './ListsTree';
import { PanelListLink } from './PanelListLink';

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
type RailSection = 'home' | 'favorites' | 'dashboards' | 'settings' | 'platform';

function railSectionFromPath(pathname: string): RailSection {
    if (pathname.startsWith('/favorites')) return 'favorites';
    if (pathname.startsWith('/dashboards')) return 'dashboards';
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
 *  - Colapsado → el panel se oculta (sólo escritorio) y queda el riel; la
 *    navegación NO lo re-expande.
 *  - Mobile (<lg): el conjunto riel+panel es un drawer off-canvas
 *    (`mobileOpen`/`onClose`, mismo mecanismo de siempre).
 */
export function Sidebar({
    mobileOpen = false,
    onClose,
}: {
    mobileOpen?: boolean;
    onClose?: () => void;
} = {}): JSX.Element {
    const lists = useLists();
    const dashboards = useDashboards();
    const [collapsed, setCollapsed] = useState<boolean>(readCollapsedPref);
    // v0.1.107 — favoritos anclados + reorden del menú de listas.
    const favorites = useFavorites();
    const updateFavorites = useUpdateFavorites();
    const reorderLists = useReorderLists();
    const favs: Favorites = favorites.data ?? { lists: [], dashboards: [] };
    const toggleFav = (kind: keyof Favorites, id: number): void => {
        updateFavorites.mutate(toggledFavorites(favs, kind, id));
    };
    // Drag & drop del árbol de listas (HTML5). El índice arrastrado vive en
    // un ref (no re-renderiza); al soltar se manda el orden completo.
    const dragIndexRef = useRef<number | null>(null);
    const handleListDrop = (targetIndex: number): void => {
        const from = dragIndexRef.current;
        dragIndexRef.current = null;
        if (from === null || !lists.data || from === targetIndex) return;
        const next = [...lists.data];
        const [moved] = next.splice(from, 1);
        if (!moved) return;
        next.splice(targetIndex, 0, moved);
        reorderLists.mutate(next.map((l) => l.id));
    };

    const { pathname } = useLocation();
    const [params] = useSearchParams();
    const section = railSectionFromPath(pathname);

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
    // justo el contenido al que acabás de entrar.
    useEffect(() => {
        clearTimers();
        setHovered(null);
        return clearTimers;
    }, [pathname]);
    // Sólo flota lo que NO estás viendo ya en el panel acoplado.
    const peeking = hovered !== null && (collapsed || hovered !== section) ? hovered : null;

    // Branding white-label del tenant (logo + nombre). Lee del query cache
    // que puebla `useBranding` en AdminCloudApp; nulls → marca por defecto.
    const branding = useBrandingData();
    const brandLogoUrl = branding.data?.logo_url ?? null;
    const brandAppName = branding.data?.app_name ?? null;

    // Workspace activo de la sesión (nombre del tenant para el header del
    // panel). Si el branding define un app_name white-label, manda ese.
    const activeTenantId = useSession((s) => s.activeTenantId);
    const memberships = useSession((s) => s.memberships);
    const membership = memberships.find((m) => m.tenant_id === activeTenantId);
    const workspaceName = membership?.tenant_name ?? null;
    const isAdmin = membership?.role === 'admin';
    const workspaceTitle = brandAppName ?? workspaceName ?? 'Imagina Base';

    // Gating por capability (Fase 7 — 1.E). El backend ya filtra GET /lists
    // a las visibles para el user, así que "Tus listas" se auto-recorta.
    // Hooks siempre en el mismo orden (rules-of-hooks): resolvemos cada
    // capability por separado y recién después combinamos.
    const canManageDashboards = useCan(CAP.MANAGE_DASHBOARDS);
    const canAccessAdmin = useCan(CAP.ACCESS_ADMIN);
    const canManageLists = useCan(CAP.MANAGE_LISTS);
    const canManageOptions = useCan('workspace_admin');
    const canSeeDashboards = (canManageDashboards || canAccessAdmin) && moduleEnabled('dashboards');
    const canSeeSettings = canManageLists || canManageOptions;
    // Sección de operador (superadmin de plataforma). Se detecta probando el
    // endpoint (403 → oculto); no depende de la matriz de capabilities.
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
                : workspaceTitle;

    /**
     * El CONTENIDO del panel para una sección. Lo usan las dos superficies
     * —el panel acoplado y el flotante del hover— así que agregar algo acá
     * sale en ambas por construcción.
     */
    const panelBody = (sec: RailSection): JSX.Element => (
        <>
            {sec === 'home' && (
                <>
                    {lists.data && lists.data.length > 0 && (
                        <ListsTree
                            lists={lists.data}
                            canManageLists={canManageLists}
                            starredIds={favs.lists}
                            onToggleStar={(id: number) => toggleFav('lists', id)}
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
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                {dashboards.data.map((d) => (
                                    <li key={d.id}>
                                        <PanelListLink
                                            to={`/dashboards/${d.id}`}
                                            name={d.name}
                                            // v0.1.145 — su icono, nunca el
                                            // puntito genérico (el usuario ya
                                            // lo había pedido para las listas).
                                            icon={dashboardIcon(d.settings)}
                                            iconColor={dashboardColor(d.settings)}
                                            starred={favs.dashboards.includes(d.id)}
                                            onToggleStar={() => toggleFav('dashboards', d.id)}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </PanelSection>
                    )}
                    {dashboards.isLoading && <PanelLoading />}
                </>
            )}

            {sec === 'favorites' && (
                <FavoritesSection
                    favs={favs}
                    lists={lists.data ?? []}
                    dashboards={dashboards.data ?? []}
                    onToggle={toggleFav}
                />
            )}

            {sec === 'settings' && (
                <SettingsPanelNav isAdmin={isAdmin} requested={params.get('s')} />
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
            className={cn(
                // `imcrm-admin-sidebar`: el modo fullscreen del template editor
                // oculta este chrome (globals.css) — riel + panel juntos.
                'imcrm-admin-sidebar imcrm-flex imcrm-shrink-0 imcrm-transition-transform imcrm-duration-200',
                // Mobile: drawer off-canvas (fixed, se desliza con translate-x).
                // lg+: estático inline (comportamiento de escritorio).
                'imcrm-fixed imcrm-inset-y-0 imcrm-left-0 imcrm-z-50 lg:imcrm-static lg:imcrm-z-auto lg:imcrm-translate-x-0',
                mobileOpen ? 'imcrm-translate-x-0 imcrm-shadow-imcrm-xl' : '-imcrm-translate-x-full lg:imcrm-translate-x-0',
            )}
        >
            {/* ── Riel oscuro de iconos ─────────────────────────────────── */}
            <nav
                aria-label={__('Navegación principal')}
                onClick={onClose}
                // En escritorio el riel FLOTA: esquinas redondeadas y un
                // respiro de 6px contra los bordes de la ventana y contra el
                // panel (v0.1.128, estilo ClickUp). En mobile es un drawer a
                // pantalla completa, así que ahí va pegado y sin redondear.
                className="imcrm-flex imcrm-w-[68px] imcrm-shrink-0 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-bg-sidebar imcrm-px-2 imcrm-py-3 imcrm-text-sidebar-foreground lg:imcrm-my-1.5 lg:imcrm-ml-1.5 lg:imcrm-mr-1.5 lg:imcrm-rounded-xl"
            >
                {/* Marca: sólo el cuadrado/logo (el nombre vive en el panel). */}
                <div className="imcrm-mb-1 imcrm-flex imcrm-shrink-0 imcrm-justify-center">
                    {brandLogoUrl ? (
                        <img
                            src={brandLogoUrl}
                            alt=""
                            className="imcrm-h-9 imcrm-w-9 imcrm-rounded-md imcrm-object-contain"
                        />
                    ) : (
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-white/15 imcrm-text-white imcrm-ring-1 imcrm-ring-white/20">
                            <Sparkles className="imcrm-h-4 imcrm-w-4" />
                        </span>
                    )}
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
                            className="imcrm-hidden imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-py-1.5 imcrm-text-sidebar-foreground/70 imcrm-transition-colors hover:imcrm-bg-sidebar-accent hover:imcrm-text-white lg:imcrm-flex"
                            aria-label={__('Expandir panel')}
                            title={__('Expandir panel')}
                            aria-expanded={false}
                        >
                            <ChevronsRight className="imcrm-h-4 imcrm-w-4" />
                        </button>
                        <span
                            aria-hidden
                            className="imcrm-mx-auto imcrm-mb-1 imcrm-hidden imcrm-h-px imcrm-w-6 imcrm-bg-white/20 lg:imcrm-block"
                        />
                    </>
                )}

                <RailItem
                    to="/lists"
                    active={section === 'home'}
                    icon={ListIcon}
                    label={__('Listas')}
                    onPeek={() => peek('home')}
                    onUnpeek={unpeek}
                />
                <RailItem
                    to="/favorites"
                    active={section === 'favorites'}
                    icon={Pin}
                    label={__('Favoritos')}
                    onPeek={() => peek('favorites')}
                    onUnpeek={unpeek}
                />
                {canSeeDashboards && (
                    <RailItem
                        to="/dashboards"
                        active={section === 'dashboards'}
                        icon={BarChart3}
                        label={__('Dashboards')}
                        onPeek={() => peek('dashboards')}
                        onUnpeek={unpeek}
                    />
                )}
                {canSeeSettings && (
                    <RailItem
                        to="/settings"
                        active={section === 'settings'}
                        icon={Settings}
                        label={__('Ajustes')}
                        onPeek={() => peek('settings')}
                        onUnpeek={unpeek}
                    />
                )}
                {isSuperadmin.data === true && (
                    <RailItem
                        to="/platform"
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
            {/* Va por PORTAL al body (v0.1.145.1): el contenedor del sidebar
                lleva `translate-x` para el drawer de mobile, y un transform
                crea un CONTEXTO DE APILADO — dentro de él, el z-index del
                flotante no puede competir con el contenido, que al venir
                después en el DOM le quedaba encima (reporte del usuario). */}
            {peeking !== null && createPortal(
                <div
                    data-testid="imcrm-peek-panel"
                    onMouseEnter={clearTimers}
                    onMouseLeave={unpeek}
                    // Al elegir algo, el flotante se va. No alcanza con
                    // reaccionar al cambio de ruta: clickear el item en el
                    // que YA estás no cambia el pathname y el panel quedaba
                    // abierto tapando el contenido.
                    onClick={() => {
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
                        {panelBody(peeking)}
                    </nav>
                </div>,
                document.body,
            )}

            {/* ── Panel interno claro (contextual según el riel) ────────── */}
            <div
                className={cn(
                    'imcrm-flex imcrm-w-[240px] imcrm-shrink-0 imcrm-flex-col imcrm-border-r imcrm-border-border imcrm-bg-canvas',
                    // Colapsado → sólo en escritorio (en mobile el drawer
                    // siempre muestra el conjunto completo).
                    collapsed && 'lg:imcrm-hidden',
                )}
            >
                <div className="imcrm-flex imcrm-h-10 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-pl-4 imcrm-pr-2">
                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[14px] imcrm-font-semibold imcrm-text-foreground">
                        {titleFor(section)}
                    </span>
                    {/* Cerrar el panel se hace DESDE el panel (v0.1.145,
                        como ClickUp): el botón vive en su cabecera, no
                        perdido al fondo del riel. Sólo escritorio: en
                        mobile el conjunto es un drawer. */}
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
                    aria-label={__('Contenido del workspace')}
                    onClick={onClose}
                    className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-4"
                >
                    {panelBody(section)}
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
    const groups = settingsSectionGroups({ isAdmin });
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

/** Plataforma: pestañas de la consola como links a `/platform?tab=<id>`. */
function PlatformPanelNav({ requested }: { requested: string | null }): JSX.Element {
    const active = isPlatformTab(requested) ? requested : 'tenants';
    return (
        <PanelSection label={__('Consola')}>
            {PLATFORM_TABS.map((t) => (
                <PanelNavItem
                    key={t.id}
                    to={`/platform?tab=${t.id}`}
                    icon={t.icon}
                    label={__(t.label)}
                    active={t.id === active}
                />
            ))}
        </PanelSection>
    );
}

/* ── Primitivas del riel/panel ─────────────────────────────────────────── */

/** Item del riel: icono 20px + etiqueta chica debajo. Activo por SECCIÓN
 *  derivada de la ruta (no NavLink.isActive: /lists/* también es "Inicio"). */
function RailItem({
    to,
    icon: Icon,
    label,
    active,
    onPeek,
    onUnpeek,
}: {
    to: string;
    icon: LucideIcon;
    label: string;
    active: boolean;
    /** Hover: abre el panel flotante de esta sección (v0.1.145). */
    onPeek?: () => void;
    onUnpeek?: () => void;
}): JSX.Element {
    return (
        <Link
            to={to}
            title={label}
            onMouseEnter={onPeek}
            onMouseLeave={onUnpeek}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1 imcrm-py-2 imcrm-transition-colors imcrm-duration-100',
                active
                    ? 'imcrm-bg-white/10 imcrm-text-white'
                    : 'imcrm-text-sidebar-foreground/80 hover:imcrm-bg-sidebar-accent hover:imcrm-text-white',
            )}
        >
            <Icon className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0" />
            <span className="imcrm-max-w-full imcrm-truncate imcrm-text-[10px] imcrm-font-medium imcrm-leading-none">
                {label}
            </span>
        </Link>
    );
}

/** Sección del panel claro (label small-caps + children). */
function PanelSection({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <h3 className="imcrm-px-2.5 imcrm-pb-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground">
                {label}
            </h3>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">{children}</div>
        </div>
    );
}

/**
 * v0.1.107 — Sección "Favoritos": listas y dashboards ANCLADOS por el
 * usuario (estrella al hover de cada item). Mezcla ambos tipos, en el
 * orden en que se anclaron; se oculta si no hay ninguno.
 */
function FavoritesSection({
    favs,
    lists,
    dashboards,
    onToggle,
}: {
    favs: Favorites;
    lists: Array<{ id: number; slug: string; name: string; icon?: string | null; color?: string | null }>;
    dashboards: Array<{ id: number; name: string; settings?: Record<string, unknown> }>;
    onToggle: (kind: keyof Favorites, id: number) => void;
}): JSX.Element | null {
    const listById = new Map(lists.map((l) => [l.id, l]));
    const dashById = new Map(dashboards.map((d) => [d.id, d]));
    // Cada anclado con SU icono (v0.1.145): el de la lista o el del
    // dashboard, nunca el puntito genérico.
    const items = [
        ...favs.lists
            .map((id) => listById.get(id))
            .filter((l): l is (typeof lists)[number] => l !== undefined)
            .map((l) => ({
                key: `l-${l.id}`,
                to: `/lists/${l.slug}/records`,
                name: l.name,
                kind: 'lists' as const,
                id: l.id,
                icon: listIcon(l.icon) ?? DEFAULT_LIST_ICON,
                iconColor: listColor(l.color),
            })),
        ...favs.dashboards
            .map((id) => dashById.get(id))
            .filter((d): d is (typeof dashboards)[number] => d !== undefined)
            .map((d) => ({
                key: `d-${d.id}`,
                to: `/dashboards/${d.id}`,
                name: d.name,
                kind: 'dashboards' as const,
                id: d.id,
                icon: dashboardIcon(d.settings),
                iconColor: dashboardColor(d.settings),
            })),
    ];
    if (items.length === 0) {
        return (
            <p className="imcrm-px-2.5 imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Tocá el pin de una lista o un dashboard en su menú para anclarlo acá.')}
            </p>
        );
    }
    return (
        <PanelSection label={__('Anclados')}>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                {items.map((it) => (
                    <li key={it.key}>
                        <PanelListLink
                            to={it.to}
                            name={it.name}
                            starred
                            icon={it.icon}
                            iconColor={it.iconColor}
                            onToggleStar={() => onToggle(it.kind, it.id)}
                        />
                    </li>
                ))}
            </ul>
        </PanelSection>
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
                'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[13px] imcrm-transition-colors imcrm-duration-100',
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

/** Spinner chico para los árboles que aún cargan. */
function PanelLoading(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
            {__('Cargando…')}
        </div>
    );
}
