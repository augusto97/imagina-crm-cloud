import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';

/**
 * Respuesta REAL de `/slugs/check` en la nube: `{available, reason}`.
 *
 * v0.1.162 — este hook esperaba `{slug, available, errors}`, el shape del
 * plugin WordPress. Con un slug NO disponible leía `errors` (que no existe)
 * y el `Object.values(undefined)` explotaba dentro del `.then`, así que el
 * `.catch` mostraba "Error verificando el slug." — o sea: el mensaje de
 * error genérico tapaba SIEMPRE el motivo real (ocupado / reservado /
 * formato). Reporte del usuario.
 */
interface SlugCheckResponse {
    available: boolean;
    reason?: 'format' | 'reserved' | 'taken';
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

/** Motivo del backend → estado + texto que el usuario puede accionar. */
function fromReason(reason: SlugCheckResponse['reason']): SlugCheckState {
    switch (reason) {
        case 'taken':
            return { state: 'taken', message: __('Ya hay otro con ese nombre interno.') };
        case 'reserved':
            return { state: 'invalid', message: __('Ese nombre interno está reservado por el sistema.') };
        case 'format':
            return {
                state: 'invalid',
                message: __('Sólo minúsculas, números y guion bajo; tiene que empezar con una letra.'),
            };
        default:
            return { state: 'taken', message: __('No disponible.') };
    }
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

        // Modo edición sin tocar el slug: es el suyo, no hay nada que
        // preguntar (y el backend lo reportaría como "ocupado" por sí mismo).
        if (currentSlug !== undefined && slug === currentSlug) {
            setResult({ state: 'idle' });
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
                    setResult(res.data.available ? { state: 'available' } : fromReason(res.data.reason));
                })
                .catch((err: unknown) => {
                    if (controller.signal.aborted) return;
                    if (err instanceof Error && err.name === 'AbortError') return;
                    setResult({ state: 'invalid', message: __('No se pudo verificar el nombre interno.') });
                });
        }, debounceMs);

        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [type, slug, listId, debounceMs, currentSlug]);

    return result;
}
