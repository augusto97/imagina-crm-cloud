import { describe, expect, it } from 'vitest';
import {
    parseRecordIdValue,
    readPayloadPath,
    readWebhookRecordConfig,
    webhookExamplePayload,
    webhookMatchFieldError,
    writeWebhookRecordConfig,
} from './webhook-record';

describe('webhook entrante con registro (v0.1.399)', () => {
    it('lee la config con tolerancia y vuelve a «none» ante lo que no entiende', () => {
        expect(readWebhookRecordConfig({ webhook_token: 'x' })).toEqual({
            mode: 'none',
            match: { by: 'record_id' },
            matchKey: 'record_id',
            applyPayloadFields: false,
        });
        expect(readWebhookRecordConfig({ record_mode: 'borrar' }).mode).toBe('none');
        const rc = readWebhookRecordConfig({ record_mode: 'upsert', match: { by: 'field', field: 'telefono' }, apply_payload_fields: true });
        expect(rc).toEqual({ mode: 'upsert', match: { by: 'field', field: 'telefono' }, matchKey: 'telefono', applyPayloadFields: true });
        // Una ruta inválida cae a la clave por defecto.
        expect(readWebhookRecordConfig({ record_mode: 'update', match_key: 'a b' }).matchKey).toBe('record_id');
        expect(readWebhookRecordConfig({ record_mode: 'update', match_key: 'data.id' }).matchKey).toBe('data.id');
    });

    it('guarda sólo lo que el modo usa', () => {
        expect(writeWebhookRecordConfig(readWebhookRecordConfig({}))).toEqual({});
        expect(writeWebhookRecordConfig(readWebhookRecordConfig({ record_mode: 'create', match_key: 'x' }))).toEqual({ record_mode: 'create' });
        expect(writeWebhookRecordConfig(readWebhookRecordConfig({ record_mode: 'update', match_key: 'data.id' }))).toEqual({
            record_mode: 'update',
            match: { by: 'record_id' },
            match_key: 'data.id',
        });
    });

    it('lee rutas con puntos e índices de listas', () => {
        const p = { record_id: 5134, data: { id: '77', items: [{ sku: 'A' }] } };
        expect(readPayloadPath(p, 'record_id')).toBe(5134);
        expect(readPayloadPath(p, 'data.id')).toBe('77');
        expect(readPayloadPath(p, 'data.items.0.sku')).toBe('A');
        expect(readPayloadPath(p, 'data.items.x')).toBeUndefined();
        expect(readPayloadPath(p, 'nada.aqui')).toBeUndefined();
    });

    it('acepta el id como número o texto, nada más', () => {
        expect(parseRecordIdValue(5134)).toBe(5134);
        expect(parseRecordIdValue(' 5134 ')).toBe(5134);
        expect(parseRecordIdValue('abc')).toBeNull();
        expect(parseRecordIdValue(0)).toBeNull();
        expect(parseRecordIdValue(-3)).toBeNull();
        expect(parseRecordIdValue(1.5)).toBeNull();
        expect(parseRecordIdValue(null)).toBeNull();
    });

    it('sólo deja buscar por un campo que no se repite', () => {
        expect(webhookMatchFieldError(undefined)).toMatch(/ya no existe/);
        expect(webhookMatchFieldError({ slug: 'estado', type: 'select', label: 'Estado', is_unique: true })).toMatch(/sólo por un campo/);
        expect(webhookMatchFieldError({ slug: 'telefono', type: 'phone', label: 'Teléfono' })).toMatch(/Sin repetidos/);
        expect(webhookMatchFieldError({ slug: 'telefono', type: 'phone', label: 'Teléfono', is_unique: true })).toBeNull();
        // Un ID automático es único por construcción.
        expect(webhookMatchFieldError({ slug: 'ticket', type: 'autonumber', label: 'Ticket' })).toBeNull();
    });

    it('arma el JSON de ejemplo con la clave en su ruta y campos reales', () => {
        const fields = [
            { slug: 'nombre', type: 'text', is_primary: true },
            { slug: 'telefono', type: 'phone' },
            { slug: 'estado', type: 'select', config: { options: [{ value: 'nueva' }] } },
            { slug: 'total', type: 'rollup' },
        ];
        const upd = readWebhookRecordConfig({ record_mode: 'update', match_key: 'data.id' });
        expect(webhookExamplePayload(upd, fields, { extra: { respuesta: '2' } })).toEqual({ data: { id: 5134 }, respuesta: '2' });
        const create = readWebhookRecordConfig({ record_mode: 'create' });
        expect(webhookExamplePayload(create, fields)).toEqual({ nombre: 'Texto', telefono: '+57 300 123 4567', estado: 'nueva' });
        const ups = readWebhookRecordConfig({ record_mode: 'upsert', match: { by: 'field', field: 'telefono' } });
        const ex = webhookExamplePayload(ups, fields);
        expect(ex.telefono).toBe('+57 300 123 4567');
        expect(ex.nombre).toBe('Texto');
        expect('total' in ex).toBe(false);
    });
});
