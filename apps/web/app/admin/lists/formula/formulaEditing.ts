import { findFormulaFunction, normalizeFunctionName, type FormulaFunctionDef } from '@imagina-base/shared';

/**
 * Fórmulas (A1) — piezas PURAS del editor: qué se está escribiendo donde está
 * el cursor (para autocompletar), en qué argumento de qué función (para la
 * ayuda de la firma) y cómo pintar el texto. Toleran texto a medio escribir:
 * nunca lanzan (el lector de verdad, `parseFormula`, sí lo hace).
 */

export type SegmentKind = 'fn' | 'ref' | 'str' | 'num' | 'op' | 'paren' | 'sep' | 'ident' | 'plain';

export interface Segment {
    kind: SegmentKind;
    start: number;
    end: number;
}

const IDENT_START = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ_]/;
const IDENT_CHAR = /[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ_.]/;
const OP_CHARS = '+-*/^%&=<>!';

/** Segmentos para pintar el texto (tolerante: el texto sin cerrar se pinta igual). */
export function highlightSegments(text: string): Segment[] {
    const out: Segment[] = [];
    let i = 0;
    const push = (kind: SegmentKind, start: number, end: number): void => {
        if (end > start) out.push({ kind, start, end });
    };
    while (i < text.length) {
        const c = text[i]!;
        if (c === '{') {
            const start = i;
            i++;
            while (i < text.length && text[i] !== '}') {
                if (text[i] === '\\' && i + 1 < text.length) i++;
                i++;
            }
            if (i < text.length) i++;
            push('ref', start, i);
            continue;
        }
        if (c === '"' || c === "'") {
            const start = i;
            i++;
            while (i < text.length) {
                if (text[i] === '\\' && i + 1 < text.length) {
                    i += 2;
                    continue;
                }
                if (text[i] === c) {
                    if (text[i + 1] === c) {
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
            push('str', start, i);
            continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
            const start = i;
            while (i < text.length && /[0-9.]/.test(text[i]!)) i++;
            push('num', start, i);
            continue;
        }
        if (IDENT_START.test(c)) {
            const start = i;
            while (i < text.length && IDENT_CHAR.test(text[i]!)) i++;
            let j = i;
            while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
            const name = text.slice(start, i);
            const isCall = text[j] === '(';
            const known = findFormulaFunction(name) !== undefined;
            const upper = normalizeFunctionName(name);
            const isLiteral = upper === 'VERDADERO' || upper === 'FALSO' || upper === 'TRUE' || upper === 'FALSE';
            push(isCall || known || isLiteral ? 'fn' : 'ident', start, i);
            continue;
        }
        if (c === '(' || c === ')') {
            push('paren', i, i + 1);
            i++;
            continue;
        }
        if (c === ',' || c === ';') {
            push('sep', i, i + 1);
            i++;
            continue;
        }
        if (OP_CHARS.includes(c)) {
            push('op', i, i + 1);
            i++;
            continue;
        }
        const start = i;
        while (i < text.length && !/[{"'0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ_(),;]/.test(text[i]!) && !OP_CHARS.includes(text[i]!)) i++;
        if (i === start) i++;
        push('plain', start, i);
    }
    return out;
}

/** ¿Dónde está el cursor? Fuera de todo, dentro de un texto o dentro de un `{campo}` sin cerrar. */
function scanState(text: string, caret: number): { inString: boolean; refStart: number | null } {
    let i = 0;
    let inString: string | null = null;
    let refStart: number | null = null;
    while (i < caret) {
        const c = text[i]!;
        if (refStart !== null) {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === '}') refStart = null;
            i++;
            continue;
        }
        if (inString) {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === inString) {
                if (text[i + 1] === inString && i + 1 < caret) {
                    i += 2;
                    continue;
                }
                inString = null;
            }
            i++;
            continue;
        }
        if (c === '"' || c === "'") inString = c;
        else if (c === '{') refStart = i;
        i++;
    }
    return { inString: inString !== null, refStart };
}

export type CompletionContext =
    | { kind: 'field'; query: string; start: number; end: number }
    | { kind: 'function'; query: string; start: number; end: number }
    | null;

/**
 * Qué se está escribiendo en el cursor: el nombre de un campo (después de una
 * `{` sin cerrar) o el de una función (letras sueltas fuera de un texto).
 * `start`/`end` es el tramo que reemplaza la sugerencia elegida.
 */
export function completionContext(text: string, caret: number): CompletionContext {
    const state = scanState(text, caret);
    if (state.refStart !== null) {
        // Si el `}` ya está justo después del cursor, la sugerencia lo reemplaza.
        let end = caret;
        while (end < text.length && text[end] !== '}' && text[end] !== '{' && text[end] !== '\n') end++;
        end = text[end] === '}' ? end + 1 : caret;
        return { kind: 'field', query: text.slice(state.refStart + 1, caret), start: state.refStart, end };
    }
    if (state.inString) return null;
    let start = caret;
    while (start > 0 && IDENT_CHAR.test(text[start - 1]!)) start--;
    const word = text.slice(start, caret);
    if (word === '' || !IDENT_START.test(word[0]!)) return null;
    // Un número decimal pegado (`1.5`) no es un nombre.
    if (start > 0 && /[0-9]/.test(text[start - 1]!)) return null;
    let end = caret;
    while (end < text.length && IDENT_CHAR.test(text[end]!)) end++;
    return { kind: 'function', query: word, start, end };
}

export interface SignatureContext {
    fn: FormulaFunctionDef;
    /** Índice del argumento donde está el cursor (0 = el primero). */
    argIndex: number;
}

/** ¿En qué argumento de qué función está el cursor? (para mostrar su firma) */
export function signatureContext(text: string, caret: number): SignatureContext | null {
    const stack: Array<{ name: string | null; arg: number }> = [];
    let i = 0;
    let inString: string | null = null;
    let inRef = false;
    while (i < caret) {
        const c = text[i]!;
        if (inRef) {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === '}') inRef = false;
            i++;
            continue;
        }
        if (inString) {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === inString) {
                if (text[i + 1] === inString && i + 1 < caret) {
                    i += 2;
                    continue;
                }
                inString = null;
            }
            i++;
            continue;
        }
        if (c === '"' || c === "'") inString = c;
        else if (c === '{') inRef = true;
        else if (c === '(') {
            let j = i - 1;
            while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
            let k = j;
            while (k >= 0 && IDENT_CHAR.test(text[k]!)) k--;
            const name = j >= 0 && k < j ? text.slice(k + 1, j + 1) : null;
            stack.push({ name, arg: 0 });
        } else if (c === ')') stack.pop();
        else if ((c === ',' || c === ';') && stack.length > 0) stack[stack.length - 1]!.arg++;
        i++;
    }
    for (let s = stack.length - 1; s >= 0; s--) {
        const frame = stack[s]!;
        if (!frame.name) continue;
        const fn = findFormulaFunction(frame.name);
        if (fn) return { fn, argIndex: frame.arg };
        return null;
    }
    return null;
}

/** Reemplaza `[start, end)` por `insert`; devuelve el texto y dónde queda el cursor. */
export function applyCompletion(
    text: string,
    range: { start: number; end: number },
    insert: string,
    caretOffset = insert.length,
): { text: string; caret: number } {
    return { text: text.slice(0, range.start) + insert + text.slice(range.end), caret: range.start + caretOffset };
}

/** Lo que se inserta al elegir una función: `NOMBRE(` (o `NOMBRE()` si no lleva argumentos). */
export function functionInsertText(fn: FormulaFunctionDef, nextChar: string | undefined): { insert: string; caretOffset: number } {
    if (nextChar === '(') return { insert: fn.name, caretOffset: fn.name.length + 1 };
    if (fn.maxArgs === 0) return { insert: `${fn.name}()`, caretOffset: fn.name.length + 2 };
    return { insert: `${fn.name}(`, caretOffset: fn.name.length + 1 };
}

/** Texto sin tildes y en minúsculas, para buscar. */
export function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}
