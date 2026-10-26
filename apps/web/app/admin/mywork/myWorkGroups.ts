import { addDaysYmd, dueBucket, zonedToday, type DueBucket, type MyWorkChecklistItem, type MyWorkItem } from '@imagina-base/shared';

/**
 * v0.1.276 — «Mi trabajo» agrupado por vencimiento, con «hoy» en la zona de
 * la empresa. Una fecha-hora se lleva a su DÍA local antes de comparar (un
 * 23:30 UTC de ayer puede ser hoy en Bogotá).
 */
export const DUE_GROUPS: Array<{ key: DueBucket; label: string }> = [
    { key: 'overdue', label: 'Vencido' },
    { key: 'today', label: 'Hoy' },
    { key: 'week', label: 'Próximos 7 días' },
    { key: 'later', label: 'Más adelante' },
    { key: 'none', label: 'Sin fecha' },
];

export function localDueDay(item: Pick<MyWorkItem, 'due' | 'due_is_datetime'>, tz: string): string | null {
    if (!item.due) return null;
    if (!item.due_is_datetime) return item.due.slice(0, 10);
    const d = new Date(item.due);
    return Number.isNaN(d.getTime()) ? item.due.slice(0, 10) : zonedToday(tz, d);
}

export function groupWork<T extends Pick<MyWorkItem, 'due' | 'due_is_datetime'>>(
    items: readonly T[],
    tz: string,
    now: Date = new Date(),
): Map<DueBucket, T[]> {
    const today = zonedToday(tz, now);
    const weekEnd = addDaysYmd(today, 7);
    const out = new Map<DueBucket, T[]>(DUE_GROUPS.map((g) => [g.key, []]));
    for (const i of items) out.get(dueBucket(localDueDay(i, tz), today, weekEnd))!.push(i);
    return out;
}

/** A9 — los ítems de checklist asignados entran a los MISMOS grupos de vencimiento. */
export function groupChecklistWork(items: readonly MyWorkChecklistItem[], tz: string, now: Date = new Date()): Map<DueBucket, MyWorkChecklistItem[]> {
    return groupWork(items, tz, now);
}
