import type { RichMark, RichNode } from './rich-text';

/**
 * v0.1.420 — La versión PÚBLICA de un documento de la app (la descripción de
 * un registro) para mostrarla fuera de la app: la ficha de un producto de la
 * tienda.
 *
 * Sólo pasa lo que tiene sentido para alguien de afuera: texto con formato,
 * títulos, listas, citas, código, tablas, columnas e imágenes SUBIDAS a la
 * app (con la clave con que la página las pide). Lo interno se cae: las
 * menciones a personas y equipos del equipo, los adjuntos, el índice. Un
 * video insertado queda como un enlace (la página pública no carga marcos de
 * otros sitios).
 *
 * Sin zod: lo importa la página pública. PURO y defensivo: el documento ya
 * viene saneado (`sanitizeRichDoc`), pero se vuelve a revisar cada enlace y
 * cada color, porque esto sale a internet.
 */

export interface PublicRichOptions {
    /** La clave pública de una imagen subida (null = no se muestra). */
    imageKey: (fileId: number) => string | null;
    /** Techo de nodos (un documento enorme no hace una respuesta enorme). */
    maxNodes?: number;
}

/** Tipos que dibuja la página pública. */
export const PUBLIC_RICH_NODES = [
    'doc',
    'paragraph',
    'heading',
    'text',
    'hardBreak',
    'bulletList',
    'orderedList',
    'listItem',
    'taskList',
    'taskItem',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'table',
    'tableRow',
    'tableHeader',
    'tableCell',
    'columnsBlock',
    'column',
    'image',
] as const;

const KEEP = new Set<string>(PUBLIC_RICH_NODES);
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EMBED_LABELS: Record<string, string> = {
    youtube: 'Ver el video en YouTube',
    vimeo: 'Ver el video en Vimeo',
    loom: 'Ver el video en Loom',
    figma: 'Ver el diseño en Figma',
    gdrive: 'Abrir en Google Drive',
};

/** Un enlace que se puede abrir desde afuera: http(s), correo o teléfono. */
export function publicLinkHref(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const url = raw.trim();
    if (url === '' || url.length > 2048) return null;
    // eslint-disable-next-line no-control-regex -- buscar caracteres de control ES el punto
    if (/[\u0000-\u001f\u007f\s]/.test(url)) return null;
    return /^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : null;
}

function cleanMarks(marks: RichMark[] | undefined): RichMark[] | undefined {
    if (!Array.isArray(marks)) return undefined;
    const out: RichMark[] = [];
    for (const m of marks) {
        if (!m || typeof m.type !== 'string') continue;
        switch (m.type) {
            case 'bold':
            case 'italic':
            case 'underline':
            case 'strike':
            case 'code':
                out.push({ type: m.type });
                break;
            case 'link': {
                const href = publicLinkHref(m.attrs?.href);
                if (href) out.push({ type: 'link', attrs: { href } });
                break;
            }
            case 'textStyle':
            case 'highlight': {
                const color = typeof m.attrs?.color === 'string' && COLOR.test(m.attrs.color) ? m.attrs.color : null;
                if (color) out.push({ type: m.type, attrs: { color } });
                break;
            }
            default:
                break;
        }
    }
    return out.length > 0 ? out : undefined;
}

function textNode(text: string, marks?: RichMark[]): RichNode {
    return marks ? { type: 'text', text, marks } : { type: 'text', text };
}

/**
 * El documento listo para la página pública, o null si no queda nada que
 * mostrar.
 */
