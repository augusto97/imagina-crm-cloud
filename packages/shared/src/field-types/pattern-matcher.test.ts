import { describe, expect, it } from 'vitest';
import { USER_PATTERN_VALUE_MAX, analyzeUserPattern, compileUserPattern } from './pattern-matcher';
import { checkValueRules, USER_PATTERN_UNUSABLE } from './field-rules';

/** Generador determinista (los tests no dependen del azar de la máquina). */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function native(pattern: string, ignoreCase: boolean): RegExp | null {
    try {
        return new RegExp(`^(?:${pattern})$`, ignoreCase ? 'iu' : 'u');
    } catch {
        return null;
    }
}

/** El mejor de tres (una máquina de CI cargada puede demorar una corrida suelta). */
function bestMs(fn: () => void): number {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
    }
    return best;
}

/** Valores "peores": casi coinciden y fallan al final. */
function worstValues(): string[] {
    const n = USER_PATTERN_VALUE_MAX;
    return [
        'a'.repeat(n - 1) + '!',
        '1'.repeat(n - 1) + '!',
        'ab'.repeat(n / 2 - 1) + '!!',
        'a1.'.repeat(Math.floor(n / 3) - 1) + '!',
        ' '.repeat(n - 1) + '!',
        'a'.repeat(n),
    ];
}

const CORPUS: Array<[string, string[]]> = [
    // Los formatos integrados (NIT, cédula, placa, sólo números, sólo letras), escritos como patrón.
    ['\\d{6,10}(-\\d)?', ['900123456-8', '900123456', '12345', '900123456-', '900123456-88']],
    ['\\d{6,10}', ['123456', '1234567890', '12345', '12345678901', '12a456']],
    ['[A-Z]{3}[-\\s]?(\\d{3}|\\d{2}[A-Z])', ['ABC123', 'ABC-123', 'ABC 12D', 'AB123', 'ABC1234', 'abc123']],
    ['\\d+', ['1', '0123456789', '', '12a', ' 1']],
    ['[\\p{L}\\p{M}\\s]+', ['José Ñandú', 'abc', 'abc1', '', 'á b']],
    // Patrones típicos.
    ['[A-Z]{3}-\\d{4}', ['RAD-2026', 'RAD-202', 'rad-2026', 'RAD-20267']],
    ['[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', ['ana@acme.co', 'ana@acme', '@acme.co', 'a.b+c@d-e.com.co', 'ana@acme.c']],
    ['(CC|CE|NIT)-\\d{6,10}', ['CC-123456', 'NIT-9001234567', 'TI-123456', 'CC-12345', 'CC123456']],
    ['\\d+(\\.\\d{1,2})?', ['10', '10.5', '10.55', '10.555', '.5', '10.']],
    ['\\p{L}+', ['Ñandú', 'a1', '', 'élan']],
    ['\\+?57\\s?3\\d{9}', ['+57 3001234567', '573001234567', '+57  3001234567', '3001234567']],
    ['[^\\s@]+@[^\\s@]+', ['a@b', 'a b@c', 'a@', '@@', 'a@b@c']],
    ['(?:ab|cd)?ef{2,3}', ['abeff', 'efff', 'cdeffff', 'ef', 'abcdeff']],
    ['(?<anio>\\d{4})-(?<mes>0[1-9]|1[0-2])', ['2026-01', '2026-13', '2026-1', '2026-12']],
    ['\\bfoo\\b.*', ['foo bar', 'foobar', 'foo', ' foo']],
    ['a.c', ['abc', 'a\nc', 'ac', 'a😀c']],
    ['[\\w\\-\\.]{2,5}', ['a-b.c', 'a', 'abcdef', 'a b']],
    ['\\x41\\u0042\\u{43}\\cJ?', ['ABC', 'ABC\n', 'abc', 'AB']],
    ['.{0,1000}', ['', 'x'.repeat(200), 'a\nb']],
    ['(a?){3}b', ['b', 'ab', 'aaab', 'aaaab']],
    ['x{2}|y{3,}', ['xx', 'yyy', 'yyyyy', 'x', 'yy', 'xxyyy']],
    ['\\$\\d+\\.\\d{2}', ['$10.00', '10.00', '$10.0']],
    ['[áéíóú]+', ['áé', 'ae', 'ÁÉ']],
    ['\\S+\\s\\S+', ['hola mundo', 'hola', 'hola  mundo', 'a b']],
];

