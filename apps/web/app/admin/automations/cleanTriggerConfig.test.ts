import { describe, expect, it } from 'vitest';

import { cleanTriggerConfig } from './config-editors';

describe('cleanTriggerConfig — webhook entrante (v0.1.399)', () => {
    it('conserva el modo, la búsqueda y la clave del registro al guardar', () => {
        const out = cleanTriggerConfig({
            webhook_token: 'tok',
            record_mode: 'upsert',
            match: { by: 'field', field: 'telefono' },
            match_key: 'cliente.telefono',
            apply_payload_fields: true,
            basura: 1,
        });
        expect(out).toEqual({
            webhook_token: 'tok',
            record_mode: 'upsert',
            match: { by: 'field', field: 'telefono' },
            match_key: 'cliente.telefono',
            apply_payload_fields: true,
        });
    });

    it('«Crear uno nuevo» guarda sólo el modo; «Nada» no deja claves', () => {
        expect(cleanTriggerConfig({ record_mode: 'create', match: { by: 'record_id' }, match_key: 'x' })).toEqual({ record_mode: 'create' });
        expect(cleanTriggerConfig({ webhook_token: 't', record_mode: 'none', match_key: 'x' })).toEqual({ webhook_token: 't' });
    });
});

describe('cleanTriggerConfig — WhatsApp (v0.1.402)', () => {
    it('conserva el número del disparador (antes se perdía al guardar)', () => {
        expect(cleanTriggerConfig({ connection_id: 7 })).toEqual({ connection_id: 7 });
        expect(cleanTriggerConfig({ connection_id: 0 })).toEqual({});
    });

    it('conserva el evento de Whats, sus sub-opciones, el teléfono y qué hacer si no está', () => {
        const out = cleanTriggerConfig({
            whats_event: 'message_status',
            statuses: ['read', 'failed'],
            conversation_events: [],
            phone_field_id: 12,
            if_missing: 'skip',
            connection_id: 3,
            otra: true,
        });
        expect(out).toEqual({ whats_event: 'message_status', statuses: ['read', 'failed'], phone_field_id: 12, if_missing: 'skip', connection_id: 3 });
    });
});

describe('cleanTriggerConfig — comentarios (v0.1.444)', () => {
    it('conserva quién, qué tipo, hilos y palabras; «cualquiera» no deja claves', () => {
        expect(
            cleanTriggerConfig({ comment_from: 'client', comment_visibility: 'any', comment_replies: 'top', comment_contains: '  factura, urgente ' }),
        ).toEqual({ comment_from: 'client', comment_replies: 'top', comment_contains: 'factura, urgente' });
        expect(cleanTriggerConfig({ comment_from: 'any', comment_contains: '   ' })).toEqual({});
    });
});
