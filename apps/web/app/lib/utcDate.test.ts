import { describe, expect, it } from 'vitest';

import { parseUtcDate, toUtcIso } from './utcDate';

describe('parseUtcDate', () => {
    it('acepta naive-UTC e ISO con zona sin duplicar la Z', () => {
        expect(toUtcIso('2026-06-01 12:04:00')).toBe('2026-06-01T12:04:00Z');
        expect(toUtcIso('2026-06-01T12:04:00Z')).toBe('2026-06-01T12:04:00Z');
        expect(toUtcIso('2026-06-01T12:04:00+05:00')).toBe('2026-06-01T12:04:00+05:00');
        expect(parseUtcDate('2026-06-01T12:04:00Z').toISOString()).toBe('2026-06-01T12:04:00.000Z');
        expect(parseUtcDate('2026-06-01 12:04:00').toISOString()).toBe('2026-06-01T12:04:00.000Z');
        expect(Number.isNaN(parseUtcDate(null).getTime())).toBe(true);
    });
});
