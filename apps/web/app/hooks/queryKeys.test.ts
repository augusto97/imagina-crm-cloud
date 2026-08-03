import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { activityKeys } from '@/hooks/useActivity';
import { automationsKeys } from '@/hooks/useAutomations';
import { fieldsKeys } from '@/hooks/useFields';
import { listsKeys } from '@/hooks/useLists';
import { canonicalListId, invalidateForList, listIdentifiersFor, recordsKeys } from '@/hooks/useRecords';
import { viewsKeys } from '@/hooks/useSavedViews';

/**
 * v0.1.114 — Regresión de la clase de bug MÁS CARA del proyecto.
 *
 * Regla de oro nº 7: un único identificador canónico en las queryKeys. En la
 * práctica conviven los dos (la URL trae el slug, los eventos de realtime y
 * las mutaciones traen el id numérico), y `invalidateForList` es el puente.
 * Cada vez que una familia de keys puso su identificador en un índice distinto
 * del 1, la invalidación dejó de matchear y la UI se congeló hasta recargar:
 *
 *   · v0.1.81 — el import creaba campos pero el estado vacío no se enteraba.
 *   · v0.1.83 — el icono de recurrencia no aparecía hasta recargar.
 *   · v0.1.85 — la página de automatizaciones no refrescaba (segmento 'list'
 *     de más corría el id al índice 2).
 *   · v0.1.105 — los cambios hechos en otra pestaña no llegaban.
 *
 * Estos tests fijan el contrato para que no vuelva a pasar en silencio.
 */

const LISTS = [
    { id: 42, slug: 'clientes', name: 'Clientes' },
    { id: 77, slug: 'facturas', name: 'Facturas' },
];

function clientWithLists(): QueryClient {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(listsKeys.list(), LISTS);
    return qc;
}

describe('contrato de las queryKeys por lista', () => {
    it('TODAS las familias ponen el identificador en el índice 1', () => {
        // Si alguna vuelve a meter un segmento extra antes del id,
        // `invalidateForList` (que matchea el índice 1) deja de verla.
        for (const key of [
            recordsKeys.forList(42),
            fieldsKeys.forList(42),
            viewsKeys.forList(42),
            automationsKeys.forList(42),
            // v0.1.149 — la actividad tenía el mismo segmento 'list' de más
            // que rompió las automatizaciones en v0.1.85: el feed del registro
            // no se refrescaba al editar.
            activityKeys.forList(42),
            activityKeys.forRecord(42, 7),
        ]) {
            expect(key[1]).toBe('42');
        }
    });

    it('invalidar por id alcanza a la actividad registrada por slug', () => {
        const qc = clientWithLists();
        let refetched = false;
        qc.setQueryDefaults(activityKeys.forRecord('clientes', 7), {
            queryFn: () => {
                refetched = true;
                return Promise.resolve([]);
            },
        });
        qc.setQueryData([...activityKeys.forRecord('clientes', 7), 100], []);
        invalidateForList(qc, activityKeys.all, 42);
        expect(
            qc.getQueryState([...activityKeys.forRecord('clientes', 7), 100])?.isInvalidated,
        ).toBe(true);
        void refetched;
    });

    it('el identificador siempre viaja como string (id numérico y slug no deben divergir de tipo)', () => {
        expect(recordsKeys.forList(42)[1]).toBe('42');
        expect(recordsKeys.forList('clientes')[1]).toBe('clientes');
    });
});

describe('listIdentifiersFor — puente id ↔ slug', () => {
    it('desde el slug resuelve también el id, y al revés', () => {
        const qc = clientWithLists();
        expect(listIdentifiersFor(qc, 'clientes')).toEqual(new Set(['clientes', '42']));
        expect(listIdentifiersFor(qc, 42)).toEqual(new Set(['42', 'clientes']));
    });

    it('sin cache de listas devuelve al menos lo que le pasaron (no rompe el primer render)', () => {
        const qc = new QueryClient();
        expect(listIdentifiersFor(qc, 'clientes')).toEqual(new Set(['clientes']));
    });
});

describe('canonicalListId', () => {
    it('normaliza el slug al id numérico (evita cachear la misma lista dos veces)', () => {
        const qc = clientWithLists();
        expect(canonicalListId(qc, 'clientes')).toBe('42');
        expect(canonicalListId(qc, 42)).toBe('42');
    });

    it('lista desconocida → se usa tal cual', () => {
        expect(canonicalListId(clientWithLists(), 'inexistente')).toBe('inexistente');
    });
});

describe('invalidateForList', () => {
    it('invalida la query registrada por SLUG cuando el evento trae el ID', async () => {
        // El caso exacto de v0.1.105: realtime emite el id numérico, pero
        // RecordsPage registró su query bajo el slug de la URL.
        const qc = clientWithLists();
        qc.setQueryData(recordsKeys.forList('clientes'), { rows: 1 });
        const before = qc.getQueryState(recordsKeys.forList('clientes'))!.isInvalidated;
        expect(before).toBe(false);

        invalidateForList(qc, recordsKeys.all, 42);

        expect(qc.getQueryState(recordsKeys.forList('clientes'))!.isInvalidated).toBe(true);
    });

    it('y a la inversa: query por ID, evento con slug', () => {
        const qc = clientWithLists();
        qc.setQueryData(fieldsKeys.forList(42), []);
        invalidateForList(qc, fieldsKeys.all, 'clientes');
        expect(qc.getQueryState(fieldsKeys.forList(42))!.isInvalidated).toBe(true);
    });

    it('NO toca las queries de otra lista (nada de invalidar todo por las dudas)', () => {
        const qc = clientWithLists();
        qc.setQueryData(recordsKeys.forList('clientes'), { rows: 1 });
        qc.setQueryData(recordsKeys.forList('facturas'), { rows: 2 });

        invalidateForList(qc, recordsKeys.all, 42);

        expect(qc.getQueryState(recordsKeys.forList('clientes'))!.isInvalidated).toBe(true);
        expect(qc.getQueryState(recordsKeys.forList('facturas'))!.isInvalidated).toBe(false);
    });

    it('no cruza namespaces: invalidar records no marca stale a fields', () => {
        const qc = clientWithLists();
        qc.setQueryData(fieldsKeys.forList(42), []);
        invalidateForList(qc, recordsKeys.all, 42);
        expect(qc.getQueryState(fieldsKeys.forList(42))!.isInvalidated).toBe(false);
    });

    it('alcanza a las sub-keys de la lista (item, list, groups…)', () => {
        // Las páginas registran keys más profundas colgando de forList.
        const qc = clientWithLists();
        qc.setQueryData(recordsKeys.item('clientes', 7), { id: 7 });
        invalidateForList(qc, recordsKeys.all, 42);
        expect(qc.getQueryState(recordsKeys.item('clientes', 7))!.isInvalidated).toBe(true);
    });
});
