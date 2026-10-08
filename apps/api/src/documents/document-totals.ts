import type { DocDesign, DocTotalRow } from '@imagina-base/shared';

/**
 * v0.1.266 (ADR-S35) — Las filas del bloque «Totales» de un documento, PURO.
 *
 * Una fila puede ser la suma de una columna de la tabla de ítems, un campo
 * numérico del registro, un porcentaje de otra fila (IVA 19 %, retención
 * −4 %), la suma de otras filas o un texto. Las referencias a otras filas se
 * resuelven por id en cualquier orden (con guarda contra ciclos), y el
 * resultado numérico de cada fila queda disponible como `{{totales.<id>}}`
 * para el resto del documento ("Son: {{totales.total|pesos}}").
 */

export interface TotalsSources {
    /** Suma de la columna `slug` de la tabla de ítems `blockId` (null = no hay). */
    itemsSum(blockId: string, slug: string): number | null;
    /** Valor numérico de un campo del registro. */
    fieldNumber(slug: string): number | null;
    /** Un template de texto ya resuelto. */
    resolve(template: string): string;
}

export interface ComputedTotalRow {
    id: string;
    label: string;
    emphasis: boolean;
    /** Valor numérico (null en una fila de texto o sin dato). */
    num: number | null;
    /** Texto (sólo filas de texto). */
    text: string | null;
}

export function computeTotalRows(rows: readonly DocTotalRow[], src: TotalsSources): ComputedTotalRow[] {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const memo = new Map<string, number | null>();
    const visiting = new Set<string>();

    const valueOf = (id: string): number | null => {
        if (memo.has(id)) return memo.get(id)!;
        const row = byId.get(id);
        if (!row || visiting.has(id)) return null;
        visiting.add(id);
        let out: number | null = null;
        const s = row.source;
        switch (s.kind) {
            case 'items_sum':
                out = src.itemsSum(s.block_id, s.slug);
                break;
            case 'field':
                out = src.fieldNumber(s.slug);
                break;
            case 'percent': {
                const base = valueOf(s.of);
                out = base === null ? null : (base * s.pct) / 100;
                break;
            }
            case 'sum': {
                let total = 0;
                let any = false;
                for (const r of s.rows) {
                    const v = valueOf(r);
                    if (v !== null) {
                        total += v;
                        any = true;
                    }
                }
                for (const r of s.minus) {
                    const v = valueOf(r);
                    if (v !== null) {
                        total -= v;
                        any = true;
                    }
                }
                out = any ? total : null;
                break;
            }
            case 'text':
                out = null;
                break;
        }
        visiting.delete(id);
        // Sin redondeos intermedios raros: centavos.
        out = out === null ? null : Math.round(out * 100) / 100;
        memo.set(id, out);
        return out;
    };

    return rows.map((r) => ({
        id: r.id,
        label: r.label,
        emphasis: r.emphasis,
        num: r.source.kind === 'text' ? null : valueOf(r.id),
        text: r.source.kind === 'text' ? src.resolve(r.source.value) : null,
    }));
}

/** Todas las filas de totales del diseño (la primera aparición de cada id gana). */
export function computeDesignTotals(
    design: DocDesign,
    src: TotalsSources,
): { byBlock: Map<string, ComputedTotalRow[]>; byRowId: Map<string, number | null> } {
    const byBlock = new Map<string, ComputedTotalRow[]>();
    const byRowId = new Map<string, number | null>();
    for (const b of design.blocks) {
        if (b.type !== 'totals') continue;
        const rows = computeTotalRows(b.rows, src);
        byBlock.set(b.id, rows);
        for (const r of rows) if (!byRowId.has(r.id)) byRowId.set(r.id, r.num ?? null);
    }
    return { byBlock, byRowId };
}
