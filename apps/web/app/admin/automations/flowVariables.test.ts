import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { describeVersionChanges, summarizeAction, summarizeTrigger } from './automationMeta';
import { parseSample, sampleTagItems, variablesAt } from './flowVariables';

const field = (id: number, slug: string, label: string, type = 'text'): FieldEntity =>
    ({ id, slug, label, type, list_id: 1, config: {}, is_required: false, is_unique: false, is_primary: false, position: id }) as unknown as FieldEntity;

const flow = (): ActionSpec[] => [
    { type: 'call_webhook', config: { url: 'https://a.example', response_name: 'cotizacion' } },
    { type: 'wait', config: { mode: 'duration', amount: 1, unit: 'minutes' } },
    {
        type: 'for_each_linked',
        config: { relation_field_id: 9, actions: [{ type: 'send_email', config: { to: '{{item.email}}' } }] },
    },
    { type: 'send_email', config: { to: 'a@x.com' } },
];

describe('variables del flujo (v0.1.288)', () => {
    it('el primer paso no tiene respuestas; los de abajo sí, con su nombre', () => {
        expect(variablesAt(flow(), [0], {}, null)).toEqual([]);
        const after = variablesAt(flow(), [3], {}, null);
        expect(after.map((s) => s.title)).toEqual(['Respuesta del webhook anterior', 'Respuesta «cotizacion»']);
        expect(after[0]!.items.map((i) => i.tag)).toEqual(['webhook.status', 'webhook.body']);
        expect(after[1]!.items.map((i) => i.tag)).toEqual(['respuestas.cotizacion.status', 'respuestas.cotizacion.body']);
    });

    it('con una respuesta real sugiere sus rutas (y el primer elemento de las listas)', () => {
        const samples = { '0': JSON.stringify({ data: { id: 7, items: [{ precio: 1200 }] }, 'con espacio': 1 }) };
        const vars = variablesAt(flow(), [3], samples, null);
        expect(vars[0]!.items.map((i) => i.tag)).toEqual([
            'webhook.status',
            'webhook.body',
            'webhook.body.data.id',
            'webhook.body.data.items.0.precio',
        ]);
        expect(vars[1]!.items.map((i) => i.tag)).toContain('respuestas.cotizacion.body.data.items.0.precio');
    });

    it('dentro de un bucle ofrece los campos del vinculado', () => {
        const item = { listId: 2, listName: 'Facturas', relationLabel: 'Cliente', fields: [field(1, 'monto', 'Monto', 'currency'), field(2, 'estado', 'Estado', 'select'), field(3, 'cliente', 'Cliente', 'relation')] };
        const vars = variablesAt(flow(), [2, 'each', 0], {}, item);
        expect(vars[0]!.title).toBe('Registro vinculado («Facturas»)');
        expect(vars[0]!.items.map((i) => i.tag)).toEqual(['item.record.id', 'item.monto', 'item.estado', 'item.estado|label']);
    });

    it('parseSample y sampleTagItems toleran texto y respuestas vacías', () => {
        expect(parseSample('OK')).toBeNull();
        expect(parseSample('{malo')).toBeNull();
        expect(sampleTagItems('webhook.body', null)).toEqual([]);
        expect(sampleTagItems('webhook.body', { a: 'x'.repeat(80) })[0]!.hint).toHaveLength(41);
    });
});

describe('resúmenes y versiones (v0.1.288)', () => {
    const fields = [field(1, 'vence', 'Vencimiento', 'date'), field(9, 'facturas', 'Facturas', 'relation')];

    it('resume la espera, el bucle y el horario por registro en lenguaje claro', () => {
        expect(summarizeAction({ type: 'wait', config: { mode: 'duration', amount: 3, unit: 'days' } }, fields, [])).toBe('Espera 3 días');
        expect(
            summarizeAction(
                { type: 'wait', config: { mode: 'until_field', date_field: 'vence', offset_amount: 1, offset_unit: 'days', offset_direction: 'before', at_time: '09:00' } },
                fields,
                [],
            ),
        ).toBe('Espera hasta 1 día antes de «Vencimiento» a las 09:00');
        expect(
            summarizeAction({ type: 'for_each_linked', config: { relation_field_id: 9, actions: [{ type: 'send_email', config: {} }] } }, fields, [], undefined, [
                { relation_field_id: 9, relation_label: 'Facturas', other_list_name: 'Facturas' },
            ]),
        ).toBe('Repite por cada registro vinculado de «Facturas» · 1 paso');
        expect(summarizeTrigger('scheduled', { frequency: 'daily', hour: 8, minute: 0, for_each_record: true, records_filter: {} }, fields)).toContain('por cada registro que cumpla el filtro');
    });

    it('describe qué cambió entre dos versiones', () => {
        const base = { name: 'A', description: null, trigger_type: 'record_created', trigger_config: {}, actions: flow(), is_active: true };
        expect(describeVersionChanges(null, base, fields, [])).toEqual(['Primera versión guardada.']);
        expect(describeVersionChanges(base, { ...base }, fields, [])).toEqual(['Sin cambios respecto de la versión anterior.']);
        const next = {
            ...base,
            name: 'B',
            is_active: false,
            actions: [...flow().slice(0, 3), { type: 'send_email', config: { to: 'b@x.com' } }, { type: 'update_field', config: { values: {} } }],
        };
        const lines = describeVersionChanges(base, next, fields, []);
        expect(lines).toContain('Cambió el nombre: «A» → «B».');
        expect(lines).toContain('La pausó.');
        expect(lines).toContain('Cambió un paso: Envía un correo a b@x.com.');
        expect(lines).toContain('Agregó un paso: Actualiza campos del registro.');
        const reordered = { ...base, actions: [flow()[1]!, flow()[0]!, flow()[2]!, flow()[3]!] };
        expect(describeVersionChanges(base, reordered, fields, [])).toEqual(['Reordenó los pasos.']);
    });
});
