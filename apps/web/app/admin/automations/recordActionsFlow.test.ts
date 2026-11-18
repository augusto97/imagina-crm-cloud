import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';

import { summarizeAction, summarizeTrigger } from './automationMeta';
import { variablesAt } from './flowVariables';

const flow = (): ActionSpec[] => [
    { type: 'find_records', config: { list_id: 4, conditions: [{ field: 'correo', op: 'eq', value: '{{correo}}' }], response_name: 'cliente' } },
    { type: 'upsert_record', config: { match_by: 'field', match_field: 'nit', match_value: '{{nit}}', values: { nombre: '{{nombre}}' } } },
    { type: 'send_email', config: { to: 'a@x.com' } },
];

describe('v0.1.444 — buscar, crear o actualizar y comentarios en el editor', () => {
    it('los pasos siguientes ven lo que dejó cada búsqueda y cada registro, con su nombre', () => {
        expect(variablesAt(flow(), [0], {}, null)).toEqual([]);
        const after = variablesAt(flow(), [2], {}, null);
        expect(after.map((s) => s.title)).toEqual(['Registro «registro»', 'Búsqueda «cliente»']);
        expect(after[1]!.items.map((i) => i.tag)).toEqual([
            'respuestas.cliente.cantidad',
            'respuestas.cliente.ids',
            'respuestas.cliente.primero.id',
            'respuestas.cliente.primero.titulo',
        ]);
    });

    it('con un resultado de «Probar», también los campos del primero encontrado', () => {
        const samples = { '0': { cantidad: 1, primero: { id: 7, titulo: 'Acme', correo: 'a@acme.co', ciudad: 'Bogotá' } } };
        const tags = variablesAt(flow(), [1], samples, null)[0]!.items.map((i) => i.tag);
        expect(tags).toContain('respuestas.cliente.primero.correo');
        expect(tags).toContain('respuestas.cliente.primero.ciudad');
        expect(tags.filter((t) => t === 'respuestas.cliente.primero.id')).toHaveLength(1);
    });

    it('resume las acciones y el disparador en palabras', () => {
        expect(summarizeAction(flow()[0]!, [], [{ id: 4, name: 'Clientes' } as never])).toBe('Busca en «Clientes» · 1 condición · {{respuestas.cliente}}');
        expect(summarizeAction(flow()[1]!, [], [])).toBe('Crea o actualiza un registro de «esta lista» buscado por «nit»');
        expect(summarizeTrigger('comment_added', { comment_from: 'client', comment_contains: 'factura' }, [])).toBe(
            'Cuando el cliente agrega un comentario con «factura»',
        );
    });
});
