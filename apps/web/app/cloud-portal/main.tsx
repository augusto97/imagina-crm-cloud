import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { PortalApp } from '@/cloud-portal/PortalApp';
import '@/styles/globals.css';

// Tras una auto-actualización del servidor, una pestaña abierta sigue siendo
// la app VIEJA y pide sus chunks con hash viejo → 404 ("Failed to fetch
// dynamically imported module"). Vite emite `vite:preloadError` en ese caso:
// recargamos UNA vez (guard en sessionStorage contra loops) para traer el
// bundle nuevo; si la recarga no lo resuelve, dejamos que el error fluya.
window.addEventListener('vite:preloadError', (event) => {
    const KEY = 'imcrm-chunk-reload';
    if (window.sessionStorage.getItem(KEY) === '1') return; // ya recargamos
    window.sessionStorage.setItem(KEY, '1');
    event.preventDefault();
    window.location.reload();
});
window.addEventListener('load', () => {
    // Boot exitoso → rearmamos el guard para el próximo deploy.
    window.sessionStorage.removeItem('imcrm-chunk-reload');
});


const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <PortalApp />
                </BrowserRouter>
            </QueryClientProvider>
        </StrictMode>,
    );
}
