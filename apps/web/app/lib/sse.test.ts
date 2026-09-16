import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse';

describe('createSseParser (v0.1.181)', () => {
    it('emite sólo eventos completos y conserva el resto en el buffer', () => {
        const p = createSseParser();
        expect(p.push('data: {"a":1}\n\ndata: {"b"')).toEqual(['{"a":1}']);
        expect(p.push(':2}\n')).toEqual([]);
        expect(p.push('\n')).toEqual(['{"b":2}']);
        expect(p.flush()).toEqual([]);
    });

    it('une data multilínea, ignora comentarios/event/id y acepta CRLF', () => {
        const p = createSseParser();
        const out = p.push(': keep-alive\r\nevent: x\r\nid: 7\r\ndata: hola\r\ndata: mundo\r\n\r\n');
        expect(out).toEqual(['hola\nmundo']);
    });

    it('flush devuelve el último evento si el servidor cerró sin separador', () => {
        const p = createSseParser();
        expect(p.push('data: fin')).toEqual([]);
        expect(p.flush()).toEqual(['fin']);
        expect(p.flush()).toEqual([]);
    });
});
