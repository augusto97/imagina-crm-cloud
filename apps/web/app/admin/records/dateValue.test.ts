import { describe, expect, it } from 'vitest';

import { formatDateValue } from './DateCellEditor';

describe('formatDateValue (v0.1.252)', () => {
    it('un date viaja como YYYY-MM-DD, sin hora', () => {
        expect(formatDateValue(new Date(2026, 9, 20), '09:30', false)).toBe('2026-10-20');
    });

    it('un datetime viaja como el instante con zona (lo que exige el backend)', () => {
        const out = formatDateValue(new Date(2026, 9, 20), '09:30', true);
        expect(out).toBe(new Date(2026, 9, 20, 9, 30).toISOString());
        expect(out.endsWith('Z')).toBe(true);
    });

    it('un datetime sin hora toma las 00:00 locales', () => {
        expect(formatDateValue(new Date(2026, 9, 20), '', true)).toBe(new Date(2026, 9, 20, 0, 0).toISOString());
    });
});
