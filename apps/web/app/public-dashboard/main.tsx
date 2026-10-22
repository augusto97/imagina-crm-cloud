import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import '@fontsource-variable/inter';
import '@/styles/globals.css';

import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';

import { PublicDashboardApp } from './PublicDashboardApp';
import { publicThemeFromQuery, tokenFromPath } from './publicDashboard';

/**
 * v0.1.292 (ADR-S50) — Página pública de un tablero. A diferencia de la app y
 * del portal, NO lleva el guard anti-encuadre (`frameGuard`): está hecha para
 * insertarse en otro sitio. Qué sitios pueden hacerlo lo decide la cabecera
 * `frame-ancestors` que manda el API con la página.
 */

// Tras una actualización del servidor, una pestaña abierta pide chunks con
// hash viejo: recargamos UNA vez (como la app y el portal).
window.addEventListener('vite:preloadError', (event) => {
    const KEY = 'imcrm-public-chunk-reload';
    try {
        if (window.sessionStorage.getItem(KEY) === '1') return;
        window.sessionStorage.setItem(KEY, '1');
    } catch {
        return;
    }
    event.preventDefault();
    window.location.reload();
});
window.setTimeout(() => {
    try {
        window.sessionStorage.removeItem('imcrm-public-chunk-reload');
    } catch {
        // storage bloqueado (iframe de terceros): nada que rearmar
    }
}, 15_000);

// Tema: `?theme=dark|light` (quien inserta elige) o el del sistema. NO se
// guarda: la página pública no toca el almacenamiento de quien la abre.
const theme = publicThemeFromQuery(window.location.search, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
if (theme === 'dark') document.documentElement.setAttribute('data-imcrm-theme', 'dark');

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                {/* Los widgets usan el router (los clics que llevan a la lista
                    filtrada); aquí no navegan — los datos van inyectados —, pero
                    el hook necesita un router: uno en memoria, sin tocar la URL. */}
                <MemoryRouter>
                    <ToastProvider>
                        <ConfirmProvider>
                            <PublicDashboardApp token={tokenFromPath(window.location.pathname)} dark={theme === 'dark'} />
                        </ConfirmProvider>
                    </ToastProvider>
                </MemoryRouter>
            </QueryClientProvider>
        </StrictMode>,
    );
}
