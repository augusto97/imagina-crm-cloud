import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    api,
    buildFieldMap,
    cloudRecordsMeta,
    cloudRecordsQuery,
    listKeyFromPath,
    mapRecord,
    mapRecordBody,
    normalizeDates,
    recordsPathKind,
    rememberFieldKey,
} from '@/lib/api';

/**
 * v0.1.114 — Tests del ADAPTADOR entre el fork (que habla por slug y por
 * página) y el backend NestJS (que habla por `f{field_id}` y por cursor).
 *
 * Por qué aquí y no en un E2E: esta capa es la que más regresiones produjo del
 * proyecto (v0.1.68 los filtros viajaban en el formato equivocado, v0.1.81 la
 * invalidación del import, v0.1.85 el path de automatizaciones…) y no tenía
 * NI UN test. Son funciones puras: cuestan milisegundos y atrapan justo la
 * clase de bug que se escapa a la vista.
 */

const MAP = buildFieldMap([
    { id: 12, slug: 'razon_social' },
    { id: 13, slug: 'monto' },
    { id: 99, slug: 'cliente' },
]);

describe('buildFieldMap — traducción slug ↔ f{id}', () => {
    it('arma los dos sentidos', () => {
        expect(MAP.toSlug.f12).toBe('razon_social');
        expect(MAP.toFid.razon_social).toBe('f12');
    });

    it('ignora entradas incompletas en vez de romper', () => {
        const m = buildFieldMap([{ id: 1 }, { slug: 'x' }, null, { id: 2, slug: 'ok' }]);
        expect(m.toSlug).toEqual({ f2: 'ok' });
        expect(buildFieldMap(undefined).toSlug).toEqual({});
    });
});

describe('mapRecord — respuesta del backend → shape de la UI', () => {
    it('traduce data y relations de f{id} a slug', () => {
        const out = mapRecord(
            {
                id: 7,
                data: { f12: 'Acme', f13: 1500 },
                relations: { f99: [3, 4] },
                created_at: '2026-07-25T10:00:00.000Z',
                updated_at: '2026-07-25T11:00:00.000Z',
            },
            MAP,
        ) as Record<string, never>;
        expect(out).toMatchObject({
            id: 7,
            fields: { razon_social: 'Acme', monto: 1500 },
            relations: { cliente: [3, 4] },
        });
    });

    it('quita la Z de los timestamps (el fork asume naive-UTC y le concatena la suya)', () => {
        // Sin esto la UI formatea '...ZZ' → Invalid Date.
        const out = mapRecord({ id: 1, data: {}, created_at: '2026-07-25T10:00:00.000Z' }, MAP) as {
            created_at: string;
        };
        expect(out.created_at).toBe('2026-07-25T10:00:00.000');
    });

    it('una clave sin campo conocido se conserva tal cual (no se pierde el dato)', () => {
        const out = mapRecord({ id: 1, data: { f12: 'Acme', f404: 'huérfano' } }, MAP) as {
            fields: Record<string, unknown>;
        };
        expect(out.fields).toEqual({ razon_social: 'Acme', f404: 'huérfano' });
    });

    it('tolera un record sin data ni relations', () => {
        const out = mapRecord({ id: 3 }, MAP) as { fields: unknown; relations: unknown };
        expect(out.fields).toEqual({});
        expect(out.relations).toEqual({});
    });
});

describe('mapRecordBody — body de la UI → body del backend', () => {
    it('traduce fields por slug a data por f{id}', () => {
        expect(mapRecordBody({ fields: { razon_social: 'Acme', monto: 10 } }, MAP)).toEqual({
            data: { f12: 'Acme', f13: 10 },
        });
    });

    it('acepta también `data` (algunas superficies ya lo mandan así)', () => {
        expect(mapRecordBody({ data: { monto: 5 } }, MAP)).toEqual({ data: { f13: 5 } });
    });

    it('un body sin fields ni data pasa intacto', () => {
        expect(mapRecordBody({ name: 'x' }, MAP)).toEqual({ name: 'x' });
    });
});

describe('cloudRecordsQuery — paginación por página', () => {
    it('per_page se traduce a limit y page VIAJA (v0.1.187: antes se descartaba)', () => {
        // Regresión: "importé 2.000 filas y sólo veo 200" — sin `page` el
        // backend nunca devolvía la segunda tanda ni el total real.
        expect(cloudRecordsQuery({ per_page: 50, page: 3, search: 'ana' })).toEqual({
            limit: 50,
            page: 3,
            search: 'ana',
        });
    });

    it('page inválida (0, texto) no viaja', () => {
        expect(cloudRecordsQuery({ per_page: 50, page: 0 })).toEqual({ limit: 50 });
        expect(cloudRecordsQuery({ per_page: 50, page: 'x' })).toEqual({ limit: 50 });
    });

    it('capea al máximo del backend (200) — el bug que cortaba kanban en 50', () => {
        expect(cloudRecordsQuery({ per_page: 1000 })).toEqual({ limit: 200 });
    });

    it('deja pasar el resto de la query sin tocarla (filter_tree, sort)', () => {
        const tree = JSON.stringify({ type: 'group', op: 'and', children: [] });
        expect(cloudRecordsQuery({ filter_tree: tree, sort: 'field_12:asc' })).toEqual({
            filter_tree: tree,
            sort: 'field_12:asc',
        });
    });

    it('sin query o sin tamaño no inventa limit', () => {
        expect(cloudRecordsQuery(undefined)).toBeUndefined();
        expect(cloudRecordsQuery({ search: 'x' })).toEqual({ search: 'x' });
    });
});

