/**
 * Motor propio para las expresiones regulares que escribe una empresa
 * (validación «Expresión regular propia» y la función REGEX_COINCIDE).
 *
 * Por qué no se usa `RegExp` del motor de JavaScript: retrocede
 * (backtracking) y un patrón puede tardar un tiempo exponencial en decir
 * «no coincide», bloqueando el proceso; no hay forma de ponerle un tope de
 * tiempo. Aquí el patrón se PARSEA con una gramática propia y estricta, se
 * compila a un programa pequeño y se ejecuta con una simulación de autómata
 * (Thompson / Pike): cada instrucción se visita como mucho una vez por
 * posición del texto, así que el costo es instrucciones × largo, con un
 * tope duro de instrucciones, de largo y de pasos. El parser ES el
 * ejecutor: no puede haber una diferencia entre «lo que se analizó» y «lo
 * que se ejecuta».
 *
 * Lo único que se delega al motor nativo son pruebas de UN carácter
 * (clases `[...]`, `\d`, `\w`, `\p{…}`, `.`), compiladas siempre con el
 * flag `u` y aplicadas a una cadena de un solo punto de código: no pueden
 * retroceder.
 *
 * La coincidencia es SIEMPRE del valor completo (anclada) y sólo se
 * responde sí/no (sin grupos de captura), por eso un cuantificador
 * perezoso o codicioso da el mismo resultado.
 */

/** Valor máximo (caracteres) sobre el que se evalúa una expresión regular propia. */
export const USER_PATTERN_VALUE_MAX = 200;
/** Largo máximo del patrón. */
export const USER_PATTERN_MAX = 200;

/**
 * Presupuesto de "pasos" de la expresión en el peor caso (estimación
 * histórica del análisis: 200^U × B). Se conserva como primera puerta.
 */
const PATTERN_STEP_BUDGET = 10_000_000;
const MAX_BOUNDED_REPEAT = 1000;
/** Tope de instrucciones del programa compilado (repeticiones ya expandidas). */
const PROGRAM_MAX = 3000;
/** Tope duro de pasos de una ejecución (cinturón: con los topes de arriba no se alcanza). */
const RUN_STEP_MAX = 1_500_000;

const COSTLY =
    'La expresión es demasiado costosa de evaluar: usa como máximo tres repeticiones abiertas (* o +) y rangos {n,m} chicos.';
const INVALID = 'La expresión regular no es válida.';

export type PatternAnalysis = { ok: true } | { ok: false; reason: string };

export class PatternError extends Error {}

/** Prueba de un carácter (una cadena de UN punto de código). */
type CharTest = (cp: string) => boolean;

type Node =
    | { t: 'char'; test: CharTest }
    | { t: 'start' }
    | { t: 'end' }
    | { t: 'wb'; neg: boolean }
    | { t: 'seq'; items: Node[] }
    | { t: 'alt'; items: Node[] }
    | { t: 'rep'; node: Node; min: number; max: number };

// ─── Parser ──────────────────────────────────────────────────────────────

const HEX = /^[0-9A-Fa-f]+$/;
const isAsciiAlnum = (c: string): boolean => /^[A-Za-z0-9]$/.test(c);
const SYNTAX = '^$\\.*+?()[]{}|/';

/** Prueba nativa de UN carácter: sólo flag `u` (+ `i`), nunca otro modo. */
function nativeCharTest(src: string, ignoreCase: boolean): CharTest {
    let re: RegExp;
    try {
        re = new RegExp(`^(?:${src})$`, ignoreCase ? 'iu' : 'u');
    } catch {
        throw new PatternError(INVALID);
    }
    // Pocos caracteres distintos por valor: se recuerda el resultado.
    let memo = new Map<string, boolean>();
    return (cp) => {
        const hit = memo.get(cp);
        if (hit !== undefined) return hit;
        const r = re.test(cp);
        if (memo.size > 256) memo = new Map();
        memo.set(cp, r);
        return r;
    };
}

