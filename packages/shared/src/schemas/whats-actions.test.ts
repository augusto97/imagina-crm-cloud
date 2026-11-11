import { describe, expect, it } from 'vitest';
import { INTEGRATIONS } from './integrations';
import {
    WHATS_ACTION_ABILITIES,
    WHATS_ACTION_KEYS,
    WHATS_ACTION_MERGE_TAGS,
    WHATS_ACTION_OUTPUTS,
    WHATS_PARAM_LOOKUP,
    WA_WEB_ABILITY_LABEL,
    WA_WEB_EXTRA_ABILITIES,
    missingWhatsAbilities,
    readWhatsKeyValues,
    whatsFlag,
    whatsNameKey,
    whatsNames,
    whatsPhoneList,
    writeWhatsKeyValues,
} from './whats-actions';

const whats = INTEGRATIONS.find((i) => i.key === 'whatsapp_web')!;

describe('v0.1.401 — acciones de Whats', () => {
    it('el catálogo y las reglas hablan de las mismas acciones', () => {
        const keys = whats.actions.map((a) => a.key).sort();
        expect(keys).toEqual([...WHATS_ACTION_KEYS].sort());
        for (const key of WHATS_ACTION_KEYS) {
            expect(WHATS_ACTION_ABILITIES[key].length).toBeGreaterThan(0);
            expect(WHATS_ACTION_OUTPUTS[key]).toBeDefined();
        }
    });

    it('cada permiso tiene su explicación y las salidas tienen su variable', () => {
        const all = new Set(Object.values(WHATS_ACTION_ABILITIES).flat());
        for (const a of all) expect(WA_WEB_ABILITY_LABEL[a], a).toBeTruthy();
        for (const a of WA_WEB_EXTRA_ABILITIES) expect(WA_WEB_ABILITY_LABEL[a], a).toBeTruthy();
        const tags = new Set(WHATS_ACTION_MERGE_TAGS.map((t) => t.tag));
        for (const out of new Set(Object.values(WHATS_ACTION_OUTPUTS).flat())) expect(tags.has(`whats.${out}`), out).toBe(true);
    });

    it('el teléfono se llama igual en todas (cambiar de acción lo conserva) y las listas existen', () => {
        for (const a of whats.actions) {
            if (a.key === 'resume_flow') continue;
            expect(a.params.some((p) => p.key === 'recipient' && p.required), a.key).toBe(true);
        }
        const used = new Set(whats.actions.flatMap((a) => a.params.map((p) => p.key)));
        for (const key of Object.keys(WHATS_PARAM_LOOKUP)) expect(used.has(key), key).toBe(true);
        // Ningún texto que ve la empresa nombra el producto.
        expect(JSON.stringify(whats.actions)).not.toMatch(/Imagina Base/);
    });

    it('permisos que faltan', () => {
        expect(missingWhatsAbilities('send_text', ['wa.send'])).toEqual([]);
        expect(missingWhatsAbilities('add_tags', ['wa.send', 'contacts.view'])).toEqual(['contacts.manage', 'tags.view', 'tags.manage']);
        expect(missingWhatsAbilities('add_tags', ['*'])).toEqual([]);
        expect(missingWhatsAbilities('no_existe', [])).toEqual([]);
    });

    it('lee etiquetas, teléfonos y filas clave → valor', () => {
        expect(whatsNames('VIP, Cliente nuevo; vip\n  Bogotá ')).toEqual(['VIP', 'Cliente nuevo', 'Bogotá']);
        expect(whatsNames(' , ;')).toEqual([]);
        expect(whatsNameKey('  Clíente   Nuevo ')).toBe('cliente nuevo');
        expect(whatsPhoneList('+573001112233\n+573004445566, +57300')).toEqual(['+573001112233', '+573004445566', '+57300']);
        expect(readWhatsKeyValues('{"pedido":"{{numero}}","total":5}')).toEqual({ pedido: '{{numero}}', total: '5' });
        expect(readWhatsKeyValues('pedido={{numero}}\nciudad = Bogotá\nsin_igual')).toEqual({ pedido: '{{numero}}', ciudad: 'Bogotá' });
        expect(readWhatsKeyValues('{roto')).toEqual({});
        expect(readWhatsKeyValues({ a: 'b' })).toEqual({ a: 'b' });
        expect(writeWhatsKeyValues([{ key: ' pedido ', value: '1' }, { key: '', value: 'x' }])).toBe('{"pedido":"1"}');
        expect(writeWhatsKeyValues([])).toBe('');
        expect(whatsFlag('', true)).toBe(true);
        expect(whatsFlag('false', true)).toBe(false);
        expect(whatsFlag('Sí', false)).toBe(true);
    });
});
