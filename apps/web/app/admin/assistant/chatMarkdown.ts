/**
 * v0.1.370 — Markdown de las respuestas del asistente, leído a una estructura
 * PURA que después dibuja React (`ChatMarkdown.tsx`). Nada pasa por
 * `innerHTML`: un texto que traiga etiquetas HTML se ve como texto. Cubre lo
 * que escriben los modelos: títulos, párrafos, listas (anidadas, numeradas y
 * de tareas), citas, tablas, bloques de código, líneas, negrita, cursiva,
 * tachado, código en línea y enlaces. Funciona con el texto a medio llegar
 * (streaming): un bloque de código sin cerrar se ve como código y una
 * negrita sin cerrar, como texto.
 */

export type Inline =
    | { t: 'text'; v: string }
    | { t: 'code'; v: string }
    | { t: 'strong' | 'em' | 'del'; c: Inline[] }
    | { t: 'link'; href: string; c: Inline[] }
    | { t: 'br' };

export interface ListItem {
    c: Inline[];
    /** null = no es una tarea; true/false = `[x]` / `[ ]`. */
    task: boolean | null;
    /** Lo que va adentro del ítem (listas anidadas, párrafos, código). */
    sub: Block[];
}

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
    | { t: 'p'; c: Inline[] }
    | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
    | { t: 'code'; lang: string; v: string; open: boolean }
    | { t: 'quote'; c: Block[] }
    | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
    | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
    | { t: 'hr' };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** Tope de profundidad (una lista anidada mil veces no cuelga la pestaña). */
const MAX_DEPTH = 8;

function leading(line: string): number {
    const m = /^[ \t]*/.exec(line)![0];
    return m.replace(/\t/g, '    ').length;
}

function isTableStart(lines: string[], i: number): boolean {
    const a = lines[i];
    const b = lines[i + 1];
    return a !== undefined && b !== undefined && a.includes('|') && TABLE_SEP.test(b) && b.includes('-');
}

function isBlockStart(lines: string[], i: number): boolean {
    const l = lines[i]!;
    return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || isTableStart(lines, i);
}

function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells: string[] = [];
    let cur = '';
    let inCode = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        if (ch === '\\' && s[i + 1] === '|') {
            cur += '|';
            i++;
            continue;
        }
        if (ch === '`') inCode = !inCode;
        if (ch === '|' && !inCode) {
            cells.push(cur.trim());
            cur = '';
            continue;
        }
        cur += ch;
    }
    cells.push(cur.trim());
    return cells;
}

function alignOf(cell: string): Align {
    const c = cell.trim();
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return null;
}

function dedent(lines: string[]): string[] {
    const sizes = lines.filter((l) => l.trim()).map(leading);
    const min = sizes.length ? Math.min(...sizes) : 0;
    return lines.map((l) => {
        let cut = 0;
        let col = 0;
        while (cut < l.length && col < min && (l[cut] === ' ' || l[cut] === '\t')) {
            col += l[cut] === '\t' ? 4 : 1;
            cut++;
        }
        return l.slice(cut);
    });
}

export function parseChatMarkdown(text: string, depth = 0): Block[] {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (!line.trim()) {
            i++;
            continue;
        }
        const fm = FENCE.exec(line);
        if (fm) {
            const fence = fm[1]!;
            const body: string[] = [];
            let closed = false;
            i++;
            while (i < lines.length) {
                const l = lines[i]!;
                if (new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(l)) {
                    closed = true;
                    i++;
                    break;
                }
                body.push(l);
                i++;
            }
            out.push({ t: 'code', lang: (fm[2] ?? '').toLowerCase(), v: body.join('\n'), open: !closed });
            continue;
        }
        const hm = HEADING.exec(line);
        if (hm) {
            const n = hm[1]!.length;
            out.push({ t: 'h', level: (n <= 1 ? 1 : n === 2 ? 2 : 3) as 1 | 2 | 3, c: parseInline(hm[2] ?? '') });
            i++;
            continue;
        }
        if (HR.test(line)) {
            out.push({ t: 'hr' });
            i++;
            continue;
        }
        if (QUOTE.test(line)) {
            const body: string[] = [];
            while (i < lines.length && lines[i]!.trim() && QUOTE.test(lines[i]!)) {
                body.push(lines[i]!.replace(QUOTE, ''));
                i++;
            }
            out.push({ t: 'quote', c: depth < MAX_DEPTH ? parseChatMarkdown(body.join('\n'), depth + 1) : [{ t: 'p', c: parseInline(body.join('\n')) }] });
            continue;
        }
        if (isTableStart(lines, i)) {
            const head = splitRow(line);
            const align = splitRow(lines[i + 1]!).map(alignOf);
            i += 2;
            const rows: Inline[][][] = [];
            while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
                const cells = splitRow(lines[i]!);
                rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
                i++;
            }
            out.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((h) => parseInline(h)), rows });
            continue;
        }
        if (LIST.test(line)) {
            const [block, next] = parseList(lines, i, depth);
            out.push(block);
            i = next;
            continue;
        }
        // Párrafo: hasta una línea en blanco o el comienzo de otro bloque.
        const para: string[] = [line.trim()];
        i++;
        while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines, i)) {
            para.push(lines[i]!.trim());
            i++;
        }
        out.push({ t: 'p', c: parseInline(para.join('\n')) });
    }
    return out;
}

