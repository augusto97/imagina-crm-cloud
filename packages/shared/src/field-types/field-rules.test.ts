import { describe, expect, it } from 'vitest';
import { parseFieldConfig, type FieldType } from '../schemas/field';
import {
    analyzeUserPattern,
    applyFieldDefaults,
    checkRequiredIf,
    checkValueRules,
    compileUserPattern,
    defaultKindsFor,
    nitCheckDigit,
    resolveFieldDefault,
    USER_PATTERN_VALUE_MAX,
} from './field-rules';
import { validateFieldValue } from './validate';

const ctx = { now: new Date('2026-12-31T23:30:00Z'), timeZone: 'America/Bogota', userId: 7 };
const f = (id: number, type: FieldType, config: Record<string, unknown> = {}, label = `Campo ${id}`) => ({
    id,
    slug: `c${id}`,
    label,
    type,
    config,
});

describe('valores por defecto', () => {
    it('fijo, hoy en la zona de la empresa, ahora y quien lo crea', () => {
        expect(resolveFieldDefault(f(1, 'text', { default_value: { kind: 'value', value: 'Hola' } }), ctx)).toBe('Hola');
        // 23:30 UTC del 31 = 18:30 en Bogotá: todavía es el 31.
        expect(resolveFieldDefault(f(2, 'date', { default_value: { kind: 'today' } }), ctx)).toBe('2026-12-31');
        expect(resolveFieldDefault(f(2, 'date', { default_value: { kind: 'today' } }), { ...ctx, timeZone: 'Asia/Tokyo' })).toBe('2027-01-01');
        expect(resolveFieldDefault(f(3, 'datetime', { default_value: { kind: 'now' } }), ctx)).toBe('2026-12-31T23:30:00.000Z');
        expect(resolveFieldDefault(f(4, 'user', { default_value: { kind: 'creator' } }), ctx)).toBe(7);
        // El sistema (0) no es "quien lo crea".
        expect(resolveFieldDefault(f(4, 'user', { default_value: { kind: 'creator' } }), { ...ctx, userId: 0 })).toBeUndefined();
        // Un tipo de default que el campo no admite no aplica.
        expect(resolveFieldDefault(f(5, 'text', { default_value: { kind: 'today' } }), ctx)).toBeUndefined();
        expect(defaultKindsFor('autonumber')).toEqual([]);
        expect(defaultKindsFor('user')).toEqual(['creator']);
    });

    it('sólo completa lo que no viene: un null explícito se respeta', () => {
        const fields = [
            f(1, 'select', { options: [{ value: 'nuevo', label: 'Nuevo' }], default_value: { kind: 'value', value: 'nuevo' } }),
            f(2, 'text', { default_value: { kind: 'value', value: 'x' } }),
        ];
        expect(applyFieldDefaults(fields, { f2: null }, ctx)).toEqual({ f1: 'nuevo', f2: null });
        expect(applyFieldDefaults(fields, { f1: 'otro' }, ctx)).toEqual({ f1: 'otro', f2: 'x' });
    });
});

