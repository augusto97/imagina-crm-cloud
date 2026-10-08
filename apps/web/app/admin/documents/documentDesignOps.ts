import {
    DOC_INNER_BLOCK_TYPES,
    emailTextDoc,
    type DocBlock,
    type DocBlockType,
    type DocDesign,
    type DocInnerBlock,
    type DocInnerBlockType,
} from '@imagina-base/shared';

/**
 * v0.1.266 — Operaciones PURAS del editor de documentos PDF (ADR-S35), el
 * mismo patrón que las del editor de correos: cada una devuelve un diseño
 * nuevo (deshacer/rehacer = pila de valores) y los bloques dentro de una
 * columna se direccionan por id igual que los de primer nivel.
 */

let seq = 0;
export function newDocBlockId(): string {
    seq = (seq + 1) % 1_000_000;
    return `d${Date.now().toString(36)}${seq.toString(36)}`;
}

export function makeDocBlock(type: DocBlockType): DocBlock {
    const id = newDocBlockId();
    const none = { kind: 'none' as const, file_id: null, url: '' };
    switch (type) {
        case 'header':
            return {
                id,
                type,
                layout: 'split',
                logo: { kind: 'brand', file_id: null, url: '' },
                logo_width: 110,
                company: 'Tu empresa\nNIT 000.000.000-0',
                title: 'DOCUMENTO',
                number: 'N.º {{record.id}}',
                date: '{{date.today|larga}}',
            };
        case 'heading':
            return { id, type, text: 'Título', level: 2, align: 'left' };
        case 'text':
            return { id, type, doc: emailTextDoc('Escribí acá el texto del documento.'), align: 'left', size: 'md' };
        case 'fields':
            return { id, type, title: '', slugs: [], layout: 'table', columns: 1 };
        case 'items':
            return {
                id,
                type,
                title: 'DETALLE',
                source: null,
                columns: [],
                numbered: true,
                sort: null,
                limit: 200,
                striped: true,
                empty_text: 'Sin ítems.',
            };
        case 'totals':
            return {
                id,
                type,
                rows: [{ id: 'total', label: 'TOTAL', source: { kind: 'text', value: '' }, emphasis: true }],
                width: 'half',
                prefix: '$ ',
                decimals: 0,
            };
        case 'image':
            return { id, type, src: none, width: 40, align: 'center' };
        case 'qr':
            // v0.1.267 — el link de pago o la ficha pública, escaneable.
            return { id, type, value: '', size: 96, align: 'left', caption: '' };
        case 'divider':
            return { id, type, thickness: 1 };
        case 'spacer':
            return { id, type, height: 16 };
        case 'page_break':
            return { id, type };
        case 'signature':
            return { id, type, signers: [{ name: 'Nombre', detail: 'C.C. 0.000.000' }], align: 'left', image: none, line: true };
        case 'columns':
            return {
                id,
                type,
                columns: [{ blocks: [makeDocInner('heading'), makeDocInner('text')] }, { blocks: [makeDocInner('heading'), makeDocInner('text')] }],
            };
    }
}

export function makeDocInner(type: DocInnerBlockType): DocInnerBlock {
    const b = makeDocBlock(type);
    if (b.type === 'heading') return { ...b, level: 3 };
    return b as DocInnerBlock;
}

function cloneWithIds<T extends DocBlock | DocInnerBlock>(b: T): T {
    const copy = JSON.parse(JSON.stringify(b)) as T;
    copy.id = newDocBlockId();
    if (copy.type === 'columns') for (const c of copy.columns) c.blocks = c.blocks.map((x) => cloneWithIds(x));
    return copy;
}

export interface DocBlockLocation {
    parentId: string | null;
    columnIndex: number | null;
    index: number;
}

