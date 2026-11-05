import { describe, expect, it } from 'vitest';

import { demoSrc, demoVersion } from './EmbedDemo';

describe('demostración de inserción (v0.1.381)', () => {
    it('marca la página como demostración y le pone la versión', () => {
        expect(demoSrc('/api/v1/public/f/abc', 'v1', null)).toBe('/api/v1/public/f/abc?imb_demo=1&v=v1');
        expect(demoSrc('/api/v1/public/b/xyz', 'v2', 'bare')).toBe('/api/v1/public/b/xyz?imb_demo=1&v=v2&imb_style=bare');
        expect(demoSrc('/p?x=1', 'v3', 'card')).toBe('/p?x=1&imb_demo=1&v=v3&imb_style=card');
    });

    it('la versión cambia sólo cuando cambia lo guardado', () => {
        const a = demoVersion([{ name: 'Contacto', config: { a: 1 } }, true]);
        expect(demoVersion([{ name: 'Contacto', config: { a: 1 } }, true])).toBe(a);
        expect(demoVersion([{ name: 'Contacto', config: { a: 2 } }, true])).not.toBe(a);
        expect(demoVersion([{ name: 'Contacto', config: { a: 1 } }, false])).not.toBe(a);
        expect(a).toMatch(/^[0-9a-z]+$/);
    });
});