describe('reglas sobre el valor', () => {
    it('mínimo y máximo de números y fechas, con mensaje propio', () => {
        const n = f(1, 'currency', { validation: { min: 1000, max: 5000 } });
        expect(checkValueRules(n, 999)).toBe('Debe estar entre 1000 y 5000.');
        expect(checkValueRules(n, 5000)).toBeNull();
        const own = f(1, 'number', { validation: { min: 0, range_message: 'No puede ser negativo' } });
        expect(checkValueRules(own, -1)).toBe('No puede ser negativo');
        const d = f(2, 'date', { validation: { min: '2026-01-01' } });
        expect(checkValueRules(d, '2025-12-31')).toBe('La fecha no puede ser anterior al 1 de enero de 2026.');
        expect(checkValueRules(d, '2026-01-01')).toBeNull();
        const dt = f(3, 'datetime', { validation: { max: '2026-06-30' } });
        expect(checkValueRules(dt, '2026-07-01T00:00:00Z')).toMatch(/posterior al 30 de junio de 2026/);
    });

    it('largo del texto', () => {
        const t = f(1, 'text', { validation: { min_length: 3, max_length: 5, length_message: 'Entre 3 y 5' } });
        expect(checkValueRules(t, 'ab')).toBe('Entre 3 y 5');
        expect(checkValueRules(t, 'abcdef')).toBe('Entre 3 y 5');
        expect(checkValueRules(t, 'ñáé')).toBeNull();
    });

    it('formatos colombianos', () => {
        // NIT reales: Ecopetrol 899999068-1, Bancolombia 890903938-8, DIAN 800197268-4.
        expect(nitCheckDigit('899999068')).toBe(1);
        expect(nitCheckDigit('890903938')).toBe(8);
        expect(nitCheckDigit('800197268')).toBe(4);
        const nit = f(1, 'text', { validation: { format: 'nit' } });
        expect(checkValueRules(nit, '890.903.938-8')).toBeNull();
        expect(checkValueRules(nit, '890903938')).toBeNull();
        expect(checkValueRules(nit, '890903938-7')).toMatch(/NIT/);
        expect(checkValueRules(nit, 'ABC')).toMatch(/NIT/);
        const nitDv = f(1, 'text', { validation: { format: 'nit_dv' } });
        expect(checkValueRules(nitDv, '890903938')).toMatch(/dígito de verificación/);
        expect(checkValueRules(nitDv, '890903938-8')).toBeNull();
        const cc = f(2, 'text', { validation: { format: 'cedula' } });
        expect(checkValueRules(cc, '1.020.304.050')).toBeNull();
        expect(checkValueRules(cc, '12345')).toMatch(/cédula/);
        const placa = f(3, 'text', { validation: { format: 'placa' } });
        expect(checkValueRules(placa, 'abc123')).toBeNull();
        expect(checkValueRules(placa, 'ABC-123')).toBeNull();
        expect(checkValueRules(placa, 'XYZ12D')).toBeNull();
        expect(checkValueRules(placa, 'AB1234')).toMatch(/placa/);
        expect(checkValueRules(f(4, 'text', { validation: { format: 'digits' } }), '12a')).toBe('Sólo se admiten números.');
        expect(checkValueRules(f(4, 'text', { validation: { format: 'letters' } }), 'María José')).toBeNull();
        expect(checkValueRules(f(4, 'text', { validation: { format: 'letters', format_message: 'Sin números' } }), 'R2D2')).toBe('Sin números');
    });

    it('la expresión propia se ancla al valor completo', () => {
        const rx = f(1, 'text', { validation: { format: 'regex', pattern: 'RAD-\\d{4}', format_message: 'Usa RAD-0000' } });
        expect(checkValueRules(rx, 'RAD-1234')).toBeNull();
        expect(checkValueRules(rx, 'x RAD-1234')).toBe('Usa RAD-0000');
        const ic = f(1, 'text', { validation: { format: 'regex', pattern: 'rad-\\d{4}', pattern_ignore_case: true } });
        expect(checkValueRules(ic, 'RAD-1234')).toBeNull();
        expect(checkValueRules(rx, 'R'.repeat(USER_PATTERN_VALUE_MAX + 1))).toMatch(/no puede pasar de 200/);
    });

    it('validateFieldValue aplica las reglas después de normalizar el tipo', () => {
        const spec = { type: 'number' as const, config: { validation: { max: 10 } }, is_required: false };
        expect(validateFieldValue(spec, '11')).toEqual({ ok: false, error: 'El valor máximo es 10.' });
        expect(validateFieldValue(spec, '9')).toEqual({ ok: true, value: 9 });
        // Vacío no se chequea (lo obligatorio es otra regla).
        expect(validateFieldValue(spec, '')).toEqual({ ok: true, value: null });
        // El ID automático acepta texto; las columnas de sistema no se escriben.
        expect(validateFieldValue({ type: 'autonumber', config: {}, is_required: false }, 'TCK-0001').ok).toBe(true);
        expect(validateFieldValue({ type: 'created_by', config: {}, is_required: false }, 3).ok).toBe(false);
    });
});

