import { describe, expect, it } from 'vitest';

import type { ActivityEntity } from '@/types/activity';
import type { CommentEntity } from '@/types/comment';

import { buildFeed, dayLabel, groupByDay } from './activityFeedModel';

const at = (min: number): string => new Date(Date.UTC(2026, 9, 1, 12, 0) + min * 60_000).toISOString();
const act = (id: number, min: number, user: number | null, action = 'record_updated'): ActivityEntity => ({
    id, list_id: 1, record_id: 1, user_id: user, user_name: user ? `U${user}` : null, action, changes: {}, created_at: at(min),
});
const com = (id: number, min: number): CommentEntity => ({
    id, list_id: 1, record_id: 1, user_id: 1, parent_id: null, content: 'hola', metadata: {}, created_at: at(min), updated_at: at(min),
});

describe('feed de actividad de la ficha', () => {
    it('junta las ediciones seguidas de la misma persona y corta con otra persona o un comentario', () => {
        const feed = buildFeed([com(9, 5)], [act(1, 0, 1), act(2, 2, 1), act(3, 4, 2), act(4, 6, 1), act(5, 30, 1), act(6, 7, null, 'comment.created')], 'all');
        // De lo más nuevo a lo más viejo; el log del comentario no se duplica.
        expect(feed.map((i) => (i.kind === 'comment' ? `c${i.comment.id}` : i.entries.map((e) => e.id).join('+')))).toEqual(['5', '4', 'c9', '3', '2+1']);
    });

    it('filtra por comentarios o por cambios', () => {
        expect(buildFeed([com(9, 5)], [act(1, 0, 1)], 'comments').map((i) => i.kind)).toEqual(['comment']);
        expect(buildFeed([com(9, 5)], [act(1, 0, 1)], 'changes').map((i) => i.kind)).toEqual(['activity']);
    });

    it('agrupa por día con "Hoy" y "Ayer"', () => {
        const now = Date.UTC(2026, 9, 1, 15, 0);
        expect(dayLabel(now - 3_600_000, now)).toBe('Hoy');
        expect(dayLabel(now - 86_400_000, now)).toBe('Ayer');
        const days = groupByDay(buildFeed([], [act(1, 0, 1), act(2, -3 * 24 * 60, 1)], 'all'), now);
        expect(days.map((d) => d.items.length)).toEqual([1, 1]);
    });
});
