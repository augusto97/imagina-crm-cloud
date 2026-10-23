/**
 * Fórmulas (opción A1) — lector de tokens.
 *
 * El lenguaje está en español y se escribe como en una hoja de cálculo:
 * `SI({Total} > 1000000, "Grande", "Chico")`. Un campo va entre llaves; al
 * GUARDAR la referencia pasa a ser `{#id}` (regla de oro nº 1: renombrar un
 * campo no rompe la fórmula) y al MOSTRARLA vuelve a su nombre.
 *
 * Todo es puro y sin `eval`: el mismo lector corre en el navegador (editor,
 * vista previa) y en el servidor (cada lectura, compilación a SQL).
 */

import { FORMULA_MAX_LENGTH } from './constants';

export type TokenKind =
    | 'num'
    | 'str'
    | 'ref'
    | 'ident'
    | 'lparen'
    | 'rparen'
    | 'sep'
    | 'op'
    | 'eof';

export interface Token {
    kind: TokenKind;
    /** Texto ya interpretado: el número, el texto sin comillas, el nombre de la referencia. */
    value: string;
    /** Posición en el texto original (offset desde 0) — inicio y fin (exclusivo). */
    start: number;
    end: number;
}

/** Error de sintaxis con su posición (columna desde 1, como lo lee una persona). */
export class FormulaSyntaxError extends Error {
    constructor(
        message: string,
        readonly start: number,
        readonly end: number,
    ) {
        super(message);
        this.name = 'FormulaSyntaxError';
    }
}


const OPERATORS = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '%', '&', '=', '<', '>'] as const;

const IDENT_START = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ_]/;
const IDENT_PART = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_.]/;

/**
 * Parte el texto en tokens. Lanza `FormulaSyntaxError` con la posición del
 * problema (comillas o llaves sin cerrar, un carácter que no es del lenguaje).
 */
export function tokenize(text: string): Token[] {
    if (text.length > FORMULA_MAX_LENGTH) {
        throw new FormulaSyntaxError(
            `La fórmula es demasiado larga (máximo ${FORMULA_MAX_LENGTH} caracteres).`,
            FORMULA_MAX_LENGTH,
            text.length,
        );
    }
    const out: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i]!;
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ') {
            i++;
            continue;
        }
        const start = i;
        // Número: 12 · 12.5 · .5 · 1e6. El decimal SIEMPRE es punto (la coma
        // separa argumentos, como en Airtable y ClickUp).
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
            const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
            const raw = m![0];
            i += raw.length;
            if (IDENT_START.test(text[i] ?? '')) {
                throw new FormulaSyntaxError(`«${raw}${text[i]}» no es un número válido.`, start, i + 1);
            }
            out.push({ kind: 'num', value: raw, start, end: i });
            continue;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            let value = '';
            i++;
            let closed = false;
            while (i < text.length) {
                const ch = text[i]!;
                if (ch === '\\' && i + 1 < text.length) {
                    const next = text[i + 1]!;
                    value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                    i += 2;
                    continue;
                }
                if (ch === quote) {
                    // `""` dentro de un texto es una comilla (como en Excel).
                    if (text[i + 1] === quote) {
                        value += quote;
                        i += 2;
                        continue;
                    }
                    i++;
                    closed = true;
                    break;
                }
                value += ch;
                i++;
            }
            if (!closed) throw new FormulaSyntaxError('Falta cerrar las comillas de un texto.', start, text.length);
            out.push({ kind: 'str', value, start, end: i });
            continue;
        }
        if (c === '{') {
            let value = '';
            i++;
            let closed = false;
            while (i < text.length) {
                const ch = text[i]!;
                if (ch === '\\' && i + 1 < text.length) {
                    value += text[i + 1]!;
                    i += 2;
                    continue;
                }
                if (ch === '}') {
                    i++;
                    closed = true;
                    break;
                }
                if (ch === '{') break;
                value += ch;
                i++;
            }
            if (!closed) throw new FormulaSyntaxError('Falta cerrar la llave } del nombre de un campo.', start, i);
            if (value.trim() === '') throw new FormulaSyntaxError('Escribe el nombre del campo entre las llaves.', start, i);
            out.push({ kind: 'ref', value: value.trim(), start, end: i });
            continue;
        }
        if (IDENT_START.test(c)) {
            while (i < text.length && IDENT_PART.test(text[i]!)) i++;
            out.push({ kind: 'ident', value: text.slice(start, i), start, end: i });
            continue;
        }
        if (c === '(') {
            out.push({ kind: 'lparen', value: c, start, end: ++i });
            continue;
        }
        if (c === ')') {
            out.push({ kind: 'rparen', value: c, start, end: ++i });
            continue;
        }
        if (c === ',' || c === ';') {
            out.push({ kind: 'sep', value: c, start, end: ++i });
            continue;
        }
        const op = OPERATORS.find((o) => text.startsWith(o, i));
        if (op) {
            i += op.length;
            // `!=` y `==` se aceptan por costumbre: se leen como `<>` y `=`.
            out.push({ kind: 'op', value: op === '!=' ? '<>' : op === '==' ? '=' : op, start, end: i });
            continue;
        }
        if (c === '}') throw new FormulaSyntaxError('Hay una llave } de más: los campos se escriben {Nombre}.', start, start + 1);
        throw new FormulaSyntaxError(`El carácter «${c}» no es parte del lenguaje de fórmulas.`, start, start + 1);
    }
    out.push({ kind: 'eof', value: '', start: text.length, end: text.length });
    return out;
}

/** Línea y columna (desde 1) de una posición del texto. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { line, column: col };
}

/** «en la columna 18» o «en la línea 2, columna 5». */
export function positionText(text: string, offset: number): string {
    const { line, column } = lineColumn(text, offset);
    return text.includes('\n') ? `en la línea ${line}, columna ${column}` : `en la columna ${column}`;
}

/** Escapa un nombre para escribirlo entre llaves (`}` y `\` llevan barra). */
export function escapeRefName(name: string): string {
    return name.replace(/[\\}{]/g, (m) => `\\${m}`);
}
