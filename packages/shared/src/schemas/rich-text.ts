import { z } from 'zod';

/**
 * Documento de texto enriquecido (v0.1.133) — la "descripción" de un registro.
 *
 * El formato es el árbol de ProseMirror (lo que emite/consume el editor del
 * front): `{ type, attrs?, content?, marks?, text? }`. Guardamos el ÁRBOL, no
 * HTML: el HTML habría que sanitizarlo en cada render y cualquier atributo
 * nuevo sería una superficie de ataque; con el árbol, lo que no está en esta
 * whitelist simplemente no existe.
 *
 * `sanitizeRichDoc` es la puerta de entrada: corre en el BACKEND antes de
 * persistir (nunca confiar en el cliente) y también sirve al front para
 * normalizar lo que pega el usuario.
 */

export interface RichMark {
    type: string;
    attrs?: Record<string, unknown>;
}

export interface RichNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: RichNode[];
    marks?: RichMark[];
    text?: string;
}

export type RichDoc = RichNode;

/** Nodos permitidos y qué atributos conserva cada uno. */
const NODE_ATTRS: Record<string, readonly string[]> = {
    doc: [],
    paragraph: [],
    heading: ['level'],
    text: [],
    hardBreak: [],
    bulletList: [],
    orderedList: ['start'],
    listItem: [],
    taskList: [],
    taskItem: ['checked'],
    blockquote: [],
    codeBlock: ['language'],
    horizontalRule: [],
    table: [],
    tableRow: [],
    // Bloques "vivos" (v0.1.134): apuntan a entidades de la app por ID, no a
    // contenido pegado. El render los resuelve; acá sólo se guarda el vínculo.
    mentionUser: ['id', 'label'],
    mentionRecord: ['id', 'listSlug', 'label'],
    imageBlock: ['fileId', 'src', 'alt', 'width'],
    fileBlock: ['fileId', 'name', 'size'],
    tableHeader: ['colspan', 'rowspan', 'colwidth'],
    tableCell: ['colspan', 'rowspan', 'colwidth'],
};

/** Marcas (formato inline) permitidas. */
const MARK_ATTRS: Record<string, readonly string[]> = {
    bold: [],
    italic: [],
    strike: [],
    underline: [],
    code: [],
    link: ['href', 'target', 'rel'],
    textStyle: ['color', 'backgroundColor'],
    highlight: ['color'],
};

/** Techos duros: un documento no puede tumbar al servidor ni al navegador. */
export const RICH_DOC_MAX_NODES = 5000;
export const RICH_DOC_MAX_DEPTH = 12;
export const RICH_DOC_MAX_TEXT = 20_000;
/** Tamaño serializado máximo (≈ el "peso" de la descripción en la fila). */
export const RICH_DOC_MAX_BYTES = 512 * 1024;

/** Nodos que sin atributos válidos no tienen sentido (se descartan). */
const ATOMIC_WITH_ATTRS = new Set(['mentionUser', 'mentionRecord', 'imageBlock', 'fileBlock']);

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * URL segura para el `href` de un enlace. Acepta http(s), mailto, tel y
 * rutas relativas; cualquier otro esquema (`javascript:`, `data:`…) devuelve
 * null y la marca se descarta — un enlace inerte es preferible a uno que
 * ejecuta código en la sesión de otro miembro.
 */
export function safeLinkHref(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const url = raw.trim();
    if (url === '' || url.length > 2048) return null;
    // Control chars (incluye el clásico `java\tscript:`).
    // eslint-disable-next-line no-control-regex -- buscar control chars ES el punto
    if (/[\u0000-\u001f\u007f]/.test(url)) return null;

    const colon = url.indexOf(':');
    if (colon === -1) return url; // relativa

    const before = url.slice(0, colon).toLowerCase();
    const firstPathChar = Math.min(
        ...['/', '?', '#'].map((c) => {
            const i = url.indexOf(c);
            return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        }),
    );
    if (firstPathChar < colon) return url; // `path/a:b` → relativa

    return ['http', 'https', 'mailto', 'tel'].includes(before) ? url : null;
}

