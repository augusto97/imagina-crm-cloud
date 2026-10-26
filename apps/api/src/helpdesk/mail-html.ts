import { sanitizeRichDoc, type RichDoc, type RichMark, type RichNode } from '@imagina-base/shared';

/**
 * D2 — El HTML de un correo → la descripción del ticket (árbol ProseMirror).
 *
 * El HTML de un correo es lo menos confiable que entra a la app: viene de
 * cualquiera, con estilos, scripts, píxeles de seguimiento y tablas de
 * maquetación. No se guarda NADA de ese HTML: se lee como una secuencia de
 * etiquetas y se arma un documento nuevo con lo que la descripción sabe
 * mostrar — párrafos, títulos, listas, citas, negrita/cursiva/subrayado/
 * tachado y enlaces — y el resultado pasa por `sanitizeRichDoc` (la misma
 * puerta que una descripción escrita a mano: enlaces sólo http/mailto/tel,
 * topes de tamaño). Imágenes, estilos y formularios simplemente no existen.
 *
 * PURO (sin DOM): se testea con correos reales de Gmail y Outlook.
 */

/** Tope del HTML que se lee (un boletín de 2 MB no aporta nada a un ticket). */
const MAX_HTML = 400_000;

const NAMED: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    aacute: 'á',
    eacute: 'é',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
    Aacute: 'Á',
    Eacute: 'É',
    Iacute: 'Í',
    Oacute: 'Ó',
    Uacute: 'Ú',
    ntilde: 'ñ',
    Ntilde: 'Ñ',
    uuml: 'ü',
    Uuml: 'Ü',
    iexcl: '¡',
    iquest: '¿',
    laquo: '«',
    raquo: '»',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    euro: '€',
    copy: '©',
    reg: '®',
    middot: '·',
    bull: '•',
    deg: '°',
    ordf: 'ª',
    ordm: 'º',
};

export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,10});/g, (whole, ent: string) => {
        if (ent.startsWith('#x') || ent.startsWith('#X')) {
            const code = parseInt(ent.slice(2), 16);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        }
        if (ent.startsWith('#')) {
            const code = parseInt(ent.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        }
        return NAMED[ent] ?? whole;
    });
}

const BLOCK_TAGS = new Set([
    'p',
    'div',
    'section',
    'article',
    'header',
    'footer',
    'center',
    'main',
    'aside',
    'address',
    'tr',
    'table',
    'tbody',
    'thead',
    'tfoot',
    'form',
    'fieldset',
    'dl',
    'dt',
    'dd',
    'figure',
    'figcaption',
    'pre',
]);
const HEADING: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 3, h5: 3, h6: 3 };
const MARK_OF: Record<string, string> = {
    b: 'bold',
    strong: 'bold',
    i: 'italic',
    em: 'italic',
    cite: 'italic',
    u: 'underline',
    ins: 'underline',
    s: 'strike',
    strike: 'strike',
    del: 'strike',
    code: 'code',
    tt: 'code',
    kbd: 'code',
};
/** Lo que no aporta nada (y se descarta con todo su contenido). */
const DROP_WITH_CONTENT = /<(head|style|script|title|xml|noscript|template|svg|object|iframe|select|textarea|button)\b[\s\S]*?<\/\1\s*>/gi;

type Container = { kind: 'root'; content: RichNode[] } | { kind: 'list'; node: RichNode } | { kind: 'item'; node: RichNode } | { kind: 'quote'; node: RichNode };

/** Lee el `href` de los atributos de una etiqueta `<a …>`. */
function hrefOf(attrs: string): string | null {
    const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
    const v = decodeEntities(raw).trim();
    return v !== '' ? v : null;
}

