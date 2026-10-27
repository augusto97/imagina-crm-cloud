import type { RichMark, RichNode } from './rich-text';

/**
 * v0.1.281 — Texto con formato en una notación sencilla (un subconjunto de
 * Markdown) ⇄ el árbol ProseMirror que guardan los bloques de texto de los
 * correos y los PDF.
 *
 * Existe para el asistente y el MCP: un modelo escribe bien "**negrita**" y
 * "- viñeta", y armar a mano el árbol de nodos (con sus marcas) es frágil.
 * Lo que entiende:
 *  - párrafos separados por una línea en blanco; un salto simple = salto de línea;
 *  - `#`, `##`, `###` títulos; `- ` / `* ` viñetas; `1. ` numeradas; `> ` cita; `---` línea;
 *  - en línea: `**negrita**`, `*cursiva*`, `~~tachado~~`, `` `código` ``, `[texto](https://…)`.
 * Las variables `{{campo}}` son texto LITERAL (un `_` o un `*` adentro no
 * abre una marca): se reconocen antes que cualquier otra cosa.
 *
 * Lo que no se puede expresar acá (color de un tramo, tablas, menciones) no
 * se pierde en la ida y vuelta si nadie lo toca: `richDocToMarkdown` lo baja
 * a su texto, y quien necesita conservarlo manda el árbol (`doc`) tal cual.
 */

type Inline = RichNode;

const INLINE_RE = /\{\{[^}]*\}\}|\*\*(.+?)\*\*|~~(.+?)~~|\*(?!\s)(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/;

function withMark(nodes: Inline[], mark: RichMark): Inline[] {
    return nodes.map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), mark] } : n));
}

function parseInline(src: string): Inline[] {
    const out: Inline[] = [];
    let rest = src;
    while (rest.length > 0) {
        const m = INLINE_RE.exec(rest);
        if (!m) {
            out.push({ type: 'text', text: rest });
            break;
        }
        if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
        const whole = m[0];
        if (whole.startsWith('{{')) out.push({ type: 'text', text: whole });
        else if (m[1] !== undefined) out.push(...withMark(parseInline(m[1]), { type: 'bold' }));
        else if (m[2] !== undefined) out.push(...withMark(parseInline(m[2]), { type: 'strike' }));
        else if (m[3] !== undefined) out.push(...withMark(parseInline(m[3]), { type: 'italic' }));
        else if (m[4] !== undefined) out.push(...withMark(parseInline(m[4]), { type: 'link', attrs: { href: m[5] } }));
        // Código en línea: el texto va tal cual (adentro no se interpreta nada).
        else if (m[6] !== undefined) out.push({ type: 'text', text: m[6], marks: [{ type: 'code' }] });
        rest = rest.slice(m.index + whole.length);
    }
    // Junta tramos de texto vecinos con las mismas marcas.
    const merged: Inline[] = [];
    for (const n of out) {
        if (n.type === 'text' && n.text === '') continue;
        const prev = merged[merged.length - 1];
        if (prev && prev.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
            prev.text = `${prev.text ?? ''}${n.text ?? ''}`;
        } else merged.push({ ...n });
    }
    return merged;
}

/** Líneas de un párrafo: un salto simple es `hardBreak`. */
function inlineLines(lines: string[]): Inline[] {
    const out: Inline[] = [];
    lines.forEach((l, i) => {
        if (i > 0) out.push({ type: 'hardBreak' });
        out.push(...parseInline(l));
    });
    return out;
}

const para = (content: Inline[]): RichNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

