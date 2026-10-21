import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import { collectAutomationSlugs, remapAutomationSlugs } from './templates';
import { describeWait, flowNodeAt, parseFlowPath, waitResumeAt } from './automation-flow';

const NOW = new Date('2026-10-21T15:00:00.000Z'); // 10:00 en Bogotá

describe('waitResumeAt', () => {
    it('duración: ahora + N unidades', () => {
        const r = waitResumeAt({ mode: 'duration', amount: 3, unit: 'hours' }, { now: NOW });
        expect(r).toEqual({ ok: true, at: new Date('2026-10-21T18:00:00.000Z') });
    });

    it('hasta una fecha SIN hora: 1 día antes a las 9:00 en la zona de la empresa', () => {
        const r = waitResumeAt(
            { mode: 'until_field', date_field: 'vence', offset_amount: 1, offset_unit: 'days', offset_direction: 'before', at_time: '09:00' },
            { now: NOW, timeZone: 'America/Bogota', field: { label: 'Vence', value: '2026-10-30' } },
        );
        // 29/10 a las 9:00 de Bogotá = 14:00 UTC.
        expect(r).toEqual({ ok: true, at: new Date('2026-10-29T14:00:00.000Z') });
    });

    it('hasta una fecha-hora: el instante con su desplazamiento en horas', () => {
        const r = waitResumeAt(
            { mode: 'until_field', date_field: 'cita', offset_amount: 2, offset_unit: 'hours', offset_direction: 'before' },
            { now: NOW, timeZone: 'America/Bogota', field: { value: '2026-10-25T20:00:00.000Z' } },
        );
        expect(r).toEqual({ ok: true, at: new Date('2026-10-25T18:00:00.000Z') });
    });

    it('campo vacío, fecha inválida, más de un año y config incompleta', () => {
        const cfg = { mode: 'until_field', date_field: 'vence' };
        expect(waitResumeAt(cfg, { now: NOW, field: { label: 'Vence', value: '' } })).toMatchObject({ ok: false, reason: 'empty' });
        expect(waitResumeAt(cfg, { now: NOW, field: { value: 'mañana' } })).toMatchObject({ ok: false, reason: 'invalid' });
        expect(waitResumeAt(cfg, { now: NOW, field: { value: '2029-01-01' } })).toMatchObject({ ok: false, reason: 'too_far' });
        expect(waitResumeAt({ mode: 'duration', amount: 0 }, { now: NOW })).toMatchObject({ ok: false, reason: 'config' });
    });

    it('describe la espera en lenguaje claro', () => {
        expect(describeWait({ mode: 'duration', amount: 1, unit: 'days' })).toBe('Espera 1 día');
        expect(
            describeWait({ mode: 'until_field', date_field: 'vence', offset_amount: 1, offset_unit: 'days', at_time: '09:00' }, 'Vencimiento'),
        ).toBe('Espera hasta 1 día antes de «Vencimiento» a las 09:00');
    });
});

describe('rutas de pasos', () => {
    const actions = [
        { type: 'send_email', config: {} },
        {
            type: 'if_else',
            config: { then_actions: [{ type: 'wait', config: {} }, { type: 'send_email', config: {} }], else_actions: [] },
        },
        { type: 'for_each_linked', config: { actions: [{ type: 'update_field', config: {} }] } },
    ];
    it('encuentra el paso en ramas y bucles', () => {
        expect(flowNodeAt(actions, [1, 'then', 0])?.type).toBe('wait');
        expect(flowNodeAt(actions, [2, 'each', 0])?.type).toBe('update_field');
        expect(flowNodeAt(actions, [1, 'else', 0])).toBeUndefined();
        expect(parseFlowPath('1.then.1')).toEqual([1, 'then', 1]);
        expect(parseFlowPath('1.otra.1')).toBeNull();
    });
});

describe('validación de las acciones nuevas', () => {
    it('una espera dentro de un bucle, un bucle anidado y nombres de respuesta', () => {
        const issues = automationConfigIssues({
            trigger_type: 'record_created',
            actions: [
                { type: 'call_webhook', config: { url: 'https://x.test', response_name: 'pedido' } },
                { type: 'call_webhook', config: { url: 'https://y.test', response_name: 'pedido' } },
                { type: 'call_webhook', config: { url: 'https://z.test', response_name: 'Mal Nombre' } },
                {
                    type: 'for_each_linked',
                    config: {
                        relation_field_id: 5,
                        actions: [
                            { type: 'wait', config: { mode: 'duration', amount: 1, unit: 'days' } },
                            { type: 'for_each_linked', config: { relation_field_id: 6, actions: [] } },
                        ],
                    },
                },
                { type: 'wait', config: { mode: 'until_field' } },
                { type: 'update_field', config: { target: 'item', values: { x: 1 } } },
            ],
        });
        const msgs = issues.map((i) => `${i.path}: ${i.message}`).join('\n');
        expect(msgs).toMatch(/actions\.1\.config\.response_name: Ya hay otro paso/);
        expect(msgs).toMatch(/actions\.2\.config\.response_name: El nombre/);
        expect(msgs).toMatch(/actions\.3\.config\.actions\.0\.type: No se puede esperar dentro/);
        expect(msgs).toMatch(/actions\.3\.config\.actions\.1\.type: No se puede repetir dentro/);
        expect(msgs).toMatch(/actions\.4\.config: Elige el campo de fecha/);
        expect(msgs).toMatch(/actions\.5\.config\.target: «El registro vinculado»/);
    });

    it('plantillas: la fecha de la espera es un rol; lo del vinculado no', () => {
        const auto = {
            trigger_config: {},
            actions: [
                { type: 'wait', config: { mode: 'until_field', date_field: 'vence' } },
                {
                    type: 'for_each_linked',
                    config: {
                        relation_field_id: 3,
                        actions: [
                            { type: 'update_field', config: { target: 'item', values: { estado: '{{nombre}}' } }, condition: [{ field: 'item.total', op: 'gt', value: 0 }] },
                        ],
                    },
                },
            ],
        };
        expect(collectAutomationSlugs(auto).sort()).toEqual(['nombre', 'vence']);
        const out = remapAutomationSlugs(auto, { vence: 'fecha_limite', nombre: 'cliente', estado: 'NO' });
        const json = JSON.stringify(out.actions);
        expect(json).toContain('"date_field":"fecha_limite"');
        expect(json).toContain('"estado":"{{cliente}}"');
        expect(json).toContain('"field":"item.total"');
    });
});
