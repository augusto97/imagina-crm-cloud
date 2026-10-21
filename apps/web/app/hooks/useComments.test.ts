import { describe, expect, it } from 'vitest';

import { followAfterComment, fromApiComment, toApiComment } from './useComments';

describe('comentarios: traducción con el API de la nube', () => {
    it('lee `body` y `kind` del API como `content` y `metadata.kind`', () => {
        const c = fromApiComment({ id: 1, list_id: 1, record_id: 2, user_id: 3, parent_id: null, body: 'Hola', kind: 'call', metadata: { duration_minutes: 5 }, created_at: 'x', updated_at: 'x' });
        expect(c.content).toBe('Hola');
        expect(c.metadata).toEqual({ duration_minutes: 5, kind: 'call' });
    });

    it('manda `body` (y el `kind` si no es nota) al publicar', () => {
        expect(toApiComment({ content: 'Pagó' })).toEqual({ body: 'Pagó' });
        expect(toApiComment({ content: 'Llamé', metadata: { kind: 'call', outcome: 'connected' } })).toEqual({
            body: 'Llamé',
            kind: 'call',
            metadata: { kind: 'call', outcome: 'connected' },
        });
    });
});

describe('«Seguir» después de comentar', () => {
    it('quien comenta queda siguiendo (y suma un seguidor)', () => {
        expect(followAfterComment({ following: false, followers: 2 })).toEqual({ following: true, followers: 3 });
    });

    it('si ya seguía, o no hay estado en cache, no cambia nada', () => {
        const same = { following: true, followers: 1 };
        expect(followAfterComment(same)).toBe(same);
        expect(followAfterComment(undefined)).toBeUndefined();
    });
});
