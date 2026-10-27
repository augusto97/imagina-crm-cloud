import { useSyncExternalStore } from 'react';

import type { ResolvedStep, TourMeta } from './tourTypes';

/** El recorrido en curso (uno a la vez en toda la app). */
export interface TourRun {
    tourId: string;
    title: string;
    meta: TourMeta;
    steps: ResolvedStep[];
    index: number;
    /** Hacia dónde se movió por última vez (para saltar pasos ausentes). */
    direction: 1 | -1;
    /** Cuántos pasos se llegaron a mostrar (un recorrido sin ninguno avisa). */
    shown: number;
    /** Los títulos de los pasos que se mostraron (para el cierre). */
    seen: string[];
    /** Sube en cada cambio de paso: el que lo pidió puede re-armarse. */
    seq: number;
}

let run: TourRun | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

export const tourStore = {
    get(): TourRun | null {
        return run;
    },
    start(next: Omit<TourRun, 'index' | 'direction' | 'shown' | 'seen' | 'seq'>): void {
        run = { ...next, index: 0, direction: 1, shown: 0, seen: [], seq: (run?.seq ?? 0) + 1 };
        emit();
    },
    goto(index: number, direction: 1 | -1): void {
        if (!run) return;
        run = { ...run, index, direction, seq: run.seq + 1 };
        emit();
    },
    /**
     * Saca un paso cuyo elemento no apareció (así «3 de 8» no salta a «5 de
     * 8») y sigue en la dirección en que se venía. Devuelve false si no queda
     * ningún paso hacia ese lado.
     */
    drop(index: number, direction: 1 | -1): boolean {
        if (!run) return false;
        const steps = run.steps.filter((_, i) => i !== index);
        const next = direction === 1 ? index : index - 1;
        if (steps.length === 0 || next >= steps.length) {
            run = { ...run, steps, index: Math.max(0, Math.min(next, steps.length - 1)), seq: run.seq + 1 };
            return false;
        }
        if (next < 0) {
            run = { ...run, steps, index: 0, direction: 1, seq: run.seq + 1 };
            emit();
            return true;
        }
        run = { ...run, steps, index: next, direction, seq: run.seq + 1 };
        emit();
        return true;
    },
    /** Un paso real quedó a la vista (la portada y el cierre no cuentan). */
    markShown(): void {
        if (!run) return;
        const step = run.steps[run.index];
        if (!step || step.kind !== 'step') return;
        const seen = run.seen.includes(step.title) ? run.seen : [...run.seen, step.title];
        run = { ...run, shown: run.shown + 1, seen };
        emit();
    },
    stop(): void {
        if (!run) return;
        run = null;
        emit();
    },
    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useTourRun(): TourRun | null {
    return useSyncExternalStore(tourStore.subscribe, tourStore.get, () => null);
}

/** ¿Hay un recorrido en curso? (para que el ofrecimiento de bienvenida espere). */
export function useTourActive(): boolean {
    return useSyncExternalStore(
        tourStore.subscribe,
        () => tourStore.get() !== null,
        () => false,
    );
}
