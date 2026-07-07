import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
    BarChart3,
    ChevronsLeft,
    ChevronsRight,
    Database,
    Loader2,
    Settings,
    Sparkles,
} from 'lucide-react';

import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * Sidebar. Inspirada en la app interna de Imagina La Web (audit):
 *  - Header con marca circular en gradient cyan + nombre de la app
 *  - Secciones con label small-caps gray
 *  - Items con icono a la izquierda, hover bg sutil, active text-primary
 *  - Footer con botón "Colapsar"
 *  - Cuando `collapsed`, sólo se muestran iconos
 */
export function Sidebar(): JSX.Element {
    const lists = useLists();
    const dashboards = useDashboards();
    const [collapsed, setCollapsed] = useState(false);

    // Gating del sidebar por capability (Fase 7 — 1.E).
    // El backend ya filtra GET /lists a las visibles para el user, así
    // que la sección "Tus listas" se auto-recorta. Aquí controlamos los
    // items de nivel superior que dependen de caps específicas.
    const canSeeDashboards = useCan(CAP.MANAGE_DASHBOARDS) || useCan(CAP.ACCESS_ADMIN);
    const canSeeSettings = useCan(CAP.MANAGE_LISTS) || useCan('manage_options');

    return (
        <aside
            className={cn(
                'imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-border-r imcrm-border-sidebar-border imcrm-bg-sidebar imcrm-text-sidebar-foreground imcrm-transition-[width] imcrm-duration-200',
                collapsed ? 'imcrm-w-[64px]' : 'imcrm-w-[240px]',
            )}
        >
            {/* Brand */}
            <div
                className={cn(
                    'imcrm-flex imcrm-h-16 imcrm-shrink-0 imcrm-items-center imcrm-border-b imcrm-border-sidebar-border imcrm-px-4',
                    collapsed && 'imcrm-justify-center imcrm-px-0',
                )}
            >
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                    <span
                        className="imcrm-relative imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-white imcrm-shadow-imcrm-sm"
                        style={{
                            background:
                                'radial-gradient(circle at 30% 30%, hsl(186 95% 55%), hsl(186 95% 35%) 70%, hsl(217 91% 40%))',
                        }}
                    >
                        <Sparkles className="imcrm-h-4 imcrm-w-4" />
                    </span>
                    {!collapsed && (
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-leading-tight">
                            <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-foreground">
                                Imagina CRM
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Nav */}
            <nav
                aria-label={__('Navegación principal')}
                className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-4"
            >
                <Section label={__('General')} hideLabel={collapsed}>
                    <NavItem to="/lists" end icon={Database} collapsed={collapsed}>
                        {__('Listas')}
                    </NavItem>
                    {canSeeDashboards && (
                        <NavItem to="/dashboards" icon={BarChart3} collapsed={collapsed}>
                            {__('Dashboards')}
                        </NavItem>
                    )}
                </Section>

                {!collapsed && lists.data && lists.data.length > 0 && (
                    <Section label={__('Tus listas')} hideLabel={false}>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            {lists.data.map((list) => (
                                <li key={list.id}>
                                    <NavLink
                                        to={`/lists/${list.slug}/records`}
                                        className={({ isActive }) =>
                                            cn(
                                                'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[13px] imcrm-transition-colors imcrm-duration-100',
                                                isActive
                                                    ? 'imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                                                    : 'imcrm-text-sidebar-foreground/75 hover:imcrm-bg-sidebar-accent hover:imcrm-text-foreground',
                                            )
                                        }
                                    >
                                        <span
                                            aria-hidden
                                            className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-current imcrm-opacity-50"
                                        />
                                        <span className="imcrm-truncate">{list.name}</span>
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}

                {!collapsed && dashboards.data && dashboards.data.length > 0 && (
                    <Section label={__('Tus dashboards')} hideLabel={false}>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            {dashboards.data.map((d) => (
                                <li key={d.id}>
                                    <NavLink
                                        to={`/dashboards/${d.id}`}
                                        className={({ isActive }) =>
                                            cn(
                                                'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[13px] imcrm-transition-colors imcrm-duration-100',
                                                isActive
                                                    ? 'imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                                                    : 'imcrm-text-sidebar-foreground/75 hover:imcrm-bg-sidebar-accent hover:imcrm-text-foreground',
                                            )
                                        }
                                    >
                                        <span
                                            aria-hidden
                                            className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-current imcrm-opacity-50"
                                        />
                                        <span className="imcrm-truncate">{d.name}</span>
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}

                {(lists.isLoading || dashboards.isLoading) && !collapsed && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </div>
                )}

                {canSeeSettings && (
                    <Section label={__('Configuración')} hideLabel={collapsed}>
                        <NavItem to="/settings" icon={Settings} collapsed={collapsed}>
                            {__('Ajustes')}
                        </NavItem>
                    </Section>
                )}
            </nav>

            {/* Footer: collapse toggle */}
            <div className="imcrm-border-t imcrm-border-sidebar-border imcrm-px-3 imcrm-py-2">
                <button
                    type="button"
                    onClick={() => setCollapsed((c) => !c)}
                    className={cn(
                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[12px] imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-sidebar-accent hover:imcrm-text-foreground',
                        collapsed && 'imcrm-justify-center',
                    )}
                    aria-label={collapsed ? __('Expandir') : __('Colapsar')}
                    title={collapsed ? __('Expandir') : __('Colapsar')}
                >
                    {collapsed ? (
                        <ChevronsRight className="imcrm-h-4 imcrm-w-4" />
                    ) : (
                        <>
                            <ChevronsLeft className="imcrm-h-4 imcrm-w-4" />
                            <span>{__('Colapsar')}</span>
                        </>
                    )}
                </button>
            </div>
        </aside>
    );
}

function Section({
    label,
    hideLabel,
    children,
}: {
    label: string;
    hideLabel: boolean;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            {!hideLabel && (
                <h3 className="imcrm-px-2.5 imcrm-pb-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground/70">
                    {label}
                </h3>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">{children}</div>
        </div>
    );
}

interface NavItemProps {
    to: string;
    icon: React.ComponentType<{ className?: string }>;
    children: React.ReactNode;
    end?: boolean;
    collapsed?: boolean;
}

function NavItem({ to, icon: Icon, children, end, collapsed }: NavItemProps): JSX.Element {
    return (
        <NavLink
            to={to}
            end={end}
            title={collapsed ? (typeof children === 'string' ? children : undefined) : undefined}
            className={({ isActive }) =>
                cn(
                    'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-2 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors imcrm-duration-100',
                    collapsed && 'imcrm-justify-center imcrm-px-0',
                    isActive
                        ? 'imcrm-bg-primary/10 imcrm-text-primary'
                        : 'imcrm-text-sidebar-foreground hover:imcrm-bg-sidebar-accent hover:imcrm-text-foreground',
                )
            }
        >
            {({ isActive }) => (
                <>
                    <Icon
                        className={cn(
                            'imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-transition-colors',
                            isActive ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground',
                        )}
                    />
                    {!collapsed && <span className="imcrm-truncate">{children}</span>}
                </>
            )}
        </NavLink>
    );
}
