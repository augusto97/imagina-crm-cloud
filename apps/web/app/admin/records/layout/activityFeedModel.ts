import { parseUtcDate } from '@/lib/utcDate';
import type { ActivityEntity } from '@/types/activity';
import type { CommentEntity } from '@/types/comment';

/**
 * v0.1.234 — El modelo del feed de actividad de la ficha, PURO (se testea
 * sin React). Junta comentarios y cambios en un solo hilo, de lo más nuevo a
 * lo más viejo, y lo vuelve legible:
 *  - los cambios seguidos de la MISMA persona en pocos minutos son UNA
 *    entrada con varias líneas (editar 4 campos de un registro no son 4
 *    renglones del feed);
 *  - todo se agrupa por día ("Hoy", "Ayer", "lun 21 sep").
 */

export type FeedFilter = 'all' | 'comments' | 'changes';

export type FeedItem =
    | { kind: 'comment'; key: string; ts: number; comment: CommentEntity }
    | { kind: 'activity'; key: string; ts: number; entries: ActivityEntity[] };

export interface FeedDay {
    key: string;
    label: string;
    items: FeedItem[];
}

/** Ventana en la que dos ediciones seguidas de la misma persona se juntan. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000;

const UPDATE_ACTIONS = new Set(['record_updated', 'record.updated']);

export function buildFeed(
    comments: readonly CommentEntity[] | undefined,
    activity: readonly ActivityEntity[] | undefined,
    filter: FeedFilter,
): FeedItem[] {
    const raw: FeedItem[] = [];
    if (filter !== 'changes') {
        for (const c of comments ?? []) raw.push({ kind: 'comment', key: `c-${c.id}`, ts: tsOf(c.created_at), comment: c });
    }
    if (filter !== 'comments') {
        for (const a of activity ?? []) {
            // El comentario ya está en el hilo: su entrada de log sería un duplicado.
            if (a.action.startsWith('comment.')) continue;
            raw.push({ kind: 'activity', key: `a-${a.id}`, ts: tsOf(a.created_at), entries: [a] });
        }
    }
    raw.sort((x, y) => y.ts - x.ts);

    const out: FeedItem[] = [];
    for (const item of raw) {
        const prev = out[out.length - 1];
        if (
            item.kind === 'activity' &&
            prev?.kind === 'activity' &&
            canMerge(prev.entries[prev.entries.length - 1]!, item.entries[0]!, prev.ts, item.ts)
        ) {
            prev.entries.push(item.entries[0]!);
            continue;
        }
        out.push(item.kind === 'activity' ? { ...item, entries: [...item.entries] } : item);
    }
    return out;
}

function canMerge(a: ActivityEntity, b: ActivityEntity, tsA: number, tsB: number): boolean {
    return (
        UPDATE_ACTIONS.has(a.action) &&
        UPDATE_ACTIONS.has(b.action) &&
        (a.user_id ?? 0) === (b.user_id ?? 0) &&
        Math.abs(tsA - tsB) <= MERGE_WINDOW_MS &&
        dayKey(tsA) === dayKey(tsB)
    );
}

export function groupByDay(items: readonly FeedItem[], now: number = Date.now()): FeedDay[] {
    const days: FeedDay[] = [];
    for (const item of items) {
        const key = dayKey(item.ts);
        let day = days[days.length - 1];
        if (!day || day.key !== key) {
            day = { key, label: dayLabel(item.ts, now), items: [] };
            days.push(day);
        }
        day.items.push(item);
    }
    return days;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "Hoy", "Ayer", "lun 21 sep" (con el año si no es el actual). */
export function dayLabel(ts: number, now: number = Date.now()): string {
    if (ts === 0) return 'Sin fecha';
    const today = dayKey(now);
    if (dayKey(ts) === today) return 'Hoy';
    if (dayKey(ts) === dayKey(now - 86_400_000)) return 'Ayer';
    const d = new Date(ts);
    const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

function dayKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function tsOf(s: string | null | undefined): number {
    if (!s) return 0;
    const t = parseUtcDate(s).getTime();
    return Number.isNaN(t) ? 0 : t;
}
