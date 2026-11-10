import { describe, expect, it } from 'vitest';

import { cleanEmbedDomain, highlightEmbedCode, shareMessage } from './shareHelpers';

describe('ventana «Compartir» (v0.1.397)', () => {
    it('colorea el código para insertar sin perder ni un carácter', () => {
        const code = '<iframe src="https://x.co/f/a?b=1&c=2" title="Hola > chau" loading="lazy"></iframe>\n<script src="https://x.co/embed.js" async></script>';
        const tokens = highlightEmbedCode(code);
        expect(tokens.map((t) => t.value).join('')).toBe(code);
        expect(tokens).toContainEqual({ kind: 'tag', value: '<iframe' });
        expect(tokens).toContainEqual({ kind: 'attr', value: 'src' });
        expect(tokens).toContainEqual({ kind: 'str', value: '"Hola > chau"' });
        expect(tokens).toContainEqual({ kind: 'tag', value: '</iframe' });
        // Un atributo sin valor (async) también es atributo.
        expect(tokens).toContainEqual({ kind: 'attr', value: 'async' });
    });

    it('lo que no es una etiqueta queda como texto', () => {
        const tokens = highlightEmbedCode('a < b y <3 sin cerrar');
        expect(tokens.map((t) => t.value).join('')).toBe('a < b y <3 sin cerrar');
        expect(tokens.every((t) => t.kind === 'text')).toBe(true);
        const open = highlightEmbedCode('<button data-x="sin cerrar');
        expect(open.map((t) => t.value).join('')).toBe('<button data-x="sin cerrar');
    });

    it('limpia los sitios que pueden insertarlo', () => {
        expect(cleanEmbedDomain('tusitio.com')).toBe('tusitio.com');
        expect(cleanEmbedDomain('  TuSitio.com/contacto  ')).toBe('tusitio.com');
        expect(cleanEmbedDomain('*.tusitio.com')).toBe('*.tusitio.com');
        expect(cleanEmbedDomain('https://www.tusitio.com/contacto/')).toBe('https://www.tusitio.com');
        expect(cleanEmbedDomain('localhost:8080')).toBe('localhost:8080');
        expect(cleanEmbedDomain('tusitio.com,')).toBe('tusitio.com');
        expect(cleanEmbedDomain('no es un sitio')).toBeNull();
        expect(cleanEmbedDomain('tusitio')).toBeNull();
        expect(cleanEmbedDomain('javascript://x')).toBeNull();
        expect(cleanEmbedDomain('')).toBeNull();
    });

    it('arma el texto que acompaña al enlace', () => {
        expect(shareMessage('form', 'Cotiza', 'https://x.co/f/a')).toBe('Cotiza: https://x.co/f/a');
        expect(shareMessage('form', '  ', 'https://x.co/f/a')).toBe('https://x.co/f/a');
        expect(shareMessage('booking', 'Consultorio', 'https://x.co/b/a')).toBe('Consultorio: agenda tu cita aquí https://x.co/b/a');
        expect(shareMessage('booking', '', 'https://x.co/b/a')).toBe('Agenda tu cita aquí: https://x.co/b/a');
    });
});
