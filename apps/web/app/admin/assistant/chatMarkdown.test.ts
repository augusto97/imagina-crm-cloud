import { describe, expect, it } from 'vitest';

import { chatLinkKind, inlineText, parseChatMarkdown, parseInline, type Block } from './chatMarkdown';

describe('v0.1.370 — Markdown del asistente', () => {
    it('títulos, párrafos con saltos, línea y cita', () => {
        const b = parseChatMarkdown('# Uno\n## Dos\n#### Cuatro\n\nPrimera línea\nsegunda línea\n\n---\n\n> Ojo con esto\n> y esto');
        expect(b.map((x) => x.t)).toEqual(['h', 'h', 'h', 'p', 'hr', 'quote']);
        expect((b[2] as { level: number }).level).toBe(3);
        expect((b[3] as { c: unknown[] }).c).toEqual([{ t: 'text', v: 'Primera línea' }, { t: 'br' }, { t: 'text', v: 'segunda línea' }]);
        expect((b[5] as { c: Block[] }).c[0]).toEqual({ t: 'p', c: [{ t: 'text', v: 'Ojo con esto' }, { t: 'br' }, { t: 'text', v: 'y esto' }] });
    });

    it('listas anidadas, numeradas desde un número y de tareas', () => {
        const b = parseChatMarkdown('3. Tercero\n4. Cuarto\n   - sub a\n   - sub b\n     - más hondo\n5. Quinto\n\n- [x] hecho\n- [ ] pendiente');
        expect(b).toHaveLength(2);
        const ol = b[0] as Extract<Block, { t: 'list' }>;
        expect(ol).toMatchObject({ ordered: true, start: 3 });
        expect(ol.items.map((it) => inlineText(it.c))).toEqual(['Tercero', 'Cuarto', 'Quinto']);
        const nested = ol.items[1]!.sub[0] as Extract<Block, { t: 'list' }>;
        expect(nested.ordered).toBe(false);
        expect(nested.items.map((it) => inlineText(it.c))).toEqual(['sub a', 'sub b']);
        expect((nested.items[1]!.sub[0] as Extract<Block, { t: 'list' }>).items[0]!.c).toEqual([{ t: 'text', v: 'más hondo' }]);
        const tasks = b[1] as Extract<Block, { t: 'list' }>;
        expect(tasks.items.map((it) => it.task)).toEqual([true, false]);
    });

    it('una línea en blanco entre ítems no corta la lista', () => {
        const b = parseChatMarkdown('- uno\n\n- dos\n\nPárrafo');
        expect(b.map((x) => x.t)).toEqual(['list', 'p']);
        expect((b[0] as Extract<Block, { t: 'list' }>).items).toHaveLength(2);
    });

    it('tablas con alineación, celdas faltantes y barras dentro del código', () => {
        const b = parseChatMarkdown('| Campo | Tipo | Total |\n|:---|:---:|---:|\n| Estado | `a|b` | 3 |\n| Monto |');
        const t = b[0] as Extract<Block, { t: 'table' }>;
        expect(t.align).toEqual(['left', 'center', 'right']);
        expect(t.head.map(inlineText)).toEqual(['Campo', 'Tipo', 'Total']);
        expect(t.rows[0]![1]).toEqual([{ t: 'code', v: 'a|b' }]);
        expect(t.rows[1]!.map(inlineText)).toEqual(['Monto', '', '']);
    });

    it('bloques de código: con lenguaje, sin interpretar lo de adentro, y abiertos mientras llegan', () => {
        const b = parseChatMarkdown('```json\n{"a": "**no**"}\n```\nDespués');
        expect(b[0]).toEqual({ t: 'code', lang: 'json', v: '{"a": "**no**"}', open: false });
        expect(b[1]!.t).toBe('p');
        const open = parseChatMarkdown('Mira:\n```sql\nselect 1');
        expect(open[1]).toEqual({ t: 'code', lang: 'sql', v: 'select 1', open: true });
    });

    it('formato en línea: negrita, cursiva, tachado, código y enlaces', () => {
        expect(parseInline('**Hola** y *mundo* ~~no~~ `x`')).toEqual([
            { t: 'strong', c: [{ t: 'text', v: 'Hola' }] },
            { t: 'text', v: ' y ' },
            { t: 'em', c: [{ t: 'text', v: 'mundo' }] },
            { t: 'text', v: ' ' },
            { t: 'del', c: [{ t: 'text', v: 'no' }] },
            { t: 'text', v: ' ' },
            { t: 'code', v: 'x' },
        ]);
        expect(parseInline('Ve a [la lista](/lists/clientes/records).')).toEqual([
            { t: 'text', v: 'Ve a ' },
            { t: 'link', href: '/lists/clientes/records', c: [{ t: 'text', v: 'la lista' }] },
            { t: 'text', v: '.' },
        ]);
        expect(parseInline('Mira https://ejemplo.com/a.')).toEqual([
            { t: 'text', v: 'Mira ' },
            { t: 'link', href: 'https://ejemplo.com/a', c: [{ t: 'text', v: 'https://ejemplo.com/a' }] },
            { t: 'text', v: '.' },
        ]);
    });

    it('no se confunde con nombres internos, variables ni un formato a medio llegar', () => {
        expect(inlineText(parseInline('el campo fecha_de_pago y {{cliente.nombre}}'))).toBe('el campo fecha_de_pago y {{cliente.nombre}}');
        expect(parseInline('fecha_de_pago').every((n) => n.t === 'text')).toBe(true);
        expect(parseInline('**sin cerrar')).toEqual([{ t: 'text', v: '**sin cerrar' }]);
        expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
        expect(parseInline('\\*literal\\*')).toEqual([{ t: 'text', v: '*literal*' }]);
    });

    it('el HTML se queda como texto (nunca se interpreta)', () => {
        const b = parseChatMarkdown('<img src=x onerror=alert(1)> <script>x</script>');
        expect(b[0]).toEqual({ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)> <script>x</script>' }] });
    });

    it('enlaces: sólo direcciones seguras; lo demás queda como texto', () => {
        expect(chatLinkKind('https://x.co')).toBe('external');
        expect(chatLinkKind('http://x.co/a?b=1')).toBe('external');
        expect(chatLinkKind('mailto:ana@x.co')).toBe('mail');
        expect(chatLinkKind('tel:+57 300 123 4567')).toBe('tel');
        expect(chatLinkKind('/lists/clientes/records')).toBe('internal');
        expect(chatLinkKind('javascript:alert(1)')).toBeNull();
        expect(chatLinkKind('//evil.com')).toBeNull();
        expect(chatLinkKind('data:text/html,hola')).toBeNull();
    });

    it('una lista muy anidada no se cuelga', () => {
        const deep = Array.from({ length: 40 }, (_, k) => `${'  '.repeat(k)}- nivel ${k}`).join('\n');
        expect(() => parseChatMarkdown(deep)).not.toThrow();
    });
});