function literalTest(cp: string, ignoreCase: boolean): CharTest {
    if (!ignoreCase || (cp.toLowerCase() === cp && cp.toUpperCase() === cp)) return (x) => x === cp;
    const src = SYNTAX.includes(cp) || cp === '-' ? `\\${cp}` : cp;
    return nativeCharTest(src, true);
}

interface Pos {
    i: number;
}

class Parser {
    constructor(
        private readonly src: string,
        private readonly ignoreCase: boolean,
    ) {}

    parse(): Node {
        const pos: Pos = { i: 0 };
        const node = this.alternatives(pos, false);
        if (pos.i < this.src.length) throw new PatternError('Sobra un paréntesis de cierre.');
        return node;
    }

    private alternatives(pos: Pos, inGroup: boolean): Node {
        const branches: Node[] = [this.sequence(pos)];
        while (pos.i < this.src.length && this.src[pos.i] === '|') {
            pos.i++;
            branches.push(this.sequence(pos));
        }
        if (inGroup) {
            if (this.src[pos.i] !== ')') throw new PatternError('Falta cerrar un paréntesis.');
            pos.i++;
        }
        return branches.length === 1 ? branches[0]! : { t: 'alt', items: branches };
    }

    private sequence(pos: Pos): Node {
        const src = this.src;
        const items: Node[] = [];
        while (pos.i < src.length && src[pos.i] !== '|' && src[pos.i] !== ')') {
            const c = src[pos.i]!;
            let atom: Node;
            let quantifiable = true;
            if (c === '\\') {
                atom = this.escape(pos);
                quantifiable = atom.t === 'char';
            } else if (c === '[') {
                atom = this.charClass(pos);
            } else if (c === '(') {
                pos.i++;
                if (src[pos.i] === '?') {
                    const ahead = src.slice(pos.i, pos.i + 3);
                    if (ahead.startsWith('?=') || ahead.startsWith('?!') || ahead === '?<=' || ahead === '?<!') {
                        throw new PatternError('No se admiten lookahead ni lookbehind.');
                    }
                    if (ahead.startsWith('?:')) pos.i += 2;
                    else if (ahead.startsWith('?<')) {
                        const m = /^\?<[A-Za-z_$][A-Za-z0-9_$]*>/.exec(src.slice(pos.i));
                        if (!m) throw new PatternError('Grupo no admitido.');
                        pos.i += m[0].length;
                    } else throw new PatternError('Grupo no admitido.');
                }
                atom = this.alternatives(pos, true);
            } else if (c === '^') {
                pos.i++;
                quantifiable = false;
                atom = { t: 'start' };
            } else if (c === '$') {
                pos.i++;
                quantifiable = false;
                atom = { t: 'end' };
            } else if (c === '*' || c === '+' || c === '?') {
                throw new PatternError('Hay una repetición (*, + o ?) sin nada que repetir.');
            } else if (c === '.') {
                pos.i++;
                atom = { t: 'char', test: nativeCharTest('.', this.ignoreCase) };
            } else {
                if (c === '{' && readQuantifier(src, { i: pos.i }) !== null) {
                    throw new PatternError('Hay una repetición {n,m} sin nada que repetir.');
                }
                // Literal (un punto de código; `{`, `}` y `]` sueltos son literales).
                const cp = String.fromCodePoint(src.codePointAt(pos.i)!);
                pos.i += cp.length;
                atom = { t: 'char', test: literalTest(cp, this.ignoreCase) };
            }

            const q = readQuantifier(src, pos);
            if (q) {
                if (!quantifiable) throw new PatternError('No se puede repetir un ancla (^, $ o \\b).');
                if (q.max < q.min) throw new PatternError('En una repetición {n,m} el máximo no puede ser menor que el mínimo.');
                if (q.max !== Infinity && q.max > MAX_BOUNDED_REPEAT) {
                    throw new PatternError(`Una repetición {n,m} no puede pasar de ${MAX_BOUNDED_REPEAT}.`);
                }
                if (q.min > MAX_BOUNDED_REPEAT) throw new PatternError(`Una repetición {n,m} no puede pasar de ${MAX_BOUNDED_REPEAT}.`);
                atom = { t: 'rep', node: atom, min: q.min, max: q.max };
                const again = src[pos.i];
                if (again === '*' || again === '+' || again === '?' || (again === '{' && readQuantifier(src, { i: pos.i }) !== null)) {
                    throw new PatternError('No se admiten dos repeticiones seguidas.');
                }
            }
            items.push(atom);
        }
        return items.length === 1 ? items[0]! : { t: 'seq', items };
    }

