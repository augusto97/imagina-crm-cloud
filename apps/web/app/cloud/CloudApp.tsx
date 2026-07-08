import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, useSession } from '@/cloud/session';
import { LoginPage } from '@/cloud/pages/LoginPage';
import { Shell } from '@/cloud/pages/Shell';
import { ListView } from '@/cloud/pages/ListView';
import { SettingsPage } from '@/cloud/pages/SettingsPage';
import { OnboardingWizard } from '@/cloud/components/OnboardingWizard';

/**
 * Gate de autenticación del shell cloud. Al montar consulta `GET /auth/me`
 * (la sesión vive en la cookie httpOnly); si hay sesión, hidrata el store y
 * entra al workspace, si no, muestra el login. BrowserRouter (adiós Hash).
 */
export function CloudApp(): JSX.Element {
    const user = useSession((s) => s.user);
    const ready = useSession((s) => s.ready);
    const setSession = useSession((s) => s.setSession);
    const markReady = useSession((s) => s.markReady);

    const me = useQuery({
        queryKey: ['me'],
        queryFn: () => api.me(),
        retry: false,
    });

    useEffect(() => {
        if (me.isSuccess) {
            setSession(me.data);
            markReady();
        }
        if (me.isError) {
            markReady();
        }
    }, [me.isSuccess, me.isError, me.data, setSession, markReady]);

    if (!ready) {
        return (
            <div className="imcrm-flex imcrm-h-screen imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
                Cargando…
            </div>
        );
    }

    if (!user) {
        return <LoginPage />;
    }

    return (
        <Routes>
            <Route element={<Shell />}>
                <Route index element={<Navigate to="/lists" replace />} />
                <Route path="lists" element={<EmptyState />} />
                <Route path="lists/:listSlug" element={<ListView />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/lists" replace />} />
            </Route>
        </Routes>
    );
}

/**
 * Estado del índice `/lists`: si el workspace todavía no tiene listas,
 * mostramos el wizard de onboarding; si ya tiene, invitamos a elegir una.
 * La misma queryKey `['lists', tenantId]` que usa el Shell → sin refetch.
 */
function EmptyState(): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const lists = useQuery({
        queryKey: ['lists', tenantId],
        queryFn: () => api.listLists(),
        enabled: tenantId !== null,
    });

    if (lists.data && lists.data.length === 0) return <OnboardingWizard />;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
            Elegí o creá una lista para empezar.
        </div>
    );
}
