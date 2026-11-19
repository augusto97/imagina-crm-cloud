import {
    REPORT_DATA_TYPES,
    REPORT_MAX_BLOCKS,
    REPORT_MAX_DATA_BLOCKS,
    reportDataBlocks,
    type ReportBlock,
    type ReportDataType,
    type ReportDataWidget,
    type ReportWidgetBlock,
} from '@imagina-base/shared';

import type { WidgetSpec } from '@/types/dashboard';

/**
 * v0.1.464 (J1) — Las operaciones del editor de informes, PURAS (se prueban
 * sin montar nada). Un bloque se encuentra por su id esté suelto o dentro de
 * una fila de columnas; ninguna operación muta la lista que recibe.
 */

/** Un id nuevo que no choca con los que ya hay. */
export function newBlockId(blocks: readonly ReportBlock[], rand: () => number = Math.random): string {
    const used = new Set(allBlockIds(blocks));
    for (;;) {
        const id = `b${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`;
        if (!used.has(id)) return id;
    }
}

/** Todos los ids, también los de adentro de las columnas. */
export function allBlockIds(blocks: readonly ReportBlock[]): string[] {
    const ids: string[] = [];
    for (const b of blocks) {
        ids.push(b.id);
        if (b.type === 'columns') for (const c of b.children) ids.push(c.id);
    }
    return ids;
}

export interface BlockLocation {
    /** Índice del bloque de arriba (o de la fila de columnas). */
    index: number;
    /** Índice dentro de la fila de columnas, o `null` si es un bloque suelto. */
    child: number | null;
    block: ReportBlock;
}

export function findBlock(blocks: readonly ReportBlock[], id: string): BlockLocation | null {
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]!;
        if (b.id === id) return { index: i, child: null, block: b };
        if (b.type === 'columns') {
            const j = b.children.findIndex((c) => c.id === id);
            if (j >= 0) return { index: i, child: j, block: b.children[j]! };
        }
    }
    return null;
}

/** ¿Se puede agregar otro bloque? (null = sí; si no, el motivo). */
export function addBlockProblem(blocks: readonly ReportBlock[], data: boolean): string | null {
    if (blocks.length >= REPORT_MAX_BLOCKS) return `Un informe admite hasta ${REPORT_MAX_BLOCKS} bloques.`;
    if (data && reportDataBlocks(blocks).length >= REPORT_MAX_DATA_BLOCKS) return `Un informe admite hasta ${REPORT_MAX_DATA_BLOCKS} bloques de datos.`;
    return null;
}

/** Inserta un bloque después de `afterId` (o al final si no está o es `null`). */
export function insertBlock(blocks: readonly ReportBlock[], block: ReportBlock, afterId: string | null): ReportBlock[] {
    const next = [...blocks];
    const at = afterId === null ? null : findBlock(blocks, afterId);
    if (at === null) next.push(block);
    else next.splice(at.index + 1, 0, block);
    return next;
}

/** Cambia un bloque (suelto o dentro de una fila). */
export function replaceBlock(blocks: readonly ReportBlock[], id: string, update: (b: ReportBlock) => ReportBlock): ReportBlock[] {
    return blocks.map((b) => {
        if (b.id === id) return update(b);
        if (b.type === 'columns' && b.children.some((c) => c.id === id)) {
            return {
                ...b,
                children: b.children.map((c) => {
                    if (c.id !== id) return c;
                    const u = update(c);
                    return u.type === 'widget' ? u : c;
                }),
            };
        }
        return b;
    });
}

/**
 * Quita un bloque. Si era uno de una fila de columnas y queda uno solo, la
 * fila desaparece y ese bloque queda suelto en su lugar.
 */
export function removeBlock(blocks: readonly ReportBlock[], id: string): ReportBlock[] {
    const at = findBlock(blocks, id);
    if (!at) return [...blocks];
    const next = [...blocks];
    if (at.child === null) {
        next.splice(at.index, 1);
        return next;
    }
    const row = blocks[at.index]!;
    if (row.type !== 'columns') return next;
    const kids = row.children.filter((c) => c.id !== id);
    if (kids.length >= 2) next[at.index] = { ...row, children: kids };
    else next.splice(at.index, 1, ...kids);
    return next;
}