export function markdownToRichDoc(md: string): RichNode {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const blocks: RichNode[] = [];
    let i = 0;
    const isBullet = (l: string): boolean => /^\s*[-*•]\s+/.test(l);
    const isOrdered = (l: string): boolean => /^\s*\d+[.)]\s+/.test(l);
    const isQuote = (l: string): boolean => /^\s*>\s?/.test(l);
    const isHeading = (l: string): boolean => /^\s*#{1,3}\s+/.test(l);
    const isRule = (l: string): boolean => /^\s*(-{3,}|\*{3,})\s*$/.test(l);
    const special = (l: string): boolean => isBullet(l) || isOrdered(l) || isQuote(l) || isHeading(l) || isRule(l);
    while (i < lines.length) {
        const line = lines[i]!;
        if (line.trim() === '') {
            i++;
            continue;
        }
        if (isRule(line)) {
            blocks.push({ type: 'horizontalRule' });
            i++;
            continue;
        }
        if (isHeading(line)) {
            const m = /^\s*(#{1,3})\s+(.*)$/.exec(line)!;
            const content = parseInline(m[2]!.trim());
            blocks.push({ type: 'heading', attrs: { level: m[1]!.length }, ...(content.length ? { content } : {}) });
            i++;
            continue;
        }
        if (isBullet(line) || isOrdered(line)) {
            const ordered = isOrdered(line);
            const items: RichNode[] = [];
            const start = ordered ? Number(/^\s*(\d+)/.exec(line)![1]) : 1;
            while (i < lines.length && (ordered ? isOrdered(lines[i]!) : isBullet(lines[i]!))) {
                const text = lines[i]!.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/, '');
                items.push({ type: 'listItem', content: [para(parseInline(text))] });
                i++;
            }
            blocks.push(
                ordered
                    ? { type: 'orderedList', ...(start !== 1 ? { attrs: { start } } : {}), content: items }
                    : { type: 'bulletList', content: items },
            );
            continue;
        }
        if (isQuote(line)) {
            const quoted: string[] = [];
            while (i < lines.length && isQuote(lines[i]!)) {
                quoted.push(lines[i]!.replace(/^\s*>\s?/, ''));
                i++;
            }
            const inner = markdownToRichDoc(quoted.join('\n')).content ?? [];
            blocks.push({ type: 'blockquote', content: inner.length ? inner : [para([])] });
            continue;
        }
        const chunk: string[] = [];
        while (i < lines.length && lines[i]!.trim() !== '' && (chunk.length === 0 || !special(lines[i]!))) {
            chunk.push(lines[i]!);
            i++;
        }
        blocks.push(para(inlineLines(chunk)));
    }
    return { type: 'doc', content: blocks.length ? blocks : [para([])] };
}

// ---------------------------------------------------------------------------

function inlineToMarkdown(nodes: RichNode[] | undefined): string {
    let out = '';
    for (const n of nodes ?? []) {
        if (n.type === 'hardBreak') {
            out += '\n';
            continue;
        }
        if (n.type !== 'text') {
            out += inlineToMarkdown(n.content);
            continue;
        }
        let t = n.text ?? '';
        const marks = n.marks ?? [];
        const has = (type: string): RichMark | undefined => marks.find((m) => m.type === type);
        if (has('code')) t = `\`${t}\``;
        if (has('bold')) t = `**${t}**`;
        if (has('italic')) t = `*${t}*`;
        if (has('strike')) t = `~~${t}~~`;
        const link = has('link');
        if (link && typeof link.attrs?.href === 'string') t = `[${t}](${link.attrs.href})`;
        out += t;
    }
    return out;
}

function blockToMarkdown(n: RichNode): string {
    switch (n.type) {
        case 'paragraph':
            return inlineToMarkdown(n.content);
        case 'heading': {
            const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 2)));
            return `${'#'.repeat(level)} ${inlineToMarkdown(n.content)}`;
        }
        case 'bulletList':
        case 'taskList':
            return (n.content ?? []).map((li) => `- ${(li.content ?? []).map(blockToMarkdown).join(' ')}`).join('\n');
        case 'orderedList': {
            const start = Number(n.attrs?.start ?? 1) || 1;
            return (n.content ?? []).map((li, k) => `${start + k}. ${(li.content ?? []).map(blockToMarkdown).join(' ')}`).join('\n');
        }
        case 'blockquote':
            return (n.content ?? [])
                .map(blockToMarkdown)
                .join('\n\n')
                .split('\n')
                .map((l) => `> ${l}`)
                .join('\n');
        case 'horizontalRule':
            return '---';
        default:
            return n.content ? n.content.map(blockToMarkdown).filter(Boolean).join('\n\n') : inlineToMarkdown([n]);
    }
}

export function richDocToMarkdown(doc: RichNode | null | undefined): string {
    if (!doc) return '';
    return (doc.content ?? [])
        .map(blockToMarkdown)
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