describe('protección contra ReDoS', () => {
    it('rechaza las construcciones con retroceso catastrófico', () => {
        for (const p of ['(a+)+$', '(a*)*', '(a|aa)+', '(\\d+)*x', '(.*a){20}', '(a)\\1', '(?=a)a', '(?<=a)b', '\\d*\\d*\\d*\\d*x', '(a{1,9}){1,9}', 'a{0,2000}']) {
            const r = analyzeUserPattern(p);
            expect(r.ok, p).toBe(false);
        }
        expect(analyzeUserPattern('a'.repeat(201)).ok).toBe(false);
        expect(analyzeUserPattern('[abc').ok).toBe(false);
    });

    it('acepta los patrones de siempre', () => {
        for (const p of [
            '[A-Z]{3}-\\d{4}',
            '\\d{3}-\\d{7}',
            '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
            '(CC|CE|NIT)-\\d{6,10}',
            '\\d+(\\.\\d{1,2})?',
            '\\p{L}+',
        ]) {
            expect(analyzeUserPattern(p), p).toEqual({ ok: true });
        }
    });

    it('un patrón aceptado responde rápido con el peor valor', () => {
        const patterns = ['[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '\\d+(\\.\\d{1,2})?', '[a-z]*[a-z]*[a-z]*x'];
        for (const p of patterns) {
            expect(analyzeUserPattern(p).ok, p).toBe(true);
            const re = compileUserPattern(p)!;
            const evil = 'a'.repeat(USER_PATTERN_VALUE_MAX - 1) + '!';
            // El mejor de tres: una máquina de CI cargada puede demorar una
            // corrida suelta. Un retroceso catastrófico (exponencial) tardaría
            // segundos o no terminaría; el cúbico de este caso, decenas de ms.
            let best = Infinity;
            for (let i = 0; i < 3; i++) {
                const t0 = performance.now();
                re.test(evil);
                re.test('1'.repeat(USER_PATTERN_VALUE_MAX));
                best = Math.min(best, performance.now() - t0);
            }
            expect(best, p).toBeLessThan(250);
        }
    });

    it('un patrón inseguro que llegó sin pasar por el guardado no se ejecuta', () => {
        expect(compileUserPattern('(a+)+$')).toBeNull();
        const field = f(1, 'text', { validation: { format: 'regex', pattern: '(a+)+$' } });
        expect(checkValueRules(field, 'a'.repeat(50) + '!')).toBeNull();
    });
});

describe('obligatorio si…', () => {
    const tipo = f(1, 'select', { options: [{ value: 'empresa', label: 'Empresa' }, { value: 'persona', label: 'Persona' }] }, 'Tipo');
    const nit = f(2, 'text', { validation: { required_if: { field_id: 1, op: 'eq', value: 'empresa' } } }, 'NIT');
    const motivo = f(3, 'long_text', { validation: { required_if: { field_id: 4, op: 'not_empty', message: 'Explica el descuento' } } });
    const desc = f(4, 'number', {}, 'Descuento');

    it('es / no es / tiene valor', () => {
        const fields = [tipo, nit, motivo, desc];
        expect(checkRequiredIf(fields, { f1: 'empresa' }).map((e) => e.message)).toEqual([
            '«NIT» es obligatorio cuando «Tipo» es «Empresa».',
        ]);
        expect(checkRequiredIf(fields, { f1: 'persona' })).toEqual([]);
        expect(checkRequiredIf(fields, { f1: 'empresa', f2: '900' })).toEqual([]);
        expect(checkRequiredIf(fields, { f4: 10 }).map((e) => e.message)).toEqual(['Explica el descuento']);
        const neq = f(5, 'text', { validation: { required_if: { field_id: 1, op: 'neq', value: 'empresa' } } });
        expect(checkRequiredIf([tipo, neq], {}).length).toBe(1);
    });

    it('en una edición sólo cuenta lo que cambió', () => {
        const fields = [tipo, nit];
        expect(checkRequiredIf(fields, { f1: 'empresa' }, { touched: new Set(['f9']) })).toEqual([]);
        expect(checkRequiredIf(fields, { f1: 'empresa' }, { touched: new Set(['f1']) }).length).toBe(1);
        expect(checkRequiredIf(fields, { f1: 'empresa' }, { touched: new Set(['f2']) }).length).toBe(1);
    });
});

describe('config: las reglas viven junto a la config del tipo', () => {
    it('parseFieldConfig acepta default y validación en los tipos escribibles y las quita en los demás', () => {
        const cfg = parseFieldConfig('text', { max_length: 10, validation: { format: 'nit' }, default_value: { kind: 'value', value: 'x' } });
        expect(cfg.validation).toEqual({ format: 'nit' });
        expect(cfg.default_value).toEqual({ kind: 'value', value: 'x' });
        const auto = parseFieldConfig('autonumber', { prefix: 'TCK', validation: { format: 'nit' } });
        expect(auto).toEqual({ prefix: 'TCK' });
        expect(() => parseFieldConfig('autonumber', { prefix: 'T C K' })).toThrow();
    });
});
