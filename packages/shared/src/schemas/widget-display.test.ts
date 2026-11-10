import { describe, expect, it } from 'vitest';

import {
    summarizeWidgetStats,
    widgetDeviceOk,
    widgetGreetingFor,
    widgetRate,
    widgetRevealState,
    widgetShownOnPage,
    widgetStatFields,
    type PublicWidgetDisplay,
} from './widget-display';

const all: PublicWidgetDisplay = { pages: 'all', page_terms: '', devices: 'all', delay_s: 0, scroll_pct: 0 };

describe('widget — dónde y cuándo aparece (v0.1.396)', () => {
    it('páginas: sólo las que contienen / todas menos (sin mayúsculas ni tildes)', () => {
        const only = { pages: 'only' as const, page_terms: 'planes, Cotización' };
        expect(widgetShownOnPage(only, 'https://acme.co/planes/pro')).toBe(true);
        expect(widgetShownOnPage(only, 'https://acme.co/cotizacion')).toBe(true);
        expect(widgetShownOnPage(only, 'https://acme.co/blog')).toBe(false);
        const except = { pages: 'except' as const, page_terms: 'checkout' };
        expect(widgetShownOnPage(except, 'https://acme.co/checkout/pago')).toBe(false);
        expect(widgetShownOnPage(except, 'https://acme.co/')).toBe(true);
        // Sin palabras, la regla no recorta nada.
        expect(widgetShownOnPage({ pages: 'only', page_terms: ' ' }, 'https://acme.co/blog')).toBe(true);
    });

    it('dispositivos: celular por debajo de 640 px; sin ancho conocido, se muestra', () => {
        expect(widgetDeviceOk({ devices: 'mobile' }, 390)).toBe(true);
        expect(widgetDeviceOk({ devices: 'mobile' }, 1280)).toBe(false);
        expect(widgetDeviceOk({ devices: 'desktop' }, 390)).toBe(false);
        expect(widgetDeviceOk({ devices: 'desktop' }, 0)).toBe(true);
    });

    it('demora y scroll: cuánto falta y si todavía falta bajar', () => {
        const d = { ...all, delay_s: 10, scroll_pct: 40 };
        expect(widgetRevealState(d, { url: '/', width: 1200, since: 3000, scroll: 0 })).toEqual({ shown: false, wait: 7000, needsScroll: true });
        expect(widgetRevealState(d, { url: '/', width: 1200, since: 12000, scroll: 10 })).toEqual({ shown: false, wait: null, needsScroll: true });
        expect(widgetRevealState(d, { url: '/', width: 1200, since: 12000, scroll: 45 })).toEqual({ shown: true, wait: null, needsScroll: false });
        expect(widgetRevealState(all, { url: '/', width: 1200 })).toEqual({ shown: true, wait: null, needsScroll: false });
        // Sin el dato del scroll (un embed.js anterior) no se queda esperando.
        expect(widgetRevealState({ ...all, scroll_pct: 40 }, { url: '/', width: 1200 }).shown).toBe(true);
        // Fuera de las páginas elegidas no aparece nunca (ni espera).
        expect(widgetRevealState({ ...d, pages: 'only', page_terms: 'planes' }, { url: '/blog', width: 1200, since: 0 })).toEqual({
            shown: false,
            wait: null,
            needsScroll: false,
        });
    });

    it('saludo: el de la página gana; en el celular sólo si se pidió', () => {
        const g = { text: '¿Te ayudamos?', rules: [{ contains: 'planes', text: '¿Dudas con los planes?' }], delay_s: 5, mobile: false };
        expect(widgetGreetingFor(g, 'https://acme.co/planes', 1200)).toBe('¿Dudas con los planes?');
        expect(widgetGreetingFor(g, 'https://acme.co/', 1200)).toBe('¿Te ayudamos?');
        expect(widgetGreetingFor(g, 'https://acme.co/', 390)).toBeNull();
        expect(widgetGreetingFor({ ...g, mobile: true }, 'https://acme.co/', 390)).toBe('¿Te ayudamos?');
        // Sin saludo general, sólo saluda en las páginas que tienen el suyo.
        expect(widgetGreetingFor({ ...g, text: '' }, 'https://acme.co/', 1200)).toBeNull();
        expect(widgetGreetingFor(null, 'https://acme.co/', 1200)).toBeNull();
    });
});

describe('widget — estadísticas por botón (v0.1.396)', () => {
    it('cada evento suma lo suyo; un botón con un id raro no suma', () => {
        expect(widgetStatFields({ kind: 'view', dev: 'mobile' })).toEqual(['v', 'dev:m']);
        expect(widgetStatFields({ kind: 'view' })).toEqual(['v', 'dev:d']);
        expect(widgetStatFields({ kind: 'click', button: 'wa1' })).toEqual(['c:wa1']);
        expect(widgetStatFields({ kind: 'click', button: '../x' })).toEqual([]);
        expect(widgetStatFields({ kind: 'open' })).toEqual(['o']);
        expect(widgetStatFields({ kind: 'lead', button: 'f1' })).toEqual(['l:f1']);
    });

    it('el resumen junta los días, los botones y los registros', () => {
        const s = summarizeWidgetStats(
            [
                { day: '2026-11-01', counts: { v: 10, o: 4, 'c:wa': 3, 'l:wa': 2, 'dev:m': 6, 'dev:d': 4, g: 5, gc: 1 } },
                { day: '2026-11-03', counts: { v: 5, o: 1, 'c:form': 1, 'l:form': 1, 'dev:d': 5 } },
                { day: '2026-11-03', counts: { v: 1 } },
            ],
            { from: '2026-11-01', to: '2026-11-03' },
        );
        expect(s).toMatchObject({ views: 16, opens: 5, clicks: 4, leads: 3, greetings: 5, greeting_clicks: 1, mobile: 6, desktop: 9 });
        expect(s.days.map((d) => d.views)).toEqual([10, 0, 6]);
        expect(s.buttons).toEqual([
            { id: 'wa', clicks: 3, leads: 2 },
            { id: 'form', clicks: 1, leads: 1 },
        ]);
        expect(widgetRate(5, 16)).toBe('31,3 %');
        expect(widgetRate(1, 0)).toBe('—');
    });
});