export function locateDocBlock(design: DocDesign, id: string): DocBlockLocation | null {
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

export function findDocBlock(design: DocDesign, id: string | null): DocBlock | DocInnerBlock | null {
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

function withContainer(
    design: DocDesign,
    id: string,
    fn: (list: Array<DocBlock | DocInnerBlock>, index: number) => Array<DocBlock | DocInnerBlock>,
): DocDesign {
    const loc = locateDocBlock(design, id);
    if (!loc) return design;
    if (loc.parentId === null) return { ...design, blocks: fn([...design.blocks], loc.index) as DocBlock[] };
    return {
        ...design,
        blocks: design.blocks.map((b) => {
            if (b.id !== loc.parentId || b.type !== 'columns') return b;
            return {
                ...b,
                columns: b.columns.map((c, ci) => (ci === loc.columnIndex ? { blocks: fn([...c.blocks], loc.index) as DocInnerBlock[] } : c)),
            };
        }),
    };
}

export function updateDocBlock(design: DocDesign, id: string, patch: Record<string, unknown>): DocDesign {
    return withContainer(design, id, (list, i) => {
        list[i] = { ...list[i]!, ...patch } as DocBlock;
        return list;
    });
}

export function removeDocBlock(design: DocDesign, id: string): DocDesign {
    return withContainer(design, id, (list, i) => {
        list.splice(i, 1);
        return list;
    });
}

export function moveDocBlock(design: DocDesign, id: string, delta: -1 | 1): DocDesign {
    return withContainer(design, id, (list, i) => {
        const j = i + delta;
        if (j < 0 || j >= list.length) return list;
        const [b] = list.splice(i, 1);
        list.splice(j, 0, b!);
        return list;
    });
}

export function duplicateDocBlock(design: DocDesign, id: string): { design: DocDesign; newId: string | null } {
    let newId: string | null = null;
    const next = withContainer(design, id, (list, i) => {
        const copy = cloneWithIds(list[i]!);
        newId = copy.id;
        list.splice(i + 1, 0, copy);
        return list;
    });
    return { design: next, newId };
}

/** Inserta después del bloque elegido (dentro de su columna si el tipo cabe ahí), o al final. */
export function insertDocBlock(design: DocDesign, block: DocBlock, afterId: string | null): DocDesign {
    if (afterId) {
        const loc = locateDocBlock(design, afterId);
        if (loc && loc.parentId !== null) {
            if ((DOC_INNER_BLOCK_TYPES as readonly string[]).includes(block.type)) {
                return withContainer(design, afterId, (list, i) => {
                    list.splice(i + 1, 0, block as DocInnerBlock);
                    return list;
                });
            }
            return insertDocBlock(design, block, loc.parentId);
        }
        if (loc) {
            const blocks = [...design.blocks];
            blocks.splice(loc.index + 1, 0, block);
            return { ...design, blocks };
        }
    }
    return { ...design, blocks: [...design.blocks, block] };
}

export function appendToDocColumn(design: DocDesign, columnsId: string, columnIndex: number, block: DocInnerBlock): DocDesign {
    return {
        ...design,
        blocks: design.blocks.map((b) =>
            b.id === columnsId && b.type === 'columns'
                ? { ...b, columns: b.columns.map((c, ci) => (ci === columnIndex ? { blocks: [...c.blocks, block] } : c)) }
                : b,
        ),
    };
}

export function setDocColumnCount(design: DocDesign, columnsId: string, count: 2 | 3): DocDesign {
    return {
        ...design,
        blocks: design.blocks.map((b) => {
            if (b.id !== columnsId || b.type !== 'columns' || count === b.columns.length) return b;
            if (count > b.columns.length) return { ...b, columns: [...b.columns, { blocks: [makeDocInner('text')] }] };
            const kept = b.columns.slice(0, count);
            const extra = b.columns.slice(count).flatMap((c) => c.blocks);
            kept[count - 1] = { blocks: [...kept[count - 1]!.blocks, ...extra] };
            return { ...b, columns: kept };
        }),
    };
}

/** Un id de fila de totales que no choca con los que ya hay. */
export function newTotalRowId(design: DocDesign): string {
    const taken = new Set<string>();
    for (const b of design.blocks) if (b.type === 'totals') for (const r of b.rows) taken.add(r.id);
    for (const base of ['subtotal', 'iva', 'descuento', 'retencion', 'total']) if (!taken.has(base)) return base;
    let n = 1;
    while (taken.has(`fila${n}`)) n++;
    return `fila${n}`;
}
