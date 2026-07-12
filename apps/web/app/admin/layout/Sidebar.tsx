import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
    BarChart3,
    ChevronsLeft,
    ChevronsRight,
    Home,
    Loader2,
    Settings,
    ShieldAlert,
    Sparkles,
} from 'lucide-react';

import { useSession } from '@/cloud/session';
import { useBrandingData } from '@/hooks/useBranding';
import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** Preferencia de colapso del panel interno (persistida por navegador). */
const PANEL_COLLAPSED_KEY = 'imcrm-panel-collapsed';

function readCollapsedPref(): boolean {
    try {
        return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Sidebar doble estilo ClickUp:
 *  - RIEL (izquierda, fijo, ~68px, tema oscuro `--imcrm-sidebar*`): logo de la
 *    marca arriba (sólo el cuadrado, sin texto) + items verticales de icono
 *    con etiqueta chica debajo (Inicio / Dashboards / Ajustes / Plataforma) +
 *    toggle de colapso del panel abajo del todo.
 *  - PANEL interno (~240px, tema CLARO): header con el workspace activo y el
 *    árbol contextual (Tus listas / Tus dashboards).
 *  - Colapsado → el panel se oculta (sólo escritorio) y queda el riel.
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

    // Branding white-label del tenant (logo + nombre). Lee del query cache
    // que puebla `useBranding` en AdminCloudApp; nulls → marca por defecto.
    const branding = useBrandingData();
    const brandLogoUrl = branding.data?.logo_url ?? null;
    const brandAppName = branding.data?.app_name ?? null;

    // Workspace activo de la sesión (nombre del tenant para el header del
    // panel). Si el branding define un app_name white-label, manda ese.
    const activeTenantId = useSession((s) => s.activeTenantId);
    const memberships = useSession((s) => s.memberships);
    const workspaceName =
        memberships.find((m) => m.tenant_id === activeTenantId)?.tenant_name ?? null;
    const panelTitle = brandAppName ?? workspaceName ?? 'Imagina Base';

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

                <RailItem to="/lists" end icon={Home} label={__('Inicio')} />
                {canSeeDashboards && (
                    <RailItem to="/dashboards" icon={BarChart3} label={__('Dashboards')} />
                )}
                {canSeeSettings && <RailItem to="/settings" icon={Settings} label={__('Ajustes')} />}
                {isSuperadmin.data === true && (
                    <RailItem to="/platform" icon={ShieldAlert} label={__('Plataforma')} />
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

            {/* ── Panel interno claro (árbol contextual) ────────────────── */}
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
                    {lists.data && lists.data.length > 0 && (
                        <PanelSection label={__('Tus listas')}>
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                {lists.data.map((list) => (
                                    <li key={list.id}>
                                        <PanelLink to={`/lists/${list.slug}/records`} name={list.name} />
                                    </li>
                                ))}
                            </ul>
                        </PanelSection>
                    )}

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

                    {(lists.isLoading || dashboards.isLoading) && (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                            {__('Cargando…')}
                        </div>
                    )}
                </nav>
            </div>
        </div>
    );
}

/** Item del riel: icono 20px + etiqueta chica debajo. */
function RailItem({
    to,
    icon: Icon,
    label,
    end,
}: {
    to: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    end?: boolean;
}): JSX.Element {
    return (
        <NavLink
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
                cn(
                    'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1 imcrm-py-2 imcrm-transition-colors imcrm-duration-100',
                    isActive
                        ? 'imcrm-bg-white/10 imcrm-text-white'
                        : 'imcrm-text-sidebar-foreground/80 hover:imcrm-bg-sidebar-accent hover:imcrm-text-white',
                )
            }
        >
            <Icon className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0" />
            <span className="imcrm-max-w-full imcrm-truncate imcrm-text-[10px] imcrm-font-medium imcrm-leading-none">
                {label}
            </span>
        </NavLink>
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
