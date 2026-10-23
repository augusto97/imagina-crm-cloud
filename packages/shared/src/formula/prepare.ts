import { findFormulaCycle, formulaRefNotAllowed, type FormulaTypingField } from './analyze';
import { FormulaSyntaxError, positionText } from './lexer';
import { parseFormula, walkFormula } from './parser';
import { formulaToStored, lookupRef, type FormulaFieldRef, type FormulaIssue } from './refs';

/**
 * Fórmulas — revisión COMPLETA antes de guardar, con las posiciones sobre el
 * texto que escribió la persona (por nombre): sintaxis, campos que existen y
 * se pueden usar, que no se use a sí misma y que no forme un ciclo con otras
 * fórmulas. La usan el servidor (al guardar, también lo que manda el
 * asistente o la API) y el editor (mientras se escribe).
 */
export type PreparedFormula =
    | { ok: true; stored: string; refs: number[]; labels: Record<string, string> }
    | { ok: false; error: FormulaIssue };

export function prepareFormula(
    text: string,
    fields: ReadonlyArray<FormulaFieldRef & FormulaTypingField>,
    selfId: number | null = null,
): PreparedFormula {
    let ast;
    try {
        ast = parseFormula(text);
    } catch (e) {
        if (e instanceof FormulaSyntaxError) return { ok: false, error: { message: e.message, start: e.start, end: e.end } };
        throw e;
    }
    let issue: FormulaIssue | null = null;
    walkFormula(ast, (n) => {
        if (issue || n.k !== 'ref') return;
        const hit = lookupRef(n.name, fields);
        if (!hit.ok) {
            issue = { message: `${hit.message} (${positionText(text, n.start)})`, start: n.start, end: n.end };
            return;
        }
        if (selfId !== null && hit.field.id === selfId) {
            issue = { message: `Una fórmula no puede usarse a sí misma (${positionText(text, n.start)}).`, start: n.start, end: n.end };
            return;
        }
        const notAllowed = formulaRefNotAllowed(hit.field.type);
        if (notAllowed) issue = { message: `${notAllowed} (${positionText(text, n.start)})`, start: n.start, end: n.end };
    });
    if (issue) return { ok: false, error: issue };
    const converted = formulaToStored(text, fields, { selfId });
    if (!converted.ok) return converted;
    const cycle = findFormulaCycle(converted.stored, fields, selfId);
    if (cycle) {
        return {
            ok: false,
            error: {
                message: `Las fórmulas se usan entre sí en círculo: ${cycle.map((f) => `«${f.label ?? `#${f.id}`}»`).join(' → ')}. Una de ellas tiene que dejar de usar a la otra.`,
                start: 0,
                end: text.length,
            },
        };
    }
    const labels: Record<string, string> = {};
    for (const id of converted.refs) {
        const f = fields.find((x) => x.id === id);
        if (f) labels[String(id)] = f.label;
    }
    return { ok: true, stored: converted.stored, refs: converted.refs, labels };
}

/**
 * ¿La fórmula GUARDADA de un campo sigue sana? Lo que puede pasar después de
 * guardarla: un campo que usa se borró (o está en la papelera), cambió a un
 * tipo que no se puede usar, o se armó un ciclo. `null` si está bien.
 */
export function formulaHealth(
    field: { id: number; config?: Record<string, unknown> | null },
    fields: ReadonlyArray<FormulaFieldRef & FormulaTypingField>,
): string | null {
    const cfg = (field.config ?? {}) as Record<string, unknown>;
    const stored = typeof cfg.formula === 'string' ? cfg.formula : '';
    if (stored.trim() === '') return 'La fórmula está vacía.';
    let ast;
    try {
        ast = parseFormula(stored);
    } catch (e) {
        return e instanceof Error ? e.message : 'La fórmula tiene un error.';
    }
    const labels = (cfg.labels && typeof cfg.labels === 'object' ? cfg.labels : {}) as Record<string, string>;
    let problem: string | null = null;
    walkFormula(ast, (n) => {
        if (problem || n.k !== 'ref') return;
        const m = /^#(\d+)$/.exec(n.name);
        const id = m ? Number(m[1]) : null;
        const f = id === null ? undefined : fields.find((x) => x.id === id);
        if (!f) {
            const known = id !== null ? labels[String(id)] : undefined;
            problem = known
                ? `El campo «${known}» no existe (está en la papelera o se borró).`
                : 'Usa un campo que ya no existe (está en la papelera o se borró).';
            return;
        }
        const notAllowed = formulaRefNotAllowed(f.type);
        if (notAllowed) problem = `${notAllowed} («${f.label}»)`;
    });
    if (problem) return problem;
    const cycle = findFormulaCycle(stored, fields, field.id);
    if (cycle) return `Las fórmulas se usan entre sí en círculo: ${cycle.map((f) => `«${f.label ?? `#${f.id}`}»`).join(' → ')}.`;
    return null;
}
