import { describe, expect, it } from 'vitest';
import type { SharedWithMeDto } from '@imagina-base/shared';

import { guestAccessIn, guestEditableRowsIn, maxGuestLevel } from './useGuests';

const shared: SharedWithMeDto = {
    tenant_name: 'Acme',
    lists: [
        { id: 1, slug: 'proveedores', name: 'Proveedores', icon: null, color: null, level: 'edit' },
        { id: 2, slug: 'pedidos', name: 'Pedidos', icon: null, color: null, level: 'view' },
    ],
    records: [
        { id: 10, list_id: 2, list_slug: 'pedidos', list_name: 'Pedidos', title: 'Pedido 10', level: 'edit' },
        { id: 11, list_id: 3, list_slug: 'tickets', list_name: 'Tickets', title: 'Ticket 11', level: 'comment' },
        { id: 12, list_id: 3, list_slug: 'tickets', list_name: 'Tickets', title: 'Ticket 12', level: 'view' },
    ],
};

describe('C3 — lo que puede hacer un invitado en la interfaz', () => {
    it('el mayor de dos niveles', () => {
        expect(maxGuestLevel('view', 'edit')).toBe('edit');
        expect(maxGuestLevel('comment', 'view')).toBe('comment');
        expect(maxGuestLevel(null, 'view')).toBe('view');
        expect(maxGuestLevel(undefined, null)).toBeNull();
    });

    it('nivel de la lista y del registro (el registro suma al de la lista)', () => {
        // Sin registro: el nivel efectivo es el de la lista.
        expect(guestAccessIn(shared, 1)).toEqual({ list: 'edit', record: 'edit' });
        expect(guestAccessIn(shared, 1, 99)).toEqual({ list: 'edit', record: 'edit' });
        expect(guestAccessIn(shared, 2, 10)).toEqual({ list: 'view', record: 'edit' });
        expect(guestAccessIn(shared, 3, 11)).toEqual({ list: null, record: 'comment' });
        // Un registro de OTRA lista con el mismo id no cuenta.
        expect(guestAccessIn(shared, 3, 10)).toEqual({ list: null, record: null });
        expect(guestAccessIn(undefined, 1)).toEqual({ list: null, record: null });
    });

    it('qué filas edita en la tabla', () => {
        // Lista entera en «editar»: sin restricción por fila.
        expect(guestEditableRowsIn(shared, 1)).toBeNull();
        // Lista en «ver» + un registro suelto en «editar»: sólo esa fila.
        expect([...(guestEditableRowsIn(shared, 2) ?? [])]).toEqual([10]);
        // Registros sueltos que no son «editar»: ninguna.
        expect(guestEditableRowsIn(shared, 3)?.size).toBe(0);
        // Mientras carga: ninguna (fail-closed).
        expect(guestEditableRowsIn(undefined, 1)?.size).toBe(0);
    });
});