/** Copia profunda de un bloque con ids nuevos (también sus hijos). */
function cloneWithIds(block: ReportBlock, taken: ReportBlock[]): ReportBlock {
    const fresh = (): string => {
        const id = newBlockId(taken);
        // Se reserva enseguida: un hijo no puede recibir el mismo id que su fila.
        taken.push({ id, type: 'divider' });
        return id;
    };
    const copy = JSON.parse(JSON.stringify(block)) as ReportBlock;
    if (copy.type === 'columns') return { ...copy, id: fresh(), children: copy.children.map((c) => ({ ...c, id: fresh() })) };
    return { ...copy, id: fresh() };
}

/** Duplica un bloque justo debajo (dentro de su fila si cabe; si no, debajo de la fila). */
export function duplicateBlock(blocks: readonly ReportBlock[], id: string): { blocks: ReportBlock[]; id: string | null } {
    const at = findBlock(blocks, id);
    if (!at) return { blocks: [...blocks], id: null };
    const taken = [...blocks];
    const copy = cloneWithIds(at.block, taken);
    const next = [...blocks];
    if (at.child !== null) {
        const row = blocks[at.index]!;
        if (row.type === 'columns' && row.children.length < 3 && copy.type === 'widget') {
            const kids = [...row.children];
            kids.splice(at.child + 1, 0, copy);
            next[at.index] = { ...row, children: kids };
            return { blocks: next, id: copy.id };
        }
    }
    next.splice(at.index + 1, 0, copy);
    return { blocks: next, id: copy.id };
}

/**
 * Sube o baja un bloque una posición. Dentro de una fila de columnas se mueve
 * de izquierda a derecha; los de arriba, entre los demás bloques.
 */
export function moveBlock(blocks: readonly ReportBlock[], id: string, delta: -1 | 1): ReportBlock[] {
    const at = findBlock(blocks, id);
    if (!at) return [...blocks];
    const next = [...blocks];
    if (at.child !== null) {
        const row = blocks[at.index]!;
        if (row.type !== 'columns') return next;
        const to = at.child + delta;
        if (to < 0 || to >= row.children.length) return next;
        const kids = [...row.children];
        const [moved] = kids.splice(at.child, 1);
        kids.splice(to, 0, moved!);
        next[at.index] = { ...row, children: kids };
        return next;
    }
    const to = at.index + delta;
    if (to < 0 || to >= blocks.length) return next;
    const [moved] = next.splice(at.index, 1);
    next.splice(to, 0, moved!);
    return next;
}

/** Arrastrar: lleva el bloque de arriba `from` a la posición `to` (entre los de arriba). */
export function moveTo(blocks: readonly ReportBlock[], from: number, to: number): ReportBlock[] {
    if (from === to || from < 0 || from >= blocks.length || to < 0 || to >= blocks.length) return [...blocks];
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
}

/**
 * «Poner al lado del siguiente»: un bloque de datos y el que sigue quedan en
 * una fila de columnas (2 o 3). Devuelve `null` si no se puede (el siguiente
 * no es de datos o la fila ya tiene 3).
 */
export function joinWithNext(blocks: readonly ReportBlock[], id: string): ReportBlock[] | null {
    const at = findBlock(blocks, id);
    if (!at || at.child !== null) return null;
    const cur = blocks[at.index]!;
    const nxt = blocks[at.index + 1];
    if (!nxt) return null;
    const next = [...blocks];
    const taken = [...blocks];
    if (cur.type === 'widget' && nxt.type === 'widget') {
        next.splice(at.index, 2, { id: newBlockId(taken), type: 'columns', children: [cur, nxt] });
        return next;
    }
    if (cur.type === 'widget' && nxt.type === 'columns' && nxt.children.length < 3) {
        next.splice(at.index, 2, { ...nxt, children: [cur, ...nxt.children] });
        return next;
    }
    if (cur.type === 'columns' && cur.children.length < 3 && nxt.type === 'widget') {
        next.splice(at.index, 2, { ...cur, children: [...cur.children, nxt] });
        return next;
    }
    return null;
}

/** «Separar»: los bloques de una fila de columnas vuelven a quedar uno debajo del otro. */
export function splitColumns(blocks: readonly ReportBlock[], id: string): ReportBlock[] {
    const at = findBlock(blocks, id);
    if (!at) return [...blocks];
    const row = blocks[at.index]!;
    if (row.type !== 'columns') return [...blocks];
    const next = [...blocks];
    next.splice(at.index, 1, ...row.children);
    return next;
}

