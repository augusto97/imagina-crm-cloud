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
    WA_WEB_KEY_ABILITIES,
    WA_WEB_PERMISSION_GROUPS,
    missingWaWebPermissionGroups,
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

describe('v0.1.403 — los permisos de la clave, por grupo', () => {
    const grouped = WA_WEB_PERMISSION_GROUPS.flatMap((g) => g.abilities);

    it('cada permiso que usa una acción o la conexión está en un grupo, con su nombre en palabras', () => {
        const used = new Set<string>([...WA_WEB_KEY_ABILITIES, ...Object.values(WHATS_ACTION_ABILITIES).flat()]);
        for (const a of used) {
            expect(grouped).toContain(a);
            expect(WA_WEB_ABILITY_LABEL[a]).toBeTruthy();
        }
        // Ninguno repetido entre grupos.
        expect(new Set(grouped).size).toBe(grouped.length);
    });

    it('los obligatorios son los de conectar y los opcionales, los de las acciones', () => {
        const required = WA_WEB_PERMISSION_GROUPS.filter((g) => g.required).flatMap((g) => g.abilities);
        expect([...required].sort()).toEqual([...WA_WEB_KEY_ABILITIES].sort());
        const optional = WA_WEB_PERMISSION_GROUPS.filter((g) => !g.required).flatMap((g) => g.abilities);
        expect([...optional].sort()).toEqual([...WA_WEB_EXTRA_ABILITIES].sort());
    });

    it('la ventana de conexión los muestra y los pasos los mencionan', () => {
        const auth = whats.auth;
        if (auth.kind !== 'key') throw new Error('Whats conecta con clave');
        expect(auth.permissions?.map((g) => g.key)).toEqual(WA_WEB_PERMISSION_GROUPS.map((g) => g.key));
        expect(auth.permissions?.find((g) => g.key === 'flows')?.permissions.map((p) => p.key)).toEqual(['flows.view', 'flows.trigger', 'flows.run']);
        expect(auth.how_to.join(' ')).toMatch(/contactos, etiquetas, grupos, flujos, goteos o la bandeja/);
    });

    it('dice qué grupos le faltan a una clave', () => {
        expect(missingWaWebPermissionGroups([...WA_WEB_KEY_ABILITIES]).map((g) => g.key)).toEqual(['contacts', 'tags', 'groups', 'flows', 'inbox', 'unsubscribe']);
        expect(missingWaWebPermissionGroups([...WA_WEB_KEY_ABILITIES, ...WA_WEB_EXTRA_ABILITIES])).toEqual([]);
        expect(missingWaWebPermissionGroups(['*'])).toEqual([]);
        // Un grupo a medias cuenta como faltante.
        expect(missingWaWebPermissionGroups([...WA_WEB_KEY_ABILITIES, 'flows.view', 'contacts.view', 'contacts.manage']).map((g) => g.key)).toContain('flows');
    });
});
