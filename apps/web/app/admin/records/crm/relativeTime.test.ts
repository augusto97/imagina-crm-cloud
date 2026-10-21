import { describe, expect, it } from 'vitest';

import { relativeTimeFrom } from './FieldValueDisplay';

const DAY = 86_400_000;
const inDays = (n: number): Date => new Date(Date.now() + n * DAY);

describe('fecha relativa de la ficha', () => {
    it('singular de verdad: «en 1 mes» y «en 1 año», no «1 meses»/«1 años»', () => {
        expect(relativeTimeFrom(inDays(32))).toBe('en 1 mes');
        expect(relativeTimeFrom(inDays(-32))).toBe('hace 1 mes');
        expect(relativeTimeFrom(inDays(400))).toBe('en 1 año');
        expect(relativeTimeFrom(inDays(-400))).toBe('hace 1 año');
    });

    it('plural para lo demás', () => {
        expect(relativeTimeFrom(inDays(95))).toBe('en 3 meses');
        expect(relativeTimeFrom(inDays(-800))).toBe('hace 2 años');
        expect(relativeTimeFrom(inDays(3))).toBe('en 3 días');
    });
});
