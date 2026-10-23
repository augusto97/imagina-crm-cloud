import { describe, expect, it } from 'vitest';
import { GANTT_PX_PER_DAY } from '@imagina-base/shared';

import {
    barBox,
    dayAtX,
    dependencyPath,
    ganttCanvas,
    GANTT_CANVAS_HALF_DAYS,
    GANTT_MILESTONE,
    panelWidths,
    resizePanelColumn,
    scrollLeftFor,
    snapDays,
    undoPatchFor,
    visibleDayRange,
    xOfDay,
} from './ganttModel';

describe('Gantt — lienzo', () => {
    const today = 20_000;
    const c = ganttCanvas(today, 'week');

    it('cubre ±5 años alrededor de hoy con la escala del zoom', () => {
        expect(c.origin).toBe(today - GANTT_CANVAS_HALF_DAYS);
        expect(c.ppd).toBe(GANTT_PX_PER_DAY.week);
        expect(c.width).toBe(Math.ceil(c.days * c.ppd));
    });

    it('día ↔ x ida y vuelta, y lo visible según el scroll', () => {
        const x = xOfDay(c, today);
        expect(dayAtX(c, x)).toBe(today);
        expect(dayAtX(c, x + c.ppd - 0.01)).toBe(today);
        const vis = visibleDayRange(c, x, c.ppd * 10);
        expect(vis).toEqual({ from: today, to: today + 9 });
    });

    it('«Ir a hoy» deja el día en el tercio izquierdo y nunca se sale del lienzo', () => {
        const w = 900;
        const left = scrollLeftFor(c, today, w);
        const center = left + w / 3;
        expect(Math.abs(dayAtX(c, center) - today)).toBeLessThanOrEqual(1);
        expect(scrollLeftFor(c, c.origin - 100, w)).toBe(0);
        expect(scrollLeftFor(c, c.origin + c.days + 100, w)).toBe(c.width - w);
    });

    it('barras y rombos', () => {
        const box = barBox(c, { start: today, end: today + 6, milestone: false });
        expect(box).toEqual({ left: xOfDay(c, today), width: 7 * c.ppd });
        const m = barBox(c, { start: today, end: today, milestone: true });
        expect(m.width).toBe(GANTT_MILESTONE);
        expect(m.left + m.width / 2).toBeCloseTo(xOfDay(c, today) + c.ppd / 2);
        // Una barra de un día en el zoom más lejano igual se puede agarrar.
        const q = ganttCanvas(today, 'quarter');
        expect(barBox(q, { start: today, end: today, milestone: false }).width).toBeGreaterThanOrEqual(6);
    });

    it('el arrastre se redondea al día', () => {
        expect(snapDays(c.ppd * 2.4, c.ppd)).toBe(2);
        expect(snapDays(-c.ppd * 0.4, c.ppd)).toBe(0);
        expect(Object.is(snapDays(-c.ppd * 0.4, c.ppd), -0)).toBe(false);
        expect(snapDays(-c.ppd * 1.6, c.ppd)).toBe(-2);
    });
});

describe('Gantt — flechas de dependencias', () => {
    it('en «L» si hay lugar; rodeando por entre las filas si se superponen', () => {
        expect(dependencyPath({ x: 100, y: 17 }, { x: 200, y: 51 })).toBe('M 100 17 H 110 V 51 H 200');
        const around = dependencyPath({ x: 100, y: 17 }, { x: 90, y: 51 }, 34);
        expect(around).toBe('M 100 17 H 110 V 34 H 80 V 51 H 90');
        // Hacia arriba rodea por arriba.
        expect(dependencyPath({ x: 100, y: 51 }, { x: 95, y: 17 }, 34)).toBe('M 100 51 H 110 V 34 H 85 V 17 H 95');
    });
});

describe('Gantt — panel y deshacer', () => {
    it('anchos del panel: título + columnas, con defaults y topes', () => {
        const w = panelWidths({ titleWidth: null, columns: [{ field_id: 1 }, { field_id: 2, width: 90 }] });
        expect(w).toEqual({ title: 260, columns: [120, 90], total: 470 });
        expect(resizePanelColumn({ titleWidth: null, columns: [] }, -1, 20).titleWidth).toBe(80);
        const r = resizePanelColumn({ titleWidth: 200, columns: [{ field_id: 1 }, { field_id: 2 }] }, 1, 999.6);
        expect(r).toEqual({ titleWidth: 200, columns: [{ field_id: 1 }, { field_id: 2, width: 600 }] });
    });

    it('el patch de deshacer vuelve a los valores de antes (vacío si no había)', () => {
        expect(undoPatchFor({ inicio: '2026-07-01', fin: '' }, { inicio: '2026-07-03', fin: '2026-07-04' })).toEqual({
            inicio: '2026-07-01',
            fin: null,
        });
    });
});
