import { COMMENT_REACTION_EMOJIS, type CommentReactionSummary } from '@imagina-base/shared';

/**
 * v0.1.291 — Hilos y reacciones de comentarios, PURO (se testea sin React).
 *
 * Hilos de UN nivel: una respuesta cuelga de un comentario raíz. Si llega una
 * respuesta cuyo raíz no está en la lista (no debería: el servidor conserva el
 * raíz borrado como «Comentario eliminado» mientras tenga respuestas), se
 * muestra como raíz para no perderla.
 */
interface ThreadItem {
    id: number;
    parent_id?: number | null;
    created_at: string;
}

export interface CommentThread<T extends ThreadItem> {
    root: T;
    /** De la más vieja a la más nueva (se leen como una conversación). */
    replies: T[];
}

export function buildThreads<T extends ThreadItem>(items: readonly T[] | undefined): Array<CommentThread<T>> {
    const list = items ?? [];
    const ids = new Set(list.map((c) => c.id));
    const replies = new Map<number, T[]>();
    const roots: T[] = [];
    for (const c of list) {
        const parent = c.parent_id ?? null;
        if (parent !== null && ids.has(parent)) {
            const bucket = replies.get(parent) ?? [];
            bucket.push(c);
            replies.set(parent, bucket);
        } else {
            roots.push(c);
        }
    }
    return roots.map((root) => ({
        root,
        replies: (replies.get(root.id) ?? []).slice().sort(byOldest),
    }));
}

/** Respuestas de cada raíz (para el feed, que ordena los raíces por su cuenta). */
export function repliesByRoot<T extends ThreadItem>(items: readonly T[] | undefined): Map<number, T[]> {
    const out = new Map<number, T[]>();
    for (const t of buildThreads(items)) if (t.replies.length > 0) out.set(t.root.id, t.replies);
    return out;
}

/** ¿Es una respuesta que se dibuja dentro de su raíz? */
export function isNestedReply<T extends ThreadItem>(c: T, all: readonly T[] | undefined): boolean {
    const parent = c.parent_id ?? null;
    return parent !== null && (all ?? []).some((x) => x.id === parent);
}

function byOldest(a: ThreadItem, b: ThreadItem): number {
    const ta = Date.parse(normalizeIso(a.created_at));
    const tb = Date.parse(normalizeIso(b.created_at));
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.id - b.id;
}

function normalizeIso(iso: string): string {
    return iso.includes('Z') || iso.includes('+') ? iso : `${iso.replace(' ', 'T')}Z`;
}

/**
 * Pone o quita la reacción de una persona (lo mismo que hace el servidor), así
 * el contador cambia al instante y la respuesta del servidor sólo confirma.
 * El resultado respeta el orden del set curado y quita los emojis en cero.
 */
export function toggleReactionLocally(
    reactions: readonly CommentReactionSummary[] | undefined,
    emoji: CommentReactionSummary['emoji'],
    userId: number,
    userName: string,
): CommentReactionSummary[] {
    const byEmoji = new Map<string, CommentReactionSummary>();
    for (const r of reactions ?? []) byEmoji.set(r.emoji, { ...r, user_ids: [...r.user_ids], user_names: [...r.user_names] });
    const cur = byEmoji.get(emoji);
    if (cur && cur.user_ids.includes(userId)) {
        const i = cur.user_ids.indexOf(userId);
        cur.user_ids.splice(i, 1);
        cur.user_names.splice(i, 1);
        cur.count = Math.max(0, cur.count - 1);
        if (cur.count === 0) byEmoji.delete(emoji);
    } else if (cur) {
        cur.user_ids.push(userId);
        cur.user_names.push(userName);
        cur.count += 1;
    } else {
        byEmoji.set(emoji, { emoji, count: 1, user_ids: [userId], user_names: [userName] });
    }
    return COMMENT_REACTION_EMOJIS.map((e) => byEmoji.get(e)).filter((r): r is CommentReactionSummary => r !== undefined);
}

/** «Ana, Pedro y 2 más» — quiénes reaccionaron, para el tooltip. */
export function reactorsText(names: readonly string[], you: string | null = null, max = 3): string {
    const shown = names.map((n) => (you !== null && n === you ? 'Tú' : n));
    if (shown.length === 0) return '';
    if (shown.length <= max) {
        if (shown.length === 1) return shown[0]!;
        return `${shown.slice(0, -1).join(', ')} y ${shown[shown.length - 1]}`;
    }
    return `${shown.slice(0, max).join(', ')} y ${shown.length - max} más`;
}