    /** Un escape FUERA de una clase. Lista blanca: lo que no está, se rechaza. */
    private escape(pos: Pos): Node {
        const src = this.src;
        const next = src[pos.i + 1];
        if (next === undefined) throw new PatternError(INVALID);
        const native = (len: number): Node => {
            const text = src.slice(pos.i, pos.i + len);
            pos.i += len;
            return { t: 'char', test: nativeCharTest(text, this.ignoreCase) };
        };
        if (/[1-9]/.test(next)) throw new PatternError('No se admiten referencias hacia atrás (\\1).');
        if (next === 'k') throw new PatternError('No se admiten referencias hacia atrás (\\k<…>).');
        if (next === 'b' || next === 'B') {
            pos.i += 2;
            return { t: 'wb', neg: next === 'B' };
        }
        if ('dDwWsStnrfv'.includes(next)) return native(2);
        if (next === '0') {
            if (/[0-9]/.test(src[pos.i + 2] ?? '')) throw new PatternError('Escape no admitido (\\0 seguido de un número).');
            return native(2);
        }
        if (next === 'x') {
            const h = src.slice(pos.i + 2, pos.i + 4);
            if (h.length !== 2 || !HEX.test(h)) throw new PatternError('Escape \\x incompleto: lleva dos dígitos hexadecimales.');
            return native(4);
        }
        if (next === 'u') {
            if (src[pos.i + 2] === '{') {
                const end = src.indexOf('}', pos.i + 3);
                const h = end === -1 ? '' : src.slice(pos.i + 3, end);
                if (h.length < 1 || h.length > 6 || !HEX.test(h) || parseInt(h, 16) > 0x10ffff) {
                    throw new PatternError('Escape \\u{…} no válido.');
                }
                return native(end + 1 - pos.i);
            }
            const h = src.slice(pos.i + 2, pos.i + 6);
            if (h.length !== 4 || !HEX.test(h)) throw new PatternError('Escape \\u incompleto: lleva cuatro dígitos hexadecimales.');
            const code = parseInt(h, 16);
            if (code >= 0xd800 && code <= 0xdbff) {
                // Par sustituto escrito como dos escapes: es UN carácter.
                const m = /^\\u([dD][c-fC-F][0-9A-Fa-f]{2})/.exec(src.slice(pos.i + 6));
                if (m) return native(12);
            }
            return native(6);
        }
        if (next === 'c') {
            if (!/^[A-Za-z]$/.test(src[pos.i + 2] ?? '')) throw new PatternError('Escape \\c no válido.');
            return native(3);
        }
        if (next === 'p' || next === 'P') {
            const m = /^\{[A-Za-z0-9_]+(=[A-Za-z0-9_]+)?\}/.exec(src.slice(pos.i + 2));
            if (!m) throw new PatternError('Escape \\p{…} no válido.');
            return native(2 + m[0].length);
        }
        if (isAsciiAlnum(next)) throw new PatternError(`Escape no admitido (\\${next}).`);
        // Escape de identidad: el carácter tal cual (`\.`, `\-`, `\/`, `\_`…).
        const cp = String.fromCodePoint(src.codePointAt(pos.i + 1)!);
        pos.i += 1 + cp.length;
        return { t: 'char', test: literalTest(cp, this.ignoreCase) };
    }

