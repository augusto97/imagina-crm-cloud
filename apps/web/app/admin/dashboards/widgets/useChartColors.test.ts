import { describe, expect, it } from 'vitest';

import { applyHideZero, displayGroupLabel, prettyGroupLabel } from './useChartColors';

describe('chart helpers', () => {
    it('v0.1.178 — displayGroupLabel traduce value → etiqueta (simple, multi y combos)', () => {
        const labels = new Map([
            ['gestion_sitio_web', 'Gestión sitio web'],
            ['vps_en_hetzner', 'VPS en Hetzner'],
        ]);
        expect(displayGroupLabel('gestion_sitio_web', labels)).toBe('Gestión sitio web');
        expect(displayGroupLabel('["gestion_sitio_web"]', labels)).toBe('Gestión sitio web');
        expect(displayGroupLabel('["gestion_sitio_web","vps_en_hetzner"]', labels)).toBe('Gestión sitio web, VPS en Hetzner');
        // Opción borrada / dato legacy: cae al value crudo, nunca se pierde.
        expect(displayGroupLabel('["gestion_sitio_web","viejo"]', labels)).toBe('Gestión sitio web, viejo');
        expect(displayGroupLabel('[]', labels)).toBe('(sin valor)');
        // Sin mapa (campo no-select, fechas) se comporta como prettyGroupLabel.
        expect(displayGroupLabel('2026-07', undefined)).toBe('2026-07');
    });

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
