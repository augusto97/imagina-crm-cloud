import { describe, expect, it } from 'vitest';

import {
    MOST_USED_DEDUPE_MS,
    MOST_USED_HALF_LIFE_MS,
    MOST_USED_MAX_ENTRIES,
    applyMostUsedVisits,
    mostUsedKey,
    mostUsedScore,
    mostUsedState,
    parseMostUsedKey,
    rankMostUsed,
    readMostUsed,
    recordMostUsedVisitsSchema,
    stableMostUsed,
    updateMostUsedSchema,
    type MostUsedStore,
    type MostUsedVisit,
} from './most-used';

const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 10, 6, 15, 0, 0);
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const visit = (kind: 'list' | 'dashboard', id: number, at: number): MostUsedVisit => ({ kind, id, at, day: dayOf(at) });
const empty = (): MostUsedStore => ({ enabled: true, items: {} });

describe('«Más usadas» (v0.1.385)', () => {
    it('claves por tipo e ID, y lectura tolerante', () => {
        expect(mostUsedKey({ kind: 'list', id: 12 })).toBe('l:12');
        expect(mostUsedKey({ kind: 'dashboard', id: 3 })).toBe('d:3');
        expect(parseMostUsedKey('l:12')).toEqual({ kind: 'list', id: 12 });
        for (const bad of ['l:0', 'x:1', 'l:-2', 'l:', 'list:1']) expect(parseMostUsedKey(bad)).toBeNull();

        expect(readMostUsed(undefined)).toEqual({ enabled: true, items: {} });
        expect(readMostUsed({ enabled: false })).toEqual({ enabled: false, items: {} });
        const store = readMostUsed({
            items: {
                'l:1': { s: 2, t: T0, d: 2, ld: '2026-11-06' },
                'l:2': { s: 'x', t: T0, d: 1, ld: '2026-11-06' },
                'z:3': { s: 1, t: T0, d: 1, ld: '2026-11-06' },
                'd:4': { s: 1, t: T0, d: 1, ld: 'ayer' },
            },
        });
        expect(Object.keys(store.items)).toEqual(['l:1']);
    });

    it('una visita suelta no entra; dos días distintos sí', () => {
        let s = applyMostUsedVisits(empty(), [visit('list', 1, T0)], T0);
        expect(rankMostUsed(s, T0)).toEqual([]);
        // Mismo día, más tarde: suma, pero sigue siendo un solo día.
        s = applyMostUsedVisits(s, [visit('list', 1, T0 + 3 * 60 * 60_000)], T0 + 3 * 60 * 60_000);
        expect(s.items['l:1']!.d).toBe(1);
        expect(rankMostUsed(s, T0 + 3 * 60 * 60_000)).toEqual([]);
        // Al día siguiente: dos días distintos y puntaje reciente alto.
        const t2 = T0 + DAY;
        s = applyMostUsedVisits(s, [visit('list', 1, t2)], t2);
        expect(s.items['l:1']!.d).toBe(2);
        expect(rankMostUsed(s, t2)).toEqual([{ kind: 'list', id: 1 }]);
    });

    it('dos visitas separadas por meses no entran (el peso viejo caducó)', () => {
        const old = T0 - 90 * DAY;
        const store: MostUsedStore = { enabled: true, items: { 'l:5': { s: 1, t: old, d: 1, ld: dayOf(old) } } };
        const s = applyMostUsedVisits(store, [visit('list', 5, T0)], T0);
        expect(s.items['l:5']!.d).toBe(2);
        expect(mostUsedScore(s.items['l:5']!, T0)).toBeLessThan(1.5);
        expect(rankMostUsed(s, T0)).toEqual([]);
    });

    it('cuenta como mucho una vez cada 30 minutos', () => {
        let s = applyMostUsedVisits(empty(), [visit('list', 1, T0)], T0);
        s = applyMostUsedVisits(
            s,
            [visit('list', 1, T0 + 60_000), visit('list', 1, T0 + MOST_USED_DEDUPE_MS - 1)],
            T0 + MOST_USED_DEDUPE_MS,
        );
        expect(s.items['l:1']!.s).toBe(1);
        s = applyMostUsedVisits(s, [visit('list', 1, T0 + MOST_USED_DEDUPE_MS)], T0 + MOST_USED_DEDUPE_MS);
        expect(s.items['l:1']!.s).toBeGreaterThan(1.9);
    });

    it('el peso cae a la mitad cada 14 días y ordena por uso reciente', () => {
        const e = { s: 4, t: T0, d: 3, ld: dayOf(T0) };
        expect(mostUsedScore(e, T0 + MOST_USED_HALF_LIFE_MS)).toBeCloseTo(2, 6);
        const store: MostUsedStore = {
            enabled: true,
            items: {
                // Muy usada hace dos meses.
                'l:1': { s: 20, t: T0 - 60 * DAY, d: 15, ld: dayOf(T0 - 60 * DAY) },
                // Usada a diario esta semana.
                'l:2': { s: 5, t: T0 - DAY, d: 5, ld: dayOf(T0 - DAY) },
                'd:3': { s: 3, t: T0 - 2 * DAY, d: 3, ld: dayOf(T0 - 2 * DAY) },
            },
        };
        expect(rankMostUsed(store, T0)).toEqual([
            { kind: 'list', id: 2 },
            { kind: 'dashboard', id: 3 },
        ]);
    });

    it('descarta visitas del futuro o muy viejas y acepta las que llegan tarde', () => {
        let s = applyMostUsedVisits(empty(), [visit('list', 1, T0 + 10 * 60_000), visit('list', 2, T0 - 8 * DAY)], T0);
        expect(s.items).toEqual({});
        s = applyMostUsedVisits(empty(), [visit('list', 1, T0)], T0);
        // Llega una visita de ayer (la cola de otro dispositivo).
        s = applyMostUsedVisits(s, [visit('list', 1, T0 - DAY)], T0);
        expect(s.items['l:1']!.d).toBe(2);
        expect(s.items['l:1']!.t).toBe(T0);
        expect(s.items['l:1']!.ld).toBe(dayOf(T0));
    });

    it('poda lo que no pesa y respeta el tope de entradas', () => {
        const visits: MostUsedVisit[] = [];
        for (let i = 1; i <= MOST_USED_MAX_ENTRIES + 15; i++) visits.push(visit('list', i, T0 - i * 60 * 60_000));
        const s = applyMostUsedVisits(empty(), visits, T0);
        expect(Object.keys(s.items)).toHaveLength(MOST_USED_MAX_ENTRIES);
        // Las más recientes sobreviven.
        expect(s.items['l:1']).toBeDefined();
        expect(s.items[`l:${MOST_USED_MAX_ENTRIES + 15}`]).toBeUndefined();
    });

    it('apagada no devuelve nada; el orden mostrado es estable', () => {
        const store: MostUsedStore = { enabled: false, items: { 'l:2': { s: 5, t: T0, d: 5, ld: dayOf(T0) } } };
        expect(mostUsedState(store, T0)).toEqual({ enabled: false, items: [] });
        expect(mostUsedState({ ...store, enabled: true }, T0).items).toEqual([{ kind: 'list', id: 2 }]);

        expect(stableMostUsed([], ['l:1', 'l:2', 'd:3'])).toEqual(['l:1', 'l:2', 'd:3']);
        // Ahora l:2 pasó adelante: lo que se veía no se mueve.
        expect(stableMostUsed(['l:1', 'l:2', 'd:3'], ['l:2', 'l:1', 'd:3'])).toEqual(['l:1', 'l:2', 'd:3']);
        // Lo nuevo entra al final; lo borrado sale.
        expect(stableMostUsed(['l:1', 'l:2', 'd:3'], ['l:9', 'l:1', 'd:3'])).toEqual(['l:1', 'd:3', 'l:9']);
        // Sin lugar, lo nuevo espera.
        expect(stableMostUsed(['l:1', 'l:2', 'l:3', 'l:4', 'l:5'], ['l:6', 'l:1', 'l:2', 'l:3', 'l:4', 'l:5'])).toEqual([
            'l:1',
            'l:2',
            'l:3',
            'l:4',
            'l:5',
        ]);
    });

    it('valida los pedidos', () => {
        expect(recordMostUsedVisitsSchema.safeParse({ visits: [visit('list', 1, T0)] }).success).toBe(true);
        expect(recordMostUsedVisitsSchema.safeParse({ visits: [] }).success).toBe(false);
        expect(recordMostUsedVisitsSchema.safeParse({ visits: [{ kind: 'record', id: 1, at: T0, day: '2026-11-06' }] }).success).toBe(false);
        expect(recordMostUsedVisitsSchema.safeParse({ visits: [{ kind: 'list', id: 1, at: T0, day: '6/11/2026' }] }).success).toBe(false);
        expect(updateMostUsedSchema.safeParse({}).success).toBe(false);
        expect(updateMostUsedSchema.safeParse({ enabled: false }).success).toBe(true);
        expect(updateMostUsedSchema.safeParse({ reset: true }).success).toBe(true);
    });
});
