import { describe, expect, it } from 'vitest';

import { widgetErrorOf } from './useDashboards';

/** v0.1.229 — el bundle trae el error de CADA widget por separado. */
describe('widgetErrorOf', () => {
    it('reconoce el error de un widget y deja pasar los datos', () => {
        expect(widgetErrorOf({ __error: 'sum sólo aplica a campos numéricos' })).toBe('sum sólo aplica a campos numéricos');
        expect(widgetErrorOf({ __error: '' })).toBe('No se pudo calcular este widget.');
        expect(widgetErrorOf({ value: 3, metric: 'count' })).toBeNull();
        expect(widgetErrorOf(undefined)).toBeNull();
    });
});
