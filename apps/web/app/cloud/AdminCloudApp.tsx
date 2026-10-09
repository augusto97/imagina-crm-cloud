import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HashRouter } from 'react-router';
import { Loader2 } from 'lucide-react';

import { activeMembership, api as cloudApi, useSession } from '@/cloud/session';
import { hydrateAdminBoot } from '@/cloud/adminBoot';
import { useBranding } from '@/hooks/useBranding';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { LoginPage } from '@/cloud/pages/LoginPage';
import { Button } from '@/components/ui/button';

/**
 * v0.1.256 — La app (shell, listas, registros, realtime) se carga DESPUÉS del
 * gate: el login, el reset de contraseña y la verificación de email ya no
 * bajan todo el código de la app para mostrar un formulario. El chunk se pide
 * apenas carga este módulo (en paralelo con `/auth/me`), así quien ya tiene
 * sesión no espera un viaje extra y quien está en el login lo tiene listo
 * cuando entra.
 */
const loadApp = () => import('@/App').then((m) => ({ default: m.App }));
const App = lazyWithReload(loadApp);
void loadApp().catch(() => undefined);

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

/**
 * v0.1.227 — Cuenta sin ninguna empresa de equipo (la sacaron, borraron su
 * empresa, o sólo tiene acceso de PORTAL — que ya no cuenta como workspace).
 * Antes quedaba una ruedita girando para siempre.
 */
function NoWorkspaceScreen({ email }: { email: string }): JSX.Element {
    const [busy, setBusy] = useState(false);
    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-canvas imcrm-p-4">
            <div className="imcrm-w-full imcrm-max-w-sm imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-text-sm imcrm-shadow-sm">
                <h1 className="imcrm-text-base imcrm-font-semibold">Tu cuenta no tiene ninguna empresa</h1>
                <p className="imcrm-mt-2 imcrm-text-muted-foreground">
                    Entraste como <strong className="imcrm-text-foreground">{email}</strong>, pero esta cuenta no es
                    miembro del equipo de ninguna empresa. Pídele a un administrador que te invite.
                </p>
                <p className="imcrm-mt-2 imcrm-text-muted-foreground">
                    Si eres cliente de una empresa, entra por su{' '}
                    <a className="imcrm-text-primary hover:imcrm-underline" href="/portal">
                        portal de clientes
                    </a>
                    .
                </p>
                <Button
                    className="imcrm-mt-4 imcrm-w-full"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                        setBusy(true);
                        void cloudApi.logout().finally(() => window.location.reload());
                    }}
                >
                    Cerrar sesión
                </Button>
            </div>
        </div>
    );
}

export function AdminCloudApp(): JSX.Element {
    const user = useSession((s) => s.user);
    const ready = useSession((s) => s.ready);
    const activeTenantId = useSession((s) => s.activeTenantId);
    const membershipCount = useSession((s) => s.memberships.length);
    const setSession = useSession((s) => s.setSession);
    const markReady = useSession((s) => s.markReady);
    const [booted, setBooted] = useState(false);

    // Branding white-label del tenant: aplica `primary_color` a los tokens del
    // tema (una sola vez aquí; el Sidebar lee del mismo query cache).
    useBranding();

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
    if (membershipCount === 0) return <NoWorkspaceScreen email={user.email} />;
    if (!booted) return <LoadingScreen />;

    return (
        <HashRouter>
            <Suspense fallback={<LoadingScreen />}>
                <App />
            </Suspense>
        </HashRouter>
    );
}
