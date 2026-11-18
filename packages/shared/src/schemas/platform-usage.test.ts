import { describe, expect, it } from 'vitest';

import { PLAN_MODULES } from './plan-access';
import { USAGE_GROUPS, USAGE_MODULE_KEYS, USAGE_MODULES, compareUsageCells, usageCellUsing, type UsageCell } from './platform-usage';

describe('v0.1.437 — uso por módulo', () => {
    it('cada clave tiene su ficha, en un grupo conocido y con un módulo de plan válido', () => {
        expect(USAGE_MODULES.map((m) => m.key).sort()).toEqual([...USAGE_MODULE_KEYS].sort());
        const groups = new Set(USAGE_GROUPS.map((g) => g.key));
        for (const m of USAGE_MODULES) {
            expect(groups.has(m.group)).toBe(true);
            if (m.plan_module) expect(PLAN_MODULES).toContain(m.plan_module);
            // Cada módulo mide algo.
            expect(m.total_label !== null || m.activity_label !== null).toBe(true);
        }
    });

    it('todos los módulos del plan se pueden medir (si no, «nadie lo usa» mentiría)', () => {
        const measured = new Set(USAGE_MODULES.map((m) => m.plan_module).filter(Boolean));
        for (const pm of PLAN_MODULES) expect(measured.has(pm)).toBe(true);
    });

    it('usar = tener algo configurado; si el módulo no tiene cantidad, haber tenido actividad', () => {
        expect(usageCellUsing({ total_label: 'activas' }, [2, 0, null])).toBe(true);
        expect(usageCellUsing({ total_label: 'activas' }, [0, 5, null])).toBe(false);
        expect(usageCellUsing({ total_label: null }, [0, 5, null])).toBe(true);
        expect(usageCellUsing({ total_label: null }, [0, 0, null])).toBe(false);
        expect(usageCellUsing({ total_label: 'activas' }, undefined)).toBe(false);
    });

    it('ordena por actividad, después cantidad, después lo más reciente', () => {
        const cells: UsageCell[] = [
            [1, 0, 10],
            [5, 0, 5],
            [1, 9, 1],
            [5, 0, 20],
        ];
        expect(cells.sort(compareUsageCells)).toEqual([
            [1, 9, 1],
            [5, 0, 20],
            [5, 0, 5],
            [1, 0, 10],
        ]);
    });
});
