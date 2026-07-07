import { useLocation } from 'react-router-dom';
import { ExternalLink, LogOut, Settings } from 'lucide-react';

import { NotificationBell } from '@/admin/layout/NotificationBell';
import { Button } from '@/components/ui/button';
import { getBootData } from '@/lib/boot';
import { __ } from '@/lib/i18n';

/**
 * Topbar inspirada en la app de audit:
 *  - Izquierda: nombre del workspace (boot.user / brand)
 *  - Derecha: notif bell, "Ver herramienta" link al admin de WP,
 *    settings + logout iconos
 *
 * El toggle de pantalla completa se eliminó en 0.30.3 — el SPA ya
 * vive en una URL standalone sin chrome de wp-admin, así que el
 * botón no tenía nada que ocultar.
 */
export function Topbar(): JSX.Element {
    useLocation();
    const boot = getBootData();

    return (
        <header className="imcrm-flex imcrm-h-16 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-4 imcrm-border-b imcrm-border-border imcrm-bg-background imcrm-px-6">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2.5">
                <h2 className="imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground">
                    {boot.user.displayName || 'Imagina CRM'}
                </h2>
            </div>

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <NotificationBell />

                <a
                    href={boot.adminUrl || '/wp-admin'}
                    className="imcrm-ml-1 imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-text-[13px] imcrm-font-medium imcrm-text-foreground imcrm-transition-colors hover:imcrm-bg-canvas hover:imcrm-border-input"
                >
                    <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Ver WP')}
                </a>

                <div className="imcrm-mx-1 imcrm-h-6 imcrm-w-px imcrm-bg-border" aria-hidden />

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
                    href="/wp-login.php?action=logout"
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