export function htmlToRichDoc(html: string): RichDoc | null {
    const src = html
        .slice(0, MAX_HTML)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(DROP_WITH_CONTENT, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replace(/<!doctype[^>]*>/gi, '');

    const root: Container = { kind: 'root', content: [] };
    const stack: Container[] = [root];
    let inline: RichNode[] = [];
    let heading: number | null = null;
    const marks: Array<{ tag: string; mark: RichMark }> = [];
    let pre = 0;

    const target = (): RichNode[] => {
        for (let i = stack.length - 1; i >= 0; i--) {
            const c = stack[i]!;
            if (c.kind === 'root') return c.content;
            if (c.kind === 'item' || c.kind === 'quote') return (c.node.content ??= []);
            if (c.kind === 'list') {
                // Texto suelto dentro de una lista sin <li>: se le arma un ítem.
                const item: RichNode = { type: 'listItem', content: [] };
                (c.node.content ??= []).push(item);
                stack.push({ kind: 'item', node: item });
                return item.content!;
            }
        }
        return root.content;
    };

    const flush = (): void => {
        // Sin espacios ni saltos colgados al principio y al final del bloque.
        while (inline.length > 0 && (inline[0]!.type === 'hardBreak' || (inline[0]!.type === 'text' && (inline[0]!.text ?? '').trim() === ''))) inline.shift();
        while (
            inline.length > 0 &&
            (inline[inline.length - 1]!.type === 'hardBreak' || (inline[inline.length - 1]!.type === 'text' && (inline[inline.length - 1]!.text ?? '').trim() === ''))
        ) {
            inline.pop();
        }
        if (inline.length > 0) {
            const first = inline[0]!;
            if (first.type === 'text') first.text = (first.text ?? '').replace(/^\s+/, '');
            const last = inline[inline.length - 1]!;
            if (last.type === 'text') last.text = (last.text ?? '').replace(/\s+$/, '');
            const content = inline.filter((n) => n.type !== 'text' || (n.text ?? '') !== '');
            if (content.length > 0) {
                target().push(heading !== null ? { type: 'heading', attrs: { level: heading }, content } : { type: 'paragraph', content });
            }
        }
        inline = [];
        heading = null;
    };

    const pushText = (raw: string): void => {
        let text = decodeEntities(raw);
        if (pre === 0) text = text.replace(/\s+/g, ' ');
        if (text === '') return;
        // Un espacio al empezar el bloque no aporta.
        if (inline.length === 0 && text.trim() === '') return;
        const activeMarks = dedupeMarks(marks.map((m) => m.mark));
        if (pre > 0 && text.includes('\n')) {
            text.split('\n').forEach((part, i) => {
                if (i > 0) inline.push({ type: 'hardBreak' });
                if (part !== '') inline.push(withMarks({ type: 'text', text: part }, activeMarks));
            });
            return;
        }
        inline.push(withMarks({ type: 'text', text }, activeMarks));
    };

    const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>|([^<]+)|</g;
    for (const m of src.matchAll(re)) {
        if (m[4] !== undefined) {
            pushText(m[4]);
            continue;
        }
        if (m[2] === undefined) {
            pushText('<');
            continue;
        }
        const closing = m[1] === '/';
        const tag = m[2].toLowerCase();
        const attrs = m[3] ?? '';
        const selfClosing = /\/\s*$/.test(attrs);

        if (tag === 'br') {
            inline.push({ type: 'hardBreak' });
            continue;
        }
        if (tag === 'hr') {
            flush();
            target().push({ type: 'horizontalRule' });
            continue;
        }
        if (tag === 'img') {
            // Las imágenes no se traen (píxeles de seguimiento); el alt sí, si dice algo.
            const alt = /\balt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
            const text = alt ? decodeEntities(alt[2] ?? alt[3] ?? '').trim() : '';
            if (text !== '' && text.length <= 80) pushText(` [${text}] `);
            continue;
        }
        if (tag in HEADING) {
            flush();
            if (!closing) heading = HEADING[tag]!;
            continue;
        }
        if (tag === 'ul' || tag === 'ol') {
            flush();
            if (!closing) {
                const node: RichNode = { type: tag === 'ul' ? 'bulletList' : 'orderedList', content: [] };
                target().push(node);
                stack.push({ kind: 'list', node });
            } else {
                popUntil(stack, 'list');
            }
            continue;
        }
        if (tag === 'li') {
            flush();
            if (!closing) {
                // Un <li> sin lista abierta: se arma una de viñetas.
                if (!stack.some((c) => c.kind === 'list')) {
                    const node: RichNode = { type: 'bulletList', content: [] };
                    target().push(node);
                    stack.push({ kind: 'list', node });
                }
                // Cerrar el ítem anterior si quedó abierto (<li> sin </li>).
                if (stack[stack.length - 1]!.kind === 'item') stack.pop();
                const list = stack[stack.length - 1]!;
                const item: RichNode = { type: 'listItem', content: [] };
                if (list.kind === 'list') (list.node.content ??= []).push(item);
                stack.push({ kind: 'item', node: item });
            } else {
                popUntil(stack, 'item');
            }
            continue;
        }
        if (tag === 'blockquote') {
            flush();
            if (!closing) {
                const node: RichNode = { type: 'blockquote', content: [] };
                target().push(node);
                stack.push({ kind: 'quote', node });
            } else {
                popUntil(stack, 'quote');
            }
            continue;
        }
        if (tag === 'td' || tag === 'th') {
            // Las tablas de maquetación se leen como texto corrido.
            if (closing) pushText(' ');
            continue;
        }
        if (BLOCK_TAGS.has(tag)) {
            if (tag === 'pre') pre = closing ? Math.max(0, pre - 1) : pre + 1;
            flush();
            continue;
        }
        const markType = tag === 'a' ? 'link' : MARK_OF[tag];
        if (markType) {
            if (closing) {
                const idx = findLastIndex(marks, (x) => x.tag === tag);
                if (idx >= 0) marks.splice(idx, 1);
            } else if (!selfClosing) {
                if (markType === 'link') {
                    const href = hrefOf(attrs);
                    if (href) marks.push({ tag, mark: { type: 'link', attrs: { href } } });
                    else marks.push({ tag, mark: { type: '__none' } });
                } else {
                    marks.push({ tag, mark: { type: markType } });
                }
            }
            continue;
        }
        // Cualquier otra etiqueta (span, font, o:p…) no aporta estructura.
    }
    flush();
    return sanitizeRichDoc({ type: 'doc', content: root.content.length > 0 ? cleanEmpty(root.content) : [] });
}

function popUntil(stack: Container[], kind: Container['kind']): void {
    for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.kind === kind) {
            stack.length = i;
            return;
        }
    }
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
    return -1;
}

