/**
 * Las capturas reales del centro de aprendizaje (v0.1.322): cuadros WebP de la
 * app de verdad, grabados por `scripts/help-captures/run.mjs` sobre una
 * empresa de ejemplo, con qué se toca en cada uno. Viven en `/help-media/`
 * (las genera el release; en desarrollo, el script). Si faltan, la ayuda se
 * ve igual con sus ilustraciones: las capturas son un extra, nunca un hueco.
 */

export interface DemoRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type DemoAction = 'view' | 'look' | 'click' | 'hover' | 'type' | 'drag';

export interface DemoFrame {
    src: string;
    caption: string;
    action: DemoAction;
    target?: DemoRect;
    to?: DemoRect;
    text?: string;
}

export interface Demo {
    title: string;
    frames: DemoFrame[];
}

export interface DemoManifest {
    version?: string;
    viewport: { width: number; height: number };
    demos: Record<string, Demo>;
}

export const MEDIA_BASE = '/help-media/';

let pending: Promise<DemoManifest | null> | null = null;

/** El índice de capturas, pedido una sola vez por sesión. `null` si no hay. */
export function loadDemoManifest(): Promise<DemoManifest | null> {
    if (!pending) {
        pending = fetch(`${MEDIA_BASE}demos.json`, { credentials: 'same-origin' })
            .then(async (r) => {
                if (!r.ok) return null;
                const type = r.headers.get('content-type') ?? '';
                // El fallback del SPA devuelve el HTML de la app con 200.
                if (!type.includes('json')) return null;
                const m = (await r.json()) as DemoManifest;
                return m && typeof m === 'object' && m.demos && m.viewport ? m : null;
            })
            .catch(() => null);
    }
    return pending;
}

/** Sólo para tests. */
export function resetDemoManifestCache(): void {
    pending = null;
}

/** Cuánto se acerca la cámara a lo que se toca, según el ancho disponible. */
export function zoomFor(containerWidth: number, viewportWidth: number, target: DemoRect | undefined): number {
    if (!target) return 1;
    const fit = containerWidth / viewportWidth; // escala a la que se ve el cuadro entero
    // En pantallas chicas acercar más: el texto de la captura tiene que leerse.
    const want = fit < 0.5 ? 1.9 : fit < 0.7 ? 1.55 : 1.3;
    // Que lo que se toca entre con margen en el cuadro acercado.
    const maxByTarget = Math.min(viewportWidth / Math.max(target.w * 1.8, 1), 2.4);
    return Math.max(1, Math.min(want, maxByTarget));
}

/**
 * Desplazamiento (en px del cuadro) para que, acercado `z`, el centro de lo
 * que se toca quede en el centro de la vista sin mostrar bordes vacíos.
 */
export function panFor(z: number, vw: number, vh: number, target: DemoRect | undefined): { x: number; y: number } {
    if (!target || z <= 1) return { x: 0, y: 0 };
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    const maxX = (vw * (z - 1)) / z;
    const maxY = (vh * (z - 1)) / z;
    const x = Math.min(Math.max(cx - vw / (2 * z), 0), maxX);
    const y = Math.min(Math.max(cy - vh / (2 * z), 0), maxY);
    return { x, y };
}

/** Cuánto dura un cuadro en la reproducción automática (ms). */
export function frameDuration(f: DemoFrame): number {
    const base = f.action === 'view' ? 3200 : 3600;
    const typing = f.action === 'type' ? Math.min((f.text ?? '').length * 70, 2400) : 0;
    const reading = Math.min(f.caption.length * 25, 2200);
    return base + typing + reading;
}
