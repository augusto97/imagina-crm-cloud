import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useIsFetching } from '@tanstack/react-query';
import { Loader2, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';

/**
 * v0.1.286 — `/platform` sin ser superadmin: antes la ruta montaba la consola
 * igual y cada tarjeta fallaba con 403 por separado. Ahora un estado claro de
 * "no tienes acceso" con la salida a las listas. (El backend sigue siendo el
 * que protege de verdad: `SuperadminGuard`.)
 */
export function PlatformGate({ children }: { children: ReactNode }): JSX.Element {
    const isSuperadmin = useIsSuperadmin();
    // Justo después del login, `/auth/me` (que trae la marca) todavía viaja.
    const checking = useIsFetching({ queryKey: ['me'] }) > 0;
    if (isSuperadmin) return <>{children}</>;
    if (checking) {
        return (
            <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center">
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
            </div>
        );
    }
    return (
        <div className="imcrm-mx-auto imcrm-mt-10 imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-text-center" data-testid="platform-no-access">
            <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                <ShieldAlert className="imcrm-h-5 imcrm-w-5" aria-hidden />
            </span>
            <h1 className="imcrm-text-base imcrm-font-semibold">{__('No tienes acceso a la consola de plataforma')}</h1>
            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                {__('La consola es sólo para quien opera el servidor. Si deberías tener acceso, vuelve a iniciar sesión con tu contraseña.')}
            </p>
            <Button asChild size="sm">
                <Link to="/lists">{__('Ir a las listas')}</Link>
            </Button>
        </div>
    );
}
