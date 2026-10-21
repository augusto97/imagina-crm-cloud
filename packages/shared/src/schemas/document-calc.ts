import {
    isComputedItemColumn,
    type DocDesign,
    type DocItemExpr,
    type DocItemsColumn,
    type DocTotalRow,
} from './document-design';

/**
 * v0.1.290 (ADR-S35) — Los CÁLCULOS de un documento, puros: las columnas
 * calculadas de la tabla de ítems (el total de cada línea) y las filas del
 * bloque «Totales» (subtotal, descuentos, base gravable, IVA, total).
 *
 * Viven en shared porque son el contrato: el servidor arma con esto el PDF
 * (vista previa del editor, botón de la ficha, automatización, portal — la
 * MISMA función) y los tests las prueban sin base de datos.
 *
 * Redondeo: cada línea se redondea a los decimales de su columna (la moneda)
 * y cada fila de totales a los del bloque, ANTES de usarla en otra cuenta.
 * Así el total impreso es exactamente la suma de lo que se ve impreso (lo
 * que espera quien revisa una factura con calculadora).
 */

/** Redondeo "comercial": la mitad se aleja del cero (2,5 → 3; −2,5 → −3). */
export function roundMoney(n: number, decimals: number): number {
    if (!Number.isFinite(n)) return n;
    const d = Math.max(0, Math.min(8, Math.trunc(decimals)));
    const abs = Math.abs(n);
    // Por notación exponencial y no `× 10^d`: 1,005 × 100 = 100,49999… y
    // redondearía para abajo.
    const str = String(abs);
    const rounded = str.includes('e') ? Math.round(abs * 10 ** d) / 10 ** d : Number(`${Math.round(Number(`${str}e${d}`))}e-${d}`);
    return n < 0 ? -rounded : rounded;
}

/** Evalúa una fórmula de columna. `lookup` da el valor numérico de una columna de la fila. */
export function evalDocItemExpr(expr: DocItemExpr, lookup: (slug: string) => number | null): number | null {
    switch (expr.op) {
        case 'col':
            return lookup(expr.slug);
        case 'const':
            return expr.value;
        case 'add':
        case 'sub': {
            let total = 0;
            let any = false;
            expr.args.forEach((a, i) => {
                const v = evalDocItemExpr(a, lookup);
                if (v === null) return;
                any = true;
                total = expr.op === 'sub' && i > 0 ? total - v : total + v;
            });
            return any ? total : null;
        }
        case 'mul':
        case 'div': {
            let acc: number | null = null;
            for (let i = 0; i < expr.args.length; i++) {
                const v = evalDocItemExpr(expr.args[i]!, lookup);
                if (v === null) return null;
                if (i === 0) acc = v;
                else if (expr.op === 'mul') acc = acc! * v;
                else {
                    if (v === 0) return null;
                    acc = acc! / v;
                }
            }
            return acc;
        }
        case 'pct':
        case 'minus_pct': {
            const of = evalDocItemExpr(expr.of, lookup);
            if (of === null) return null;
            const pct = evalDocItemExpr(expr.pct, lookup) ?? 0;
            return expr.op === 'pct' ? (of * pct) / 100 : of * (1 - pct / 100);
        }
    }
}

/**
 * Los valores de las columnas CALCULADAS de una fila, en orden y ya
 * redondeados. Una columna puede leer las calculadas ANTERIORES (el bruto
 * → el neto con descuento); una posterior se lee vacía (no hay ciclos).
 */
export function computeItemColumns(
    columns: readonly DocItemsColumn[],
    fieldNumber: (slug: string) => number | null,
): Map<string, number | null> {
    const out = new Map<string, number | null>();
    const computedKeys = new Set(columns.filter(isComputedItemColumn).map((c) => c.slug));
    const lookup = (slug: string): number | null => {
        if (out.has(slug)) return out.get(slug) ?? null;
        // Una calculada que todavía no se evaluó (posterior): vacía.
        if (computedKeys.has(slug)) return null;
        return fieldNumber(slug);
    };
    for (const c of columns) {
        if (!isComputedItemColumn(c)) continue;
        const v = evalDocItemExpr(c.expr, lookup);
        out.set(c.slug, v === null || !Number.isFinite(v) ? null : roundMoney(v, c.decimals ?? 2));
    }
    return out;
}