    /**
     * Una clase `[...]`: termina en el PRIMER corchete de cierre sin escapar
     * (igual que el motor). Vacía o negada-vacía se rechaza. Su interior se
     * compila aparte, como prueba de un solo carácter.
     */
    private charClass(pos: Pos): Node {
        const src = this.src;
        let i = pos.i + 1;
        let out = '[';
        if (src[i] === '^') {
            out += '^';
            i++;
        }
        const bodyStart = i;
        while (i < src.length && src[i] !== ']') {
            const c = src[i]!;
            if (c === '\\') {
                const n = src[i + 1];
                if (n === undefined) throw new PatternError('Falta cerrar un corchete.');
                // `\_`, `\@`… (puntuación que no es sintaxis): el carácter tal cual.
                if (n.charCodeAt(0) < 128 && !isAsciiAlnum(n) && !SYNTAX.includes(n) && n !== '-') out += n;
                else out += c + n;
                i += 2;
            } else {
                out += c;
                i++;
            }
        }
        if (src[i] !== ']') throw new PatternError('Falta cerrar un corchete.');
        if (i === bodyStart) throw new PatternError('Hay una clase de caracteres vacía ([] o [^]).');
        out += ']';
        pos.i = i + 1;
        return { t: 'char', test: nativeCharTest(out, this.ignoreCase) };
    }
}

function readQuantifier(src: string, pos: Pos): { min: number; max: number } | null {
    const c = src[pos.i];
    let q: { min: number; max: number } | null = null;
    if (c === '*') q = { min: 0, max: Infinity };
    else if (c === '+') q = { min: 1, max: Infinity };
    else if (c === '?') q = { min: 0, max: 1 };
    if (q) {
        pos.i++;
    } else if (c === '{') {
        const m = /^\{(\d{1,6})(,(\d{0,6}))?\}/.exec(src.slice(pos.i, pos.i + 16));
        if (!m) return null; // `{` literal
        const min = Number(m[1]);
        const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
        q = { min, max };
        pos.i += m[0].length;
    }
    if (q && src[pos.i] === '?') pos.i++; // perezoso: mismo resultado sí/no
    return q;
}

// ─── Estimación de costo (primera puerta, la misma regla de siempre) ─────

interface Cx {
    /** Cuantificadores sin tope (`*`, `+`, `{n,}`) que se suman en serie. */
    u: number;
    /** Factor de ramificación (alternativas × rangos de los cuantificadores con tope). */
    b: number;
}

function cost(node: Node): Cx {
    switch (node.t) {
        case 'seq': {
            let u = 0;
            let b = 1;
            for (const it of node.items) {
                const c = cost(it);
                u += c.u;
                b *= c.b;
                if (!Number.isFinite(b) || b > 1e15) b = Infinity;
            }
            return { u, b };
        }
        case 'alt': {
            const cs = node.items.map(cost);
            return { u: Math.max(...cs.map((c) => c.u)), b: cs.reduce((acc, c) => acc + c.b, 0) };
        }
        case 'rep': {
            const inner = cost(node.node);
            if (node.max === Infinity) {
                if (inner.u > 0 || inner.b > 1) {
                    throw new PatternError('No se admiten repeticiones anidadas como (a+)+ o (a|b)*: pueden colgar la validación.');
                }
                return { u: 1, b: 1 };
            }
            const range = node.max - node.min + 1;
            return { u: inner.u * node.max, b: Math.pow(inner.b, Math.max(node.max, 1)) * range };
        }
        default:
            return { u: 0, b: 1 };
    }
}

// ─── Programa ────────────────────────────────────────────────────────────

const Op = { Char: 0, Split: 1, Jmp: 2, Start: 3, End: 4, Wb: 5, Nwb: 6, Match: 7, Fail: 8 } as const;
type Op = (typeof Op)[keyof typeof Op];

interface Program {
    op: Op[];
    x: number[];
    y: number[];
    test: Array<CharTest | null>;
}

function nullable(node: Node): boolean {
    switch (node.t) {
        case 'char':
            return false;
        case 'seq':
            return node.items.every(nullable);
        case 'alt':
            return node.items.some(nullable);
        case 'rep':
            return node.min === 0 || nullable(node.node);
        default:
            return true;
    }
}

