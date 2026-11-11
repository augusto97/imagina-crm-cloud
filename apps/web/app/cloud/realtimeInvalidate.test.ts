import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { layoutDataKeys } from '@/admin/records/layout/useLayoutData';
import { dashboardsKeys } from '@/hooks/useDashboards';
import { listsKeys } from '@/hooks/useLists';
import { AGGREGATES_NS, recordsKeys } from '@/hooks/useRecords';
import { activityKeys } from '@/hooks/useActivity';

import {
    DERIVED_WINDOW_MS,
    RECORDS_WINDOW_MS,
    createRealtimeInvalidator,
    layoutDataTouchesList,
} from './realtimeInvalidate';

const A = 12; // la lista que cambia (slug «clientes»)
const B = 99; // otra lista

function seed() {
    const qc = new QueryClient();
    const keys = {
        tableBySlug: recordsKeys.list('clientes', {}),
        tableById: recordsKeys.list(A, {}),
        aggregates: [AGGREGATES_NS, String(A), 'pie'],
        activity: [...activityKeys.all, String(A), 5],
        otherTable: recordsKeys.list(B, {}),
        // Ficha abierta de OTRA lista con un bloque de vinculados de A…
        sheetLinked: [...layoutDataKeys.forRecord(B, 1, 's1'), 'app'],
        // …y otra que sólo lee la lista 50.
        sheetOther: [...layoutDataKeys.forRecord(B, 2, 's2'), 'app'],
        dashA: [...dashboardsKeys.widgetsDataOf(7), 'p'],
        dashB: [...dashboardsKeys.widgetsDataOf(8), 'p'],
    } as const;
    qc.setQueryData(listsKeys.list(), [{ id: A, slug: 'clientes' }, { id: B, slug: 'otra' }]);
    for (const k of Object.values(keys)) qc.setQueryData(k, {});
    qc.setQueryData(keys.sheetLinked, { b1: { list: { id: A }, rows: [] } });
    qc.setQueryData(keys.sheetOther, { b1: { list: { id: 50 }, rows: [] } });
    qc.setQueryData(dashboardsKeys.one(7), { id: 7, widgets: [{ list_id: A }] });
    qc.setQueryData(dashboardsKeys.one(8), { id: 8, widgets: [{ list_id: B }] });
    return { qc, keys };
}

const stale = (qc: QueryClient, key: readonly unknown[]): boolean => qc.getQueryState(key)?.isInvalidated === true;
/** Como si el refetch hubiera terminado: la query vuelve a estar fresca. */
const freshen = (qc: QueryClient, keys: Record<string, readonly unknown[]>): void => {
    for (const k of Object.values(keys)) qc.setQueryData(k, qc.getQueryData(k));
};

