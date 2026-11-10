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
