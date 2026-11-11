import { Outlet, useLocation } from 'react-router';

import { PageErrorBoundary } from '@/components/ErrorBoundary';

/**
 * El `<Outlet />` del shell dentro de un límite de errores: si una pantalla
 * falla al dibujarse, el menú y la barra superior siguen ahí y al navegar a
 * otra ruta el aviso se va solo. Componente aparte para que sea éste —y no el
 * shell entero— el que se vuelva a dibujar con cada cambio de ruta.
 */
export function SafeOutlet(): JSX.Element {
    const { pathname } = useLocation();
    return (
        <PageErrorBoundary resetKey={pathname}>
            <Outlet />
        </PageErrorBoundary>
    );
}
