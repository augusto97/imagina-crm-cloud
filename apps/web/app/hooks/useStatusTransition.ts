import { useEffect, useRef } from 'react';

import { useEventCallback } from '@/hooks/useEventCallback';

/**
 * v0.1.286 — llama a `onChange` cuando `value` CAMBIA mientras el componente
 * está montado; el primer valor observado no cuenta. Para "cuando la corrida
 * termine, refresca X": con un `useEffect` sobre el estado, abrir una pantalla
 * cuya última corrida ya había terminado refrescaba en el acto lo que se
 * acababa de traer (requests duplicadas).
 */
export function useStatusTransition<T>(value: T | undefined, onChange: (value: T) => void): void {
    const prev = useRef<{ seen: boolean; value: T | undefined }>({ seen: false, value: undefined });
    const cb = useEventCallback(onChange);
    useEffect(() => {
        if (value === undefined) return;
        if (!prev.current.seen) {
            prev.current = { seen: true, value };
            return;
        }
        if (prev.current.value === value) return;
        prev.current = { seen: true, value };
        cb(value);
    }, [value, cb]);
}
