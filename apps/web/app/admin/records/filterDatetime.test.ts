import { describe, expect, it } from 'vitest';

import { datetimeFilterToInput, datetimeInputToFilter } from './filterDatetime';

describe('filtro de fecha y hora — valor con zona (v0.1.286)', () => {
    it('la hora local del input viaja como instante ISO y vuelve igual', () => {
        const iso = datetimeInputToFilter('2026-10-21T14:30');
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
        expect(new Date(iso).getTime()).toBe(new Date('2026-10-21T14:30').getTime());
        expect(datetimeFilterToInput(iso)).toBe('2026-10-21T14:30');
    });

    it('un filtro guardado sin zona se muestra tal cual; vacío y basura no revientan', () => {
        expect(datetimeFilterToInput('2026-10-21T14:30')).toBe('2026-10-21T14:30');
        expect(datetimeFilterToInput('')).toBe('');
        expect(datetimeFilterToInput('xx')).toBe('');
        expect(datetimeInputToFilter('')).toBe('');
    });
});