const DATA_TYPES: ReadonlySet<string> = new Set(REPORT_DATA_TYPES);

export function isReportDataType(type: string): type is ReportDataType {
    return DATA_TYPES.has(type);
}

/** Lo que guarda el diálogo del widget → la parte de datos de un bloque (sin su lugar en la grilla). */
export function dataWidgetFromSpec(spec: WidgetSpec): ReportDataWidget | null {
    if (!isReportDataType(spec.type) || !(spec.list_id > 0)) return null;
    return { type: spec.type, list_id: spec.list_id, title: spec.title ?? '', config: { ...(spec.config ?? {}) } };
}

/** Un bloque de datos como widget de tablero (para el diálogo y los componentes). */
export function specFromBlock(block: ReportWidgetBlock): WidgetSpec {
    return {
        id: block.id,
        type: block.widget.type,
        list_id: block.widget.list_id,
        title: block.widget.title,
        config: block.widget.config,
        layout: { x: 0, y: 0, w: 12, h: 4 },
    } as WidgetSpec;
}

const DATA_TYPE_LABEL: Record<ReportDataType, string> = {
    kpi: 'Indicador',
    gauge: 'Medidor',
    stat_delta: 'Indicador con variación',
    chart_bar: 'Gráfico de barras',
    chart_pie: 'Gráfico de torta',
    chart_line: 'Línea',
    chart_area: 'Área',
    funnel: 'Embudo',
    table: 'Tabla',
    pivot: 'Tabla dinámica',
    forecast: 'Pronóstico de ventas',
};

export function dataTypeLabel(type: ReportDataType): string {
    return DATA_TYPE_LABEL[type] ?? 'Datos';
}

/** El nombre de un bloque en la lista de la izquierda: qué es y su texto o título. */
export function blockLabel(block: ReportBlock, listName: (id: number) => string | null): { kind: string; text: string } {
    switch (block.type) {
        case 'heading':
            return { kind: 'Título', text: block.text.trim() || 'Sin título' };
        case 'text': {
            const first = block.text.trim().split('\n')[0]?.replace(/[#*_`>[\]-]/g, '').trim() ?? '';
            return { kind: 'Texto', text: first || 'Sin texto' };
        }
        case 'widget': {
            const list = listName(block.widget.list_id);
            const title = block.widget.title.trim() || dataTypeLabel(block.widget.type);
            return { kind: dataTypeLabel(block.widget.type), text: list ? `${title} · ${list}` : title };
        }
        case 'columns':
            return { kind: 'Columnas', text: `${block.children.length} bloques lado a lado` };
        case 'divider':
            return { kind: 'Separador', text: 'Una línea' };
        case 'page_break':
            return { kind: 'Salto de página', text: 'Sólo en el PDF' };
    }
}

/** Lo que se edita en el editor (lo que se guarda con «Guardar»). */
export interface ReportDraft {
    name: string;
    description: string;
    blocks: ReportBlock[];
    period: string;
    compare: string;
    visibility: 'workspace' | 'private' | 'roles';
    allowed_roles: string[];
}

/** ¿Cambió algo respecto de lo guardado? */
export function draftDirty(a: ReportDraft, b: ReportDraft): boolean {
    return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Historial de deshacer/rehacer. Lo que se tipea seguido en el mismo campo
 * (`key`) se junta en UN paso; tope de 80 pasos.
 */
export interface DraftHistory {
    past: ReportDraft[];
    present: ReportDraft;
    future: ReportDraft[];
    lastKey: string | null;
}

export function historyOf(draft: ReportDraft): DraftHistory {
    return { past: [], present: draft, future: [], lastKey: null };
}

export function commit(h: DraftHistory, next: ReportDraft, key: string | null = null): DraftHistory {
    if (!draftDirty(h.present, next)) return h;
    if (key !== null && key === h.lastKey) return { ...h, present: next, future: [] };
    return { past: [...h.past, h.present].slice(-80), present: next, future: [], lastKey: key };
}

export function undo(h: DraftHistory): DraftHistory {
    const prev = h.past[h.past.length - 1];
    if (!prev) return h;
    return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastKey: null };
}

export function redo(h: DraftHistory): DraftHistory {
    const nxt = h.future[0];
    if (!nxt) return h;
    return { past: [...h.past, h.present], present: nxt, future: h.future.slice(1), lastKey: null };
}
