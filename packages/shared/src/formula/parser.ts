import { findFormulaFunction } from './catalog';
import { FormulaSyntaxError, positionText, tokenize, type Token } from './lexer';

/**
 * Fórmulas — árbol de la expresión.
 *
 * Precedencia (de menor a mayor), la de las hojas de cálculo:
 *   comparación (= <> < > <= >=) → unión de texto (&) → suma/resta →
 *   multiplicación/división/residuo → potencia (^) → signo (-x) → porcentaje (x%)
 *
 * `%` después de un valor es PORCENTAJE (`19%` = 0,19) salvo que le siga
 * otro valor, en cuyo caso es el RESIDUO (`10 % 3` = 1): `{Precio} * 19%` y
 * `{Unidades} % 12` se leen como se escriben. Como en Excel, `-2^2` = 4.
 */

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '%' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

interface Span {
    start: number;
    end: number;
}

export type FormulaNode =
    | ({ k: 'num'; v: number } & Span)
    | ({ k: 'str'; v: string } & Span)
    | ({ k: 'bool'; v: boolean } & Span)
    /** `name`: lo que estaba entre llaves (sin interpretar). */
    | ({ k: 'ref'; name: string } & Span)
    /** `fn`: el nombre canónico de la función (`SI`), `raw` como se escribió. */
    | ({ k: 'call'; fn: string; raw: string; args: FormulaNode[] } & Span)
    | ({ k: 'neg'; arg: FormulaNode } & Span)
    | ({ k: 'pct'; arg: FormulaNode } & Span)
    | ({ k: 'bin'; op: BinaryOp; l: FormulaNode; r: FormulaNode } & Span);

/** Profundidad máxima de anidado (paréntesis + funciones + operadores). */
export const FORMULA_MAX_DEPTH = 40;
/** Cantidad máxima de piezas del árbol. */
export const FORMULA_MAX_NODES = 1500;

const COMPARISON = new Set(['=', '<>', '<', '>', '<=', '>=']);

const OPERAND_START = new Set(['num', 'str', 'ref', 'ident', 'lparen']);

/**
 * Lee una fórmula y devuelve su árbol. Lanza `FormulaSyntaxError` con la
 * posición y un mensaje en lenguaje claro («falta un paréntesis en la columna
 * 18»). No resuelve los campos: eso lo hace quien conoce la lista.
 */
export function parseFormula(text: string): FormulaNode {
    const tokens = tokenize(text);
    const p = new Parser(text, tokens);
    if (tokens.length === 1) throw new FormulaSyntaxError('Escribe la fórmula.', 0, 0);
    const node = p.expression(0);
    const t = p.peek();
    if (t.kind !== 'eof') {
        if (t.kind === 'rparen') throw p.error(`Hay un paréntesis de cierre de más ${positionText(text, t.start)}.`, t);
        throw p.error(`Falta un operador o una coma antes de «${p.show(t)}» ${positionText(text, t.start)}.`, t);
    }
    return node;
}

class Parser {
    private i = 0;
    private nodes = 0;

    constructor(
        private readonly text: string,
        private readonly tokens: Token[],
    ) {}

