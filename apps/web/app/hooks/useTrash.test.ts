import { describe, expect, it } from 'vitest';
import type { TrashItem } from '@imagina-base/shared';

import { trashItemDetail, trashItemName } from '@/cloud/components/TrashPanel';
import { recordTitleFor, trashedTitle } from '@/hooks/useTrash';

const base: TrashItem = {
    type: 'record',
    id: 7,
    name: '',
    list_id: 3,
    list_name: 'Clientes',
    list_slug: 'clientes',
    subtype: null,
    children: null,
    deleted_at: '2026-10-20T10:00:00',
    deleted_by: 1,
    deleted_by_name: 'Ana',
    purge_at: '2026-11-19T10:00:00',
    can_restore: true,
};

describe('papelera', () => {
    it('el aviso nombra lo borrado (o dice qué fue)', () => {
        expect(trashedTitle('record', 'Acme')).toBe('«Acme» se movió a la papelera');
        expect(trashedTitle('list', '  ')).toBe('La lista se movió a la papelera');
        expect(trashedTitle('field', 'x'.repeat(80))).toContain('…»');
    });

    it('el título del registro sale del campo de título (o del primer texto)', () => {
        const fields = [
            { slug: 'monto', type: 'number' },
            { slug: 'nombre', type: 'text' },
            { slug: 'razon', type: 'text', is_primary: true },
        ];
        expect(recordTitleFor(fields, { nombre: 'Ana', razon: 'Acme S.A.' })).toBe('Acme S.A.');
        expect(recordTitleFor(fields.slice(0, 2), { nombre: ' Ana ' })).toBe('Ana');
        expect(recordTitleFor(fields, { razon: '' })).toBeNull();
        expect(recordTitleFor(fields, undefined)).toBeNull();
    });

    it('cada cosa se describe en lenguaje claro', () => {
        expect(trashItemName(base)).toBe('Registro #7');
        expect(trashItemDetail({ ...base, children: 2 })).toBe('en «Clientes» · con 2 subtareas');
        expect(trashItemDetail({ ...base, type: 'list', name: 'Clientes', list_id: null, list_name: null, children: 1 })).toBe('con 1 registro');
        expect(trashItemDetail({ ...base, type: 'field', subtype: 'select' })).toBe('Selección · en «Clientes»');
        expect(trashItemDetail({ ...base, type: 'view', subtype: 'kanban' })).toBe('Kanban · en «Clientes»');
        expect(trashItemDetail({ ...base, type: 'automation', subtype: 'scheduled' })).toBe('En un horario · en «Clientes»');
    });
});
