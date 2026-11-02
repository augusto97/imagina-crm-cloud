import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    BarChart3,
    Bot,
    Check,
    ChevronRight,
    CircleHelp,
    Download,
    GraduationCap,
    Lightbulb,
    ListChecks,
    LogOut,
    Megaphone,
    Monitor,
    Moon,
    Pin,
    Settings,
    ShieldAlert,
    Sun,
    Trash2,
    TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { help, useHelpAvailability } from '@/admin/help/helpBus';
import { logoutAndReload } from '@/admin/layout/logout';
import { initials } from '@/admin/layout/WorkspaceSwitcher';
import { useSession } from '@/cloud/session';
import { roleLabel, switchWorkspace, useWorkspaces } from '@/cloud/workspaceSwitch';
import { InstallAppDialog } from '@/components/pwa/InstallAppDialog';
import { useIncidents } from '@/hooks/useNotifications';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { currentAppName } from '@/lib/pwa/appMeta';
import { promptInstall, useInstallMode } from '@/lib/pwa/install';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * v0.1.342 — «Más»: la quinta pestaña de la barra de abajo del celular (y de
 * la app instalada). Reúne en UNA página, en filas grandes para el dedo, todo
 * lo que en el escritorio está repartido entre el riel y el menú de la
 * cuenta: quién eres, en qué empresa estás (y el cambio a otra), los demás
 * lugares de la app, Ajustes, el tema, instalar la app, la ayuda y cerrar
 * sesión. Antes eso vivía en un cajón de dos columnas que se abría con la
 * hamburguesa, más un menú desplegable en el avatar.
 */