    peek(offset = 0): Token {
        return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]!;
    }

    private next(): Token {
        const t = this.peek();
        if (this.i < this.tokens.length - 1) this.i++;
        return t;
    }

    show(t: Token): string {
        return t.kind === 'eof' ? 'el final' : this.text.slice(t.start, t.end);
    }

    error(message: string, t: Pick<Token, 'start' | 'end'>): FormulaSyntaxError {
        return new FormulaSyntaxError(message, t.start, Math.max(t.end, t.start + 1));
    }

    private count(span: Span): void {
        if (++this.nodes > FORMULA_MAX_NODES) {
            throw new FormulaSyntaxError(
                `La fórmula es demasiado grande (más de ${FORMULA_MAX_NODES} piezas): divídela en varias fórmulas.`,
                span.start,
                span.end,
            );
        }
    }

    private guardDepth(depth: number, t: Token): void {
        if (depth > FORMULA_MAX_DEPTH) {
            throw this.error(`La fórmula anida demasiado (más de ${FORMULA_MAX_DEPTH} niveles) ${positionText(this.text, t.start)}.`, t);
        }
    }

    expression(depth: number): FormulaNode {
        return this.comparison(depth);
    }

    private comparison(depth: number): FormulaNode {
        let left = this.concat(depth);
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || !COMPARISON.has(t.value)) return left;
            this.next();
            const right = this.concat(depth + 1);
            left = this.bin(t.value as BinaryOp, left, right);
        }
    }

    private concat(depth: number): FormulaNode {
        let left = this.additive(depth);
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || t.value !== '&') return left;
            this.next();
            left = this.bin('&', left, this.additive(depth + 1));
        }
    }

    private additive(depth: number): FormulaNode {
        let left = this.multiplicative(depth);
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) return left;
            this.next();
            left = this.bin(t.value, left, this.multiplicative(depth + 1));
        }
    }

    private multiplicative(depth: number): FormulaNode {
        let left = this.power(depth);
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || (t.value !== '*' && t.value !== '/' && t.value !== '%')) return left;
            this.next();
            left = this.bin(t.value, left, this.power(depth + 1));
        }
    }

    private power(depth: number): FormulaNode {
        let left = this.unary(depth);
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || t.value !== '^') return left;
            this.next();
            left = this.bin('^', left, this.unary(depth + 1));
        }
    }

    private unary(depth: number): FormulaNode {
        const t = this.peek();
        this.guardDepth(depth, t);
        if (t.kind === 'op' && (t.value === '-' || t.value === '+')) {
            this.next();
            const arg = this.unary(depth + 1);
            if (t.value === '+') return arg;
            const node: FormulaNode = { k: 'neg', arg, start: t.start, end: arg.end };
            this.count(node);
            return node;
        }
        return this.postfix(depth);
    }

    private postfix(depth: number): FormulaNode {
        let node = this.primary(depth);
        for (;;) {
            const t = this.peek();
            if (t.kind !== 'op' || t.value !== '%') return node;
            // `%` seguido de otro valor es el residuo (lo toma `multiplicative`).
            if (OPERAND_START.has(this.peek(1).kind)) return node;
            this.next();
            node = { k: 'pct', arg: node, start: node.start, end: t.end };
            this.count(node);
        }
    }

    private primary(depth: number): FormulaNode {
        const t = this.peek();
        switch (t.kind) {
            case 'num': {
                this.next();
                const v = Number(t.value);
                if (!Number.isFinite(v)) throw this.error(`El número «${t.value}» es demasiado grande.`, t);
                const node: FormulaNode = { k: 'num', v, start: t.start, end: t.end };
                this.count(node);
                return node;
            }
            case 'str': {
                this.next();
                const node: FormulaNode = { k: 'str', v: t.value, start: t.start, end: t.end };
                this.count(node);
                return node;
            }
            case 'ref': {
                this.next();
                const node: FormulaNode = { k: 'ref', name: t.value, start: t.start, end: t.end };
                this.count(node);
                return node;
            }
            case 'lparen': {
                this.next();
                if (this.peek().kind === 'rparen') {
                    throw this.error(`Hay unos paréntesis vacíos ${positionText(this.text, t.start)}.`, this.peek());
                }
                const inner = this.expression(depth + 1);
                const close = this.peek();
                if (close.kind !== 'rparen') {
                    throw this.error(
                        `Falta un paréntesis de cierre ) ${positionText(this.text, close.start)} (el que se abrió ${positionText(this.text, t.start)}).`,
                        close,
                    );
                }
                this.next();
                return { ...inner, start: t.start, end: close.end };
            }
            case 'ident':
                return this.callOrWord(depth);
            case 'rparen':
                throw this.error(`Falta un valor antes del paréntesis ) ${positionText(this.text, t.start)}.`, t);
            case 'sep':
                throw this.error(`Falta un valor antes de la coma ${positionText(this.text, t.start)}.`, t);
            case 'op':
                throw this.error(`Falta un valor antes de «${t.value}» ${positionText(this.text, t.start)}.`, t);
            case 'eof':
                throw this.error(
                    this.text.trim() === '' ? 'Escribe la fórmula.' : `La fórmula termina antes de tiempo: falta un valor ${positionText(this.text, t.start)}.`,
                    t,
                );
        }
    }

    private callOrWord(depth: number): FormulaNode {
        const t = this.next();
        const def = findFormulaFunction(t.value);
        if (this.peek().kind !== 'lparen') {
            // VERDADERO / FALSO también se escriben sin paréntesis.
            if (def?.name === 'VERDADERO' || def?.name === 'FALSO') {
                const node: FormulaNode = { k: 'bool', v: def.name === 'VERDADERO', start: t.start, end: t.end };
                this.count(node);
                return node;
            }
            if (def) {
                throw this.error(`A ${def.name} le faltan los paréntesis: ${def.name}(…) ${positionText(this.text, t.end)}.`, t);
            }
            throw this.error(
                `«${t.value}» no es una función ni un campo ${positionText(this.text, t.start)}. Los campos se escriben entre llaves: {${t.value}}.`,
                t,
            );
        }
        if (!def) {
            throw this.error(`La función «${t.value}» no existe ${positionText(this.text, t.start)}.`, t);
        }
        const open = this.next();
        const args: FormulaNode[] = [];
        if (this.peek().kind !== 'rparen') {
            for (;;) {
                args.push(this.expression(depth + 1));
                const sep = this.peek();
                if (sep.kind === 'sep') {
                    this.next();
                    if (this.peek().kind === 'rparen') {
                        throw this.error(`Sobra una coma al final de ${def.name} ${positionText(this.text, sep.start)}.`, sep);
                    }
                    continue;
                }
                if (sep.kind === 'rparen') break;
                if (sep.kind === 'eof') {
                    throw this.error(
                        `Falta un paréntesis de cierre ) para ${def.name} ${positionText(this.text, sep.start)} (se abrió ${positionText(this.text, open.start)}).`,
                        sep,
                    );
                }
                throw this.error(`Falta una coma entre los argumentos de ${def.name} ${positionText(this.text, sep.start)}.`, sep);
            }
        }
        const close = this.next();
        if (args.length < def.minArgs || args.length > def.maxArgs) {
            const want =
                def.minArgs === def.maxArgs
                    ? `${def.minArgs} argumento${def.minArgs === 1 ? '' : 's'}`
                    : def.maxArgs >= 30
                      ? `al menos ${def.minArgs}`
                      : `entre ${def.minArgs} y ${def.maxArgs} argumentos`;
            throw new FormulaSyntaxError(
                `${def.name} recibe ${want} y tiene ${args.length} ${positionText(this.text, t.start)}.`,
                t.start,
                close.end,
            );
        }
        const node: FormulaNode = { k: 'call', fn: def.name, raw: t.value, args, start: t.start, end: close.end };
        this.count(node);
        return node;
    }

    private bin(op: BinaryOp, l: FormulaNode, r: FormulaNode): FormulaNode {
        const node: FormulaNode = { k: 'bin', op, l, r, start: l.start, end: r.end };
        this.count(node);
        return node;
    }
}

