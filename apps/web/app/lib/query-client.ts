import { QueryClient } from '@tanstack/react-query';

/**
 * v0.1.286 — reintentar SÓLO lo que puede salir distinto la segunda vez: la
 * red caída, un 5xx o un 429. Un 4xx (permiso, no existe, validación) vuelve
 * igual: reintentarlo duplicaba cada request fallida (y su espera).
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (failureCount >= 1) return false;
    const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        return false;
    }
    return true;
}

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: shouldRetryQuery,
        },
        mutations: {
            retry: 0,
        },
    },
});
