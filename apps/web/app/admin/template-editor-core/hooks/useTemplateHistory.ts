import { useCallback, useRef, useState } from 'react';

/**
 * Hook genérico de undo/redo (paridad con `useConfigHistory` del
 * editor CRM, pero parametrizable a cualquier shape de template).
 *
 * Cap a `MAX_HISTORY=50` para evitar crecimiento sin límite.
 * El load inicial NO se trackea — undo no debería volverte a un
 * config vacío. Usa `reset(next)` para setear sin tocar history.
 */

const MAX_HISTORY = 50;

interface History<T> {
    config: T;
    setConfig: (next: T | ((prev: T) => T)) => void;
    undo: () => void;
    redo: () => void;
    reset: (next: T) => void;
    canUndo: boolean;
    canRedo: boolean;
}

export function useTemplateHistory<T>(initial: T): History<T> {
    const [config, setConfigRaw] = useState<T>(initial);
    const pastRef = useRef<T[]>([]);
    const futureRef = useRef<T[]>([]);
    const [version, setVersion] = useState(0);

    const setConfig = useCallback((next: T | ((prev: T) => T)) => {
        setConfigRaw((prev) => {
            const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
            if (resolved === prev) return prev;
            pastRef.current.push(prev);
            if (pastRef.current.length > MAX_HISTORY) {
                pastRef.current.shift();
            }
            futureRef.current = [];
            setVersion((v) => v + 1);
            return resolved;
        });
    }, []);

    const undo = useCallback(() => {
        if (pastRef.current.length === 0) return;
        const previous = pastRef.current.pop()!;
        setConfigRaw((current) => {
            futureRef.current.push(current);
            if (futureRef.current.length > MAX_HISTORY) {
                futureRef.current.shift();
            }
            setVersion((v) => v + 1);
            return previous;
        });
    }, []);

    const redo = useCallback(() => {
        if (futureRef.current.length === 0) return;
        const next = futureRef.current.pop()!;
        setConfigRaw((current) => {
            pastRef.current.push(current);
            if (pastRef.current.length > MAX_HISTORY) {
                pastRef.current.shift();
            }
            setVersion((v) => v + 1);
            return next;
        });
    }, []);

    const reset = useCallback((next: T) => {
        pastRef.current = [];
        futureRef.current = [];
        setVersion((v) => v + 1);
        setConfigRaw(next);
    }, []);

    return {
        config,
        setConfig,
        undo,
        redo,
        reset,
        canUndo: pastRef.current.length > 0 && version >= 0,
        canRedo: futureRef.current.length > 0 && version >= 0,
    };
}
