import { useState } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import {
    BarChart3,
    ChevronsLeft,
    ChevronsRight,
    Home,
    LayoutGrid,
    Loader2,
    Settings,
    ShieldAlert,
    Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { resolveSettingsSection, settingsSectionGroups } from '@/cloud/settingsSections';
import { useBrandingData } from '@/hooks/useBranding';
import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { isPlatformTab, PLATFORM_TABS } from '@/admin/platform/platformTabs';

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
type RailSection = 'home' | 'dashboards' | 'settings' | 'platform';

function railSectionFromPath(pathname: string): RailSection {
    if (pathname.startsWith('/dashboards')) return 'dashboards';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/platform')) return 'platform';
    return 'home';
}

/**
 * Sidebar doble estilo ClickUp:
 *  - RIEL (izquierda, fijo, ~68px, tema oscuro `--imcrm-sidebar*`): logo de la
 *    marca arriba (sólo el cuadrado, sin texto) + items verticales de icono
 *    con etiqueta chica debajo (Inicio / Dashboards / Ajustes / Plataforma) +
 *    toggle de colapso del panel abajo del todo.
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

    const { pathname } = useLocation();
    const [params] = useSearchParams();
    const section = railSectionFromPath(pathname);

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
    const panelTitle =
        section === 'settings'
            ? __('Ajustes')
            : section === 'platform'
              ? __('Plataforma')
              : workspaceTitle;

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
                className="imcrm-flex imcrm-w-[68px] imcrm-shrink-0 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-bg-sidebar imcrm-px-2 imcrm-py-3 imcrm-text-sidebar-foreground"
            >
                {/* Marca: sólo el cuadrado/logo (el nombre vive en el panel). */}
                <div className="imcrm-mb-2 imcrm-flex imcrm-shrink-0 imcrm-justify-center">
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

                <RailItem to="/lists" active={section === 'home'} icon={Home} label={__('Inicio')} />
                {canSeeDashboards && (
                    <RailItem
                        to="/dashboards"
                        active={section === 'dashboards'}
                        icon={BarChart3}
                        label={__('Dashboards')}
                    />
                )}
                {canSeeSettings && (
                    <RailItem
                        to="/settings"
                        active={section === 'settings'}
                        icon={Settings}
                        label={__('Ajustes')}
                    />
                )}
                {isSuperadmin.data === true && (
                    <RailItem
                        to="/platform"
                        active={section === 'platform'}
                        icon={ShieldAlert}
                        label={__('Plataforma')}
                    />
                )}

                <div className="imcrm-flex-1" aria-hidden />

                {/* Toggle del panel (sólo escritorio; en mobile es un drawer). */}
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapsed();
                    }}
                    className="imcrm-hidden imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-py-2 imcrm-text-sidebar-foreground/70 imcrm-transition-colors hover:imcrm-bg-sidebar-accent hover:imcrm-text-white lg:imcrm-flex"
                    aria-label={collapsed ? __('Expandir panel') : __('Colapsar panel')}
                    title={collapsed ? __('Expandir panel') : __('Colapsar panel')}
                    aria-expanded={!collapsed}
                >
                    {collapsed ? (
                        <ChevronsRight className="imcrm-h-4 imcrm-w-4" />
                    ) : (
                        <ChevronsLeft className="imcrm-h-4 imcrm-w-4" />
                    )}
                </button>
            </nav>

            {/* ── Panel interno claro (contextual según el riel) ────────── */}
            <div
                className={cn(
                    'imcrm-flex imcrm-w-[240px] imcrm-shrink-0 imcrm-flex-col imcrm-border-r imcrm-border-border imcrm-bg-background',
                    // Colapsado → sólo en escritorio (en mobile el drawer
                    // siempre muestra el conjunto completo).
                    collapsed && 'lg:imcrm-hidden',
                )}
            >
                <div className="imcrm-flex imcrm-h-16 imcrm-shrink-0 imcrm-items-center imcrm-border-b imcrm-border-border imcrm-px-4">
                    <span className="imcrm-truncate imcrm-text-[14px] imcrm-font-semibold imcrm-text-foreground">
                        {panelTitle}
                    </span>
                </div>

                <nav
                    aria-label={__('Contenido del workspace')}
                    onClick={onClose}
                    className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-4"
                >
                    {section === 'home' && (
                        <>
                            {lists.data && lists.data.length > 0 && (
                                <PanelSection label={__('Espacio de trabajo')}>
                                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                        {lists.data.map((list) => (
                                            <li key={list.id}>
                                                <PanelLink
                                                    to={`/lists/${list.slug}/records`}
                                                    name={list.name}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </PanelSection>
                            )}
                            {lists.isLoading && <PanelLoading />}
                        </>
                    )}

                    {section === 'dashboards' && (
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
                                                <PanelLink to={`/dashboards/${d.id}`} name={d.name} />
                                            </li>
                                        ))}
                                    </ul>
                                </PanelSection>
                            )}
                            {dashboards.isLoading && <PanelLoading />}
                        </>
                    )}

                    {section === 'settings' && (
                        <SettingsPanelNav
                            isAdmin={isAdmin}
                            isSuperadmin={isSuperadmin.data === true}
                            requested={params.get('s')}
                        />
                    )}

                    {section === 'platform' && (
                        <PlatformPanelNav requested={params.get('tab')} />
                    )}
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
    isSuperadmin,
    requested,
}: {
    isAdmin: boolean;
    isSuperadmin: boolean;
    requested: string | null;
}): JSX.Element {
    const groups = settingsSectionGroups({ isAdmin, isSuperadmin });
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
}: {
    to: string;
    icon: LucideIcon;
    label: string;
    active: boolean;
}): JSX.Element {
    return (
        <Link
            to={to}
            title={label}
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

/** Link del árbol del panel: dot + nombre (tema claro, NO el del riel). */
function PanelLink({ to, name }: { to: string; name: string }): JSX.Element {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                cn(
                    'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[13px] imcrm-transition-colors imcrm-duration-100',
                    isActive
                        ? 'imcrm-bg-muted imcrm-font-medium imcrm-text-foreground'
                        : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
                )
            }
        >
            <span
                aria-hidden
                className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-current imcrm-opacity-50"
            />
            <span className="imcrm-truncate">{name}</span>
        </NavLink>
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
                    ? 'imcrm-bg-muted imcrm-font-medium imcrm-text-foreground'
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
