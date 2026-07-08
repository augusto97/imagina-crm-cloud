import { useLocation } from 'react-router-dom';
import { ExternalLink, LogOut, Settings } from 'lucide-react';

import { NotificationBell } from '@/admin/layout/NotificationBell';
import { Button } from '@/components/ui/button';
import { getBootData } from '@/lib/boot';
import { isCloud, moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';

/**
 * Topbar:
 *  - Izquierda: nombre del workspace / usuario
 *  - Derecha: notif bell (menciones), settings + logout
 *
 * En la nube (Imagina Base) el logout va contra el backend NestJS
 * (`POST /auth/logout`) y limpia la sesión; en el plugin va a wp-login.
 * El link "Ver WP" y la campana solo aplican donde tienen backend.
 */
export function Topbar(): JSX.Element {
    useLocation();
    const boot = getBootData();
    const cloud = isCloud();

    const cloudLogout = async (e: React.MouseEvent): Promise<void> => {
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
        <header className="imcrm-flex imcrm-h-16 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-4 imcrm-border-b imcrm-border-border imcrm-bg-background imcrm-px-6">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2.5">
                <h2 className="imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground">
                    {boot.user.displayName || 'Imagina Base'}
                </h2>
            </div>

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                {moduleEnabled('mentions') && <NotificationBell />}

                {!cloud && (
                    <a
                        href={boot.adminUrl || '/wp-admin'}
                        className="imcrm-ml-1 imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-text-[13px] imcrm-font-medium imcrm-text-foreground imcrm-transition-colors hover:imcrm-bg-canvas hover:imcrm-border-input"
                    >
                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Ver WP')}
                    </a>
                )}

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
                    href={cloud ? '#' : '/wp-login.php?action=logout'}
                    onClick={cloud ? cloudLogout : undefined}
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
