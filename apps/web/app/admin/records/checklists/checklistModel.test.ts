import { describe, expect, it } from 'vitest';
import type { RecordChecklists } from '@imagina-base/shared';

import { patchItem, reorderItemsIn, withTotals } from '@/hooks/useChecklists';

import { dueStateOf, moveId, shiftId } from './checklistModel';

const NOW = new Date('2026-11-12T15:00:00Z'); // 10:00 en Bogotá

describe('A9 · fecha de un ítem de checklist', () => {
    it('un día del calendario se compara contra HOY en la zona de la empresa', () => {
        expect(dueStateOf('2026-11-11', false, NOW, 'America/Bogota')).toBe('overdue');
        expect(dueStateOf('2026-11-12', false, NOW, 'America/Bogota')).toBe('today');
        expect(dueStateOf('2026-11-20', false, NOW, 'America/Bogota')).toBe('upcoming');
    });

    it('con hora: pasado el instante está vencido aunque sea hoy', () => {
        expect(dueStateOf('2026-11-12T14:00:00Z', false, NOW, 'America/Bogota')).toBe('overdue');
        expect(dueStateOf('2026-11-12T20:00:00Z', false, NOW, 'America/Bogota')).toBe('today');
        // 03:00 UTC del 13 = 22:00 del 12 en Bogotá → todavía es hoy allá.
        expect(dueStateOf('2026-11-13T03:00:00Z', false, NOW, 'America/Bogota')).toBe('today');
    });

    it('un ítem hecho o sin fecha no tiene estado', () => {
        expect(dueStateOf('2026-11-01', true, NOW, 'America/Bogota')).toBeNull();
        expect(dueStateOf(null, false, NOW, 'America/Bogota')).toBeNull();
    });
});

describe('A9 · reordenar ítems', () => {
    it('arrastrar hacia abajo deja el ítem DESPUÉS del destino; hacia arriba, ANTES', () => {
        expect(moveId([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
        expect(moveId([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
    });

    it('soltar sobre sí mismo o sobre algo que no está no cambia nada', () => {
        expect(moveId([1, 2, 3], 2, 2)).toBeNull();
        expect(moveId([1, 2, 3], 9, 2)).toBeNull();
    });

    it('subir y bajar desde el menú (táctil) respetan los bordes', () => {
        expect(shiftId([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
        expect(shiftId([1, 2, 3], 3, 1)).toBeNull();
        expect(shiftId([1, 2, 3], 1, -1)).toBeNull();
    });
});

describe('A9 · cache optimista de los checklists', () => {
    const state: RecordChecklists = withTotals([
        {
            id: 10,
            list_id: 1,
            record_id: 5,
            name: 'Arranque',
            position: 0,
            created_at: '2026-11-01T00:00:00Z',
            items: [
                { id: 1, checklist_id: 10, text: 'A', done: false, done_by: null, done_at: null, assignee_id: null, due: null, position: 0, created_at: '' },
                { id: 2, checklist_id: 10, text: 'B', done: true, done_by: 3, done_at: '', assignee_id: null, due: null, position: 1, created_at: '' },
                { id: 3, checklist_id: 10, text: 'C', done: false, done_by: null, done_at: null, assignee_id: null, due: null, position: 2, created_at: '' },
            ],
        },
    ]);

    it('los totales salen de los ítems', () => {
        expect(state.done).toBe(1);
        expect(state.total).toBe(3);
    });

    it('marcar un ítem recalcula hechos / total al instante', () => {
        const next = patchItem(state, 1, { done: true });
        expect(next.done).toBe(2);
        expect(next.checklists[0]!.items[0]!.done).toBe(true);
        // El estado anterior no se toca (para volver atrás si el servidor rechaza).
        expect(state.checklists[0]!.items[0]!.done).toBe(false);
    });

    it('reordenar respeta el orden pedido y renumera la posición', () => {
        const next = reorderItemsIn(state, 10, [3, 1, 2]);
        expect(next.checklists[0]!.items.map((i) => [i.id, i.position])).toEqual([
            [3, 0],
            [1, 1],
            [2, 2],
        ]);
    });
});
