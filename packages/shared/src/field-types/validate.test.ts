import { describe, expect, it } from 'vitest';
import type { FieldType } from '../schemas/field';
import { validateFieldValue, type FieldValueSpec } from './validate';

const field = (
    type: FieldType,
    config: Record<string, unknown> = {},
    is_required = false,
): FieldValueSpec => ({ type, config, is_required });

describe('validateFieldValue — required / nullish', () => {
    it('nullish en campo required falla (salvo checkbox)', () => {
        for (const empty of [null, '', []]) {
            expect(validateFieldValue(field('text', {}, true), empty).ok).toBe(false);
        }
    });
    it('nullish en campo opcional se normaliza a null', () => {
        expect(validateFieldValue(field('text'), '')).toEqual({ ok: true, value: null });
        expect(validateFieldValue(field('multi_select'), [])).toEqual({ ok: true, value: null });
    });
});

describe('validateFieldValue — text/number', () => {
    it('text respeta max_length', () => {
        expect(validateFieldValue(field('text', { max_length: 3 }), 'abcd').ok).toBe(false);
        expect(validateFieldValue(field('text', { max_length: 3 }), 'abc')).toEqual({
            ok: true,
            value: 'abc',
        });
    });
    it('number coacciona string numérico y valida min/max', () => {
        expect(validateFieldValue(field('number'), '42')).toEqual({ ok: true, value: 42 });
        expect(validateFieldValue(field('number', { min: 10 }), 5).ok).toBe(false);
        expect(validateFieldValue(field('number', { max: 10 }), 11).ok).toBe(false);
        expect(validateFieldValue(field('number'), 'no').ok).toBe(false);
    });
});

describe('validateFieldValue — select/multi_select', () => {
    const opts = { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
    it('select exige pertenencia a las opciones', () => {
        expect(validateFieldValue(field('select', opts), 'a')).toEqual({ ok: true, value: 'a' });
        expect(validateFieldValue(field('select', opts), 'z').ok).toBe(false);
    });
    it('multi_select valida cada item y deduplica', () => {
        expect(validateFieldValue(field('multi_select', opts), ['a', 'a', 'b'])).toEqual({
            ok: true,
            value: ['a', 'b'],
        });
        expect(validateFieldValue(field('multi_select', opts), ['a', 'z']).ok).toBe(false);
    });
});

describe('validateFieldValue — checkbox (nunca required-fail)', () => {
    it('ausencia = false, coacciona strings y números', () => {
        expect(validateFieldValue(field('checkbox', {}, true), null)).toEqual({ ok: true, value: false });
        expect(validateFieldValue(field('checkbox'), 'yes')).toEqual({ ok: true, value: true });
        expect(validateFieldValue(field('checkbox'), 0)).toEqual({ ok: true, value: false });
        expect(validateFieldValue(field('checkbox'), 'nope').ok).toBe(false);
    });
});

describe('validateFieldValue — date/datetime/url/email/user', () => {
    it('date exige YYYY-MM-DD', () => {
        expect(validateFieldValue(field('date'), '2026-05-31').ok).toBe(true);
        expect(validateFieldValue(field('date'), '31/05/2026').ok).toBe(false);
    });
    it('datetime exige ISO con zona', () => {
        expect(validateFieldValue(field('datetime'), '2026-05-31T10:00:00Z').ok).toBe(true);
        expect(validateFieldValue(field('datetime'), '2026-05-31').ok).toBe(false);
    });
    it('url y email validan formato; email se normaliza a minúsculas', () => {
        expect(validateFieldValue(field('url'), 'https://x.com/y').ok).toBe(true);
        expect(validateFieldValue(field('url'), 'no-url').ok).toBe(false);
        expect(validateFieldValue(field('email'), 'A@B.COM')).toEqual({ ok: true, value: 'a@b.com' });
        expect(validateFieldValue(field('email'), 'bad@').ok).toBe(false);
    });
    it('user exige id entero positivo', () => {
        expect(validateFieldValue(field('user'), 7)).toEqual({ ok: true, value: 7 });
        expect(validateFieldValue(field('user'), 0).ok).toBe(false);
    });
});

describe('validateFieldValue — relation/computed no van en data', () => {
    it('rechaza escribir relation o computed en los datos', () => {
        expect(validateFieldValue(field('relation'), 5).ok).toBe(false);
        expect(validateFieldValue(field('computed'), 'x').ok).toBe(false);
    });
});
