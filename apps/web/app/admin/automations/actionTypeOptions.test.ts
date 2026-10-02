import { describe, expect, it } from 'vitest';

import type { ActionMeta } from '@/types/automation';

import { actionOptionValue, actionTitle, actionTypeOptions, specForOption } from './actionTypeOptions';

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
