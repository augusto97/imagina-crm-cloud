import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * v0.1.294 — Qué celda de la tabla se está editando.
 *
 * La tabla funciona como una hoja de cálculo: un click ELIGE la celda (para
 * copiar, pegar, borrar o moverse con el teclado) y la edición se pide aparte
 * — segundo click, doble click, Enter, F2 o empezar a escribir. Quien decide
 * es el controlador de la tabla; la celda sólo escucha si el pedido es para
 * ella. Cada celda se suscribe por su clave (`registro:campo`), así abrir un
 * editor no vuelve a dibujar las cientos de celdas de la tabla.
 *
 * Fuera de una tabla (la tabla editable de la ficha) no hay almacén y la celda
 * conserva su comportamiento de siempre: un click edita.
 */
export type EditEndReason = 'enter' | 'tab' | 'shift-tab' | 'escape' | 'blur' | 'closed';

export interface GridEditRequest {
    key: string;
    /** Cambia en cada pedido: la celda abre su editor cuando ve uno nuevo. */
    token: number;
    /** Lo que se tecleó para empezar a editar (reemplaza el valor), o null. */
    seed: string | null;
}

export class GridEditStore {
    private current: GridEditRequest | null = null;
    private seq = 0;
    private readonly listeners = new Set<() => void>();
    /** Lo pone el controlador: qué hacer cuando una celda termina de editar. */
    onEnd: ((key: string, reason: EditEndReason) => void) | null = null;

    request(key: string, seed: string | null = null): void {
        this.current = { key, token: ++this.seq, seed };
        this.emit();
    }

    /**
     * Teclas que llegan ANTES de que el editor tome el foco (se escribe
     * rápido): se suman a lo tecleado en vez de reabrir el editor y perderlas.
     */
    appendSeed(key: string, text: string): boolean {
        if (!this.current || this.current.key !== key) return false;
        this.current = { ...this.current, seed: (this.current.seed ?? '') + text };
        this.emit();
        return true;
    }

    /** La celda terminó (guardó, canceló o se cerró su selector). */
    end(key: string, reason: EditEndReason): void {
        if (this.current?.key === key) {
            this.current = null;
            this.emit();
        }
        this.onEnd?.(key, reason);
    }

    get = (): GridEditRequest | null => this.current;

    isEditing(): boolean {
        return this.current !== null;
    }

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    };

    private emit(): void {
        for (const fn of this.listeners) fn();
    }
}

export function gridCellKey(recordId: number, fieldId: number): string {
    return `${recordId}:${fieldId}`;
}

export const GridEditContext = createContext<GridEditStore | null>(null);

const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;

/** El almacén de la tabla (null fuera de una tabla). */
export function useGridEditStore(): GridEditStore | null {
    return useContext(GridEditContext);
}

/** El pedido de edición para ESTA celda (o null). */
export function useCellEditRequest(store: GridEditStore | null, key: string): GridEditRequest | null {
    return useSyncExternalStore(
        store ? store.subscribe : NOOP_SUBSCRIBE,
        () => {
            const cur = store?.get() ?? null;
            return cur && cur.key === key ? cur : null;
        },
    );
}
