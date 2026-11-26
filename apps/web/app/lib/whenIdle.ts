type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
};

/**
 * v0.1.472 — Corre `fn` cuando la pestaña queda libre (después de `delay`
 * ms y a más tardar `timeout` ms más tarde). Devuelve la forma de
 * cancelarlo: lo que se pide "para después" no compite con lo que la
 * pantalla necesita ya (abrir una ficha, cargar una tabla).
 */
export function whenIdle(fn: () => void, { delay = 0, timeout = 2000 }: { delay?: number; timeout?: number } = {}): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const w = window as IdleWindow;
    let idleId: number | null = null;
    let fallbackId: number | null = null;
    let done = false;
    const run = (): void => {
        if (done) return;
        done = true;
        fn();
    };
    const schedule = (): void => {
        if (w.requestIdleCallback) idleId = w.requestIdleCallback(run, { timeout });
        else fallbackId = window.setTimeout(run, Math.min(timeout, 600));
    };
    const delayId = delay > 0 ? window.setTimeout(schedule, delay) : null;
    if (delayId === null) schedule();
    return () => {
        done = true;
        if (delayId !== null) window.clearTimeout(delayId);
        if (fallbackId !== null) window.clearTimeout(fallbackId);
        if (idleId !== null) w.cancelIdleCallback?.(idleId);
    };
}
