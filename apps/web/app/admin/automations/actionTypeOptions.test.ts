import { describe, expect, it } from 'vitest';

import type { ActionMeta } from '@/types/automation';

import { actionOptionValue, actionTitle, actionTypeOptions, carryOverSpec, specForOption } from './actionTypeOptions';

const conn = (connection_id: number, connection_name: string, action_key: string, label: string): ActionMeta => ({
    slug: 'connector_action',
    label,
    config_schema: {},
    connector: { connection_id, connection_name, action_key, description: '' },
});

const CATALOG: ActionMeta[] = [
    { slug: 'send_email', label: 'Enviar email', config_schema: {} },
    { slug: 'update_field', label: 'Actualizar un campo', config_schema: {} },
    { slug: 'if_else', label: 'Si / sino', config_schema: {} },
    conn(2, 'WhatsApp', 'send_text', 'Enviar mensaje de WhatsApp'),
    conn(3, 'Tienda', 'update_order_status', 'Cambiar el estado de un pedido'),
];

describe('selector de tipo de acción', () => {
    it('cada acción de conector es su propia opción (antes todas valían "connector_action")', () => {
        const values = actionTypeOptions(CATALOG, null).map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
        expect(values).toContain('connector:2:send_text');
        expect(values).toContain('connector:3:update_order_status');
    });

    it('una acción de la tienda se muestra como ella misma, no como la primera del catálogo', () => {
        const spec = { type: 'connector_action', config: { connection_id: 3, action_key: 'update_order_status', values: {} } };
        expect(actionOptionValue(spec)).toBe('connector:3:update_order_status');
        expect(actionTitle(spec, CATALOG, 'x')).toBe('Cambiar el estado de un pedido');
        expect(actionOptionValue({ type: 'update_field', config: {} })).toBe('update_field');
        expect(actionTitle({ type: 'update_field', config: {} }, CATALOG, 'x')).toBe('Actualizar un campo');
    });

    it('elegir una acción de conector conserva la conexión y la clave', () => {
        expect(specForOption('connector:2:send_text')).toEqual({
            type: 'connector_action',
            config: { connection_id: 2, action_key: 'send_text', values: {} },
        });
        expect(specForOption('update_field')).toEqual({ type: 'update_field', config: {} });
    });

    it('lo que el catálogo no conoce se muestra tal cual (no cae en la primera opción)', () => {
        const unknown = actionTypeOptions(CATALOG, { type: 'set_field', config: {} });
        expect(unknown[0]).toMatchObject({ value: 'set_field', group: 'unknown' });
        const gone = actionTypeOptions(CATALOG, { type: 'connector_action', config: { connection_id: 9, action_key: 'x' } });
        expect(gone[0]).toMatchObject({ value: 'connector:9:x', group: 'unknown' });
        expect(actionTypeOptions(CATALOG, null, { exclude: ['if_else'] }).some((o) => o.value === 'if_else')).toBe(false);
    });
});

describe('cambiar de acción conserva lo escrito (v0.1.400)', () => {
    const app = (connection_id: number, integration_key: string, action_key: string): ActionMeta => ({
        slug: 'connector_action',
        label: action_key,
        config_schema: {},
        connector: { connection_id, connection_name: `c${connection_id}`, action_key, description: '', integration_key },
    });
    const catalog: ActionMeta[] = [app(2, 'whatsapp', 'send_text'), app(9, 'whatsapp_web', 'send_text'), app(9, 'whatsapp_web', 'send_media'), app(5, 'gmail', 'send_email'), app(6, 'outlook', 'send_email')];
    const condition = { logic: 'and', rules: [{ slug: 'estado', op: 'eq', value: 'x' }] } as never;

    it('de la cuenta de WAS a la de Whats: número, mensaje y condición quedan', () => {
        const prev = { type: 'connector_action', config: { connection_id: 2, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola' } }, condition };
        const next = carryOverSpec(prev, specForOption('connector:9:send_text'), catalog);
        expect(next).toEqual({ type: 'connector_action', config: { connection_id: 9, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola' } }, condition });
    });

    it('a otra acción sólo pasa lo que ésa entiende; de Gmail a Outlook pasan para/asunto/mensaje', () => {
        const prev = { type: 'connector_action', config: { connection_id: 9, action_key: 'send_text', values: { recipient: '+57300', message: 'Hola' } } };
        expect(carryOverSpec(prev, specForOption('connector:9:send_media'), catalog).config.values).toEqual({ recipient: '+57300' });
        const mail = { type: 'connector_action', config: { connection_id: 5, action_key: 'send_email', values: { to: 'a@b.co', subject: 'S', body: 'B' } } };
        expect(carryOverSpec(mail, specForOption('connector:6:send_email'), catalog).config.values).toEqual({ to: 'a@b.co', subject: 'S', body: 'B' });
    });

    it('una llamada directa a la API de WAS pasa a «Enviar mensaje de WhatsApp» con su número y su mensaje', () => {
        const prev = {
            type: 'call_webhook',
            config: { url: 'https://was.imagina.cloud/api/send/whatsapp', body_params: [{ key: 'account', value: 'abc' }, { key: 'recipient', value: '{{celular}}' }, { key: 'message', value: 'Hola {{cliente}}' }] },
            condition,
        };
        const next = carryOverSpec(prev, specForOption('connector:9:send_text'), catalog);
        expect(next.config.values).toEqual({ recipient: '{{celular}}', message: 'Hola {{cliente}}' });
        expect(next.condition).toEqual(condition);
    });

    it('a una acción propia de la app arranca vacía pero conserva la condición', () => {
        const prev = { type: 'connector_action', config: { connection_id: 2, action_key: 'send_text', values: { recipient: 'x', message: 'y' } }, condition };
        expect(carryOverSpec(prev, specForOption('update_field'), catalog)).toEqual({ type: 'update_field', config: {}, condition });
    });
});