function compile(root: Node): Program {
    const p: Program = { op: [], x: [], y: [], test: [] };
    const push = (op: Op, test: CharTest | null = null): number => {
        if (p.op.length >= PROGRAM_MAX) throw new PatternError(COSTLY);
        p.op.push(op);
        p.x.push(0);
        p.y.push(0);
        p.test.push(test);
        return p.op.length - 1;
    };
    const emit = (node: Node): void => {
        switch (node.t) {
            case 'char':
                push(Op.Char, node.test);
                return;
            case 'start':
                push(Op.Start);
                return;
            case 'end':
                push(Op.End);
                return;
            case 'wb':
                push(node.neg ? Op.Nwb : Op.Wb);
                return;
            case 'seq':
                for (const it of node.items) emit(it);
                return;
            case 'alt': {
                const jumps: number[] = [];
                node.items.forEach((it, idx) => {
                    if (idx < node.items.length - 1) {
                        const split = push(Op.Split);
                        p.x[split] = p.op.length;
                        emit(it);
                        jumps.push(push(Op.Jmp));
                        p.y[split] = p.op.length;
                    } else emit(it);
                });
                for (const j of jumps) p.x[j] = p.op.length;
                return;
            }
            case 'rep': {
                // El valor no pasa de USER_PATTERN_VALUE_MAX caracteres: más
                // repeticiones que eso (de algo que consume) no cambian el
                // resultado, y el programa queda chico.
                const canBeEmpty = nullable(node.node);
                let min = node.min;
                let max = node.max;
                if (canBeEmpty) min = 0;
                else if (min > USER_PATTERN_VALUE_MAX) {
                    push(Op.Fail);
                    return;
                }
                if (max !== Infinity && max > USER_PATTERN_VALUE_MAX) max = USER_PATTERN_VALUE_MAX;
                for (let k = 0; k < min; k++) emit(node.node);
                if (max === Infinity) {
                    const split = push(Op.Split);
                    p.x[split] = p.op.length;
                    emit(node.node);
                    const jmp = push(Op.Jmp);
                    p.x[jmp] = split;
                    p.y[split] = p.op.length;
                } else {
                    const splits: number[] = [];
                    for (let k = min; k < max; k++) {
                        const split = push(Op.Split);
                        p.x[split] = p.op.length;
                        splits.push(split);
                        emit(node.node);
                    }
                    for (const s of splits) p.y[s] = p.op.length;
                }
                return;
            }
        }
    };
    emit(root);
    push(Op.Match);
    return p;
}

// ─── Ejecución (simulación del autómata) ─────────────────────────────────

const WORD = /^\w$/u;
const isWord = (cp: string | undefined): boolean => cp !== undefined && WORD.test(cp);

function run(p: Program, value: string): boolean {
    const input = Array.from(value);
    const n = input.length;
    const size = p.op.length;
    const mark = new Int32Array(size).fill(-1);
    let current: number[] = [];
    let next: number[] = [];
    const stack: number[] = [];
    let steps = 0;
    let over = false;

    /** Agrega el hilo `pc` (siguiendo saltos y anclas) a la lista de la posición `at`. */
    const add = (list: number[], pc0: number, at: number): boolean => {
        stack.length = 0;
        stack.push(pc0);
        while (stack.length > 0) {
            const pc = stack.pop()!;
            if (mark[pc] === at) continue;
            mark[pc] = at;
            if (++steps > RUN_STEP_MAX) {
                over = true;
                return false;
            }
            switch (p.op[pc]!) {
                case Op.Jmp:
                    stack.push(p.x[pc]!);
                    break;
                case Op.Split:
                    stack.push(p.y[pc]!, p.x[pc]!);
                    break;
                case Op.Start:
                    if (at === 0) stack.push(pc + 1);
                    break;
                case Op.End:
                    if (at === n) stack.push(pc + 1);
                    break;
                case Op.Wb:
                case Op.Nwb: {
                    const boundary = isWord(input[at - 1]) !== isWord(input[at]);
                    if (boundary === (p.op[pc] === Op.Wb)) stack.push(pc + 1);
                    break;
                }
                case Op.Match:
                    if (at === n) return true;
                    break;
                case Op.Fail:
                    break;
                default:
                    list.push(pc);
            }
        }
        return false;
    };

    if (add(current, 0, 0)) return true;
    for (let at = 0; at < n && current.length > 0 && !over; at++) {
        const cp = input[at]!;
        next = [];
        for (const pc of current) {
            if (++steps > RUN_STEP_MAX) return false;
            if (p.test[pc]!(cp) && add(next, pc + 1, at + 1)) return true;
            if (over) return false;
        }
        current = next;
    }
    return false;
}