export function MenuPage(): JSX.Element | null {
    const qc = useQueryClient();
    const user = useSession((s) => s.user);
    const impersonating = useSession((s) => s.impersonating);
    const isAdmin = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin');
    const { memberships, active, locked } = useWorkspaces();
    const theme = useTheme();
    const installMode = useInstallMode();
    const [installHelp, setInstallHelp] = useState(false);
    const helpAvailable = useHelpAvailability();
    const whatsNew = useWhatsNewFeed(true);
    const unseenNews = whatsNew.data?.unseen_count ?? 0;
    const isSuperadmin = useIsSuperadmin();

    const canManageDashboards = useCan(CAP.MANAGE_DASHBOARDS);
    const canViewDashboards = useCan(CAP.VIEW_DASHBOARDS);
    const canAccessAdmin = useCan(CAP.ACCESS_ADMIN);
    const canManageAgents = useCan(CAP.MANAGE_AI_AGENTS);
    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS);
    const canSeeDashboards = (canManageDashboards || (canAccessAdmin && canViewDashboards)) && moduleEnabled('dashboards');
    const incidents = useIncidents('open', isAdmin || canManageAutomations);
    const openIncidents = incidents.data?.open ?? 0;

    if (!user) return null;
    const displayName = user.name.trim() !== '' ? user.name : user.email;
    const canSwitch = memberships.length > 1 && !locked;

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-xl imcrm-flex-col imcrm-gap-5 imcrm-pb-4 imcrm-pt-1" data-testid="menu-page">
            <h1 className="imcrm-sr-only">{__('Más')}</h1>

            {/* Quién eres → tu cuenta. */}
            <Link
                to="/settings?s=seguridad"
                data-testid="menu-account"
                className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3.5 imcrm-transition-colors active:imcrm-bg-muted/60"
            >
                <span
                    aria-hidden
                    className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-base imcrm-font-semibold imcrm-text-primary-foreground"
                >
                    {initials(displayName)}
                </span>
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-truncate imcrm-text-[16px] imcrm-font-semibold">{displayName}</span>
                    <span className="imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">{user.email}</span>
                    <span className="imcrm-mt-0.5 imcrm-text-[12px] imcrm-font-medium imcrm-text-primary">{__('Tu cuenta y seguridad')}</span>
                </span>
                <ChevronRight className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            </Link>
            {impersonating && (
                <p className="-imcrm-mt-3 imcrm-rounded-md imcrm-bg-warning/15 imcrm-px-3 imcrm-py-2 imcrm-text-[13px]">
                    {__('Estás viendo la app como esta persona (soporte).')}
                </p>
            )}

            {/* La empresa (y el cambio a otra). */}
            {active && (
                <MenuGroup label={canSwitch ? __('Tus empresas') : __('Empresa')}>
                    {(canSwitch ? memberships : [active]).map((m) => {
                        const current = m.tenant_id === active.tenant_id;
                        return (
                            <li key={m.tenant_id}>
                                <button
                                    type="button"
                                    disabled={!canSwitch || current}
                                    onClick={() => switchWorkspace(m.tenant_id, qc)}
                                    data-testid="menu-workspace"
                                    data-current={current ? 'true' : undefined}
                                    className="imcrm-flex imcrm-min-h-[52px] imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-3.5 imcrm-py-2 imcrm-text-left imcrm-transition-colors enabled:active:imcrm-bg-muted/60 disabled:imcrm-cursor-default"
                                >
                                    <span
                                        aria-hidden
                                        className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-text-[12px] imcrm-font-semibold imcrm-text-foreground/80 imcrm-ring-1 imcrm-ring-border"
                                    >
                                        {initials(m.tenant_name)}
                                    </span>
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                        <span className={cn('imcrm-truncate imcrm-text-[15px]', current && 'imcrm-font-semibold')}>{m.tenant_name}</span>
                                        <span className="imcrm-text-[12px] imcrm-text-muted-foreground">{roleLabel(m.role)}</span>
                                    </span>
                                    {current && canSwitch && <Check className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-primary" aria-label={__('Empresa actual')} />}
                                </button>
                            </li>
                        );
                    })}
                </MenuGroup>
            )}

            <MenuGroup label={__('Ir a')}>
                <MenuLink to="/favorites" icon={Pin} label={__('Favoritos')} hint={__('Lo que anclaste para tenerlo a mano')} testId="menu-favorites" />
                {canSeeDashboards && (
                    <MenuLink to="/dashboards" icon={BarChart3} label={__('Tableros')} hint={__('Dashboards con cifras y gráficos de tus listas')} testId="menu-dashboards" />
                )}
                {canManageAgents && <MenuLink to="/agents" icon={Bot} label={__('Agentes de IA')} hint={__('Compañeros que trabajan solos')} />}
                <MenuLink to="/aprende" icon={GraduationCap} label={__('Aprende')} hint={__('El manual de cada parte de la app')} testId="menu-learn" />
                <MenuLink to="/ideas" icon={Lightbulb} label={__('Ideas para tu negocio')} hint={__('Automatizaciones listas para activar')} />
                <MenuLink
                    to="/novedades"
                    icon={Megaphone}
                    label={__('Novedades')}
                    hint={__('Lo nuevo de cada versión')}
                    badge={unseenNews > 0 ? (unseenNews > 9 ? '9+' : String(unseenNews)) : null}
                    testId="menu-whats-new"
                />
            </MenuGroup>

            <MenuGroup label={__('Configuración')}>
                <MenuLink
                    to="/settings"
                    icon={Settings}
                    label={__('Ajustes')}
                    hint={isAdmin ? __('Tu empresa, el equipo, las conexiones y tu cuenta') : __('Tu cuenta, avisos y apariencia')}
                    testId="menu-settings"
                />
                {openIncidents > 0 && (
                    <MenuLink
                        to="/settings?s=problemas"
                        icon={TriangleAlert}
                        label={__('Problemas')}
                        hint={openIncidents === 1 ? __('1 cosa dejó de funcionar') : sprintf(__('%d cosas dejaron de funcionar'), openIncidents)}
                        tone="danger"
                    />
                )}
                <MenuLink to="/settings?s=papelera" icon={Trash2} label={__('Papelera')} hint={__('Recupera lo borrado en los últimos 30 días')} />
                {isSuperadmin && (
                    <MenuLink to="/platform" icon={ShieldAlert} label={__('Plataforma')} hint={__('Consola del operador')} testId="menu-platform" />
                )}
            </MenuGroup>

            <MenuGroup label={__('Preferencias')}>
                <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-px-3.5 imcrm-py-3">
                    <span className="imcrm-text-[15px]">{__('Apariencia')}</span>
                    <ThemeChooser mode={theme.mode} onChange={theme.setMode} />
                </li>
                {installMode !== null && (
                    <MenuButton
                        icon={Download}
                        label={__('Instalar la app')}
                        hint={__('Ábrela desde la pantalla de inicio, como cualquier app')}
                        testId="menu-install"
                        onClick={() => {
                            if (installMode === 'prompt') void promptInstall();
                            else setInstallHelp(true);
                        }}
                    />
                )}
                <MenuLink to="/settings?s=avisos" icon={Megaphone} label={__('Avisos y notificaciones')} hint={__('Qué te llega al correo y al teléfono')} />
            </MenuGroup>

            {(helpAvailable.help || helpAvailable.gettingStarted) && (
                <MenuGroup label={__('Ayuda')}>
                    {helpAvailable.help && (
                        <MenuButton icon={CircleHelp} label={__('Centro de ayuda')} hint={__('Guías «¿Cómo hago…?» y recorridos')} testId="menu-help" onClick={() => help.openHelp()} />
                    )}
                    {helpAvailable.gettingStarted && (
                        <MenuButton icon={ListChecks} label={__('Primeros pasos')} hint={__('Lo básico para arrancar, paso a paso')} onClick={() => help.openGettingStarted()} />
                    )}
                </MenuGroup>
            )}

            <button
                type="button"
                onClick={() => void logoutAndReload(Boolean(impersonating))}
                data-testid="menu-logout"
                className="imcrm-flex imcrm-min-h-[52px] imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-text-[15px] imcrm-font-medium imcrm-text-destructive imcrm-transition-colors active:imcrm-bg-destructive/10"
            >
                <LogOut className="imcrm-h-4 imcrm-w-4" aria-hidden />
                {impersonating ? __('Salir de esta sesión') : __('Cerrar sesión')}
            </button>

            {installHelp && <InstallAppDialog open={installHelp} onOpenChange={setInstallHelp} appName={currentAppName()} />}
        </div>
    );
}

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <h2 className="imcrm-px-1 imcrm-text-[12px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">{label}</h2>
            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">
                {children}
            </ul>
        </section>
    );
}

