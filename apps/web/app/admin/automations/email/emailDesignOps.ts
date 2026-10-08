import {
    emailTextDoc,
    type EmailBlock,
    type EmailBlockType,
    type EmailDesign,
    type EmailInnerBlock,
    type EmailInnerBlockType,
} from '@imagina-base/shared';

/**
 * v0.1.265 — Operaciones PURAS del editor de correos (ADR-S34): todas
 * devuelven un diseño nuevo, así el historial de deshacer/rehacer es una pila
 * de valores. Los bloques dentro de una columna se direccionan por su `id`
 * igual que los de primer nivel (un id es único en todo el diseño).
 */

let seq = 0;
export function newBlockId(): string {
    seq = (seq + 1) % 1_000_000;
    return `b${Date.now().toString(36)}${seq.toString(36)}`;
}

export const INNER_BLOCK_TYPES: readonly EmailInnerBlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];

/** Bloque nuevo con valores por defecto razonables. */
export function makeBlock(type: EmailBlockType): EmailBlock {
    const id = newBlockId();
    switch (type) {
        case 'heading':
            return { id, type, text: 'Título', level: 2, align: 'left' };
        case 'text':
            return { id, type, doc: emailTextDoc('Escribí acá tu mensaje.'), align: 'left', size: 'md' };
        case 'button':
            return { id, type, label: 'Ver más', url: 'https://', align: 'center', full_width: false };
        case 'image':
            return { id, type, src: '', alt: '', width: 100, align: 'center', link: '', bleed: false };
        case 'divider':
            return { id, type, thickness: 1 };
        case 'spacer':
            return { id, type, height: 24 };
        case 'fields':
            return { id, type, title: '', slugs: [], layout: 'table' };
        case 'signature':
            return { id, type };
        case 'html':
            return { id, type, html: '' };
        case 'columns':
            return {
                id,
                type,
                columns: [
                    { blocks: [makeInner('heading'), makeInner('text')] },
                    { blocks: [makeInner('heading'), makeInner('text')] },
                ],
            };
    }
}

export function makeInner(type: EmailInnerBlockType): EmailInnerBlock {
    const b = makeBlock(type);
    if (b.type === 'heading') return { ...b, level: 3 };
    return b as EmailInnerBlock;
}

/** Copia profunda con ids nuevos (duplicar). */
function cloneWithIds<T extends EmailBlock | EmailInnerBlock>(b: T): T {
    const copy = JSON.parse(JSON.stringify(b)) as T;
    copy.id = newBlockId();
    if (copy.type === 'columns') {
        for (const c of copy.columns) c.blocks = c.blocks.map((x) => cloneWithIds(x));
    }
    return copy;
}

export interface BlockLocation {
    /** null = primer nivel. */
    parentId: string | null;
    columnIndex: number | null;
    index: number;
}

export function locate(design: EmailDesign, id: string): BlockLocation | null {
    const top = design.blocks.findIndex((b) => b.id === id);
    if (top >= 0) return { parentId: null, columnIndex: null, index: top };
    for (const b of design.blocks) {
        if (b.type !== 'columns') continue;
        for (let ci = 0; ci < b.columns.length; ci++) {
            const idx = b.columns[ci]!.blocks.findIndex((x) => x.id === id);
            if (idx >= 0) return { parentId: b.id, columnIndex: ci, index: idx };
        }
    }
    return null;
}

export function findBlock(design: EmailDesign, id: string | null): EmailBlock | EmailInnerBlock | null {
    if (!id) return null;
    for (const b of design.blocks) {
        if (b.id === id) return b;
        if (b.type === 'columns') {
            for (const c of b.columns) {
                const hit = c.blocks.find((x) => x.id === id);
                if (hit) return hit;
            }
        }
    }
    return null;
}

/** Aplica `fn` a la lista que contiene el bloque `id` (primer nivel o columna). */
function withContainer(
    design: EmailDesign,
    id: string,
    fn: (list: Array<EmailBlock | EmailInnerBlock>, index: number) => Array<EmailBlock | EmailInnerBlock>,
): EmailDesign {
    const loc = locate(design, id);
    if (!loc) return design;
    if (loc.parentId === null) {
        return { ...design, blocks: fn([...design.blocks], loc.index) as EmailBlock[] };
    }
    return {
        ...design,
        blocks: design.blocks.map((b) => {
            if (b.id !== loc.parentId || b.type !== 'columns') return b;
            return {
                ...b,
                columns: b.columns.map((c, ci) =>
                    ci === loc.columnIndex ? { blocks: fn([...c.blocks], loc.index) as EmailInnerBlock[] } : c,
                ),
            };
        }),
    };
}

