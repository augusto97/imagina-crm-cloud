import type { LayoutBlock, LayoutPage, LayoutSection, RecordLayoutV3 } from '@imagina-base/shared';

/**
 * v0.1.231 — Operaciones PURAS del editor de la ficha sobre la plantilla v3.
 * Cada una devuelve una plantilla NUEVA (el historial de deshacer guarda
 * copias) y nunca deja una sección inválida: columnas que suman 12 y una pila
 * por columna. Todo lo que el editor hace pasa por aquí, así se testea sin
 * montar la interfaz.
 */

export interface BlockPath {
    pageId: string;
    sectionId: string;
    col: number;
    index: number;
}

let seq = 0;
/** Id corto y único dentro de la plantilla (no tiene que ser global). */
export function newId(prefix: string): string {
    seq = (seq + 1) % 1_000_000;
    return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function mapPage(layout: RecordLayoutV3, pageId: string, fn: (p: LayoutPage) => LayoutPage): RecordLayoutV3 {
    return { ...layout, pages: layout.pages.map((p) => (p.id === pageId ? fn(p) : p)) };
}

function mapSection(page: LayoutPage, sectionId: string, fn: (s: LayoutSection) => LayoutSection): LayoutPage {
    return { ...page, sections: page.sections.map((s) => (s.id === sectionId ? fn(s) : s)) };
}

/** Dónde está un bloque. */
export function findBlock(layout: RecordLayoutV3, blockId: string): (BlockPath & { block: LayoutBlock }) | null {
    for (const page of layout.pages) {
        for (const section of page.sections) {
            for (let col = 0; col < section.blocks.length; col++) {
                const index = section.blocks[col]!.findIndex((b) => b.id === blockId);
                if (index >= 0) return { pageId: page.id, sectionId: section.id, col, index, block: section.blocks[col]![index]! };
            }
        }
    }
    return null;
}

export function findSection(layout: RecordLayoutV3, sectionId: string): { pageId: string; index: number; section: LayoutSection } | null {
    for (const page of layout.pages) {
        const index = page.sections.findIndex((s) => s.id === sectionId);
        if (index >= 0) return { pageId: page.id, index, section: page.sections[index]! };
    }
    return null;
}

export function insertBlock(layout: RecordLayoutV3, at: BlockPath, block: LayoutBlock): RecordLayoutV3 {
    return mapPage(layout, at.pageId, (p) =>
        mapSection(p, at.sectionId, (s) => {
            const blocks = s.blocks.map((stack, i) => {
                if (i !== at.col) return stack;
                const next = [...stack];
                next.splice(Math.max(0, Math.min(at.index, next.length)), 0, block);
                return next;
            });
            return { ...s, blocks };
        }),
    );
}

export function removeBlock(layout: RecordLayoutV3, blockId: string): RecordLayoutV3 {
    return {
        ...layout,
        pages: layout.pages.map((p) => ({
            ...p,
            sections: p.sections.map((s) => ({ ...s, blocks: s.blocks.map((stack) => stack.filter((b) => b.id !== blockId)) })),
        })),
    };
}

export function updateBlock(layout: RecordLayoutV3, blockId: string, patch: Partial<LayoutBlock>): RecordLayoutV3 {
    return {
        ...layout,
        pages: layout.pages.map((p) => ({
            ...p,
            sections: p.sections.map((s) => ({
                ...s,
                blocks: s.blocks.map((stack) => stack.map((b) => (b.id === blockId ? { ...b, ...patch } : b))),
            })),
        })),
    };
}

/**
 * Mueve un bloque a otra posición (misma u otra sección/página). El índice
 * destino se interpreta ANTES de sacar el bloque, como lo ve quien arrastra:
 * soltar un bloque justo debajo de sí mismo no lo mueve.
 */
export function moveBlock(layout: RecordLayoutV3, blockId: string, to: BlockPath): RecordLayoutV3 {
    const from = findBlock(layout, blockId);
    if (!from) return layout;
    let index = to.index;
    if (from.pageId === to.pageId && from.sectionId === to.sectionId && from.col === to.col && from.index < to.index) index -= 1;
    return insertBlock(removeBlock(layout, blockId), { ...to, index }, from.block);
}

export function duplicateBlock(layout: RecordLayoutV3, blockId: string): { layout: RecordLayoutV3; newId: string | null } {
    const at = findBlock(layout, blockId);
    if (!at) return { layout, newId: null };
    const copy: LayoutBlock = { ...structuredClone(at.block), id: newId(at.block.type) };
    return { layout: insertBlock(layout, { ...at, index: at.index + 1 }, copy), newId: copy.id };
}

/** Cambia las columnas de una sección; las pilas que sobran se juntan en la última. */
export function setSectionColumns(layout: RecordLayoutV3, sectionId: string, columns: number[]): RecordLayoutV3 {
    const found = findSection(layout, sectionId);
    if (!found || columns.reduce((a, b) => a + b, 0) !== 12) return layout;
    return mapPage(layout, found.pageId, (p) =>
        mapSection(p, sectionId, (s) => {
            const stacks = s.blocks.slice(0, columns.length).map((st) => [...st]);
            while (stacks.length < columns.length) stacks.push([]);
            const extra = s.blocks.slice(columns.length).flat();
            stacks[columns.length - 1]!.push(...extra);
            return { ...s, columns, blocks: stacks };
        }),
    );
}

export function updateSection(layout: RecordLayoutV3, sectionId: string, patch: Partial<Pick<LayoutSection, 'title' | 'style'>>): RecordLayoutV3 {
    const found = findSection(layout, sectionId);
    if (!found) return layout;
    return mapPage(layout, found.pageId, (p) => mapSection(p, sectionId, (s) => ({ ...s, ...patch })));
}

export function insertSection(layout: RecordLayoutV3, pageId: string, index: number, columns: number[] = [12]): { layout: RecordLayoutV3; id: string } {
    const id = newId('s');
    const section: LayoutSection = { id, columns, blocks: columns.map(() => []) };
    return {
        id,
        layout: mapPage(layout, pageId, (p) => {
            const sections = [...p.sections];
            sections.splice(Math.max(0, Math.min(index, sections.length)), 0, section);
            return { ...p, sections };
        }),
    };
}

export function removeSection(layout: RecordLayoutV3, sectionId: string): RecordLayoutV3 {
    return { ...layout, pages: layout.pages.map((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== sectionId) })) };
}