describe('cloudRecordsMeta — meta de paginación para la UI (v0.1.187)', () => {
    it('con total del backend, pagina de verdad', () => {
        expect(cloudRecordsMeta({ next_cursor: '200', total: 2500, page: 1, per_page: 200, total_pages: 13 }, 200)).toEqual({
            page: 1,
            per_page: 200,
            total: 2500,
            total_pages: 13,
            next_cursor: '200',
        });
    });

    it('sin total (subtareas, pickers) la tanda es una sola página, como antes', () => {
        expect(cloudRecordsMeta({ next_cursor: null }, 7)).toEqual({
            page: 1,
            per_page: 7,
            total: 7,
            total_pages: 1,
            next_cursor: null,
        });
        expect(cloudRecordsMeta(undefined, 0).total).toBe(0);
    });

    it('total sin total_pages → los calcula', () => {
        expect(cloudRecordsMeta({ total: 401, per_page: 200 }, 200).total_pages).toBe(3);
    });
});

describe('reconocimiento de paths', () => {
    it('distingue listado de item y toma la lista del path', () => {
        expect(recordsPathKind('/lists/clientes/records')).toBe('list');
        expect(recordsPathKind('/lists/42/records/7')).toBe('item');
        expect(recordsPathKind('/lists/clientes/fields')).toBeNull();
        expect(listKeyFromPath('/lists/clientes/records/7')).toBe('clientes');
        expect(listKeyFromPath('/dashboards/3')).toBeNull();
    });
});

describe('normalizeDates', () => {
    it('limpia los *_at de objetos y de arrays, sin tocar el resto', () => {
        expect(normalizeDates({ id: 1, created_at: '2026-01-01T00:00:00.000Z', name: 'Z' })).toEqual({
            id: 1,
            created_at: '2026-01-01T00:00:00.000',
            name: 'Z',
        });
        expect(normalizeDates([{ updated_at: '2026-01-01T00:00:00Z' }])).toEqual([
            { updated_at: '2026-01-01T00:00:00' },
        ]);
        expect(normalizeDates('texto')).toBe('texto');
    });
});

describe('campo nuevo con la tabla abierta', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('la columna nueva se traduce aunque el mapa del slug y el del id sean objetos distintos', async () => {
        const json = (body: unknown): Response =>
            new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        const fieldsV1 = [{ id: 501, list_id: 77, slug: 'producto' }];
        const replies: unknown[] = [
            { data: fieldsV1 }, // la tabla pide los campos por SLUG
            { data: fieldsV1 }, // el editor de un campo, por ID → otro objeto
            { data: [{ id: 1, list_id: 77, data: { f501: 'Taza', f502: 75000 } }], meta: {} },
        ];
        vi.stubGlobal('fetch', vi.fn(async () => json(replies.shift())));

        await api.get('/lists/tienda_api/fields');
        await api.get('/lists/77/fields');
        // Se crea un campo desde el editor (que tiene el id de la lista).
        rememberFieldKey({ id: 502, slug: 'total', list_id: 77 }, 77);
        const res = await api.get<Array<{ fields: Record<string, unknown> }>>('/lists/tienda_api/records');
        expect(res.data[0]!.fields).toMatchObject({ producto: 'Taza', total: 75000 });
    });
});

describe('C6 / A9 — alta desde una plantilla y progreso del checklist', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('el progreso del checklist viaja en el registro (sólo si tiene ítems)', () => {
        const out = mapRecord({ id: 1, data: {}, checklist: { done: 2, total: 5 } }, MAP) as { checklist?: unknown };
        expect(out.checklist).toEqual({ done: 2, total: 5 });
        const none = mapRecord({ id: 2, data: {} }, MAP) as { checklist?: unknown };
        expect(none.checklist).toBeUndefined();
    });

    it('POST records/from-template: el cuerpo va por f{id} con template_id y la respuesta vuelve por slug', async () => {
        const json = (body: unknown): Response =>
            new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } });
        const calls: Array<{ url: string; body: unknown }> = [];
        const replies: unknown[] = [
            { data: [{ id: 801, list_id: 88, slug: 'nombre' }, { id: 802, list_id: 88, slug: 'estado' }] },
            { data: { id: 9, list_id: 88, data: { f801: 'Acme', f802: 'nuevo' } }, meta: { record_id: 9, subtask_ids: [10, 11], checklist_ids: [3], warnings: [] } },
        ];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
                return json(replies.shift());
            }),
        );
        await api.get('/lists/clientes_tpl/fields');
        const res = await api.post<{ id: number; fields: Record<string, unknown> }>('/lists/clientes_tpl/records/from-template', {
            template_id: 4,
            fields: { nombre: 'Acme' },
            parent_id: null,
        });
        expect(calls[1]!.body).toEqual({ template_id: 4, parent_id: null, data: { f801: 'Acme' } });
        expect(res.data).toMatchObject({ id: 9, fields: { nombre: 'Acme', estado: 'nuevo' } });
        expect(res.meta).toMatchObject({ subtask_ids: [10, 11] });
    });
});
