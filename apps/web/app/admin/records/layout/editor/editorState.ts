import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { LayoutBlock, RecordLayoutV3 } from '@imagina-base/shared';

import type { CatalogContext } from './blockCatalog';
import { catalogEntry } from './blockCatalog';
import { insertBlock, insertSection, moveBlock, type BlockPath } from './layoutOps';

/** Lo que está elegido en el lienzo (manda qué muestra el inspector). */
export type Selection =
    | { kind: 'block'; id: string }
    | { kind: 'section'; id: string }
    | { kind: 'header' }
    | { kind: 'page' }
    | null;

const LIMIT = 60;

/**
 * Historial del editor: cada cambio confirmado es una foto; deshacer/rehacer
 * se mueven entre fotos. Los cambios "en vivo" de un campo de texto del
 * inspector se agrupan (`coalesce`) para que escribir un título no llene el
 * historial de una letra por paso.
 */
export function useLayoutHistory(initial: RecordLayoutV3) {
    const [state, setState] = useState<{ stack: RecordLayoutV3[]; index: number }>({ stack: [initial], index: 0 });
    const lastKey = useRef<string | null>(null);

    const commit = useCallback((next: RecordLayoutV3, coalesceKey?: string) => {
        setState((s) => {
            const same = coalesceKey !== undefined && coalesceKey === lastKey.current && s.index === s.stack.length - 1;
            lastKey.current = coalesceKey ?? null;
            if (same) {
                const stack = [...s.stack];
                stack[s.index] = next;
                return { stack, index: s.index };
            }
            const stack = [...s.stack.slice(0, s.index + 1), next].slice(-LIMIT);
            return { stack, index: stack.length - 1 };
        });
    }, []);

    const undo = useCallback(() => {
        lastKey.current = null;
        setState((s) => ({ ...s, index: Math.max(0, s.index - 1) }));
    }, []);
    const redo = useCallback(() => {
        lastKey.current = null;
        setState((s) => ({ ...s, index: Math.min(s.stack.length - 1, s.index + 1) }));
    }, []);
    const reset = useCallback((next: RecordLayoutV3) => {
        lastKey.current = null;
        setState({ stack: [next], index: 0 });
    }, []);

    return {
        layout: state.stack[state.index]!,
        commit,
        undo,
        redo,
        reset,
        canUndo: state.index > 0,
        canRedo: state.index < state.stack.length - 1,
    };
}

// ── Arrastrar y soltar ──────────────────────────────────────────────────

export const DRAG_MIME = 'application/x-imcrm-layout-block';

export type DragPayload = { new: string } | { move: string };

export function readDrag(e: React.DragEvent): DragPayload | null {
    try {
        const raw = e.dataTransfer.getData(DRAG_MIME);
        const parsed = raw ? (JSON.parse(raw) as DragPayload) : null;
        return parsed && ('new' in parsed || 'move' in parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeDrag(e: React.DragEvent, payload: DragPayload): void {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
}

export function isLayoutDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}

// ── Contexto del editor ─────────────────────────────────────────────────

export interface EditorApi {
    layout: RecordLayoutV3;
    commit: (next: RecordLayoutV3, coalesceKey?: string) => void;
    selection: Selection;
    select: (s: Selection) => void;
    pageId: string;
    catalog: CatalogContext;
    /** Suelta un bloque (nuevo del catálogo o existente) en una posición. */
    drop: (payload: DragPayload, at: BlockPath) => void;
    /** Agrega un bloque del catálogo donde corresponda según la selección. */
    add: (catalogKey: string) => void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
    const ctx = useContext(EditorContext);
    if (!ctx) throw new Error('useEditor fuera del editor');
    return ctx;
}

/** Arma las acciones de soltar/agregar sobre el historial. */
export function useEditorActions(
    layout: RecordLayoutV3,
    commit: (next: RecordLayoutV3) => void,
    select: (s: Selection) => void,
    catalog: CatalogContext,
    pageId: string,
    selection: Selection,
) {
    const drop = useCallback(
        (payload: DragPayload, at: BlockPath) => {
            if ('move' in payload) {
                commit(moveBlock(layout, payload.move, at));
                select({ kind: 'block', id: payload.move });
                return;
            }
            const entry = catalogEntry(payload.new);
            if (!entry) return;
            const b: LayoutBlock = entry.create(catalog);
            commit(insertBlock(layout, at, b));
            select({ kind: 'block', id: b.id });
        },
        [layout, commit, select, catalog],
    );

    const add = useCallback(
        (key: string) => {
            const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0]!;
            // Debajo del bloque elegido; si no, al final de la sección elegida;
            // si no, al final de la primera columna de la última sección.
            let at: BlockPath | null = null;
            if (selection?.kind === 'block') {
                for (const s of page.sections) {
                    s.blocks.forEach((stack, col) => {
                        const i = stack.findIndex((b) => b.id === selection.id);
                        if (i >= 0) at = { pageId: page.id, sectionId: s.id, col, index: i + 1 };
                    });
                }
            } else if (selection?.kind === 'section') {
                const s = page.sections.find((x) => x.id === selection.id);
                if (s) at = { pageId: page.id, sectionId: s.id, col: 0, index: s.blocks[0]?.length ?? 0 };
            }
            const last = page.sections[page.sections.length - 1];
            if (!at && last) at = { pageId: page.id, sectionId: last.id, col: 0, index: last.blocks[0]?.length ?? 0 };
            if (at) return drop({ new: key }, at);
            // Página vacía: primero una sección de una columna.
            const entry = catalogEntry(key);
            if (!entry) return;
            const r = insertSection(layout, page.id, 0, [12]);
            const b = entry.create(catalog);
            commit(insertBlock(r.layout, { pageId: page.id, sectionId: r.id, col: 0, index: 0 }, b));
            select({ kind: 'block', id: b.id });
        },
        [layout, pageId, selection, drop, catalog, commit, select],
    );

    return useMemo(() => ({ drop, add }), [drop, add]);
}
