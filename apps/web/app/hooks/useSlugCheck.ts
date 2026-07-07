import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

interface SlugCheckResponse {
    slug: string;
    available: boolean;
    errors: Record<string, string>;
}

interface UseSlugCheckParams {
    type: 'list' | 'field';
    slug: string;
    listId?: number;
    /** ms del debounce. Default 350. */
    debounceMs?: number;
    /** Si el slug coincide con uno actual conocido (modo edición), saltarse el check. */
    currentSlug?: string;
}

interface SlugCheckState {
    state: 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
    message?: string;
}

/**
 * Hook que valida disponibilidad de un slug contra `/slugs/check` con
 * debounce. Usa AbortController para cancelar requests en vuelo cuando el
 * usuario sigue tipeando.
 */
export function useSlugCheck({
    type,
    slug,
    listId,
    debounceMs = 350,
    currentSlug,
}: UseSlugCheckParams): SlugCheckState {
    const [result, setResult] = useState<SlugCheckState>({ state: 'idle' });

    useEffect(() => {
        if (!slug) {
            setResult({ state: 'idle' });
            return;
        }

        if (currentSlug !== undefined && slug === currentSlug) {
            setResult({ state: 'available' });
            return;
        }

        setResult({ state: 'checking' });

        const controller = new AbortController();
        const timer = setTimeout(() => {
            const query: Record<string, unknown> = { type, slug };
            if (listId !== undefined) query.list_id = listId;

            api.get<SlugCheckResponse>('/slugs/check', { query, signal: controller.signal })
                .then((res) => {
                    if (controller.signal.aborted) return;
                    if (res.data.available) {
                        setResult({ state: 'available' });
                    } else {
                        const firstError = Object.values(res.data.errors)[0];
                        setResult({
                            state: firstError?.includes('reservado') || firstError?.includes('Formato')
                                ? 'invalid'
                                : 'taken',
                            message: firstError,
                        });
                    }
                })
                .catch((err: unknown) => {
                    if (controller.signal.aborted) return;
                    if (err instanceof Error && err.name === 'AbortError') return;
                    setResult({ state: 'invalid', message: 'Error verificando el slug.' });
                });
        }, debounceMs);

        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [type, slug, listId, debounceMs, currentSlug]);

    return result;
}
