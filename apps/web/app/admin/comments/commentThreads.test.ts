import { describe, expect, it } from 'vitest';

import { buildThreads, isNestedReply, reactorsText, repliesByRoot, toggleReactionLocally } from './commentThreads';

const c = (id: number, parent: number | null, at: string) => ({ id, parent_id: parent, created_at: at });

describe('hilos de comentarios', () => {
    it('cuelga las respuestas de su raíz, de la más vieja a la más nueva', () => {
        const threads = buildThreads([
            c(1, null, '2026-10-01T10:00:00Z'),
            c(3, 1, '2026-10-01T12:00:00Z'),
            c(2, 1, '2026-10-01T11:00:00Z'),
            c(4, null, '2026-10-02T10:00:00Z'),
        ]);
        expect(threads.map((t) => t.root.id)).toEqual([1, 4]);
        expect(threads[0]!.replies.map((r) => r.id)).toEqual([2, 3]);
        expect(threads[1]!.replies).toEqual([]);
    });

    it('una respuesta sin su raíz en la lista se muestra como raíz (no se pierde)', () => {
        const threads = buildThreads([c(5, 99, '2026-10-01T10:00:00Z')]);
        expect(threads.map((t) => t.root.id)).toEqual([5]);
        expect(isNestedReply(c(5, 99, ''), [c(5, 99, '')])).toBe(false);
    });

    it('repliesByRoot sólo lista raíces con respuestas', () => {
        const map = repliesByRoot([c(1, null, '2026-10-01 10:00:00'), c(2, 1, '2026-10-01 11:00:00'), c(3, null, '2026-10-01 12:00:00')]);
        expect([...map.keys()]).toEqual([1]);
        expect(isNestedReply(c(2, 1, ''), [c(1, null, ''), c(2, 1, '')])).toBe(true);
    });
});

describe('reacciones', () => {
    it('pone, suma y quita respetando el orden del set', () => {
        let r = toggleReactionLocally([], '🎉', 1, 'Ana');
        r = toggleReactionLocally(r, '👍', 2, 'Pedro');
        expect(r.map((x) => x.emoji)).toEqual(['👍', '🎉']);
        r = toggleReactionLocally(r, '👍', 1, 'Ana');
        expect(r[0]).toMatchObject({ emoji: '👍', count: 2, user_names: ['Pedro', 'Ana'] });
        r = toggleReactionLocally(r, '👍', 2, 'Pedro');
        expect(r[0]).toMatchObject({ count: 1, user_ids: [1] });
        r = toggleReactionLocally(r, '🎉', 1, 'Ana');
        expect(r.map((x) => x.emoji)).toEqual(['👍']);
    });

    it('nombra a quienes reaccionaron', () => {
        expect(reactorsText(['Ana'])).toBe('Ana');
        expect(reactorsText(['Ana', 'Pedro'], 'Pedro')).toBe('Ana y Tú');
        expect(reactorsText(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C y 2 más');
    });
});