export function moveSection(layout: RecordLayoutV3, sectionId: string, delta: -1 | 1): RecordLayoutV3 {
    const found = findSection(layout, sectionId);
    if (!found) return layout;
    const target = found.index + delta;
    return mapPage(layout, found.pageId, (p) => {
        if (target < 0 || target >= p.sections.length) return p;
        const sections = [...p.sections];
        const [s] = sections.splice(found.index, 1);
        sections.splice(target, 0, s!);
        return { ...p, sections };
    });
}

export function duplicateSection(layout: RecordLayoutV3, sectionId: string): RecordLayoutV3 {
    const found = findSection(layout, sectionId);
    if (!found) return layout;
    const copy: LayoutSection = {
        ...structuredClone(found.section),
        id: newId('s'),
        blocks: found.section.blocks.map((st) => st.map((b) => ({ ...structuredClone(b), id: newId(b.type) }))),
    };
    return mapPage(layout, found.pageId, (p) => {
        const sections = [...p.sections];
        sections.splice(found.index + 1, 0, copy);
        return { ...p, sections };
    });
}

export function addPage(layout: RecordLayoutV3, name: string): { layout: RecordLayoutV3; id: string } {
    const id = newId('p');
    const page: LayoutPage = { id, name, sections: [{ id: newId('s'), columns: [12], blocks: [[]] }] };
    return { id, layout: { ...layout, pages: [...layout.pages, page] } };
}

export function renamePage(layout: RecordLayoutV3, pageId: string, name: string): RecordLayoutV3 {
    return mapPage(layout, pageId, (p) => ({ ...p, name }));
}

/** Nunca deja la plantilla sin páginas. */
export function removePage(layout: RecordLayoutV3, pageId: string): RecordLayoutV3 {
    if (layout.pages.length <= 1) return layout;
    return { ...layout, pages: layout.pages.filter((p) => p.id !== pageId) };
}

export function movePage(layout: RecordLayoutV3, pageId: string, delta: -1 | 1): RecordLayoutV3 {
    const i = layout.pages.findIndex((p) => p.id === pageId);
    const target = i + delta;
    if (i < 0 || target < 0 || target >= layout.pages.length) return layout;
    const pages = [...layout.pages];
    const [p] = pages.splice(i, 1);
    pages.splice(target, 0, p!);
    return { ...layout, pages };
}

/** Plantillas de columnas que ofrece el editor. */
export const COLUMN_PRESETS: number[][] = [[12], [6, 6], [8, 4], [4, 8], [4, 4, 4], [3, 6, 3], [3, 3, 3, 3]];
