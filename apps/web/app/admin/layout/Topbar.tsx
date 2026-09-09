import { LogOut, Menu, Moon, Settings, Sparkles, Sun } from 'lucide-react';

import { NotificationBell } from '@/admin/layout/NotificationBell';
import { useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useBrandingData } from '@/hooks/useBranding';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/**
 * Topbar:
 *  - Izquierda: hamburger del drawer (sólo mobile) + logo y nombre del
 *    workspace (sólo mobile, v0.1.169: en el teléfono el panel del sidebar
 *    está cerrado casi siempre, así que sin esto la barra quedaba vacía y
 *    no se sabía en qué empresa estabas). En escritorio el nombre vive en
 *    el panel interno del sidebar doble.
 *  - Derecha: notif bell (menciones), settings + logout
 *
 * El logout va contra el backend (`POST /auth/logout`), limpia la sesión
 * local y recarga. La campana sólo aparece si su módulo está cableado.
 */
export function Topbar({ onMenuClick }: { onMenuClick?: () => void } = {}): JSX.Element {
    const theme = useTheme();
    const isDark = theme.resolved === 'dark';
    const branding = useBrandingData();
    const activeTenantId = useSession((s) => s.activeTenantId);
    const memberships = useSession((s) => s.memberships);
    const membership = memberships.find((m) => m.tenant_id === activeTenantId);
    const workspaceTitle = branding.data?.app_name ?? membership?.tenant_name ?? 'Imagina Base';
    const logoUrl = branding.data?.logo_url ?? null;
    const logout = async (e: React.MouseEvent): Promise<void> => {
        e.preventDefault();
        const { api, useSession } = await import('@/cloud/session');
        try {
            await api.logout();
        } catch {
            // ignoramos: igual limpiamos la sesión local y recargamos
        }
        useSession.getState().clear();
        window.location.assign('/');
    };

    return (
        <header className="imcrm-admin-topbar imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-background imcrm-px-2 sm:imcrm-gap-4 sm:imcrm-px-6 lg:imcrm-h-10 lg:imcrm-px-6">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1">
                {/* Hamburguesa: abre el sidebar (riel+panel) como drawer (sólo mobile). */}
                <button
                    type="button"
                    onClick={onMenuClick}
                    aria-label={__('Abrir menú')}
                    className="imcrm-inline-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-foreground/80 imcrm-transition-colors hover:imcrm-bg-accent lg:imcrm-hidden"
                >
                    <Menu className="imcrm-h-5 imcrm-w-5" />
                </button>
                {/* Marca del workspace (sólo mobile). */}
                <span
                    className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 lg:imcrm-hidden"
                    data-testid="imcrm-topbar-brand"
                >
                    {logoUrl ? (
                        <img src={logoUrl} alt="" className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain" />
                    ) : (
                        <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-sidebar imcrm-text-white">
                            <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />
                        </span>
                    )}
                    <span className="imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground">
                        {workspaceTitle}
                    </span>
                </span>
            </div>

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                {moduleEnabled('mentions') && <NotificationBell />}

                {/* v0.1.112 — claro ⇄ oscuro. La preferencia se guarda por
                 * navegador; el tri-estado (incluido "Seguir al sistema")
                 * vive en Ajustes → Apariencia. */}
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={isDark ? __('Cambiar a modo claro') : __('Cambiar a modo oscuro')}
                    title={isDark ? __('Modo claro') : __('Modo oscuro')}
                    data-theme-toggle={theme.resolved}
                    onClick={theme.toggle}
                >
                    {isDark ? <Sun className="imcrm-h-4 imcrm-w-4" /> : <Moon className="imcrm-h-4 imcrm-w-4" />}
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={__('Configuración')}
                    onClick={() => {
                        window.location.hash = '#/settings';
                    }}
                >
                    <Settings className="imcrm-h-4 imcrm-w-4" />
                </Button>

                <a
                    href="#"
                    onClick={logout}
                    className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-foreground/70 imcrm-transition-colors hover:imcrm-bg-accent hover:imcrm-text-destructive"
                    aria-label={__('Cerrar sesión')}
                    title={__('Cerrar sesión')}
                >
                    <LogOut className="imcrm-h-4 imcrm-w-4" />
                </a>
            </div>
        </header>
    );
}
