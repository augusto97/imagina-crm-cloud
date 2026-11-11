/**
 * Lector de HTML de UNA pasada y costo lineal.
 *
 * El HTML que llega de afuera (un correo entrante, una firma, un bloque
 * HTML) se leía con varias expresiones regulares cuyo costo crecía con el
 * cuadrado (o el cubo) del tamaño cuando una etiqueta o un comentario
 * quedaban sin cerrar. Este lector avanza con `indexOf`: cada carácter se
 * mira una cantidad constante de veces, pase lo que pase con la entrada.
 *
 *  - Comentarios, CDATA y declaraciones (`<!doctype …>`, `<?xml …?>`) se
 *    descartan. Un comentario o un CDATA sin cierre descarta el resto.
 *  - Los elementos de `dropWithContent` se descartan con todo su contenido;
 *    si no tienen cierre, se descarta el resto de la entrada.
 *  - Una etiqueta sin `>` no es una etiqueta: el resto se entrega como texto.
 *
 * No interpreta entidades ni arma un árbol: entrega texto y etiquetas.
 */

export type HtmlToken =
    | { kind: 'text'; text: string }
    | { kind: 'tag'; name: string; closing: boolean; attrs: string };

/** Tope del HTML que se convierte (lo que pasa de aquí se recorta). */
export const HTML_SCAN_MAX = 400_000;
/** Tope de los atributos de UNA etiqueta que se entregan (el resto no se lee). */
const ATTRS_MAX = 4096;

const isSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);
const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c: number): boolean => isAlpha(c) || (c >= 48 && c <= 57) || c === 58 || c === 45;

/** Recorta el HTML al tope (sin cortar a mitad un par sustituto). */
export function capHtml(html: string, max = HTML_SCAN_MAX): string {
    if (typeof html !== 'string') return '';
    if (html.length <= max) return html;
    const code = html.charCodeAt(max - 1);
    return html.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

export function scanHtml(
    html: string,
    onToken: (token: HtmlToken) => void,
    opts: { dropWithContent?: ReadonlySet<string> } = {},
): void {
    const src = html;
    const drop = opts.dropWithContent;
    // Sólo para buscar cierres sin distinguir mayúsculas (una copia, lineal).
    let lower: string | null = null;
    const n = src.length;
    let i = 0;
    const text = (from: number, to: number): void => {
        if (to > from) onToken({ kind: 'text', text: src.slice(from, to) });
    };
    while (i < n) {
        const lt = src.indexOf('<', i);
        if (lt === -1) {
            text(i, n);
            return;
        }
        text(i, lt);
        const c1 = src.charCodeAt(lt + 1);
        if (c1 === 33 /* ! */) {
            if (src.startsWith('<!--', lt)) {
                const end = src.indexOf('-->', lt + 4);
                if (end === -1) return;
                i = end + 3;
                continue;
            }
            if (src.startsWith('<![CDATA[', lt)) {
                const end = src.indexOf(']]>', lt + 9);
                if (end === -1) return;
                i = end + 3;
                continue;
            }
        }
        if (c1 === 33 || c1 === 63 /* ? */) {
            const end = src.indexOf('>', lt + 2);
            if (end === -1) {
                // Sin `>` en lo que queda: nada más puede ser una etiqueta.
                text(lt, n);
                return;
            }
            i = end + 1;
            continue;
        }
        // ¿Es una etiqueta?  `<` espacios `/`? espacios nombre
        let j = lt + 1;
        while (j < n && isSpace(src.charCodeAt(j))) j++;
        let closing = false;
        if (src.charCodeAt(j) === 47 /* / */) {
            closing = true;
            j++;
            while (j < n && isSpace(src.charCodeAt(j))) j++;
        }
        if (j >= n || !isAlpha(src.charCodeAt(j))) {
            // Un `<` suelto es texto.
            onToken({ kind: 'text', text: '<' });
            i = lt + 1;
            continue;
        }
        let k = j + 1;
        while (k < n && isNameChar(src.charCodeAt(k))) k++;
        // El nombre no termina en `-` ni `:` (eso ya es parte de los atributos).
        while (k > j + 1 && (src.charCodeAt(k - 1) === 45 || src.charCodeAt(k - 1) === 58)) k--;
        const gt = src.indexOf('>', k);
        if (gt === -1) {
            text(lt, n);
            return;
        }
        const name = src.slice(j, k).toLowerCase();
        if (!closing && drop?.has(name)) {
            lower ??= src.toLowerCase();
            const needle = `</${name}`;
            let from = gt + 1;
            let end = -1;
            for (;;) {
                const at = lower.indexOf(needle, from);
                if (at === -1) break;
                let m = at + needle.length;
                while (m < n && isSpace(src.charCodeAt(m))) m++;
                if (src.charCodeAt(m) === 62 /* > */) {
                    end = m + 1;
                    break;
                }
                from = m > at + needle.length ? m : at + needle.length;
            }
            if (end === -1) return; // sin cierre: se descarta el resto
            i = end;
            continue;
        }
        onToken({ kind: 'tag', name, closing, attrs: gt - k > ATTRS_MAX ? src.slice(k, k + ATTRS_MAX) : src.slice(k, gt) });
        i = gt + 1;
    }
}

/** El valor de un atributo (`href="…"`, `alt='…'` o sin comillas), sin interpretar entidades. */
export function htmlAttr(attrs: string, name: 'href' | 'alt' | 'src', allowUnquoted = true): string | null {
    const bounded = attrs.length > ATTRS_MAX ? attrs.slice(0, ATTRS_MAX) : attrs;
    const lowerAttrs = bounded.toLowerCase();
    let from = 0;
    for (;;) {
        const at = lowerAttrs.indexOf(name, from);
        if (at === -1) return null;
        from = at + name.length;
        const before = at === 0 ? 32 : lowerAttrs.charCodeAt(at - 1);
        if (isNameChar(before) || before === 95) continue;
        let j = from;
        while (j < bounded.length && isSpace(bounded.charCodeAt(j))) j++;
        if (bounded.charCodeAt(j) !== 61 /* = */) continue;
        j++;
        while (j < bounded.length && isSpace(bounded.charCodeAt(j))) j++;
        const q = bounded.charCodeAt(j);
        if (q === 34 || q === 39) {
            const end = bounded.indexOf(q === 34 ? '"' : "'", j + 1);
            if (end === -1) {
                from = j + 1;
                continue;
            }
            return bounded.slice(j + 1, end);
        }
        if (!allowUnquoted) continue;
        let e = j;
        while (e < bounded.length && !isSpace(bounded.charCodeAt(e)) && bounded.charCodeAt(e) !== 62) e++;
        if (e === j) continue;
        return bounded.slice(j, e);
    }
}
