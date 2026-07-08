import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { PortalApp } from '@/cloud-portal/PortalApp';
import '@/styles/globals.css';

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
