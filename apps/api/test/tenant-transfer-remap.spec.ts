import { describe, expect, it } from 'vitest';
import { parseViewConfig } from '@imagina-base/shared';
import {
    emptyMaps,
    mapId,
    remapAutomation,
    remapJson,
    remapListSettings,
    remapRecordData,
    remapRichDoc,
    remapViewConfig,
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

    it('v0.1.287 — config de vista: segundo agrupado y colores condicionales (condición y celda)', () => {
        const out = remapJson(
            {
                group_by_field_id: 10,
                sub_group_by_field_id: 11,
                frozen_columns: 2,
                color_rules: [
                    { id: 'r1', enabled: true, condition: { type: 'condition', field_id: 10, op: 'eq', value: 'baja' }, color: 'red', target: 'row' },
                    { id: 'r2', enabled: true, condition: { type: 'condition', field_id: 12, op: 'is_null' }, color: 'amber', target: 'cell', cell_field_id: 11 },
                ],
            },
            maps(),
        );
        expect(out).toEqual({
            group_by_field_id: 110,
            sub_group_by_field_id: 111,
            frozen_columns: 2,
            color_rules: [
                { id: 'r1', enabled: true, condition: { type: 'condition', field_id: 110, op: 'eq', value: 'baja' }, color: 'red', target: 'row' },
                { id: 'r2', enabled: true, condition: { type: 'condition', field_id: 112, op: 'is_null' }, color: 'amber', target: 'cell', cell_field_id: 111 },
            ],
        });
    });

    it('v0.1.297 — kanban: ids de campo por convención y columnas/carriles por PERSONA con el mapa de usuarios', () => {
        // Columnas por etapa (select) y carriles por vendedor (user).
        const types = new Map<number, string>([[10, 'select'], [11, 'user'], [12, 'currency']]);
        const out = remapViewConfig(
            {
                group_by_field_id: 10,
                kanban_lane_field_id: 11,
                kanban_value_field_id: 12,
                kanban_collapsed_lanes: ['30', '999', '__null__'],
                kanban_wip_limits: [{ column: 'ganado', limit: 5 }],
                kanban_move_rules: [{ column: 'perdido', required_field_ids: [12, 999] }],
            },
            types,
            maps(),
        );
        expect(out).toEqual({
            group_by_field_id: 110,
            kanban_lane_field_id: 111,
            kanban_value_field_id: 112,
            // El 999 no viajó: se descarta (si no, el plegado sería de OTRA persona).
            kanban_collapsed_lanes: ['130', '__null__'],
            // Columnas por un select: su value no cambia.
            kanban_wip_limits: [{ column: 'ganado', limit: 5 }],
            kanban_move_rules: [{ column: 'perdido', required_field_ids: [112] }],
        });
        // Columnas por persona: las claves de columna también se traducen.
        const byUser = remapViewConfig(
            { group_by_field_id: 11, kanban_wip_limits: [{ column: '31', limit: 3 }, { column: '999', limit: 1 }], kanban_hidden_columns: ['30'] },
            types,
            maps(),
        );
        expect(byUser).toEqual({ group_by_field_id: 111, kanban_wip_limits: [{ column: '131', limit: 3 }], kanban_hidden_columns: ['130'] });
    });

    it('B2 — carga de trabajo: campos por convención y personas visibles por el mapa de usuarios', () => {
        const types = new Map<number, string>([[10, 'user'], [11, 'date'], [12, 'number']]);
        const out = remapViewConfig(
            {
                workload_person_field_id: 10,
                workload_start_field_id: 11,
                workload_end_field_id: 999,
                workload_estimate_field_id: 12,
                workload_metric: 'estimate',
                workload_user_ids: [31, 999, 30],
            },
            types,
            maps(),
        );
        expect(out).toEqual({
            workload_person_field_id: 110,
            workload_start_field_id: 111,
            // Un campo que no viajó queda en null (no apunta a otro).
            workload_end_field_id: null,
            workload_estimate_field_id: 112,
            workload_metric: 'estimate',
            // La persona 999 no viajó: se descarta (si no, se vería a OTRA).
            workload_user_ids: [131, 130],
        });
        // C1 — el filtro por equipo: traducido; un equipo que no viajó se quita.
        const m = maps();
        m.team.set(5, 105);
        expect(remapViewConfig({ workload_person_field_id: 10, workload_team_id: 5 }, types, m)).toEqual({ workload_person_field_id: 110, workload_team_id: 105 });
        expect(remapViewConfig({ workload_person_field_id: 10, workload_team_id: 6 }, types, m)).toEqual({ workload_person_field_id: 110 });
    });

    it('C1 — el paso de aprobación «Un equipo» apunta al equipo NUEVO (y a ninguno si no viajó)', () => {
        const m = maps();
        m.team.set(5, 105);
        const config = {
            steps: [
                { id: 's1', approver: { type: 'team', team_id: 5 }, mode: 'all' },
                { id: 's2', approver: { type: 'team', team_id: 6 } },
                { id: 's3', approver: { type: 'users', approver_user_ids: [30, 999] } },
            ],
        };
        expect(remapJson(config, m)).toEqual({
            steps: [
                { id: 's1', approver: { type: 'team', team_id: 105 }, mode: 'all' },
                // Un equipo que no viajó no apunta al equipo de OTRA empresa.
                { id: 's2', approver: { type: 'team', team_id: null } },
                { id: 's3', approver: { type: 'users', approver_user_ids: [130] } },
            ],
        });
    });

    it('B4 — calendario: fin, fuentes adicionales, campo de color y reglas por convención', () => {
        const types = new Map<number, string>([[10, 'datetime'], [11, 'datetime'], [12, 'select']]);
        const out = remapViewConfig(
            {
                date_field_id: 10,
                calendar_end_field_id: 11,
                calendar_color_field_id: 12,
                calendar_sources: [
                    { id: 's2', start_field_id: 11, end_field_id: 999, color: 'red' },
                    { id: 's3', start_field_id: 999 },
                ],
                calendar_hidden_sources: ['s2'],
                color_rules: [{ id: 'r1', condition: { type: 'condition', field_id: 12, op: 'eq', value: 'x' }, color: 'gray' }],
            },
            types,
            maps(),
        );
        expect(out).toEqual({
            date_field_id: 110,
            calendar_end_field_id: 111,
            calendar_color_field_id: 112,
            // Un campo que no viajó queda en null: la lectura de la vista descarta esa fuente.
            calendar_sources: [
                { id: 's2', start_field_id: 111, end_field_id: null, color: 'red' },
                { id: 's3', start_field_id: null },
            ],
            calendar_hidden_sources: ['s2'],
            color_rules: [{ id: 'r1', condition: { type: 'condition', field_id: 112, op: 'eq', value: 'x' }, color: 'gray' }],
        });
        const cfg = parseViewConfig('calendar', out);
        expect(cfg.calendar_sources).toEqual([{ id: 's2', start_field_id: 111, end_field_id: null, color: 'red' }]);
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
