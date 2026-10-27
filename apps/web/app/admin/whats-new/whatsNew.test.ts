// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { canPresentNow, FEATURED_COOLDOWN_MS, isOnWhatsNewPage, rememberPresented, screenIsBusy } from './featuredGate';
import { dayLabel, groupByMonth, monthLabel } from './whatsNewMeta';
import { whatsNewPanel } from './whatsNewStore';

/** Un `Storage` mínimo en memoria. */
function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() {
            return m.size;
        },
        clear: () => m.clear(),
        getItem: (k) => m.get(k) ?? null,
        key: (i) => [...m.keys()][i] ?? null,
        removeItem: (k) => void m.delete(k),
        setItem: (k, v) => void m.set(k, String(v)),
    };
}

describe('novedades: fechas y agrupado por mes', () => {
    it('meses y días en español', () => {
        expect(monthLabel(new Date(2026, 9, 26))).toBe('Octubre de 2026');
        expect(dayLabel(new Date(2026, 9, 26), new Date(2026, 11, 1))).toBe('26 de octubre');
        expect(dayLabel(new Date(2025, 0, 3), new Date(2026, 11, 1))).toBe('3 de enero de 2025');
        expect(monthLabel(new Date('no'))).toBe('');
    });

    it('agrupa conservando el orden (lo más nuevo primero)', () => {
        const items = [
            { id: 1, published_at: '2026-10-26T12:00:00Z' },
            { id: 2, published_at: '2026-10-02T12:00:00Z' },
            { id: 3, published_at: '2026-09-30T12:00:00Z' },
        ];
        const groups = groupByMonth(items, (s) => new Date(s));
        expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([[1, 2], [3]]);
        expect(groups[0]!.label).toBe('Octubre de 2026');
        expect(groups[1]!.label).toBe('Septiembre de 2026');
    });
});

describe('novedades: cuándo se presenta una destacada', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        delete document.body.dataset.tourActive;
    });

    it('espera si hay un diálogo, un menú, un recorrido o un campo con foco', () => {
        expect(screenIsBusy()).toBe(false);
        const cases: Array<[string, Record<string, string>]> = [
            ['div', { role: 'dialog' }],
            ['div', { role: 'menu', 'data-state': 'open' }],
            ['div', { 'data-help-overlay': '' }],
            ['div', { 'data-onboarding-active': '' }],
        ];
        for (const [tag, attrs] of cases) {
            const el = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
            document.body.appendChild(el);
            expect(screenIsBusy(), JSON.stringify(attrs)).toBe(true);
            el.remove();
        }
        // Un menú CERRADO no ocupa.
        const closed = document.createElement('div');
        closed.setAttribute('role', 'menu');
        closed.setAttribute('data-state', 'closed');
        document.body.appendChild(closed);
        expect(screenIsBusy()).toBe(false);

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        expect(screenIsBusy()).toBe(true);
        input.blur();
        document.body.dataset.tourActive = '1';
        expect(screenIsBusy()).toBe(true);
    });

    it('una por sesión y una cada 12 horas', () => {
        const session = memoryStorage();
        const local = memoryStorage();
        const now = Date.UTC(2026, 9, 26, 15);
        expect(canPresentNow(now, session, local)).toBe(true);
        rememberPresented(now, session, local);
        expect(canPresentNow(now + 1000, session, local)).toBe(false);
        // Otra pestaña (sesión nueva) dentro de las 12 h: tampoco.
        expect(canPresentNow(now + 60_000, memoryStorage(), local)).toBe(false);
        expect(canPresentNow(now + FEATURED_COOLDOWN_MS + 1, memoryStorage(), local)).toBe(true);
    });

    it('sin storage (modo privado) no se traba', () => {
        const broken = {
            getItem: () => {
                throw new Error('bloqueado');
            },
            setItem: () => {
                throw new Error('bloqueado');
            },
        };
        expect(canPresentNow(Date.now(), broken, broken)).toBe(true);
        expect(() => rememberPresented(Date.now(), broken, broken)).not.toThrow();
    });

    it('no se presenta en la propia página de novedades', () => {
        expect(isOnWhatsNewPage({ hash: '#/novedades', pathname: '/' })).toBe(true);
        expect(isOnWhatsNewPage({ hash: '#/novedades?x=1', pathname: '/' })).toBe(true);
        expect(isOnWhatsNewPage({ hash: '', pathname: '/novedades' })).toBe(true);
        expect(isOnWhatsNewPage({ hash: '#/lists', pathname: '/' })).toBe(false);
        expect(isOnWhatsNewPage({ hash: '#/novedades-viejas', pathname: '/' })).toBe(false);
    });
});

describe('novedades: estado del panel', () => {
    it('abre en una novedad y cierra', () => {
        const seen: boolean[] = [];
        const off = whatsNewPanel.subscribe(() => seen.push(whatsNewPanel.get().open));
        whatsNewPanel.open('v0.1.317-agentes-ia');
        expect(whatsNewPanel.get()).toEqual({ open: true, focus: 'v0.1.317-agentes-ia' });
        whatsNewPanel.close();
        whatsNewPanel.close(); // cerrar dos veces no avisa de nuevo
        expect(whatsNewPanel.get()).toEqual({ open: false, focus: null });
        expect(seen).toEqual([true, false]);
        off();
    });
});