function parseList(lines: string[], start: number, depth: number): [Block, number] {
    const first = LIST.exec(lines[start]!)!;
    const indent = leading(lines[start]!);
    const ordered = /\d/.test(first[2]!);
    const startNum = ordered ? Number.parseInt(first[2]!, 10) || 1 : 1;
    const items: ListItem[] = [];
    const sameKind = (m: RegExpExecArray | null, l: string): boolean => !!m && leading(l) === indent && /\d/.test(m[2]!) === ordered;
    const nextNonBlank = (k: number): number => {
        let j = k;
        while (j < lines.length && !lines[j]!.trim()) j++;
        return j;
    };
    let i = start;
    while (i < lines.length) {
        const l = lines[i]!;
        if (!l.trim()) {
            const j = nextNonBlank(i);
            if (j < lines.length && sameKind(LIST.exec(lines[j]!), lines[j]!)) {
                i = j;
                continue;
            }
            break;
        }
        const m = LIST.exec(l);
        if (!sameKind(m, l)) break;
        let content = m![3] ?? '';
        const sub: string[] = [];
        i++;
        while (i < lines.length) {
            const cl = lines[i]!;
            if (!cl.trim()) {
                const j = nextNonBlank(i);
                if (j < lines.length && leading(lines[j]!) > indent && !sameKind(LIST.exec(lines[j]!), lines[j]!)) {
                    sub.push('');
                    i++;
                    continue;
                }
                break;
            }
            const lead = leading(cl);
            if (lead > indent) {
                sub.push(cl);
                i++;
                continue;
            }
            if (LIST.test(cl) || isBlockStart(lines, i)) break;
            // Continuación «perezosa» del mismo ítem.
            content += `\n${cl.trim()}`;
            i++;
        }
        let task: boolean | null = null;
        const tm = /^\[( |x|X)\]\s+/.exec(content);
        if (tm) {
            task = tm[1] !== ' ';
            content = content.slice(tm[0].length);
        }
        items.push({
            c: parseInline(content),
            task,
            sub: sub.length && depth < MAX_DEPTH ? parseChatMarkdown(dedent(sub).join('\n'), depth + 1) : [],
        });
    }
    return [{ t: 'list', ordered, start: startNum, items }, i];
}

// ── Formato en línea ────────────────────────────────────────────────────

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|~>'.split(''));
const WORD = /[\p{L}\p{N}]/u;

function isWord(ch: string | undefined): boolean {
    return ch !== undefined && WORD.test(ch);
}

