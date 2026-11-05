import { describe, expect, it } from 'vitest';

import { historyBucket } from './AssistantHistory';
import { screenContext, suggestionsFor } from './assistantContext';

describe('v0.1.370 — qué tiene abierto la persona', () => {
    it('reconoce la ficha, la lista, sus automatizaciones y sus ajustes', () => {
        expect(screenContext('/lists/clientes/records/42')).toEqual({ screen: 'record', listSlug: 'clientes', recordId: 42 });
        expect(screenContext('/lists/clientes/records')).toEqual({ screen: 'records', listSlug: 'clientes' });
        expect(screenContext('/lists/clientes')).toEqual({ screen: 'records', listSlug: 'clientes' });
        expect(screenContext('/lists/clientes/automations/7')).toEqual({ screen: 'automations', listSlug: 'clientes' });
        expect(screenContext('/lists/clientes/edit')).toEqual({ screen: 'list_settings', listSlug: 'clientes' });
        expect(screenContext('/lists/clientes/portal-editor')).toEqual({ screen: 'list_settings', listSlug: 'clientes' });
    });

    it('fuera de una lista no inventa un slug ni un registro', () => {
        expect(screenContext('/lists/new/file')).toEqual({ screen: 'other' });
        expect(screenContext('/dashboards/3')).toEqual({ screen: 'dashboard' });
        expect(screenContext('/dashboards')).toEqual({ screen: 'dashboards' });
        expect(screenContext('/')).toEqual({ screen: 'lists' });
        expect(screenContext('/folders/2')).toEqual({ screen: 'lists' });
        expect(screenContext('/my-work')).toEqual({ screen: 'my_work' });
        expect(screenContext('/settings')).toEqual({ screen: 'other' });
        expect(screenContext('/lists/clientes/records/abc').recordId).toBeUndefined();
    });

    it('cada pantalla trae sugerencias propias y nunca vacías', () => {
        const screens = ['record', 'records', 'automations', 'list_settings', 'dashboard', 'dashboards', 'lists', 'my_work', 'other'] as const;
        const seen = new Set<string>();
        for (const screen of screens) {
            const g = suggestionsFor({ screen });
            expect(g.items.length).toBeGreaterThanOrEqual(3);
            expect(g.title.length).toBeGreaterThan(0);
            for (const s of g.items) {
                // Español neutro: nada de voseo.
                expect(s.text).not.toMatch(/\b(armá|creá|mostrame|decime|agregá|pedí|tenés|podés)\b/i);
            }
            seen.add(g.items[0]!.text);
        }
        expect(seen.size).toBeGreaterThanOrEqual(7);
        expect(suggestionsFor({ screen: 'record' }).items[0]!.text).toMatch(/este registro/);
    });
});

describe('v0.1.370 — grupos del historial', () => {
    const now = new Date(2026, 10, 5, 15, 0);
    it('hoy, ayer, últimos 7 días y antes', () => {
        expect(historyBucket(new Date(2026, 10, 5, 0, 5).toISOString(), now)).toBe('today');
        expect(historyBucket(new Date(2026, 10, 4, 23, 59).toISOString(), now)).toBe('yesterday');
        expect(historyBucket(new Date(2026, 10, 1).toISOString(), now)).toBe('week');
        expect(historyBucket(new Date(2026, 9, 1).toISOString(), now)).toBe('older');
        expect(historyBucket('nada', now)).toBe('older');
    });
});
