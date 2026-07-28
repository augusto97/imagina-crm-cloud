import { describe, expect, it } from 'vitest';

import { docKey } from './RecordDescription';
import { filterCommands, SLASH_COMMANDS } from './slashCommands';

/**
 * `docKey` es el guard que evita el borrado accidental: al montar, el editor
 * emite un cambio propio (agrega el párrafo final vacío). Si esa firma no
 * coincidiera con la del servidor, abrir una ficha guardaría — y con una
 * descripción vacía, la BORRARÍA. Pasó de verdad en el E2E de v0.1.133.
 */
describe('docKey — firma comparable del documento', () => {
    const doc = (content: unknown[]) => ({ type: 'doc', content }) as never;

    it('null y un documento vacío son la MISMA cosa', () => {
        expect(docKey(null)).toBe(docKey(doc([])));
        expect(docKey(doc([{ type: 'paragraph' }]))).toBe(docKey(null));
        expect(docKey(doc([{ type: 'paragraph', content: [] }]))).toBe(docKey(null));
    });

    it('ignora los párrafos vacíos DEL FINAL (el que agrega el editor)', () => {
        const conTexto = doc([
            { type: 'paragraph', content: [{ type: 'text', text: 'hola' }] },
        ]);
        const conTextoYCola = doc([
            { type: 'paragraph', content: [{ type: 'text', text: 'hola' }] },
            { type: 'paragraph' },
            { type: 'paragraph' },
        ]);
        expect(docKey(conTextoYCola)).toBe(docKey(conTexto));
    });

    it('un párrafo vacío EN EL MEDIO sí cuenta (es un salto que el usuario puso)', () => {
        const a = doc([
            { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ]);
        const b = doc([
            { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
            { type: 'paragraph' },
            { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ]);
        expect(docKey(a)).not.toBe(docKey(b));
    });

    it('un cambio real cambia la firma', () => {
        const a = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hola' }] }]);
        const b = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hola!' }] }]);
        expect(docKey(a)).not.toBe(docKey(b));
    });
});

describe('menú «/»', () => {
    it('busca sin acentos y por palabras clave', () => {
        expect(filterCommands('titulo').map((c) => c.id)).toContain('h1');
        expect(filterCommands('Título').map((c) => c.id)).toContain('h1');
        expect(filterCommands('checklist').map((c) => c.id)).toEqual(['task']);
        expect(filterCommands('')).toHaveLength(SLASH_COMMANDS.length);
        expect(filterCommands('zzz')).toHaveLength(0);
    });
});
