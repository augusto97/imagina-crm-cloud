import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

import { App } from '@/App';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { queryClient } from '@/lib/query-client';
import { getBootData } from '@/lib/boot';
import '@/styles/globals.css';
// Cargar el CSS del portal del cliente también dentro del bundle del
// admin. Necesario porque el editor de template del portal renderea
// los componentes reales del portal como preview — sin estos estilos
// los bloques se verían sin formato (default browser styles).
import '../assets/portal.css';

function mount(): void {
    const boot = getBootData();
    const container = document.getElementById(boot.rootId);

    if (!container) {
        // eslint-disable-next-line no-console
        console.warn(`[imagina-crm] Mount node "#${boot.rootId}" not found.`);
        return;
    }

    createRoot(container).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <ConfirmProvider>
                        <HashRouter>
                            <App />
                        </HashRouter>
                    </ConfirmProvider>
                </ToastProvider>
            </QueryClientProvider>
        </StrictMode>,
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
    mount();
}
