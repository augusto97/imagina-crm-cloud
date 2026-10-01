import { layoutChartKindSchema, normalizeWidths, type LayoutBlock, type LayoutSection } from '@imagina-base/shared';

/**
 * v0.1.234 — Cómo se dibujan las columnas de una sección con el ancho que
 * HAY (PURO, se testea sin DOM). La plantilla dice "8 · 4" o "3 · 6 · 3",
 * pero eso supone un ancho que no siempre está:
 *  - una columna sin bloques no ocupa lugar: su ancho se reparte entre las
 *    demás (si no, quedaba un hueco en blanco);
 *  - si alguna columna quedaría más angosta de lo que su contenido necesita
 *    (una tabla de propiedades no entra en 200 px), la sección se acomoda:
 *    de a DOS por fila cuando todo es chico (cifras, botones); con tres o
 *    más columnas, "principal + lateral" (la más ancha a la izquierda y las
 *    demás juntas a la derecha, el 3 · 6 · 3 clásico de un CRM pasa a
 *    8 · 4); y si ni así entra, apilada.
 *
 * Por debajo de 760 px la hoja de estilos ya apila todo (celular).
 */
export type SectionMode = 'grid' | 'pairs' | 'stack';

export interface SectionPlan {
    mode: SectionMode;
    columns: number[];
    blocks: LayoutBlock[][];
}

/** Ancho mínimo cómodo de una columna con contenido "de lectura". */
export const MIN_COLUMN = 240;
/** Ancho mínimo de una columna con sólo piezas chicas (cifras, botones). */
export const MIN_COMPACT_COLUMN = 150;

const COMPACT_TYPES: ReadonlySet<string> = new Set(['field', 'heading', 'divider', 'spacer', 'button', 'notice']);
const COMPACT_CHARTS: ReadonlySet<string> = new Set(['kpi', 'gauge', 'stat_delta']);

export function isCompactBlock(block: LayoutBlock): boolean {
    if (block.type === 'chart') return COMPACT_CHARTS.has(layoutChartKindSchema.catch('kpi').parse(block.config.kind));
    return COMPACT_TYPES.has(block.type);
}

export function planSection(section: LayoutSection, width: number, gap: number): SectionPlan {
    const kept = section.columns
        .map((w, i) => ({ w, blocks: section.blocks[i] ?? [] }))
        .filter((c) => c.blocks.length > 0);
    if (kept.length === 0) return { mode: 'grid', columns: [12], blocks: [[]] };
    const columns = normalizeWidths(kept.map((c) => c.w));
    const blocks = kept.map((c) => c.blocks);
    if (width <= 0 || kept.length === 1) return { mode: 'grid', columns, blocks };

    const usable = width - gap * (kept.length - 1);
    const compact = blocks.map((col) => col.every(isCompactBlock));
    const fits = columns.every((w, i) => (usable * w) / 12 >= (compact[i] ? MIN_COMPACT_COLUMN : MIN_COLUMN));
    if (fits) return { mode: 'grid', columns, blocks };
    if (compact.every(Boolean) && kept.length >= 3 && (width - gap) / 2 >= MIN_COMPACT_COLUMN) {
        return { mode: 'pairs', columns, blocks };
    }
    if (kept.length >= 3) {
        const main = columns.indexOf(Math.max(...columns));
        const side = blocks.filter((_, i) => i !== main).flat();
        const sideCompact = side.every(isCompactBlock);
        const twoUsable = width - gap;
        if ((twoUsable * 8) / 12 >= (compact[main] ? MIN_COMPACT_COLUMN : MIN_COLUMN) && (twoUsable * 4) / 12 >= (sideCompact ? MIN_COMPACT_COLUMN : MIN_COLUMN)) {
            return { mode: 'grid', columns: [8, 4], blocks: [blocks[main]!, side] };
        }
    }
    return { mode: 'stack', columns, blocks };
}
