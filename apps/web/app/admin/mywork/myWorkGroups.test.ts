import { describe, expect, it } from 'vitest';
import type { MyWorkItem } from '@imagina-base/shared';

import { groupWork, localDueDay } from './myWorkGroups';

const item = (record_id: number, due: string | null, due_is_datetime = false): MyWorkItem => ({
    list_id: 1,
    list_slug: 'tareas',
    list_name: 'Tareas',
    list_icon: null,
    list_color: null,
    record_id,
    title: `R${record_id}`,
    due,
    due_label: 'Vence',
    due_is_datetime,
    status_label: null,
    status_color: null,
});

describe('Mi trabajo', () => {
    it('agrupa por vencimiento con «hoy» en la zona de la empresa', () => {
        const now = new Date('2026-10-09T15:00:00Z');
        const g = groupWork(
            [item(1, '2026-10-01'), item(2, '2026-10-09'), item(3, '2026-10-14'), item(4, '2026-12-01'), item(5, null)],
            'America/Bogota',
            now,
        );
        expect(g.get('overdue')!.map((i) => i.record_id)).toEqual([1]);
        expect(g.get('today')!.map((i) => i.record_id)).toEqual([2]);
        expect(g.get('week')!.map((i) => i.record_id)).toEqual([3]);
        expect(g.get('later')!.map((i) => i.record_id)).toEqual([4]);
        expect(g.get('none')!.map((i) => i.record_id)).toEqual([5]);
    });

    it('una fecha-hora cuenta en el día local', () => {
        // 02:00 UTC del 10 = 21:00 del 9 en Bogotá.
        expect(localDueDay(item(1, '2026-10-10T02:00:00Z', true), 'America/Bogota')).toBe('2026-10-09');
        expect(localDueDay(item(1, '2026-10-10T02:00:00Z', true), 'UTC')).toBe('2026-10-10');
    });
});