describe('realtime — qué se vuelve a pedir con un aviso de registros', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sólo lo de ESA lista (por id y por slug), sus tableros y las fichas que la leen', () => {
        const { qc, keys } = seed();
        const rt = createRealtimeInvalidator(qc, { isHidden: () => false });
        rt.handle({ topic: 'records', listId: A });
        expect(stale(qc, keys.tableBySlug)).toBe(true);
        expect(stale(qc, keys.tableById)).toBe(true);
        expect(stale(qc, keys.aggregates)).toBe(true);
        expect(stale(qc, keys.activity)).toBe(true);
        expect(stale(qc, keys.sheetLinked)).toBe(true);
        expect(stale(qc, keys.dashA)).toBe(true);
        // Nada de otra lista, ni la ficha que no la lee, ni el tablero ajeno.
        expect(stale(qc, keys.otherTable)).toBe(false);
        expect(stale(qc, keys.sheetOther)).toBe(false);
        expect(stale(qc, keys.dashB)).toBe(false);
        rt.dispose();
    });

    it('con la pestaña oculta no se pide nada; al volver se aplica una vez', () => {
        const { qc, keys } = seed();
        let hidden = true;
        const rt = createRealtimeInvalidator(qc, { isHidden: () => hidden });
        const spy = vi.spyOn(qc, 'invalidateQueries');
        for (let i = 0; i < 30; i += 1) rt.handle({ topic: 'records', listId: A });
        expect(spy).not.toHaveBeenCalled();
        expect(stale(qc, keys.tableBySlug)).toBe(false);
        hidden = false;
        rt.onVisible();
        expect(stale(qc, keys.tableBySlug)).toBe(true);
        expect(stale(qc, keys.dashA)).toBe(true);
        const calls = spy.mock.calls.length;
        rt.onVisible(); // ya no queda nada guardado
        expect(spy.mock.calls.length).toBe(calls);
        rt.dispose();
    });

    it('una lista que se escribe sin parar: el primero al instante, después por ventanas y siempre uno al final', () => {
        const { qc, keys } = seed();
        const rt = createRealtimeInvalidator(qc, { isHidden: () => false });
        rt.handle({ topic: 'records', listId: A });
        expect(stale(qc, keys.tableBySlug)).toBe(true);
        freshen(qc, keys);

        // Un aviso por segundo durante la ventana: no vuelve a pedir todavía.
        rt.handle({ topic: 'records', listId: A });
        expect(stale(qc, keys.tableBySlug)).toBe(false);
        expect(stale(qc, keys.dashA)).toBe(false);

        // Al cerrar la ventana de la lista, UNA vez (lo derivado espera la suya).
        vi.advanceTimersByTime(RECORDS_WINDOW_MS);
        expect(stale(qc, keys.tableBySlug)).toBe(true);
        expect(stale(qc, keys.dashA)).toBe(false);
        vi.advanceTimersByTime(DERIVED_WINDOW_MS - RECORDS_WINDOW_MS);
        expect(stale(qc, keys.dashA)).toBe(true);
        expect(stale(qc, keys.sheetLinked)).toBe(true);

        // Sin más avisos, no hay más pedidos.
        freshen(qc, keys);
        vi.advanceTimersByTime(DERIVED_WINDOW_MS * 3);
        expect(stale(qc, keys.tableBySlug)).toBe(false);
        expect(stale(qc, keys.dashA)).toBe(false);
        // Y pasado el silencio, el siguiente aviso vuelve a ser inmediato.
        rt.handle({ topic: 'records', listId: A });
        expect(stale(qc, keys.tableBySlug)).toBe(true);
        rt.dispose();
    });

    it('los demás temas se aplican al instante, también con la pestaña oculta', () => {
        const { qc } = seed();
        const rt = createRealtimeInvalidator(qc, { isHidden: () => true });
        rt.handle({ topic: 'lists' });
        expect(stale(qc, listsKeys.list())).toBe(true);
        rt.dispose();
    });
});

describe('layoutDataTouchesList', () => {
    const ids = new Set(['12', 'clientes']);
    it('la ficha de la propia lista siempre', () => {
        expect(layoutDataTouchesList(['record-layout-data', '12', 1, 's'], { b: { list: { id: 50 } } }, ids)).toBe(true);
    });
    it('un bloque de vinculados de esa lista sí, de otra no', () => {
        expect(layoutDataTouchesList(['record-layout-data', '99', 1, 's'], { b: { list: { id: 12 } } }, ids)).toBe(true);
        expect(layoutDataTouchesList(['record-layout-data', '99', 1, 's'], { b: { list: { id: 50 } } }, ids)).toBe(false);
    });
    it('un bloque que no dice su lista (un gráfico) o sin datos todavía: ante la duda, sí', () => {
        expect(layoutDataTouchesList(['record-layout-data', '99', 1, 's'], { g: { value: 3 } }, ids)).toBe(true);
        expect(layoutDataTouchesList(['record-layout-data', '99', 1, 's'], undefined, ids)).toBe(true);
    });
    it('el portal dice la lista de cada bloque en su mapa', () => {
        const data = { g: { value: 3 }, __block_lists: { g: 50 } };
        expect(layoutDataTouchesList(['record-layout-data', '99', 1, 's', 'portal'], data, ids)).toBe(false);
        expect(layoutDataTouchesList(['record-layout-data', '99', 1, 's', 'portal'], { ...data, __block_lists: { g: 12 } }, ids)).toBe(true);
    });
});