function cleanAttrs(
    type: string,
    raw: unknown,
    allowed: readonly string[],
): Record<string, unknown> | undefined {
    if (allowed.length === 0 || raw === null || typeof raw !== 'object') return undefined;
    const src = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const key of allowed) {
        const value = src[key];
        if (value === undefined || value === null) continue;

        switch (key) {
            case 'level': {
                const n = Number(value);
                if (Number.isInteger(n) && n >= 1 && n <= 4) out[key] = n;
                break;
            }
            case 'start':
            case 'colspan':
            case 'rowspan': {
                const n = Number(value);
                if (Number.isInteger(n) && n >= 1 && n <= 1000) out[key] = n;
                break;
            }
            case 'colwidth': {
                if (Array.isArray(value)) {
                    const widths = value
                        .map((w) => Number(w))
                        .filter((w) => Number.isFinite(w) && w > 0 && w <= 2000);
                    if (widths.length > 0) out[key] = widths;
                }
                break;
            }
            case 'checked': {
                out[key] = value === true || value === 'true';
                break;
            }
            case 'language': {
                if (typeof value === 'string' && /^[a-zA-Z0-9+#_-]{1,30}$/.test(value)) {
                    out[key] = value;
                }
                break;
            }
            case 'id':
            case 'fileId': {
                const n = Number(value);
                if (Number.isInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER) out[key] = n;
                break;
            }
            case 'width': {
                const n = Number(value);
                if (Number.isFinite(n) && n >= 40 && n <= 2000) out[key] = Math.round(n);
                break;
            }
            case 'size': {
                const n = Number(value);
                if (Number.isInteger(n) && n >= 0) out[key] = n;
                break;
            }
            case 'label':
            case 'name':
            case 'alt': {
                if (typeof value === 'string' && value !== '') out[key] = value.slice(0, 190);
                break;
            }
            case 'listSlug': {
                if (typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value)) out[key] = value;
                break;
            }
            case 'src': {
                const src = safeLinkHref(value);
                if (src !== null) out[key] = src;
                break;
            }
            case 'href': {
                const href = safeLinkHref(value);
                if (href !== null) out[key] = href;
                break;
            }
            case 'target': {
                if (value === '_blank' || value === '_self') out[key] = value;
                break;
            }
            case 'rel': {
                // Nunca se conserva lo que mande el cliente: si el enlace abre
                // en pestaña nueva, el rel lo fija el render.
                break;
            }
            case 'color':
            case 'backgroundColor': {
                if (typeof value === 'string' && HEX_COLOR.test(value.trim())) {
                    out[key] = value.trim().toLowerCase();
                }
                break;
            }
            default:
                break;
        }
    }
    // Un enlace sin href no es un enlace.
    if (type === 'link' && out.href === undefined) return undefined;
    // Ídem los bloques vivos: sin la referencia no hay qué resolver.
    if ((type === 'mentionUser' || type === 'mentionRecord') && out.id === undefined) return undefined;
    if (type === 'fileBlock' && out.fileId === undefined) return undefined;
    if (type === 'imageBlock' && out.fileId === undefined && out.src === undefined) return undefined;
    return Object.keys(out).length > 0 ? out : undefined;
}

function cleanMarks(raw: unknown): RichMark[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: RichMark[] = [];
    for (const m of raw.slice(0, 20)) {
        if (m === null || typeof m !== 'object') continue;
        const type = (m as RichMark).type;
        if (typeof type !== 'string') continue;
        const allowed = MARK_ATTRS[type];
        if (allowed === undefined) continue;
        const attrs = cleanAttrs(type, (m as RichMark).attrs, allowed);
        if (type === 'link' && attrs === undefined) continue; // href inseguro
        out.push(attrs === undefined ? { type } : { type, attrs });
    }
    return out.length > 0 ? out : undefined;
}

interface CleanState {
    nodes: number;
}

function cleanNode(raw: unknown, depth: number, state: CleanState): RichNode | null {
    if (raw === null || typeof raw !== 'object') return null;
    if (depth > RICH_DOC_MAX_DEPTH) return null;
    if (state.nodes >= RICH_DOC_MAX_NODES) return null;

    const node = raw as RichNode;
    if (typeof node.type !== 'string') return null;
    const allowed = NODE_ATTRS[node.type];
    if (allowed === undefined) return null; // tipo desconocido → fuera

    state.nodes += 1;
    const out: RichNode = { type: node.type };

    if (node.type === 'text') {
        if (typeof node.text !== 'string' || node.text === '') return null;
        out.text = node.text.slice(0, RICH_DOC_MAX_TEXT);
        const marks = cleanMarks(node.marks);
        if (marks !== undefined) out.marks = marks;
        return out;
    }

    const attrs = cleanAttrs(node.type, node.attrs, allowed);
    if (attrs !== undefined) out.attrs = attrs;
    else if (ATOMIC_WITH_ATTRS.has(node.type)) return null;

    if (Array.isArray(node.content)) {
        const content: RichNode[] = [];
        for (const child of node.content) {
            const cleaned = cleanNode(child, depth + 1, state);
            if (cleaned !== null) content.push(cleaned);
        }
        if (content.length > 0) out.content = content;
    }
    return out;
}

/**
 * Normaliza lo que llega del cliente a un documento válido, o `null` si no
 * hay nada que guardar. Un documento vacío (párrafo sin texto) es `null` a
 * propósito: así `has_description` no miente en el listado.
 */
