import { describe, expect, it } from 'vitest';
import { listTrashQuerySchema, trashDaysLeft, trashTargetSchema } from './trash';

describe('papelera', () => {
    it('cuenta los días que quedan (0 si ya venció)', () => {
        const now = new Date('2026-10-01T12:00:00Z');
        expect(trashDaysLeft('2026-10-31T12:00:00Z', now)).toBe(30);
        expect(trashDaysLeft('2026-10-01T18:00:00Z', now)).toBe(1);
        expect(trashDaysLeft('2026-09-30T12:00:00Z', now)).toBe(0);
        expect(trashDaysLeft('no-es-fecha', now)).toBe(0);
    });

    it('valida el filtro del listado y el destino', () => {
        expect(listTrashQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 });
        expect(listTrashQuerySchema.parse({ type: 'record', list_id: '7', q: ' acme ' })).toMatchObject({
            type: 'record',
            list_id: 7,
            q: 'acme',
        });
        expect(listTrashQuerySchema.safeParse({ type: 'otra' }).success).toBe(false);
        expect(trashTargetSchema.parse({ type: 'list', id: '12' })).toEqual({ type: 'list', id: 12 });
        expect(trashTargetSchema.safeParse({ type: 'list', id: '-1' }).success).toBe(false);
    });
});
