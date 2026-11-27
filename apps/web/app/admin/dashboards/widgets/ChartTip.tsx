import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { deltaView, diffText, toneClass, type ReadyCompare } from './compareView';

/**
 * v0.1.474 — El recuadro de los gráficos al pasar el mouse, AL INSTANTE.
 *
 * Hasta v0.1.473 las barras, la dona, el embudo y la línea usaban el `title`
 * del navegador, que tarda cerca de un segundo en aparecer (y en el celular
 * no aparece nunca). Éste sale apenas el mouse entra, sigue al puntero y se va
 * al salir; con el dedo, el primer toque lo muestra y el segundo abre los
 * registros (si el gráfico lo permite).
 *
 * El estado vive en un store chico por gráfico: moverse sobre las barras NO
 * vuelve a dibujar el gráfico, sólo el recuadro (y su posición se escribe
 * directo en el DOM). Va por portal al `<body>` con posición fija, así ningún
 * contenedor con scroll lo recorta.
 */
export interface ChartTipRow {
    label?: string;
    value: string;
    /** Muestra de color (la de la barra o el sector). */
    color?: string;
    /** Clases de color del valor (la variación en verde/rojo). */
    valueClass?: string;
}

export interface ChartTipContent {
    title: string;
    subtitle?: string;
    rows: ChartTipRow[];
    /** «Clic para ver los registros». */
    hint?: string;
}

interface TipState {
    key: string;
    content: ChartTipContent;
    x: number;
    y: number;
    touch: boolean;
}

class TipStore {
    state: TipState | null = null;
    version = 0;
    private listeners = new Set<() => void>();
    private movers = new Set<() => void>();

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    };

    onMove(fn: () => void): () => void {
        this.movers.add(fn);
        return () => this.movers.delete(fn);
    }

    getVersion = (): number => this.version;

    show(key: string, content: ChartTipContent, x: number, y: number, touch: boolean): void {
        this.state = { key, content, x, y, touch };
        this.version++;
        for (const fn of this.listeners) fn();
    }

    move(x: number, y: number): void {
        if (!this.state) return;
        this.state.x = x;
        this.state.y = y;
        for (const fn of this.movers) fn();
    }

    hide(key?: string): void {
        if (!this.state || (key !== undefined && this.state.key !== key)) return;
        this.state = null;
        this.version++;
        for (const fn of this.listeners) fn();
    }
}

export interface ChartTipHandlers {
    'data-chart-tip-target': '';
    onPointerEnter: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onClick: (e: React.MouseEvent) => void;
}

export interface ChartTip {
    /**
     * Los manejadores de UN elemento del gráfico (una barra, un sector, un
     * punto). `content` se arma recién al mostrarse; `onActivate` es el clic
     * que abre los registros.
     */
    bind: (key: string, content: () => ChartTipContent, onActivate?: (() => void) | null) => ChartTipHandlers;
    /** Va una vez por gráfico, en cualquier lugar del árbol. */
    layer: JSX.Element;
}

export function useChartTip(): ChartTip {
    const storeRef = useRef<TipStore | null>(null);
    if (storeRef.current === null) storeRef.current = new TipStore();
    const store = storeRef.current;
    const lastPointer = useRef<string>('mouse');

    const bind = useCallback(
        (key: string, content: () => ChartTipContent, onActivate?: (() => void) | null): ChartTipHandlers => ({
            'data-chart-tip-target': '',
            onPointerEnter: (e) => {
                if (e.pointerType === 'touch') return;
                store.show(key, content(), e.clientX, e.clientY, false);
            },
            onPointerMove: (e) => {
                if (e.pointerType === 'touch') return;
                if (store.state?.key !== key) store.show(key, content(), e.clientX, e.clientY, false);
                else store.move(e.clientX, e.clientY);
            },
            onPointerLeave: (e) => {
                if (e.pointerType === 'touch') return;
                store.hide(key);
            },
            onPointerDown: (e) => {
                lastPointer.current = e.pointerType;
            },
            onClick: (e) => {
                if (lastPointer.current === 'touch') {
                    // Con el dedo: el primer toque muestra el recuadro; el
                    // segundo (en el mismo elemento) abre los registros.
                    if (store.state?.key !== key || !onActivate) {
                        store.show(key, content(), e.clientX, e.clientY, true);
                        return;
                    }
                    store.hide();
                }
                onActivate?.();
            },
        }),
        [store],
    );

    return { bind, layer: <ChartTipLayer store={store} /> };
}