describe('motor propio de expresiones: equivalencia con RegExp', () => {
    it('corpus de formatos integrados y patrones típicos (con y sin mayúsculas)', () => {
        for (const [pattern, values] of CORPUS) {
            for (const ic of [false, true]) {
                const own = compileUserPattern(pattern, ic);
                const ref = native(pattern, ic);
                expect(own, pattern).not.toBeNull();
                expect(ref, pattern).not.toBeNull();
                for (const v of [...values, '', 'x']) {
                    expect(own!.test(v), `${pattern} ~ ${JSON.stringify(v)} (i=${ic})`).toBe(ref!.test(v));
                }
            }
        }
    });

    it('escapes de puntuación que RegExp con «u» no admite se leen como el carácter', () => {
        expect(compileUserPattern('[A-Z]{3}\\-\\d{3}')!.test('ABC-123')).toBe(true);
        expect(compileUserPattern('[\\w\\_\\@]+')!.test('a_b@c')).toBe(true);
        expect(compileUserPattern('a{b}c]')!.test('a{b}c]')).toBe(true);
    });

    it('patrones generados: lo que se acepta da lo mismo que RegExp', () => {
        const atoms = ['a', 'b', '1', '\\d', '\\w', '\\s', '.', '[ab]', '[^a]', '[a-c1]', '\\.', '-', '\\p{L}', '\\b', 'ab', '(?:a|b)', '(a1)', '^', '$'];
        const quants = ['', '', '', '?', '*', '+', '{2}', '{1,3}', '{0,2}', '{2,}', '+?', '*?'];
        const alphabet = ['a', 'b', '1', ' ', '.', '-', 'c', 'A'];
        const next = rng(20260001);
        const pick = <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)]!;
        let accepted = 0;
        for (let k = 0; k < 1500; k++) {
            let pattern = '';
            const parts = 1 + Math.floor(next() * 5);
            for (let j = 0; j < parts; j++) {
                let piece = pick(atoms);
                const q = pick(quants);
                if (q !== '' && (piece === '^' || piece === '$' || piece === '\\b')) piece = 'a';
                if (q !== '' && piece === 'ab') piece = '(?:ab)';
                pattern += piece + q;
                if (next() < 0.12) pattern += '|';
            }
            if (next() < 0.2) pattern = `(${pattern})${pick(['', '?', '{2}', '{0,2}'])}`;
            const ic = next() < 0.3;
            const own = compileUserPattern(pattern, ic);
            if (own === null) continue;
            const ref = native(pattern, ic);
            // Todo lo que se genera aquí y el motor propio acepta es válido para RegExp.
            expect(ref, pattern).not.toBeNull();
            accepted++;
            for (let v = 0; v < 12; v++) {
                let value = '';
                const len = Math.floor(next() * 9);
                for (let c = 0; c < len; c++) value += pick(alphabet);
                expect(own.test(value), `${pattern} ~ ${JSON.stringify(value)} (i=${ic})`).toBe(ref!.test(value));
            }
        }
        expect(accepted).toBeGreaterThan(300);
    });
});

describe('motor propio de expresiones: lo que se rechaza', () => {
    const O = '[';
    const C = ']';
    const BS = '\\';
    /** Un grupo que repite, repetido otra vez. */
    const nested = (inner: string): string => `(${inner}+)+`;

    it('formas que un análisis laxo dejaría pasar', () => {
        const hidden = nested('a') + '$';
        const cases = [
            // clase vacía / negada-vacía seguida de sintaxis viva
            `${O}${C}${hidden}`,
            `${O}^${C}${hidden}`,
            `${O}${C}${hidden}${C}`,
            `${O}^${C}${hidden}${C}`,
            // escapes de largo fijo sin sus dígitos
            `${BS}u${hidden}`,
            `${BS}x${hidden}`,
            `${BS}c${hidden}`,
            `${BS}u{${hidden}}`,
            `${BS}u12${hidden}`,
            `${BS}xZ1${hidden}`,
            // propiedad con llaves que otro modo leería como repetición
            `${BS}p{2}${hidden}`,
            `a${BS}P{2,}${hidden}`,
            `${BS}p${hidden}`,
            // forma directa
            hidden,
            nested('a|aa'),
            `(${nested('a')}){3}`,
            // referencias y lookarounds
            `(a)${BS}1`,
            `(?<n>a)${BS}k<n>`,
            '(?=a)a',
            '(?<!a)b',
            '(?i:a)',
            // sintaxis incompleta
            `${O}abc`,
            '(abc',
            'abc)',
            '*a',
            'a**',
            'a{2}{3}',
            'a{3,2}',
            '^*',
            `${BS}`,
            `${BS}q`,
            `${BS}01`,
        ];
        cases.forEach((p, idx) => {
            expect(analyzeUserPattern(p).ok, `caso ${idx}`).toBe(false);
            expect(compileUserPattern(p), `caso ${idx}`).toBeNull();
            expect(compileUserPattern(p, true), `caso ${idx}`).toBeNull();
        });
    });

    it('el producto de repeticiones {n,m} anidadas tiene tope', () => {
        for (const p of ['((a{30}){30}){30}', '((ab|cd){50}){50}', '((a?){100}){100}', 'a{0,2000}', 'a{1001}', '((a?b?){60}){60}']) {
            expect(analyzeUserPattern(p).ok, p).toBe(false);
        }
        // Rangos grandes sobre UN carácter sí: el valor no pasa de 200.
        expect(analyzeUserPattern('.{0,1000}').ok).toBe(true);
        expect(compileUserPattern('a{250}')!.test('a'.repeat(200))).toBe(false);
        expect(compileUserPattern('a{150,900}')!.test('a'.repeat(200))).toBe(true);
    });

    it('un valor más largo que el tope nunca coincide', () => {
        expect(compileUserPattern('.*')!.test('a'.repeat(USER_PATTERN_VALUE_MAX + 1))).toBe(false);
        expect(compileUserPattern('.*')!.test('a'.repeat(USER_PATTERN_VALUE_MAX))).toBe(true);
    });
});

