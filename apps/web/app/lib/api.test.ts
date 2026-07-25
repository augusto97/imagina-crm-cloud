import { describe, expect, it } from 'vitest';

import {
    buildFieldMap,
    cloudRecordsQuery,
    listKeyFromPath,
    mapRecord,
    mapRecordBody,
    normalizeDates,
    recordsPathKind,
} from '@/lib/api';

/**
 * v0.1.114 — Tests del ADAPTADOR entre el fork (que habla por slug y por
 * página) y el backend NestJS (que habla por `f{field_id}` y por cursor).
 *
 * Por qué acá y no en un E2E: esta capa es la que más regresiones produjo del
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

describe('cloudRecordsQuery — paginación por página → por cursor', () => {
    it('per_page se traduce a limit y page se descarta (el backend es keyset)', () => {
        expect(cloudRecordsQuery({ per_page: 50, page: 3, search: 'ana' })).toEqual({
            limit: 50,
            search: 'ana',
        });
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