function dedupeMarks(list: RichMark[]): RichMark[] {
    const out: RichMark[] = [];
    for (const m of list) {
        if (m.type === '__none') continue;
        const i = out.findIndex((x) => x.type === m.type);
        if (i >= 0) out[i] = m;
        else out.push(m);
    }
    return out;
}

function withMarks(node: RichNode, marks: RichMark[]): RichNode {
    return marks.length > 0 ? { ...node, marks: marks.map((m) => ({ ...m })) } : node;
}

/** Listas, ítems y citas que quedaron sin contenido se descartan. */
function cleanEmpty(nodes: RichNode[]): RichNode[] {
    const out: RichNode[] = [];
    for (const n of nodes) {
        if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'listItem' || n.type === 'blockquote') {
            const content = cleanEmpty(n.content ?? []);
            if (content.length === 0) continue;
            // Un ítem tiene que empezar con un párrafo (ProseMirror).
            if (n.type === 'listItem' && content[0]!.type !== 'paragraph') content.unshift({ type: 'paragraph' });
            out.push({ ...n, content });
            continue;
        }
        out.push(n);
    }
    return out;
}

/** Texto plano → documento: un párrafo por bloque, un salto simple es `hardBreak`. */
export function textToRichDoc(text: string): RichDoc | null {
    const blocks = text
        .replace(/\r\n?/g, '\n')
        .slice(0, MAX_HTML)
        .split(/\n\s*\n/)
        .map((b) => b.replace(/^\n+|\n+$/g, ''))
        .filter((b) => b.trim() !== '');
    const content: RichNode[] = blocks.map((b) => {
        const lines = b.split('\n');
        const inline: RichNode[] = [];
        lines.forEach((l, i) => {
            if (i > 0) inline.push({ type: 'hardBreak' });
            if (l !== '') inline.push({ type: 'text', text: l });
        });
        return { type: 'paragraph', content: inline };
    });
    return sanitizeRichDoc({ type: 'doc', content });
}
