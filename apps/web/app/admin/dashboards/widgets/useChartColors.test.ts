import { describe, expect, it } from 'vitest';

import { applyHideZero, prettyGroupLabel } from './useChartColors';

describe('chart helpers', () => {
    it('v0.1.101 — prettyGroupLabel convierte JSON de multi_select a texto', () => {
        expect(prettyGroupLabel('["hosting_2gb"]')).toBe('hosting_2gb');
        expect(prettyGroupLabel('["vip","promo"]')).toBe('vip, promo');
        expect(prettyGroupLabel('[]')).toBe('(sin valor)');
        // No-JSON se muestra tal cual (incluye corchetes literales raros)
        expect(prettyGroupLabel('activo')).toBe('activo');
        expect(prettyGroupLabel('[no json')).toBe('[no json');
        expect(prettyGroupLabel('2026-07')).toBe('2026-07');
    });

    it('v0.1.102 — applyHideZero oculta grupos con métrica 0', () => {
        const rows = [
            { label: 'a', value: 100 },
            { label: 'b', value: 0 },
            { label: 'c', value: 50 },
            { label: 'd', value: 0 },
        ];
        expect(applyHideZero(rows, false)).toEqual(rows);
        expect(applyHideZero(rows, true)).toEqual([
            { label: 'a', value: 100 },
            { label: 'c', value: 50 },
        ]);
        // Todo en 0 → se muestran igual (un chart vacío confunde más)
        const zeros = [{ label: 'x', value: 0 }];
        expect(applyHideZero(zeros, true)).toEqual(zeros);
    });
});
