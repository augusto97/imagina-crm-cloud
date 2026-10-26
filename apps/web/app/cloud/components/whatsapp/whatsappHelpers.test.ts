import { describe, expect, it } from 'vitest';
import type { WhatsappTemplate } from '@imagina-base/shared';

import { labelMergeTags, readVariables, selectedTemplate } from './whatsappHelpers';

const tpl = (name: string, language: string, id: number): WhatsappTemplate => ({
    id,
    meta_id: String(id),
    name,
    language,
    category: 'UTILITY',
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    components: [],
    rejected_reason: null,
    synced_at: '2026-10-20T00:00:00.000Z',
});

describe('D3 — piezas del editor de WhatsApp', () => {
    it('lee las variables como objeto o como JSON en texto', () => {
        expect(readVariables({ 'body.1': '{{nombre}}', 'body.2': 3, raro: {} })).toEqual({ 'body.1': '{{nombre}}', 'body.2': '3' });
        expect(readVariables('{"body.1":"Ana"}')).toEqual({ 'body.1': 'Ana' });
        expect(readVariables('no es json')).toEqual({});
        expect(readVariables(['x'])).toEqual({});
        expect(readVariables(undefined)).toEqual({});
    });

    it('elige la plantilla por nombre y prefiere el idioma guardado', () => {
        const list = [tpl('aviso', 'en', 1), tpl('aviso', 'es', 2), tpl('otra', 'es', 3)];
        expect(selectedTemplate(list, 'aviso', 'es')?.id).toBe(2);
        expect(selectedTemplate(list, 'aviso', 'pt_BR')?.id).toBe(1);
        expect(selectedTemplate(list, 'no_existe', 'es')).toBeNull();
    });

    it('en la vista previa las variables del registro se leen por su campo', () => {
        const fields = [{ slug: 'nombre', label: 'Nombre' }];
        expect(labelMergeTags('Hola {{nombre}}, vence {{ fecha|larga }} · {{pago.link}}', fields)).toBe('Hola [Nombre], vence [fecha] · [pago.link]');
        expect(labelMergeTags('sin variables', fields)).toBe('sin variables');
    });
});
