import { describe, expect, it } from 'vitest';
import {
    emptyMaps,
    mapId,
    remapAutomation,
    remapJson,
    remapListSettings,
    remapRecordData,
    remapRichDoc,
    type IdMaps,
} from '../src/platform/tenant-transfer.remap';

/**
 * v0.1.197 — el re-mapeo de ids es la pieza donde un descuido no falla
 * ruidosamente: deja una referencia apuntando a la fila de OTRA empresa. Por
 * eso es pura y se prueba sola.
 */

function maps(): IdMaps {
    const m = emptyMaps();
    m.list.set(1, 101).set(2, 102);
    m.field.set(10, 110).set(11, 111).set(12, 112);
    m.record.set(20, 120).set(21, 121);
    m.user.set(30, 130).set(31, 131);
    m.attachment.set(40, 140).set(41, 141);
    m.connection.set(50, 150);
    m.template.set(60, 160);
    m.view.set(70, 170);
    return m;
}

describe('mapId', () => {
    it('traduce números y cadenas numéricas, y devuelve null si no está', () => {
        const m = maps();
        expect(mapId(m.list, 1)).toBe(101);
        expect(mapId(m.list, '2')).toBe(102);
        expect(mapId(m.list, 999)).toBeNull();
        expect(mapId(m.list, null)).toBeNull();
        expect(mapId(m.list, 'hola')).toBeNull();
    });
});

describe('remapJson', () => {
    it('traduce las claves por convención, incluso anidadas', () => {
        const out = remapJson(
            {
                group_by_field_id: 10,
                date_field_id: null,
                column_field_ids: [10, 11, 999],
                nested: { target_list_id: 2, inputs: [11, 12] },
            },
            maps(),
        );
        expect(out).toEqual({
            group_by_field_id: 110,
            date_field_id: null,
            // El campo muerto se cae del array en vez de quedar apuntando al
            // id viejo (que en el destino es de otra empresa).
            column_field_ids: [110, 111],
            nested: { target_list_id: 102, inputs: [111, 112] },
        });
    });

    it('traduce las claves con nombre propio y conserva `list_id: 0`', () => {
        const out = remapJson(
            [
                { connection_id: 50, default_template_id: 60, view_id: 70 },
                // Widget de CONTENIDO de un tablero: 0 = "sin lista".
                { type: 'heading', list_id: 0 },
                { type: 'kpi', list_id: 1, related_lists: [1, 2, 999] },
            ],
            maps(),
        );
        expect(out).toEqual([
            { connection_id: 150, default_template_id: 160, view_id: 170 },
            { type: 'heading', list_id: 0 },
            { type: 'kpi', list_id: 101, related_lists: [101, 102] },
        ]);
    });

    it('deja intactos los slugs y los valores que no son referencias', () => {
        const out = remapJson({ field: 'estado', op: 'eq', value: 10 }, maps());
        expect(out).toEqual({ field: 'estado', op: 'eq', value: 10 });
    });
});

describe('remapRecordData', () => {
    const types = new Map<number, string>([
        [10, 'text'],
        [11, 'file'],
        [12, 'user'],
    ]);

    it('traduce las claves f{id} y los valores de file/user', () => {
        const out = remapRecordData({ f10: 'Acme', f11: [40, 41, 999], f12: 30 }, types, maps());
        expect(out).toEqual({ f110: 'Acme', f111: [140, 141], f112: 130 });
    });

    it('descarta el valor de un campo que no viajó', () => {
        const out = remapRecordData({ f10: 'Acme', f99: 'huérfano' }, types, maps());
        expect(out).toEqual({ f110: 'Acme' });
    });

    it('sin catálogo de tipos sólo traduce las claves (diff de actividad)', () => {
        // El diff guarda `{from,to}` por campo: sus valores NO son valores de
        // campo, así que traducirlos los rompería.
        const out = remapRecordData({ f10: { from: 'a', to: 'b' } }, new Map(), maps());
        expect(out).toEqual({ f110: { from: 'a', to: 'b' } });
    });
});