/** Busca el cierre de un delimitador; null si no hay uno válido. */
function findClose(s: string, from: number, delim: string, underscore: boolean): number | null {
    let i = from;
    while (i < s.length) {
        if (s[i] === '\\') {
            i += 2;
            continue;
        }
        if (s[i] === '`') {
            const run = /^`+/.exec(s.slice(i))![0];
            const end = s.indexOf(run, i + run.length);
            if (end < 0) return null;
            i = end + run.length;
            continue;
        }
        if (s.startsWith(delim, i) && i > from && s[i - 1] !== ' ' && s[i - 1] !== '\n') {
            // Una sola marca no debe cerrar sobre una doble (`*a **b** c*`).
            if (delim.length === 1 && s[i + 1] === delim) {
                i += 2;
                continue;
            }
            if (underscore && isWord(s[i + delim.length])) {
                i++;
                continue;
            }
            return i;
        }
        i++;
    }
    return null;
}

/** Recorta la puntuación final que casi nunca es parte de una dirección. */
function trimUrl(url: string): string {
    let u = url;
    while (/[.,;:!?)\]'"»]$/.test(u)) {
        if (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) >= (u.match(/\)/g)?.length ?? 0)) break;
        u = u.slice(0, -1);
    }
    return u;
}

export function parseInline(s: string): Inline[] {
    const out: Inline[] = [];
    let buf = '';
    const flush = (): void => {
        if (buf) out.push({ t: 'text', v: buf });
        buf = '';
    };
    let i = 0;
    while (i < s.length) {
        const ch = s[i]!;
        if (ch === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
            buf += s[i + 1];
            i += 2;
            continue;
        }
        if (ch === '\n') {
            flush();
            out.push({ t: 'br' });
            i++;
            continue;
        }
        if (ch === '`') {
            const run = /^`+/.exec(s.slice(i))![0];
            const end = s.indexOf(run, i + run.length);
            if (end > i) {
                flush();
                let code = s.slice(i + run.length, end);
                if (/^ .* $/.test(code)) code = code.slice(1, -1);
                out.push({ t: 'code', v: code });
                i = end + run.length;
                continue;
            }
            buf += run;
            i += run.length;
            continue;
        }
        const two = s.slice(i, i + 2);
        if (two === '**' || two === '__' || two === '~~') {
            const underscore = two === '__';
            if (!(underscore && isWord(s[i - 1])) && s[i + 2] !== ' ' && s[i + 2] !== undefined) {
                const close = findClose(s, i + 2, two, underscore);
                if (close !== null && close > i + 2) {
                    flush();
                    out.push({ t: two === '~~' ? 'del' : 'strong', c: parseInline(s.slice(i + 2, close)) });
                    i = close + 2;
                    continue;
                }
            }
        }
        if ((ch === '*' || ch === '_') && s[i + 1] !== ch) {
            const underscore = ch === '_';
            if (!(underscore && isWord(s[i - 1])) && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
                const close = findClose(s, i + 1, ch, underscore);
                if (close !== null && close > i + 1) {
                    flush();
                    out.push({ t: 'em', c: parseInline(s.slice(i + 1, close)) });
                    i = close + 1;
                    continue;
                }
            }
        }
        if (ch === '[') {
            const m = /^\[([^\]\n]+)\]\(\s*<?([^\s>)]+)>?(?:\s+"[^"]*")?\s*\)/.exec(s.slice(i));
            if (m) {
                flush();
                out.push({ t: 'link', href: m[2]!, c: parseInline(m[1]!) });
                i += m[0].length;
                continue;
            }
        }
        if ((ch === 'h' || ch === 'H') && !isWord(s[i - 1])) {
            const m = /^https?:\/\/[^\s<>`"]+/i.exec(s.slice(i));
            if (m) {
                const url = trimUrl(m[0]);
                flush();
                out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
                i += url.length;
                continue;
            }
        }
        buf += ch;
        i++;
    }
    flush();
    return out;
}

/** Qué hacer con un enlace: abrir afuera, navegar en la app o dejarlo como texto. */
export function chatLinkKind(href: string): 'external' | 'mail' | 'tel' | 'internal' | null {
    const h = href.trim();
    if (/^https?:\/\/[^\s]+$/i.test(h)) return 'external';
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return 'mail';
    if (/^tel:\+?[\d\s()-]{3,}$/i.test(h)) return 'tel';
    if (/^#?\/[^\s]*$/.test(h) && !h.startsWith('//') && !h.startsWith('#//')) return 'internal';
    return null;
}

/** El texto plano de un fragmento (para copiar el contenido de una celda, etc.). */
export function inlineText(nodes: Inline[]): string {
    return nodes
        .map((n) => {
            if (n.t === 'text' || n.t === 'code') return n.v;
            if (n.t === 'br') return '\n';
            return inlineText(n.c);
        })
        .join('');
}
