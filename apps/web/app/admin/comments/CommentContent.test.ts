import { describe, expect, it } from 'vitest';

import { MENTION_RE } from './CommentContent';

function mentions(text: string): string[] {
    MENTION_RE.lastIndex = 0;
    return Array.from(text.matchAll(MENTION_RE), (m) => m[2] ?? '');
}

describe('chips de mención', () => {
    it('toma el email COMPLETO (el backend menciona por email)', () => {
        expect(mentions('Hola @beto@test.local mira esto')).toEqual(['beto@test.local']);
        expect(mentions('cc @ana.gomez+crm@acme.co y @luis@x.org')).toEqual(['ana.gomez+crm@acme.co', 'luis@x.org']);
    });

    it('conserva el @login corto de los comentarios viejos', () => {
        expect(mentions('@ana revisa')).toEqual(['ana']);
    });

    it('un email suelto (sin @ delante) no es mención', () => {
        expect(mentions('escribir a beto@test.local')).toEqual([]);
    });
});
