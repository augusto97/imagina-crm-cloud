import { describe, expect, it } from 'vitest';
import type { LayoutBlock, LayoutSection } from '@imagina-base/shared';

import { planSection } from './sectionPlan';

const b = (id: string, type: LayoutBlock['type'], config: Record<string, unknown> = {}): LayoutBlock => ({ id, type, config });
const section = (columns: number[], blocks: LayoutBlock[][]): LayoutSection => ({ id: 's', columns, blocks });

describe('reparto de columnas de la ficha', () => {
    it('una columna vacía cede su ancho', () => {
        const plan = planSection(section([3, 5, 4], [[b('a', 'record_stats')], [], []]), 900, 16);
        expect(plan).toMatchObject({ mode: 'grid', columns: [12] });
        expect(plan.blocks).toHaveLength(1);
    });

    it('con lugar, respeta la plantilla', () => {
        const s = section([8, 4], [[b('d', 'fields')], [b('a', 'activity')]]);
        expect(planSection(s, 1100, 16)).toMatchObject({ mode: 'grid', columns: [8, 4] });
    });

    it('un 3 · 6 · 3 sin lugar pasa a principal + lateral, sin perder bloques ni orden', () => {
        const s = section([3, 6, 3], [[b('d', 'fields')], [b('a', 'activity')], [b('f', 'fields')]]);
        const plan = planSection(s, 900, 16);
        expect(plan.mode).toBe('grid');
        expect(plan.columns).toEqual([8, 4]);
        expect(plan.blocks.map((col) => col.map((x) => x.id))).toEqual([['a'], ['d', 'f']]);
    });

    it('cifras chicas que no entran van de a dos; contenido de lectura se apila', () => {
        const kpis = section([3, 3, 3, 3], [[b('1', 'field')], [b('2', 'chart', { kind: 'kpi' })], [b('3', 'field')], [b('4', 'field')]]);
        expect(planSection(kpis, 500, 16).mode).toBe('pairs');
        const wide = section([6, 6], [[b('t', 'related')], [b('c', 'chart', { kind: 'bar' })]]);
        expect(planSection(wide, 420, 16).mode).toBe('stack');
    });

    it('sin medir todavía (primer render) dibuja la plantilla', () => {
        expect(planSection(section([4, 4, 4], [[b('a', 'fields')], [b('b', 'fields')], [b('c', 'fields')]]), 0, 16).mode).toBe('grid');
    });
});