function RowBody({
    icon: Icon,
    label,
    hint,
    badge,
    tone,
    chevron = true,
}: {
    icon: LucideIcon;
    label: string;
    hint?: string;
    badge?: string | null;
    tone?: 'danger';
    chevron?: boolean;
}): JSX.Element {
    return (
        <>
            <span
                aria-hidden
                className={cn(
                    'imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg',
                    tone === 'danger' ? 'imcrm-bg-destructive/10 imcrm-text-destructive' : 'imcrm-bg-muted imcrm-text-foreground/75',
                )}
            >
                <Icon className="imcrm-h-[18px] imcrm-w-[18px]" />
            </span>
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className={cn('imcrm-truncate imcrm-text-[15px]', tone === 'danger' && 'imcrm-font-medium imcrm-text-destructive')}>{label}</span>
                {hint && <span className="imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{hint}</span>}
            </span>
            {badge && (
                <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary-foreground">
                    {badge}
                </span>
            )}
            {chevron && <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />}
        </>
    );
}

const ROW_CLASS =
    'imcrm-flex imcrm-min-h-[52px] imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-3.5 imcrm-py-2 imcrm-text-left imcrm-transition-colors active:imcrm-bg-muted/70 [@media(hover:hover)]:hover:imcrm-bg-muted/40';

function MenuLink({
    to,
    testId,
    ...body
}: {
    to: string;
    icon: LucideIcon;
    label: string;
    hint?: string;
    badge?: string | null;
    tone?: 'danger';
    testId?: string;
}): JSX.Element {
    return (
        <li>
            <Link to={to} className={ROW_CLASS} data-testid={testId}>
                <RowBody {...body} />
            </Link>
        </li>
    );
}

function MenuButton({
    onClick,
    testId,
    ...body
}: {
    onClick: () => void;
    icon: LucideIcon;
    label: string;
    hint?: string;
    testId?: string;
}): JSX.Element {
    return (
        <li>
            <button type="button" onClick={onClick} className={ROW_CLASS} data-testid={testId}>
                <RowBody {...body} chevron={false} />
            </button>
        </li>
    );
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
    { mode: 'light', label: 'Claro', icon: Sun },
    { mode: 'dark', label: 'Oscuro', icon: Moon },
    { mode: 'system', label: 'Como el sistema', icon: Monitor },
];

function ThemeChooser({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }): JSX.Element {
    return (
        <div role="radiogroup" aria-label={__('Apariencia')} className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1" data-testid="menu-theme">
            {THEME_OPTIONS.map((o) => {
                const on = o.mode === mode;
                return (
                    <button
                        key={o.mode}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.mode)}
                        className={cn(
                            'imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-1 imcrm-text-[13px] imcrm-transition-colors',
                            on ? 'imcrm-bg-background imcrm-font-semibold imcrm-shadow-sm' : 'imcrm-text-muted-foreground',
                        )}
                    >
                        <o.icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                        <span className="imcrm-truncate">{__(o.label)}</span>
                    </button>
                );
            })}
        </div>
    );
}
