import { checklistDueHasTime, resolveTimeZone, zonedDayAndMinute, zonedToday } from '@imagina-base/shared';

import { formatDateStr, formatDateTime, getTenantTimeZone } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

/**
 * A9 — Lo puro de la sección de checklists de la ficha: el estado de la fecha
 * de un ítem (vencido / hoy / próximo) y el reordenado por arrastre. Aparte
 * del componente para poder probarlo sin montar nada.
 */

export type DueState = 'overdue' | 'today' | 'upcoming';

/** La zona con la que se decide «hoy»: la de la empresa (ADR-S33) o la del equipo. */
function zone(): string {
    let browser: string | undefined;
    try {
        browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        browser = undefined;
    }
    return resolveTimeZone(getTenantTimeZone(), browser);
}

/**
 * ¿Cómo está la fecha de un ítem respecto de hoy? Una fecha sin hora es un
 * día del calendario (no se le aplica zona); una con hora se lleva al día de
 * la empresa. Un ítem HECHO no está vencido nunca.
 */
export function dueStateOf(due: string | null, done: boolean, now: Date = new Date(), tz: string = zone()): DueState | null {
    if (!due || done) return null;
    const today = zonedToday(tz, now);
    let day: string;
    if (checklistDueHasTime(due)) {
        const at = parseUtcDate(due);
        if (Number.isNaN(at.getTime())) return null;
        if (at.getTime() < now.getTime()) return 'overdue';
        day = zonedDayAndMinute(at, tz).ymd;
    } else {
        day = due.slice(0, 10);
        if (day < today) return 'overdue';
    }
    return day === today ? 'today' : 'upcoming';
}

/** El texto corto de la fecha de un ítem, en el formato de la empresa. */
export function formatDue(due: string | null): string {
    if (!due) return '';
    if (checklistDueHasTime(due)) {
        const at = parseUtcDate(due);
        return Number.isNaN(at.getTime()) ? due : formatDateTime(at);
    }
    return formatDateStr(due.slice(0, 10));
}

/**
 * El orden nuevo al soltar `dragged` sobre `target`: queda ANTES de `target`
 * si se arrastró hacia arriba y DESPUÉS si se arrastró hacia abajo (como en
 * cualquier lista). Soltarlo sobre sí mismo no cambia nada (null).
 */
export function moveId(ids: readonly number[], dragged: number, target: number): number[] | null {
    if (dragged === target) return null;
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) return null;
    const next = ids.filter((id) => id !== dragged);
    const at = next.indexOf(target);
    next.splice(from < to ? at + 1 : at, 0, dragged);
    return next;
}

/** Subir (-1) o bajar (+1) un ítem una posición (el menú del ítem, en táctil). */
export function shiftId(ids: readonly number[], id: number, delta: -1 | 1): number[] | null {
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const next = [...ids];
    next[i] = ids[j]!;
    next[j] = id;
    return next;
}

/** Acciones de una fila que aparecen al pasar el mouse (en táctil, tenues). */
export const HOVER_REVEAL =
    'imcrm-opacity-60 [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 focus-visible:imcrm-opacity-100 data-[state=open]:imcrm-opacity-100';