/**
 * Todas las filas de una tabla de ítems: los valores de sus columnas
 * calculadas y la SUMA de cada una (de los valores ya redondeados por línea,
 * así el subtotal impreso es la suma de lo que se ve). `rows` da, por fila,
 * el valor numérico de cada campo de la lista de ítems.
 */
export function computeItemsRows(
    columns: readonly DocItemsColumn[],
    rows: ReadonlyArray<(slug: string) => number | null>,
): { values: Array<Map<string, number | null>>; sums: Map<string, number> } {
    const values = rows.map((r) => computeItemColumns(columns, r));
    const sums = new Map<string, number>();
    for (const c of columns) {
        if (!isComputedItemColumn(c)) continue;
        let total = 0;
        let any = false;
        for (const v of values) {
            const n = v.get(c.slug);
            if (n === null || n === undefined) continue;
            total += n;
            any = true;
        }
        // Sin ítems la suma es 0 (una cotización vacía cuesta $ 0); con ítems
        // pero todos vacíos queda sin dato ("—"): algo falta en la plantilla.
        if (any) sums.set(c.slug, roundMoney(total, c.decimals ?? 2));
        else if (rows.length === 0) sums.set(c.slug, 0);
    }
    return { values, sums };
}

const OP_SYMBOL: Record<'add' | 'sub' | 'mul' | 'div', string> = { add: '+', sub: '−', mul: '×', div: '÷' };

/** La fórmula en lenguaje humano: "Cantidad × Precio − Descuento %". */
export function describeDocItemExpr(expr: DocItemExpr, label: (slug: string) => string, nested = false): string {
    switch (expr.op) {
        case 'col':
            return label(expr.slug);
        case 'const':
            return String(expr.value).replace('.', ',');
        case 'pct':
            return `${describeDocItemExpr(expr.pct, label, true)} % de ${describeDocItemExpr(expr.of, label, true)}`;
        case 'minus_pct':
            return `${describeDocItemExpr(expr.of, label, true)} − ${describeDocItemExpr(expr.pct, label, true)} %`;
        default: {
            const inner = expr.args.map((a) => describeDocItemExpr(a, label, true)).join(` ${OP_SYMBOL[expr.op]} `);
            return nested ? `(${inner})` : inner;
        }
    }
}

// ── Totales ──────────────────────────────────────────────────────────────

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
    /** No se dibuja (oculta, o en cero con «ocultar si da 0»). */
    hidden: boolean;
}

/**
 * Las filas de un bloque «Totales». Las referencias a otras filas se
 * resuelven por id en cualquier orden (con guarda contra ciclos) y cada fila
 * se redondea a `decimals` (los del bloque) antes de usarse en otra.
 */
export function computeTotalRows(rows: readonly DocTotalRow[], src: TotalsSources, opts: { decimals?: number } = {}): ComputedTotalRow[] {
    const decimals = opts.decimals ?? 2;
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
                const fromField = s.pct_field ? src.fieldNumber(s.pct_field) : null;
                const pct = fromField ?? s.pct;
                out = base === null ? null : ((s.negate ? -1 : 1) * base * pct) / 100;
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
        out = out === null || !Number.isFinite(out) ? null : roundMoney(out, decimals);
        // −0 se imprime "-0": sin signo.
        if (out === 0) out = 0;
        memo.set(id, out);
        return out;
    };

    return rows.map((r) => {
        const num = r.source.kind === 'text' ? null : valueOf(r.id);
        return {
            id: r.id,
            label: r.label,
            emphasis: r.emphasis,
            num,
            text: r.source.kind === 'text' ? src.resolve(r.source.value) : null,
            hidden: r.hidden === true || (r.hide_zero === true && r.source.kind !== 'text' && (num === null || num === 0)),
        };
    });
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
        const rows = computeTotalRows(b.rows, src, { decimals: b.decimals });
        byBlock.set(b.id, rows);
        for (const r of rows) if (!byRowId.has(r.id)) byRowId.set(r.id, r.num ?? null);
    }
    return { byBlock, byRowId };
}
