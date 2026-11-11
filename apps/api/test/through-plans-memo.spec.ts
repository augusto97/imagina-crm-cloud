import type { Field } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../src/db/client';
import { ThroughEngine, type ThroughFieldsSource } from '../src/records/through-fields';

let nextId = 1;
const field = (listId: number, type: Field['type'], config: Record<string, unknown> = {}): Field =>
    ({
        id: nextId++,
        list_id: listId,
        slug: `c${nextId}`,
        label: `Campo ${nextId}`,
        type,
        config,
        is_required: false,
        is_unique: false,
        is_indexed: false,
        is_primary: false,
        position: nextId,
        created_at: '2026-01-01T00:00:00Z',
        description: null,
    }) as Field;

/**
 * Clientes (lista 1) resume tres listas que le apuntan (facturas, tareas,
 * tickets) y además mira un dato de su propia relación hacia Zonas.
 */
function world() {
    const CLIENTES = 1;
    const others = [2, 3, 4].map((listId) => {
        const rel = field(listId, 'relation', { target_list_id: CLIENTES });
        const monto = field(listId, 'currency');
        return { listId, rel, monto, fields: [rel, monto] };
    });
    const zonaNombre = field(5, 'text');
    const haciaZona = field(CLIENTES, 'relation', { target_list_id: 5 });
    const clientes: Field[] = [
        field(CLIENTES, 'text'),
        haciaZona,
        field(CLIENTES, 'lookup', { relation_field_id: haciaZona.id, target_field_id: zonaNombre.id }),
        ...others.map((o) => field(CLIENTES, 'rollup', { relation_field_id: o.rel.id, target_field_id: o.monto.id, operation: 'sum' })),
    ];
    const byList = new Map<number, Field[]>([[CLIENTES, clientes], [5, [zonaNombre]], ...others.map((o) => [o.listId, o.fields] as [number, Field[]])]);
    const all = [...byList.values()].flat();
    const calls = { one: 0, many: 0, list: 0, lists: 0 };
    const source: ThroughFieldsSource = {
        findAnyByIdWithinTx: async (_tx, _t, id) => {
            calls.one += 1;
            return all.find((f) => f.id === id) ?? null;
        },
        listByListIdWithinTx: async (_tx, _t, listId) => {
            calls.list += 1;
            return byList.get(listId) ?? [];
        },
        findAnyByIdsWithinTx: async (_tx, _t, ids) => {
            calls.many += 1;
            return all.filter((f) => ids.includes(f.id));
        },
        listByListIdsWithinTx: async (_tx, _t, ids) => {
            calls.lists += 1;
            return new Map(ids.map((id) => [id, byList.get(id) ?? []]));
        },
    };
    return { engine: new ThroughEngine(source), clientes, calls, CLIENTES };
}

const fakeTx = (): Tx => ({}) as Tx;

describe('planes de lookup/rollup: una vez por transacción y sin una consulta por relación', () => {
    it('las relaciones de otras listas y sus campos se piden de una vez (antes: una consulta por cada una)', async () => {
        const { engine, clientes, calls, CLIENTES } = world();
        const plans = await engine.plans(fakeTx(), 1, CLIENTES, clientes);
        expect(plans).toHaveLength(4);
        expect(plans.map((p) => p.direction).sort()).toEqual(['forward', 'reverse', 'reverse', 'reverse']);
        // 2 consultas en total (relaciones ajenas + campos de las 4 otras listas); antes 3 + 4 = 7.
        expect(calls).toEqual({ one: 0, many: 1, list: 0, lists: 1 });
    });

    it('el mismo pedido los usa varias veces sin volver a leer; otra transacción (u otros campos) calcula de nuevo', async () => {
        const { engine, clientes, calls, CLIENTES } = world();
        const tx = fakeTx();
        const a = await engine.plans(tx, 1, CLIENTES, clientes);
        const [b, c] = await Promise.all([engine.plans(tx, 1, CLIENTES, clientes), engine.plans(tx, 1, CLIENTES, clientes)]);
        expect(calls.many + calls.lists).toBe(2);
        expect(b).toEqual(a);
        // Cada quien recibe su copia: filtrarla no le cambia el resultado a otro.
        b.length = 0;
        expect(c).toHaveLength(4);
        expect(await engine.plans(tx, 1, CLIENTES, clientes)).toHaveLength(4);
        // Releer los campos (otro arreglo) o abrir otra transacción no reusa nada.
        await engine.plans(tx, 1, CLIENTES, [...clientes]);
        expect(calls.many + calls.lists).toBe(4);
        await engine.plans(fakeTx(), 1, CLIENTES, clientes);
        expect(calls.many + calls.lists).toBe(6);
    });

    it('sin lookup ni rollup no consulta nada', async () => {
        const { engine, calls } = world();
        expect(await engine.plans(fakeTx(), 1, 9, [field(9, 'text')])).toEqual([]);
        expect(calls).toEqual({ one: 0, many: 0, list: 0, lists: 0 });
    });
});
