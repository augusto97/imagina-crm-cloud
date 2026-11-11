import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './email-design';
import { HTML_SCAN_MAX, capHtml, htmlAttr, scanHtml, type HtmlToken } from './html-scan';

function tokens(html: string, drop: string[] = []): HtmlToken[] {
    const out: HtmlToken[] = [];
    scanHtml(html, (t) => out.push(t), { dropWithContent: new Set(drop) });
    return out;
}

function ms(fn: () => void): number {
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
    }
    return best;
}

/** Repite una pieza hasta llenar `size` caracteres. */
const fill = (piece: string, size: number): string => piece.repeat(Math.ceil(size / piece.length)).slice(0, size);

/** La versión anterior (con expresiones regulares), como referencia para correos bien formados. */
function legacyPlain(html: string): string {
    let s = html;
    s = s.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, d, s2, text: string) => {
        const href = (d ?? s2 ?? '').trim();
        const label = text.replace(/<[^>]+>/g, '').trim();
        if (!href || href === '#' || href === label || (/^mailto:/i.test(href) && href.slice(7) === label)) return label;
        return label ? `${label} (${href})` : href;
    });
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<li\b[^>]*>/gi, '\n- ');
    s = s.replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|pre)>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = s
        .replace(/&nbsp;/g, ' ')
        .replace(/&#847;|&zwnj;/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
    return s
        .split('\n')
        .map((l) => l.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

describe('scanHtml', () => {
    it('entrega texto y etiquetas; descarta comentarios, declaraciones y elementos sin contenido útil', () => {
        expect(
            tokens('<!DOCTYPE html><?xml version="1.0"?><p class="a">Hola <!-- nota --><B>tú</B></p><STYLE>p{}</STYLE ><![CDATA[x]]>fin', ['style']),
        ).toEqual([
            { kind: 'tag', name: 'p', closing: false, attrs: ' class="a"' },
            { kind: 'text', text: 'Hola ' },
            { kind: 'tag', name: 'b', closing: false, attrs: '' },
            { kind: 'text', text: 'tú' },
            { kind: 'tag', name: 'b', closing: true, attrs: '' },
            { kind: 'tag', name: 'p', closing: true, attrs: '' },
            { kind: 'text', text: 'fin' },
        ]);
    });

    it('un «<» suelto es texto y una etiqueta sin cierre no es una etiqueta', () => {
        expect(tokens('1 < 2 y <b')).toEqual([
            { kind: 'text', text: '1 ' },
            { kind: 'text', text: '<' },
            { kind: 'text', text: ' 2 y ' },
            { kind: 'text', text: '<b' },
        ]);
        // Elemento descartable o comentario sin cierre: se descarta el resto.
        expect(tokens('a<script>x', ['script'])).toEqual([{ kind: 'text', text: 'a' }]);
        expect(tokens('a<' + '!-- sin fin')).toEqual([{ kind: 'text', text: 'a' }]);
        // `</styles>` no cierra `<style>`.
        expect(tokens('<style>a</styles>b</style>c', ['style'])).toEqual([{ kind: 'text', text: 'c' }]);
    });

    it('htmlAttr lee comillas dobles, simples y sin comillas', () => {
        expect(htmlAttr(' class="x" HREF = "https://a.co/?b=1&amp;c=2"', 'href')).toBe('https://a.co/?b=1&amp;c=2');
        expect(htmlAttr(" href='x y'", 'href')).toBe('x y');
        expect(htmlAttr(' href=abc target=_blank', 'href')).toBe('abc');
        expect(htmlAttr(' href=abc', 'href', false)).toBeNull();
        expect(htmlAttr(' data-href="no"', 'href')).toBeNull();
        expect(htmlAttr(' alt', 'alt')).toBeNull();
    });

    it('capHtml no corta un par sustituto', () => {
        const s = 'a'.repeat(9) + '😀';
        expect(capHtml(s, 10)).toBe('a'.repeat(9));
        expect(capHtml(s, 11)).toBe(s);
    });
});

describe('htmlToPlainText: igual que antes en correos bien formados', () => {
    const fixtures = [
        '<p>Hola <a href="https://x.com">sitio</a></p><ul><li>uno</li></ul>',
        '<html><head><title>T</title><style>p{color:red}</style></head><body><div>Hola&nbsp;Ana,</div><div><br></div><div>Gracias por <b>escribir</b>.</div></body></html>',
        '<div dir="ltr">Uno<br>Dos<br/>Tres<br />Cuatro</div><!-- firma --><div>-- <br>Ana &amp; Cía &lt;ventas&gt;</div>',
        '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table><p>Fin</p>',
        '<p><a href="mailto:ana@acme.co">ana@acme.co</a> · <a href="#">arriba</a> · <a href=\'https://acme.co\'>https://acme.co</a> · <a href="https://acme.co/x"><img src="a.png"></a></p>',
        '<h1>Título</h1><blockquote><p>Cita <i>larga</i></p></blockquote><ol><li class="x">a</li><li>b</li></ol><pre>c  d</pre>',
        '<script>alert(1)</script><p>Texto con &quot;comillas&quot; y &#39;apóstrofos&#39;</p>',
        '<p style="margin:0">Línea&zwnj; uno</p>\n<p>  Línea   dos  </p>\n\n\n<p>tres</p>',
        '<a name="top">ancla sin enlace</a> y <a href="https://a.co" target="_blank" rel="x"><span>con <b>formato</b></span></a>',
        'Sólo texto, sin etiquetas.',
        '',
    ];
    it('mismas salidas', () => {
        for (const f of fixtures) expect(htmlToPlainText(f), f).toBe(legacyPlain(f));
    });
});

describe('conversión de HTML: tiempo acotado con entradas grandes', () => {
    const N = HTML_SCAN_MAX;
    const openers: Array<[string, string]> = [
        ['comentario sin cierre', '<' + '!--'],
        ['CDATA sin cierre', '<' + '![CDATA['],
        ['declaración sin cierre', '<' + '!doctype '],
        ['script sin cierre', '<' + 'script '],
        ['style con cierre incompleto', '<' + 'style>a</style '],
        ['etiqueta sin cierre', '<' + 'a '],
        ['enlace con atributo y sin cierre', '<' + 'a href="x" '],
        ['enlace abierto sin </a>', '<' + 'a href="x">y'],
        ['ítem de lista sin cierre', '<' + 'li '],
        ['menor suelto con espacios', '<' + '   '],
        ['cierre incompleto', '<' + '/ p '],
        ['atributos href sin valor', ' href   '],
        ['comillas sin cerrar', '<' + 'a href="'],
    ];

    it('htmlToPlainText: cada forma, repetida hasta el tope, termina en < 300 ms', () => {
        for (const [name, piece] of openers) {
            const input = fill(piece, N);
            expect(ms(() => htmlToPlainText(input)), name).toBeLessThan(300);
        }
    });

    it('scanHtml con todos los elementos descartables: < 300 ms', () => {
        const drop = ['head', 'style', 'script', 'title', 'xml', 'noscript', 'template', 'svg', 'object', 'iframe', 'select', 'textarea', 'button'];
        for (const [name, piece] of openers) {
            const input = fill(piece, N);
            expect(ms(() => tokens(input, drop)), name).toBeLessThan(300);
        }
    });

    it('una entrada de 5 MB se recorta (y se avisa) en < 300 ms', () => {
        const big = fill('<p>hola <b>mundo</b></p>', 5_000_000);
        let out = '';
        expect(ms(() => (out = htmlToPlainText(big)))).toBeLessThan(300);
        expect(out.length).toBeLessThan(N);
        expect(out).toContain('contenido recortado');
        expect(htmlToPlainText('<p>corto</p>')).toBe('corto');
    });
});
