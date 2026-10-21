import { describe, expect, it } from 'vitest';
import { buildMemberLookup, coerceTextToFieldValue, normalizeDateString, parseNumberText } from './text-coercion';
import { validateFieldValue } from './validate';

const field = (type: string, config: Record<string, unknown> = {}) => ({ type, config });
const estado = field('select', {
    options: [
        { value: 'pendiente_pago', label: 'Pendiente de pago' },
        { value: 'gestion', label: 'Gestión' },
    ],
});

describe('parseNumberText', () => {
    it('lee los separadores de la empresa en los casos ambiguos', () => {
        expect(parseNumberText('1.500.000')).toBe(1500000);
        expect(parseNumberText('1.500.000', 'dot_comma')).toBe(1500000);
        expect(parseNumberText('1.500', 'dot_comma')).toBe(1500);
        expect(parseNumberText('1,500', 'comma_dot')).toBe(1500);
        expect(parseNumberText('1.5', 'dot_comma')).toBe(1.5);
        expect(parseNumberText('12,5', 'comma_dot')).toBe(12.5);
    });
    it('con dos separadores distintos, el último es el decimal', () => {
        expect(parseNumberText('1,032,000.50')).toBe(1032000.5);
        expect(parseNumberText('1.234,56')).toBe(1234.56);
        expect(parseNumberText('1 234,5', 'space_comma')).toBe(1234.5);
    });
    it('símbolos, negativos y lo que no es número', () => {
        expect(parseNumberText('$ 25.900', 'dot_comma')).toBe(25900);
        expect(parseNumberText('COP 1.200.000')).toBe(1200000);
        expect(parseNumberText('(1.200)', 'dot_comma')).toBe(-1200);
        expect(parseNumberText('-3,5', 'dot_comma')).toBe(-3.5);
        expect(parseNumberText('hola')).toBeNull();
        expect(parseNumberText('')).toBeNull();
    });
});

describe('normalizeDateString', () => {
    it('día/mes según el formato de la empresa cuando es ambiguo', () => {
        expect(normalizeDateString('03/04/2026', 'date', { dateFormat: 'dmy' })).toBe('2026-04-03');
        expect(normalizeDateString('03/04/2026', 'date', { dateFormat: 'mdy' })).toBe('2026-03-04');
        expect(normalizeDateString('31/12/2026', 'date', { dateFormat: 'mdy' })).toBe('2026-12-31');
        expect(normalizeDateString('2026-12-31', 'date')).toBe('2026-12-31');
        expect(normalizeDateString('31/02/2026', 'date')).toBe('31/02/2026');
    });
    it('fecha y hora sin zona se lee en el reloj de la empresa', () => {
        expect(normalizeDateString('21/10/2026 14:30', 'datetime', { dateFormat: 'dmy', timeZone: 'America/Bogota' })).toBe(
            '2026-10-21T19:30:00.000Z',
        );
        expect(normalizeDateString('2026-10-21 2:30 p. m.', 'datetime', { timeZone: 'UTC' })).toBe('2026-10-21T14:30:00.000Z');
        // Ya canónico: no se re-escribe (sin milisegundos de más).
        expect(normalizeDateString('2026-10-21T14:30:00Z', 'datetime')).toBe('2026-10-21T14:30:00Z');
    });
});

describe('coerceTextToFieldValue', () => {
    it('opciones por etiqueta o valor, sin mayúsculas ni acentos', () => {
        expect(coerceTextToFieldValue('pendiente de pago', estado)).toBe('pendiente_pago');
        expect(coerceTextToFieldValue('GESTION', estado)).toBe('gestion');
        expect(coerceTextToFieldValue('pendiente_pago', estado)).toBe('pendiente_pago');
        expect(coerceTextToFieldValue('Gestión, Pendiente de pago', { ...estado, type: 'multi_select' })).toEqual(['gestion', 'pendiente_pago']);
    });
    it('casillas: estrictas para pegar, laxas para el import histórico', () => {
        expect(coerceTextToFieldValue('Sí', field('checkbox'), { strictBoolean: true })).toBe(true);
        expect(coerceTextToFieldValue('No', field('checkbox'), { strictBoolean: true })).toBe(false);
        expect(coerceTextToFieldValue('quizás', field('checkbox'), { strictBoolean: true })).toBe('quizás');
        expect(coerceTextToFieldValue('quizás', field('checkbox'))).toBe(false);
    });
    it('personas por nombre o email (un nombre repetido no resuelve)', () => {
        const members = buildMemberLookup([
            { id: 3, name: 'Ana Pérez', email: 'ana@acme.co' },
            { id: 4, name: 'Juan', email: 'juan1@acme.co' },
            { id: 5, name: 'Juan', email: 'juan2@acme.co' },
        ]);
        expect(coerceTextToFieldValue('ana pérez', field('user'), { members })).toBe(3);
        expect(coerceTextToFieldValue('Ana Perez', field('user'), { members })).toBe(3);
        expect(coerceTextToFieldValue('ANA@acme.co', field('user'), { members })).toBe(3);
        expect(coerceTextToFieldValue('Juan', field('user'), { members })).toBe('Juan');
        expect(coerceTextToFieldValue('7', field('user'))).toBe(7);
    });
    it('montos, porcentajes y calificaciones', () => {
        expect(coerceTextToFieldValue('1.032.000', field('currency'), { numberFormat: 'dot_comma' })).toBe(1032000);
        expect(coerceTextToFieldValue('45 %', field('percent'))).toBe(45);
        expect(coerceTextToFieldValue('★★★☆☆', field('rating'))).toBe(3);
        expect(coerceTextToFieldValue('4 de 5', field('rating'))).toBe(4);
    });
    it('el resultado pasa la validación del campo', () => {
        const v = coerceTextToFieldValue('31/12/2026', field('date'), { dateFormat: 'dmy' });
        expect(validateFieldValue({ type: 'date', config: {}, is_required: false }, v).ok).toBe(true);
        const dt = coerceTextToFieldValue('31/12/2026 08:00', field('datetime'), { dateFormat: 'dmy', timeZone: 'America/Bogota' });
        expect(validateFieldValue({ type: 'datetime', config: {}, is_required: false }, dt).ok).toBe(true);
    });
});