/** Recorre el árbol (pre-orden). */
export function walkFormula(node: FormulaNode, visit: (n: FormulaNode) => void): void {
    visit(node);
    switch (node.k) {
        case 'call':
            for (const a of node.args) walkFormula(a, visit);
            return;
        case 'neg':
        case 'pct':
            walkFormula(node.arg, visit);
            return;
        case 'bin':
            walkFormula(node.l, visit);
            walkFormula(node.r, visit);
            return;
        default:
            return;
    }
}

const parseCache = new Map<string, { ok: true; ast: FormulaNode } | { ok: false; error: FormulaSyntaxError }>();

/**
 * `parseFormula` con caché (el servidor evalúa la misma fórmula en cada fila
 * de cada página: leerla una sola vez). Nunca lanza.
 */
export function parseFormulaCached(text: string): { ok: true; ast: FormulaNode } | { ok: false; error: FormulaSyntaxError } {
    const hit = parseCache.get(text);
    if (hit) return hit;
    let res: { ok: true; ast: FormulaNode } | { ok: false; error: FormulaSyntaxError };
    try {
        res = { ok: true, ast: parseFormula(text) };
    } catch (e) {
        res = { ok: false, error: e instanceof FormulaSyntaxError ? e : new FormulaSyntaxError(String(e), 0, 0) };
    }
    if (parseCache.size > 1000) parseCache.clear();
    parseCache.set(text, res);
    return res;
}