function ChartTipLayer({ store }: { store: TipStore }): JSX.Element | null {
    useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
    const ref = useRef<HTMLDivElement | null>(null);
    const state = store.state;

    useLayoutEffect(() => {
        const place = (): void => {
            const el = ref.current;
            const s = store.state;
            if (!el || !s) return;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const gap = 14;
            let left = s.x + gap;
            let top = s.y + gap;
            if (left + w > window.innerWidth - 8) left = s.x - w - gap;
            if (top + h > window.innerHeight - 8) top = s.y - h - gap;
            el.style.left = `${Math.max(8, left)}px`;
            el.style.top = `${Math.max(8, top)}px`;
        };
        place();
        return store.onMove(place);
    });

    // Se va al hacer scroll (el elemento se movió debajo) y, con el dedo, al
    // tocar en otro lado.
    useLayoutEffect(() => {
        if (!state) return;
        const onScroll = (): void => store.hide();
        const onDown = (e: PointerEvent): void => {
            if (store.state?.touch && !(e.target instanceof Element && e.target.closest('[data-chart-tip-target]'))) store.hide();
        };
        window.addEventListener('scroll', onScroll, true);
        document.addEventListener('pointerdown', onDown, true);
        const timer = state.touch ? window.setTimeout(() => store.hide(), 5000) : undefined;
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            document.removeEventListener('pointerdown', onDown, true);
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [state, store]);

    if (!state || typeof document === 'undefined') return null;
    const { content } = state;
    return createPortal(
        <div
            ref={ref}
            role="tooltip"
            data-testid="imcrm-chart-tip"
            className="imcrm-pointer-events-none imcrm-fixed imcrm-z-[90] imcrm-w-max imcrm-max-w-[18rem] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-px-2.5 imcrm-py-2 imcrm-text-[11px] imcrm-text-popover-foreground imcrm-shadow-imcrm-md"
            style={{ left: -9999, top: -9999 }}
        >
            <p className="imcrm-truncate imcrm-font-semibold">{content.title}</p>
            {content.subtitle && <p className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">{content.subtitle}</p>}
            {content.rows.length > 0 && (
                <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    {content.rows.map((r, i) => (
                        <li key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            {r.color && <span className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-sm" style={{ backgroundColor: r.color }} aria-hidden />}
                            {r.label !== undefined && <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-muted-foreground">{r.label}</span>}
                            <span className={cn('imcrm-font-semibold imcrm-tabular-nums', r.label === undefined && 'imcrm-flex-1', r.valueClass)}>{r.value}</span>
                        </li>
                    ))}
                </ul>
            )}
            {content.hint && <p className="imcrm-mt-1 imcrm-border-t imcrm-border-border imcrm-pt-1 imcrm-text-[10px] imcrm-text-muted-foreground">{content.hint}</p>}
        </div>,
        document.body,
    );
}

/** El texto de ayuda de un elemento que se puede abrir. */
export function openHint(navigable: boolean): string | undefined {
    if (!navigable) return undefined;
    const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
    return touch ? __('Toca otra vez para ver los registros') : __('Clic para ver los registros');
}

/** Ahora, antes y la diferencia de un elemento con «Comparar con…». */
export function compareTipRows(
    compare: ReadyCompare,
    current: number,
    previous: number | null | undefined,
    format: (n: number) => string,
): ChartTipRow[] {
    const prev = previous ?? null;
    const d = prev === null ? null : deltaView(current, prev, compare.invert === true);
    const rows: ChartTipRow[] = [
        { label: __('Ahora'), value: format(current) },
        { label: __('Antes'), value: prev === null ? '—' : format(prev) },
    ];
    if (d) rows.push({ label: __('Diferencia'), value: `${diffText(d.diff, format)} (${d.text})`, valueClass: toneClass(d.tone) });
    return rows;
}

/** «12,5 %» con los separadores de la empresa (la parte del total). */
export function shareText(part: number, total: number): string {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return '—';
    return `${formatNumber((part / total) * 100, { maxFrac: 1 })} %`;
}
