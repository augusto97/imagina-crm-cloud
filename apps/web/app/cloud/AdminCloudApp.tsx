import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { App } from '@/App';
import { activeMembership, api as cloudApi, useSession } from '@/cloud/session';
import { hydrateAdminBoot } from '@/cloud/adminBoot';
import { useRealtime } from '@/cloud/useRealtime';
import { LoginPage } from '@/cloud/pages/LoginPage';

/**
 * Gate de sesión de Imagina Base que monta la UI REAL del admin
 * (`app/App` — el fork pulido del plugin) contra el backend NestJS.
 *
 * Flujo: `GET /auth/me` (sesión en cookie httpOnly). Sin sesión → login. Con
 * sesión → hidrata el store + el `boot` del admin (restRoot `/api/v1`, tenant
 * activo, capabilities por rol) y recién ahí renderiza `<App/>` con HashRouter
 * (`#/lists/...`), igual que Imagina CRM original.
 */
function LoadingScreen(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-screen imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
            <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin" />
        </div>
    );
}

export function AdminCloudApp(): JSX.Element {
    const user = useSession((s) => s.user);
    const ready = useSession((s) => s.ready);
    const activeTenantId = useSession((s) => s.activeTenantId);
    const setSession = useSession((s) => s.setSession);
    const markReady = useSession((s) => s.markReady);
    const [booted, setBooted] = useState(false);

    // Invalidación push del workspace activo (no-op hasta tener sesión+tenant).
    useRealtime();

    const me = useQuery({ queryKey: ['me'], queryFn: () => cloudApi.me(), retry: false });

    useEffect(() => {
        if (me.isSuccess) {
            setSession(me.data);
            markReady();
        }
        if (me.isError) {
            markReady();
        }
    }, [me.isSuccess, me.isError, me.data, setSession, markReady]);

    // Hidratar el boot del admin cuando hay usuario + workspace activo. Se
    // re-ejecuta al cambiar de workspace (switcher) para reapuntar el tenant.
    useEffect(() => {
        if (user && activeTenantId !== null) {
            hydrateAdminBoot(user, activeMembership());
            setBooted(true);
        } else {
            setBooted(false);
        }
    }, [user, activeTenantId]);

    if (!ready) return <LoadingScreen />;
    if (!user) return <LoginPage />;
    if (!booted) return <LoadingScreen />;

    return (
        <HashRouter>
            <App />
        </HashRouter>
    );
}
