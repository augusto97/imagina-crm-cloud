import type { DocItemExpr, DocItemsColumn } from '@imagina-base/shared';

/**
 * v0.1.290 — El editor de las columnas CALCULADAS de la tabla de ítems.
 *
 * El modelo guardado es un mini-árbol de operaciones (`DocItemExpr`, sin
 * código). Para editarlo sin escribir fórmulas, el editor ofrece las formas
 * que se usan de verdad —«A × B», «A × B − descuento %», «A + B»…— con un
 * selector por operando (una columna o un número fijo). Estas funciones
 * PURAS traducen entre las dos cosas; una fórmula que no encaja en ninguna
 * forma (armada por el asistente/MCP) se muestra tal cual y se puede
 * reemplazar por una de las formas.
 */

export type FormulaOperand = { kind: 'col'; slug: string } | { kind: 'const'; value: number };

export const FORMULA_KINDS = ['mul', 'mul_disc', 'add', 'sub', 'div', 'pct', 'minus_pct', 'ref'] as const;
export type FormulaKind = (typeof FORMULA_KINDS)[number];

export interface Formula {
    kind: FormulaKind;
    a: FormulaOperand;
    b: FormulaOperand;
    /** El descuento % de «A × B − D %». */
    d: FormulaOperand;
}

/** Cuántos operandos usa cada forma (A, B y D). */
export const FORMULA_ARITY: Record<FormulaKind, 1 | 2 | 3> = {
    ref: 1,
    mul: 2,
    add: 2,
    sub: 2,
    div: 2,
    pct: 2,
    minus_pct: 2,
    mul_disc: 3,
};

const empty: FormulaOperand = { kind: 'const', value: 0 };

function operandOf(expr: DocItemExpr): FormulaOperand | null {
    if (expr.op === 'col') return { kind: 'col', slug: expr.slug };
    if (expr.op === 'const') return { kind: 'const', value: expr.value };
    return null;
}

function exprOf(o: FormulaOperand): DocItemExpr {
    return o.kind === 'col' ? { op: 'col', slug: o.slug } : { op: 'const', value: o.value };
}

/** Fórmula guardada → forma del editor (null = no encaja: «personalizada»). */
export function exprToFormula(expr: DocItemExpr | undefined): Formula | null {
    if (!expr) return null;
    const base = { b: empty, d: empty };
    if (expr.op === 'col' || expr.op === 'const') {
        const a = operandOf(expr);
        return a ? { kind: 'ref', a, ...base } : null;
    }
    if (!('args' in expr)) {
        const of = expr.of;
        if (expr.op === 'minus_pct' && 'args' in of && of.op === 'mul' && of.args.length === 2) {
            const a = operandOf(of.args[0]!);
            const b = operandOf(of.args[1]!);
            const d = operandOf(expr.pct);
            return a && b && d ? { kind: 'mul_disc', a, b, d } : null;
        }
        const a = operandOf(of);
        const b = operandOf(expr.pct);
        return a && b ? { kind: expr.op, a, b, d: empty } : null;
    }
    if (expr.args.length !== 2) return null;
    const a = operandOf(expr.args[0]!);
    const b = operandOf(expr.args[1]!);
    return a && b ? { kind: expr.op, a, b, d: empty } : null;
}

/** Forma del editor → fórmula guardada. */
export function formulaToExpr(f: Formula): DocItemExpr {
    switch (f.kind) {
        case 'ref':
            return exprOf(f.a);
        case 'mul_disc':
            return { op: 'minus_pct', of: { op: 'mul', args: [exprOf(f.a), exprOf(f.b)] }, pct: exprOf(f.d) };
        case 'pct':
        case 'minus_pct':
            return { op: f.kind, of: exprOf(f.a), pct: exprOf(f.b) };
        default:
            return { op: f.kind, args: [exprOf(f.a), exprOf(f.b)] };
    }
}

/**
 * Cambiar el campo de una columna (p. ej. elegir el campo de la marcadora
 * «[Precio unitario]») re-apunta TAMBIÉN las fórmulas que la leían.
 */
export function renameItemsColumnRef(columns: readonly DocItemsColumn[], from: string, to: string): DocItemsColumn[] {
    const walk = (e: DocItemExpr): DocItemExpr => {
        if (e.op === 'col') return e.slug === from ? { op: 'col', slug: to } : e;
        if (e.op === 'const') return e;
        if ('args' in e) return { ...e, args: e.args.map(walk) };
        return { ...e, of: walk(e.of), pct: walk(e.pct) };
    };
    return columns.map((c) => ({
        ...c,
        ...(c.slug === from ? { slug: to } : {}),
        ...(c.kind === 'computed' && c.expr ? { expr: walk(c.expr) } : {}),
    }));
}

/** Una clave libre para una columna calculada nueva ("calc_1", "calc_2"…). */
export function newComputedKey(columns: readonly DocItemsColumn[]): string {
    const used = new Set(columns.map((c) => c.slug));
    for (let i = 1; ; i++) if (!used.has(`calc_${i}`)) return `calc_${i}`;
}