describe('remapRichDoc', () => {
    it('traduce menciones, registros y archivos a cualquier profundidad', () => {
        const doc = {
            type: 'doc',
            content: [
                {
                    type: 'columns',
                    content: [
                        { type: 'mentionUser', attrs: { id: 30, label: 'Ana' } },
                        { type: 'mentionRecord', attrs: { id: 21 } },
                        { type: 'imageBlock', attrs: { fileId: 40, alt: 'logo' } },
                        { type: 'fileBlock', attrs: { fileId: 999 } },
                    ],
                },
            ],
        };
        const out = remapRichDoc(doc, maps()) as typeof doc;
        const nodes = out.content[0]!.content as Array<{ attrs: Record<string, unknown> }>;
        expect(nodes[0]!.attrs).toEqual({ id: 130, label: 'Ana' });
        expect(nodes[1]!.attrs).toEqual({ id: 121 });
        expect(nodes[2]!.attrs).toEqual({ fileId: 140, alt: 'logo' });
        // Un adjunto que no viajó queda en null: el bloque se degrada, no
        // apunta al archivo de otra empresa.
        expect(nodes[3]!.attrs).toEqual({ fileId: null });
    });
});

describe('remapListSettings', () => {
    it('traduce las CLAVES de permissions.users y emite token público nuevo', () => {
        const out = remapListSettings(
            {
                title_field_id: 10,
                permissions: {
                    agent: { view: 'own', fields_hidden: ['costo'] },
                    users: { '30': { view: 'all' }, '999': { view: 'all' } },
                },
                // El bloque público habla por SLUG salvo `view_id`.
                public: {
                    enabled: true,
                    token: 'token-del-origen',
                    visible_field_slugs: ['estado'],
                    view_id: 70,
                },
            },
            maps(),
            'token-nuevo',
        );
        expect(out.title_field_id).toBe(110);
        const permissions = out.permissions as Record<string, unknown>;
        // El acceso individual de alguien que no viajó se descarta: dejarlo
        // con el id viejo se lo daría a OTRA persona del servidor destino.
        expect(permissions.users).toEqual({ '130': { view: 'all' } });
        expect(permissions.agent).toEqual({ view: 'own', fields_hidden: ['costo'] });
        expect(out.public).toEqual({
            enabled: true,
            token: 'token-nuevo',
            visible_field_slugs: ['estado'],
            view_id: 170,
        });
    });

    it('sin publicación no inventa el bloque público', () => {
        const out = remapListSettings({ title_field_id: 11 }, maps(), null);
        expect(out).toEqual({ title_field_id: 111 });
    });
});

describe('remapAutomation', () => {
    it('traduce ids en ramas anidadas y tira el token del webhook entrante', () => {
        const { triggerConfig, actions } = remapAutomation(
            { due_field: 'vence', field_filters: [{ field: 'estado', op: 'eq', value: 'x' }], webhook_token: 'viejo' },
            [
                { type: 'update_field', config: { values: { estado: 'pagada' } } },
                {
                    type: 'if_else',
                    config: {
                        then_actions: [{ type: 'create_record', config: { target_list_id: 2 } }],
                        else_actions: [{ type: 'call_webhook', config: { connection_id: 50 } }],
                    },
                },
            ],
            maps(),
        );
        expect(triggerConfig.webhook_token).toBeUndefined();
        // Las condiciones hablan por SLUG: sobreviven intactas.
        expect(triggerConfig.field_filters).toEqual([{ field: 'estado', op: 'eq', value: 'x' }]);
        const list = actions as Array<Record<string, Record<string, unknown>>>;
        expect(list[1]!.config!.then_actions).toEqual([
            { type: 'create_record', config: { target_list_id: 102 } },
        ]);
        expect(list[1]!.config!.else_actions).toEqual([
            { type: 'call_webhook', config: { connection_id: 150 } },
        ]);
    });
});