export function updateBlock(design: EmailDesign, id: string, patch: Partial<EmailBlock> | Partial<EmailInnerBlock>): EmailDesign {
    return withContainer(design, id, (list, i) => {
        list[i] = { ...list[i]!, ...patch } as EmailBlock;
        return list;
    });
}

export function removeBlock(design: EmailDesign, id: string): EmailDesign {
    return withContainer(design, id, (list, i) => {
        list.splice(i, 1);
        return list;
    });
}

export function moveBlock(design: EmailDesign, id: string, delta: -1 | 1): EmailDesign {
    return withContainer(design, id, (list, i) => {
        const j = i + delta;
        if (j < 0 || j >= list.length) return list;
        const [b] = list.splice(i, 1);
        list.splice(j, 0, b!);
        return list;
    });
}

export function duplicateBlock(design: EmailDesign, id: string): { design: EmailDesign; newId: string | null } {
    let newId: string | null = null;
    const next = withContainer(design, id, (list, i) => {
        const copy = cloneWithIds(list[i]!);
        newId = copy.id;
        list.splice(i + 1, 0, copy);
        return list;
    });
    return { design: next, newId };
}

/**
 * Inserta un bloque. Con `afterId`: después de ese bloque (dentro de su misma
 * columna si es interno y el tipo cabe en una columna; si no, después de la
 * fila de columnas). Sin `afterId`: al final.
 */
export function insertBlock(design: EmailDesign, block: EmailBlock, afterId: string | null): EmailDesign {
    if (afterId) {
        const loc = locate(design, afterId);
        if (loc && loc.parentId !== null) {
            if ((INNER_BLOCK_TYPES as readonly string[]).includes(block.type)) {
                return withContainer(design, afterId, (list, i) => {
                    list.splice(i + 1, 0, block as EmailInnerBlock);
                    return list;
                });
            }
            return insertBlock(design, block, loc.parentId);
        }
        if (loc) {
            const blocks = [...design.blocks];
            blocks.splice(loc.index + 1, 0, block);
            return { ...design, blocks };
        }
    }
    return { ...design, blocks: [...design.blocks, block] };
}

/** Agrega un bloque al final de una columna. */
export function appendToColumn(design: EmailDesign, columnsId: string, columnIndex: number, block: EmailInnerBlock): EmailDesign {
    return {
        ...design,
        blocks: design.blocks.map((b) =>
            b.id === columnsId && b.type === 'columns'
                ? {
                      ...b,
                      columns: b.columns.map((c, ci) => (ci === columnIndex ? { blocks: [...c.blocks, block] } : c)),
                  }
                : b,
        ),
    };
}

/** Cambia la cantidad de columnas (2 o 3) conservando el contenido. */
export function setColumnCount(design: EmailDesign, columnsId: string, count: 2 | 3): EmailDesign {
    return {
        ...design,
        blocks: design.blocks.map((b) => {
            if (b.id !== columnsId || b.type !== 'columns') return b;
            if (count === b.columns.length) return b;
            if (count > b.columns.length) return { ...b, columns: [...b.columns, { blocks: [makeInner('text')] }] };
            const kept = b.columns.slice(0, count);
            const extra = b.columns.slice(count).flatMap((c) => c.blocks);
            kept[count - 1] = { blocks: [...kept[count - 1]!.blocks, ...extra] };
            return { ...b, columns: kept };
        }),
    };
}

/** Nombre humano de cada tipo de bloque. */
export const EMAIL_BLOCK_LABELS: Record<EmailBlockType, string> = {
    heading: 'Título',
    text: 'Texto',
    button: 'Botón',
    image: 'Imagen',
    divider: 'Separador',
    spacer: 'Espacio',
    fields: 'Datos del registro',
    signature: 'Firma',
    html: 'HTML propio',
    columns: 'Columnas',
};

export const EMAIL_BLOCK_HINTS: Record<EmailBlockType, string> = {
    heading: 'Un título grande o un subtítulo.',
    text: 'Párrafos con negrita, enlaces, listas y colores.',
    button: 'Un botón que abre un enlace (pagar, ver, confirmar).',
    image: 'Un logo, una foto o un banner.',
    divider: 'Una línea fina para separar secciones.',
    spacer: 'Aire entre bloques.',
    fields: 'Los campos del registro en una tabla prolija.',
    signature: 'Tu firma, donde quieras ubicarla.',
    html: 'Pegá tu propio HTML (para expertos).',
    columns: 'Dos o tres columnas que se apilan en el celular.',
};