export function publicRichDoc(doc: RichNode | null | undefined, opts: PublicRichOptions): RichNode | null {
    if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return null;
    const max = opts.maxNodes ?? 3000;
    let count = 0;

    const walk = (node: RichNode, depth: number): RichNode | RichNode[] | null => {
        if (count >= max || depth > 12 || !node || typeof node.type !== 'string') return null;
        count++;
        switch (node.type) {
            case 'text': {
                const text = typeof node.text === 'string' ? node.text : '';
                return text === '' ? null : textNode(text, cleanMarks(node.marks));
            }
            case 'mentionRecord': {
                // Otro registro: sólo su nombre, como texto.
                const label = typeof node.attrs?.label === 'string' ? node.attrs.label.trim() : '';
                return label ? textNode(label) : null;
            }
            case 'mentionUser':
            case 'mentionTeam':
            case 'fileBlock':
            case 'tocBlock':
                // Personas y equipos del equipo, adjuntos internos y el índice: no salen.
                return null;
            case 'imageBlock': {
                const fileId = Number(node.attrs?.fileId);
                const key = Number.isSafeInteger(fileId) && fileId > 0 ? opts.imageKey(fileId) : null;
                if (!key) return null;
                const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt.slice(0, 200) : '';
                return { type: 'image', attrs: { src: key, alt } };
            }
            case 'embedBlock': {
                const href = publicLinkHref(node.attrs?.url);
                if (!href || !/^https:\/\//i.test(href)) return null;
                const provider = typeof node.attrs?.provider === 'string' ? node.attrs.provider : '';
                return { type: 'paragraph', content: [textNode(EMBED_LABELS[provider] ?? 'Abrir el enlace', [{ type: 'link', attrs: { href } }])] };
            }
            default:
                break;
        }
        if (!KEEP.has(node.type)) return null;
        const out: RichNode = { type: node.type };
        if (node.type === 'heading') {
            const level = Number(node.attrs?.level);
            out.attrs = { level: level >= 1 && level <= 3 ? Math.floor(level) : 2 };
        } else if (node.type === 'orderedList') {
            const start = Number(node.attrs?.start);
            if (Number.isInteger(start) && start > 1 && start < 100_000) out.attrs = { start };
        } else if (node.type === 'taskItem') {
            out.attrs = { checked: node.attrs?.checked === true };
        } else if ((node.type === 'tableCell' || node.type === 'tableHeader') && node.attrs) {
            const colspan = Number(node.attrs.colspan);
            const rowspan = Number(node.attrs.rowspan);
            const attrs: Record<string, unknown> = {};
            if (Number.isInteger(colspan) && colspan > 1 && colspan <= 50) attrs.colspan = colspan;
            if (Number.isInteger(rowspan) && rowspan > 1 && rowspan <= 50) attrs.rowspan = rowspan;
            if (Object.keys(attrs).length > 0) out.attrs = attrs;
        }
        if (Array.isArray(node.content)) {
            const kids: RichNode[] = [];
            for (const c of node.content) {
                const r = walk(c, depth + 1);
                if (Array.isArray(r)) kids.push(...r);
                else if (r) kids.push(r);
            }
            if (kids.length > 0) out.content = kids;
        }
        // Una lista, tabla o columna sin hijos no dibuja nada.
        if (!out.content && ['bulletList', 'orderedList', 'taskList', 'table', 'tableRow', 'columnsBlock', 'column', 'blockquote'].includes(out.type)) return null;
        return out;
    };

    const root = walk(doc, 0);
    if (!root || Array.isArray(root) || !root.content || !hasVisible(root)) return null;
    return root;
}

function hasVisible(node: RichNode): boolean {
    if (node.type === 'text') return (node.text ?? '').trim() !== '';
    if (node.type === 'image' || node.type === 'horizontalRule') return true;
    return (node.content ?? []).some(hasVisible);
}

/** Las imágenes subidas de un documento (los `fileId` de sus bloques de imagen). */
export function richDocImageFileIds(doc: RichNode | null | undefined, max = 40): number[] {
    const out: number[] = [];
    const walk = (n: RichNode | undefined): void => {
        if (!n || out.length >= max) return;
        if (n.type === 'imageBlock') {
            const id = Number(n.attrs?.fileId);
            if (Number.isSafeInteger(id) && id > 0 && !out.includes(id)) out.push(id);
        }
        for (const c of n.content ?? []) walk(c);
    };
    walk(doc ?? undefined);
    return out;
}
