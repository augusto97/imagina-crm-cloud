import { describe, expect, it } from 'vitest';

import {
    parseDaysInput,
    relativeDateKeyOf,
    relativeDatePreview,
    valueForRelativeKey,
} from './relativeDateValue';

/** v0.1.469 — el valor de «es en…» de una fecha. */

const clock = { now: new Date('2026-11-26T15:00:00Z'), timeZone: 'America/Bogota' };
const dmy = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('relativeDateKeyOf — qué opción del selector muestra un valor', () => {
    it('preset, N días, rango fijo y lo que no se entiende', () => {
        expect(relativeDateKeyOf('next_7_days')).toBe('next_7_days');
        expect(relativeDateKeyOf({ days: 10, dir: 'next' })).toBe('rolling:next');
        expect(relativeDateKeyOf({ days: '45', dir: 'before' })).toBe('rolling:before');
        expect(relativeDateKeyOf({ from: '2026-11-01', to: '2026-11-30' })).toBe('custom');
        // Un N roto conserva la opción (se corrige el número, no se pierde la elección).
        expect(relativeDateKeyOf({ days: 0, dir: 'after' })).toBe('rolling:after');
        expect(relativeDateKeyOf('nada')).toBe('this_month');
        expect(relativeDateKeyOf(null)).toBe('this_month');
    });
});

describe('valueForRelativeKey — el valor que nace al elegir otra opción', () => {
    it('N días: arranca con el default y conserva la cantidad al cambiar de sentido', () => {
        expect(valueForRelativeKey('rolling:next', 'this_month', clock)).toEqual({ days: 10, dir: 'next' });
        expect(valueForRelativeKey('rolling:before', 'this_month', clock)).toEqual({ days: 30, dir: 'before' });
        expect(valueForRelativeKey('rolling:last', { days: 14, dir: 'next' }, clock)).toEqual({ days: 14, dir: 'last' });
    });

    it('«Personalizado…» arranca con lo que se estaba viendo (si tiene principio y fin)', () => {
        expect(valueForRelativeKey('custom', { days: 3, dir: 'next' }, clock)).toEqual({ from: '2026-11-26', to: '2026-11-28' });
        expect(valueForRelativeKey('custom', { from: '2026-01-01', to: '2026-01-31' }, clock)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
        // «Hace más de» no tiene principio: una semana desde hoy.
        expect(valueForRelativeKey('custom', { days: 30, dir: 'before' }, clock)).toEqual({ from: '2026-11-26', to: '2026-12-02' });
    });

    it('un preset es su slug', () => {
        expect(valueForRelativeKey('this_quarter', { days: 3, dir: 'next' }, clock)).toBe('this_quarter');
    });
});

describe('parseDaysInput', () => {
    it('sólo enteros de 1 a 3650', () => {
        expect(parseDaysInput('10')).toBe(10);
        expect(parseDaysInput(' 3650 ')).toBe(3650);
        for (const bad of ['', '0', '3651', '2.5', '-4', 'diez']) expect(parseDaysInput(bad)).toBeNull();
    });
});

describe('relativeDatePreview — qué abarca hoy, en la zona y el formato de la empresa', () => {
    it('los cuatro sentidos', () => {
        expect(relativeDatePreview({ days: 10, dir: 'next' }, clock, dmy)).toBe('Del 26/11/2026 al 05/12/2026');
        expect(relativeDatePreview({ days: 10, dir: 'last' }, clock, dmy)).toBe('Del 17/11/2026 al 26/11/2026');
        expect(relativeDatePreview({ days: 45, dir: 'before' }, clock, dmy)).toBe('Antes del 12/10/2026');
        expect(relativeDatePreview({ days: 30, dir: 'after' }, clock, dmy)).toBe('Desde el 27/12/2026');
        expect(relativeDatePreview('today', clock, dmy)).toBe('El 26/11/2026');
        expect(relativeDatePreview({ days: 0, dir: 'next' }, clock, dmy)).toBeNull();
    });

    it('«hoy» es el de la empresa, no el del navegador', () => {
        // 26-nov 03:00 UTC: en Bogotá todavía es el 25.
        const early = { now: new Date('2026-11-26T03:00:00Z'), timeZone: 'America/Bogota' };
        expect(relativeDatePreview('today', early, dmy)).toBe('El 25/11/2026');
        expect(relativeDatePreview('today', { ...early, timeZone: 'Asia/Tokyo' }, dmy)).toBe('El 26/11/2026');
    });
});
