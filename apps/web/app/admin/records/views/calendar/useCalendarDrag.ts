import { useEffect, useRef, useState } from 'react';

import type { CalendarEvent, DropTarget } from './calendarModel';

/**
 * B4 — Arrastrar en el calendario con eventos de puntero (no el arrastre
 * HTML5: hace falta el minuto exacto bajo el puntero para encajar a 15 min y
 * para estirar). Tres gestos:
 *  - `move`: mover un evento (en el mes, de día; en la grilla, de día y hora);
 *  - `resize`: estirar su borde final;
 *  - `create`: arrastrar en un hueco de la grilla para crear con inicio y fin.
 * Un gesto que no se movió (menos de 4 px) es un CLIC: abre el registro o
 * crea en ese hueco. Sólo con mouse o lápiz: en táctil el dedo desliza la
 * página y se mueve con «Mover a…».
 */
export type DragKind = 'move' | 'resize' | 'create';

export interface DragPreview {
    kind: DragKind;
    event: CalendarEvent | null;
    /** Dónde empezó el gesto y dónde está ahora (lo que devuelve `hitTest`). */
    origin: DropTarget;
    target: DropTarget;
    /** El gesto ya se movió (dejó de ser un clic). */
    moved: boolean;
}

export interface CalendarDragHandlers {
    /** Qué hay bajo el puntero: un día y, en la grilla de horas, un minuto. */
    hitTest: (clientX: number, clientY: number) => DropTarget | null;
    onCommit: (p: DragPreview) => void;
    /** Clic sin moverse. */
    onClick: (p: DragPreview) => void;
}

const THRESHOLD = 4;

export function useCalendarDrag(handlers: CalendarDragHandlers): {
    preview: DragPreview | null;
    start: (e: React.PointerEvent, kind: DragKind, event: CalendarEvent | null) => void;
} {
    const [preview, setPreview] = useState<DragPreview | null>(null);
    const ref = useRef(handlers);
    ref.current = handlers;
    const cleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => cleanup.current?.(), []);

    const start = (e: React.PointerEvent, kind: DragKind, event: CalendarEvent | null): void => {
        if (e.button !== 0 || e.pointerType === 'touch') return;
        const origin = ref.current.hitTest(e.clientX, e.clientY);
        if (!origin) return;
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        const y0 = e.clientY;
        let current: DragPreview = { kind, event, origin, target: origin, moved: false };
        setPreview(current);
        const move = (ev: PointerEvent): void => {
            const moved = current.moved || Math.abs(ev.clientX - x0) > THRESHOLD || Math.abs(ev.clientY - y0) > THRESHOLD;
            const target = ref.current.hitTest(ev.clientX, ev.clientY) ?? current.target;
            if (moved === current.moved && target.day === current.target.day && target.minute === current.target.minute) return;
            current = { ...current, moved, target };
            setPreview(current);
        };
        const finish = (commit: boolean): void => {
            cleanup.current?.();
            setPreview(null);
            if (current.moved) suppressNextClick();
            if (!commit) return;
            if (current.moved) ref.current.onCommit(current);
            else ref.current.onClick(current);
        };
        const up = (): void => finish(true);
        const cancel = (): void => finish(false);
        const key = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                finish(false);
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', key, true);
        // Que el arrastre no seleccione texto de la página.
        const prevSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        cleanup.current = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
            window.removeEventListener('keydown', key, true);
            document.body.style.userSelect = prevSelect;
            cleanup.current = null;
        };
    };

    return { preview, start };
}

/**
 * Después de un arrastre el navegador igual dispara un `click` (sobre el
 * evento o un ancestro común): sin esto, soltar un evento abría su ficha.
 */
function suppressNextClick(): void {
    const stop = (ev: MouseEvent): void => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener('click', stop, true);
    };
    window.addEventListener('click', stop, true);
    window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

/** El día bajo el puntero, por el atributo `data-cal-day` de las celdas. */
export function dayUnderPointer(clientX: number, clientY: number, attr = 'data-cal-day'): string | null {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
        const day = (el as HTMLElement).getAttribute?.(attr);
        if (day) return day;
    }
    return null;
}