export function sanitizeRichDoc(input: unknown): RichDoc | null {
    if (input === null || input === undefined) return null;
    const cleaned = cleanNode(input, 0, { nodes: 0 });
    if (cleaned === null || cleaned.type !== 'doc') return null;
    if (isEmptyRichDoc(cleaned)) return null;
    if (JSON.stringify(cleaned).length > RICH_DOC_MAX_BYTES) return null;
    return cleaned;
}

/** ¿El documento no aporta nada? (sin texto y sin nodos "con cuerpo"). */
export function isEmptyRichDoc(doc: RichDoc | null | undefined): boolean {
    if (doc === null || doc === undefined) return true;
    const ATOMS = new Set([
        'horizontalRule',
        'table',
        'taskItem',
        'codeBlock',
        'imageBlock',
        'fileBlock',
        'mentionUser',
        'mentionRecord',
    ]);
    let empty = true;
    const walk = (node: RichNode): void => {
        if (!empty) return;
        if (node.type === 'text' && typeof node.text === 'string' && node.text.trim() !== '') {
            empty = false;
            return;
        }
        if (ATOMS.has(node.type)) {
            empty = false;
            return;
        }
        for (const child of node.content ?? []) walk(child);
    };
    walk(doc);
    return empty;
}

/** Proyección a texto plano (previews, búsqueda, bitácora). */
export function richDocToPlainText(doc: RichDoc | null | undefined, limit = 5000): string {
    if (doc === null || doc === undefined) return '';
    const parts: string[] = [];
    let length = 0;
    const BLOCKS = new Set([
        'paragraph',
        'heading',
        'listItem',
        'taskItem',
        'blockquote',
        'codeBlock',
        'tableRow',
    ]);
    const walk = (node: RichNode): void => {
        if (length >= limit) return;
        if (node.type === 'text' && typeof node.text === 'string') {
            parts.push(node.text);
            length += node.text.length;
            return;
        }
        for (const child of node.content ?? []) walk(child);
        if (BLOCKS.has(node.type)) parts.push('\n');
    };
    walk(doc);
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
}

/**
 * Schema Zod del documento. Es deliberadamente PERMISIVO en la forma (el
 * filtrado fino lo hace `sanitizeRichDoc`, que es quien decide qué se
 * persiste); acá sólo se acota el tamaño para que un payload absurdo no
 * llegue siquiera a parsearse en profundidad.
 */
const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
    z.object({
        type: z.string().max(40),
        attrs: z.record(z.string(), z.unknown()).optional(),
        content: z.array(richNodeSchema).optional(),
        marks: z
            .array(z.object({ type: z.string().max(40), attrs: z.record(z.string(), z.unknown()).optional() }))
            .optional(),
        text: z.string().optional(),
    }),
);

export const richDocSchema = richNodeSchema.superRefine((doc, ctx) => {
    if (JSON.stringify(doc).length > RICH_DOC_MAX_BYTES) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'La descripción es demasiado grande (máx. 512 KB).',
        });
    }
});

/** Body de `PATCH /lists/:list/records/:id/description`. */
export const updateRecordDescriptionSchema = z.object({
    /** `null` borra la descripción. */
    description: richDocSchema.nullable(),
});
export type UpdateRecordDescriptionInput = z.infer<typeof updateRecordDescriptionSchema>;

/**
 * IDs de usuario mencionados en el documento (v0.1.134).
 *
 * La mención NO se busca por texto: es un nodo con el id de la persona, así
 * que renombrar a alguien no rompe el vínculo (misma lógica que las claves
 * `f{field_id}` — el ID es la verdad, la etiqueta es humana).
 */
export function collectMentionedUserIds(doc: RichDoc | null | undefined): number[] {
    const out = new Set<number>();
    const walk = (node: RichNode): void => {
        if (node.type === 'mentionUser') {
            const id = Number((node.attrs as { id?: unknown } | undefined)?.id);
            if (Number.isInteger(id) && id > 0) out.add(id);
        }
        for (const child of node.content ?? []) walk(child);
    };
    if (doc) walk(doc);
    return [...out];
}

/** IDs de los archivos referenciados (imágenes y adjuntos) del documento. */
export function collectFileIds(doc: RichDoc | null | undefined): number[] {
    const out = new Set<number>();
    const walk = (node: RichNode): void => {
        if (node.type === 'imageBlock' || node.type === 'fileBlock') {
            const id = Number((node.attrs as { fileId?: unknown } | undefined)?.fileId);
            if (Number.isInteger(id) && id > 0) out.add(id);
        }
        for (const child of node.content ?? []) walk(child);
    };
    if (doc) walk(doc);
    return [...out];
}