describe('motor propio de expresiones: tiempo acotado', () => {
    it('cada patrón del corpus responde en < 200 ms con los peores valores', () => {
        for (const [pattern] of CORPUS) {
            const own = compileUserPattern(pattern, true)!;
            const ms = bestMs(() => {
                for (const v of worstValues()) own.test(v);
            });
            expect(ms, pattern).toBeLessThan(200);
        }
    });

    it('patrones al límite de lo aceptado: < 200 ms con valores de 200 caracteres', () => {
        // Lo más caro que el análisis deja pasar: repeticiones abiertas en
        // serie, alternativas y rangos grandes.
        const heavy = [
            '[a-z]*[a-z]*[a-z]*x',
            '\\w*\\w*\\w*!!',
            '(a|b|ab|ba){12}x',
            '(a?){200}b',
            '.{0,1000}x.{0,1000}y',
            '(a{0,60}b{0,60}){10}c',
            'a*'.repeat(3) + 'a?'.repeat(60) + 'b',
        ];
        const next = rng(7);
        const toks = ['a*', 'a+', '\\w*', '.*', 'a?', '(a|aa)', '(a|b){0,8}', '[ab]{1,40}', 'a{0,200}', '(a?b?){20}', '\\d*', 'a'];
        for (let k = 0; k < 300; k++) {
            let p = '';
            const parts = 2 + Math.floor(next() * 10);
            for (let j = 0; j < parts; j++) p += toks[Math.floor(next() * toks.length)]!;
            heavy.push(p + '!');
        }
        let ran = 0;
        for (const p of heavy) {
            const own = compileUserPattern(p);
            if (own === null) continue;
            ran++;
            const ms = bestMs(() => {
                for (const v of worstValues()) own.test(v);
            });
            expect(ms, p).toBeLessThan(200);
        }
        expect(ran).toBeGreaterThan(50);
    });

    it('analizar un patrón de 200 caracteres también está acotado', () => {
        const shapes = ['('.repeat(100) + ')'.repeat(100), '(a{9}'.repeat(30) + ')'.repeat(30), 'a{200}'.repeat(33), '(a|'.repeat(60) + ')'.repeat(60)];
        for (const p of shapes) {
            const ms = bestMs(() => {
                analyzeUserPattern(p);
            });
            expect(ms).toBeLessThan(200);
        }
    });
});

describe('regla de formato con una expresión que no se puede ejecutar', () => {
    const field = (pattern: string, message?: string) => ({
        type: 'text' as const,
        config: { validation: { format: 'regex', pattern, ...(message ? { format_message: message } : {}) } },
    });

    it('no deja pasar el valor (con el mensaje del campo si lo tiene)', () => {
        const bad = '(' + 'a+' + ')+';
        expect(checkValueRules(field(bad), 'aaa')).toBe(USER_PATTERN_UNUSABLE);
        expect(checkValueRules(field(bad, 'Usa RAD-0000'), 'aaa')).toBe('Usa RAD-0000');
        // Vacío no se chequea: no bloquea guardar el resto del registro.
        expect(checkValueRules(field(bad), '')).toBeNull();
        expect(checkValueRules(field('RAD-\\d{4}'), 'RAD-2026')).toBeNull();
    });
});