// ─── API ─────────────────────────────────────────────────────────────────

/** Una expresión propia lista para usar: coincide (o no) con el valor COMPLETO. */
export interface UserPattern {
    test(value: string): boolean;
}

function build(pattern: string, ignoreCase: boolean): Program {
    const ast = new Parser(pattern, ignoreCase).parse();
    const cx = cost(ast);
    const steps = Math.pow(USER_PATTERN_VALUE_MAX, cx.u) * cx.b;
    if (!Number.isFinite(steps) || steps > PATTERN_STEP_BUDGET) throw new PatternError(COSTLY);
    return compile(ast);
}

/**
 * ¿Se puede guardar y ejecutar esta expresión? Se rechaza al GUARDAR:
 *
 *  1. Más de 200 caracteres, o sintaxis que el motor propio no admite
 *     (escapes fuera de la lista blanca, clases vacías, grupos especiales).
 *  2. Referencias hacia atrás (`\1`, `\k<x>`) y lookarounds.
 *  3. Cuantificador SIN TOPE sobre un grupo que ya repite o tiene
 *     alternativas (`(a+)+`, `(a|ab)*`).
 *  4. Un costo estimado (200^U × B) mayor a 10.000.000, o un programa
 *     compilado (con las repeticiones `{n,m}` expandidas, también las
 *     anidadas) de más de 3.000 instrucciones.
 *
 * Aun si este análisis tuviera un error, la ejecución es la de
 * `compileUserPattern`: una simulación con tope duro de pasos, no el motor
 * con retroceso.
 */
export function analyzeUserPattern(pattern: string): PatternAnalysis {
    if (typeof pattern !== 'string' || pattern.length === 0) return { ok: false, reason: 'Escribe la expresión regular.' };
    if (pattern.length > USER_PATTERN_MAX) return { ok: false, reason: `La expresión no puede pasar de ${USER_PATTERN_MAX} caracteres.` };
    try {
        build(pattern, false);
        return { ok: true };
    } catch (e) {
        if (e instanceof PatternError) return { ok: false, reason: e.message };
        // Anidamiento desmedido de paréntesis (pila) u otro error: no es válida.
        return { ok: false, reason: INVALID };
    }
}

const patternCache = new Map<string, UserPattern | null>();

/** La expresión propia lista para usar (anclada), o null si no es válida / es demasiado costosa. */
export function compileUserPattern(pattern: string, ignoreCase = false): UserPattern | null {
    const key = `${ignoreCase ? 'i' : '-'}:${pattern}`;
    const cached = patternCache.get(key);
    if (cached !== undefined) return cached;
    let compiled: UserPattern | null = null;
    if (typeof pattern === 'string' && pattern.length > 0 && pattern.length <= USER_PATTERN_MAX) {
        try {
            const program = build(pattern, ignoreCase);
            compiled = {
                test: (value: string) => typeof value === 'string' && value.length <= USER_PATTERN_VALUE_MAX && run(program, value),
            };
        } catch {
            compiled = null;
        }
    }
    if (patternCache.size > 500) patternCache.clear();
    patternCache.set(key, compiled);
    return compiled;
}
