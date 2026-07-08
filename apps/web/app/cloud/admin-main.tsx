import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { AdminCloudApp } from '@/cloud/AdminCloudApp';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { queryClient } from '@/lib/query-client';
import '@/styles/globals.css';

/**
 * Entry standalone de Imagina Base: monta la UI REAL del admin (fork pulido
 * del plugin) contra el backend NestJS, detrás del gate de sesión. Reemplaza
 * al shell mínimo `cloud/main.tsx`. Un solo `queryClient` (el del admin) para
 * el gate y la app; los providers de toast/confirm envuelven login + app.
 */
const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <ConfirmProvider>
                        <AdminCloudApp />
                    </ConfirmProvider>
                </ToastProvider>
            </QueryClientProvider>
        </StrictMode>,
    );
}
