import { useLocation } from 'react-router-dom';
import { LogOut, Menu, Settings } from 'lucide-react';

import { NotificationBell } from '@/admin/layout/NotificationBell';
import { Button } from '@/components/ui/button';
import { getBootData } from '@/lib/boot';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';

/**
 * Topbar:
 *  - Izquierda: nombre del workspace / usuario
 *  - Derecha: notif bell (menciones), settings + logout
 *
 * El logout va contra el backend (`POST /auth/logout`), limpia la sesión
 * local y recarga. La campana sólo aparece si su módulo está cableado.
 */
export function Topbar({ onMenuClick }: { onMenuClick?: () => void } = {}): JSX.Element {
    useLocation();
    const boot = getBootData();

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
        <header className="imcrm-flex imcrm-h-16 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-background imcrm-px-4 sm:imcrm-gap-4 sm:imcrm-px-6">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                {/* Hamburguesa: abre el sidebar como drawer (sólo mobile). */}
                <button
                    type="button"
                    onClick={onMenuClick}
                    aria-label={__('Abrir menú')}
                    className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-foreground/80 imcrm-transition-colors hover:imcrm-bg-accent lg:imcrm-hidden"
                >
                    <Menu className="imcrm-h-5 imcrm-w-5" />
                </button>
                <h2 className="imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground">
                    {boot.user.displayName || 'Imagina Base'}
                </h2>
            </div>

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                {moduleEnabled('mentions') && <NotificationBell />}

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
