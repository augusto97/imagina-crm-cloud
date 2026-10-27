import { describe, expect, it } from 'vitest';

import { holeBox, isFullyVisible, mobileCardEdge, placeBalloon } from './geometry';
import { buildRun, fillAppName, resolveSteps, routeMatches, stepProgress, touchWording } from './resolve';
import { tourStore } from './tourStore';
import type { ResolvedStep, TourContext, TourDef } from './tourTypes';

const VIEW = { width: 1280, height: 800 };
const BALLOON = { width: 340, height: 190 };

describe('geometría del recorrido', () => {
    it('el recorte agrega aire y no se sale de la ventana', () => {
        expect(holeBox({ top: 100, left: 200, width: 80, height: 30 }, VIEW)).toEqual({ top: 94, left: 194, width: 92, height: 42 });
        const tall = holeBox({ top: -50, left: -10, width: 400, height: 2000 }, VIEW);
        expect(tall.top).toBe(0);
        expect(tall.left).toBe(0);
        expect(tall.top + tall.height).toBeLessThanOrEqual(VIEW.height);
    });

    it('respeta la ubicación preferida si entra', () => {
        const hole = { top: 300, left: 80, width: 60, height: 40 };
        const right = placeBalloon(hole, BALLOON, VIEW, 'right');
        expect(right.placement).toBe('right');
        expect(right.left).toBe(hole.left + hole.width + 12);
    });

    it('si la preferida no entra, prueba otra sin taparse con el elemento', () => {
        // Botón pegado arriba a la derecha: abajo es lo natural.
        const hole = { top: 4, left: 1200, width: 40, height: 32 };
        const pos = placeBalloon(hole, BALLOON, VIEW, 'top');
        expect(pos.placement).toBe('bottom');
        expect(pos.top).toBeGreaterThanOrEqual(hole.top + hole.height);
        // Nunca fuera de la pantalla.
        expect(pos.left + BALLOON.width).toBeLessThanOrEqual(VIEW.width - 12);
    });

    it('un elemento enorme deja el globo dentro de la pantalla', () => {
        const pos = placeBalloon({ top: 0, left: 0, width: 1280, height: 800 }, BALLOON, VIEW);
        expect(pos.top).toBeGreaterThanOrEqual(12);
        expect(pos.left).toBeGreaterThanOrEqual(12);
        expect(pos.top + BALLOON.height).toBeLessThanOrEqual(VIEW.height - 12);
    });

    it('sin elemento, centrado', () => {
        const pos = placeBalloon(null, BALLOON, VIEW);
        expect(pos.placement).toBe('center');
        expect(pos.left).toBe((VIEW.width - BALLOON.width) / 2);
    });

    it('en el celular la tarjeta va abajo salvo que el elemento esté abajo', () => {
        const phone = { width: 390, height: 844 };
        expect(mobileCardEdge(null, phone)).toBe('bottom');
        expect(mobileCardEdge({ top: 10, left: 0, width: 40, height: 40 }, phone)).toBe('bottom');
        expect(mobileCardEdge({ top: 700, left: 0, width: 40, height: 40 }, phone)).toBe('top');
    });

    it('detecta si hay que llevar el elemento a la vista', () => {
        expect(isFullyVisible({ top: 100, left: 0, width: 50, height: 50 }, VIEW)).toBe(true);
        expect(isFullyVisible({ top: 900, left: 0, width: 50, height: 50 }, VIEW)).toBe(false);
        expect(isFullyVisible({ top: -40, left: 0, width: 50, height: 50 }, VIEW)).toBe(false);
    });
});

function ctx(over: Partial<TourContext> = {}): TourContext {
    return {
        can: () => true,
        role: 'admin',
        isAdmin: true,
        isSuperadmin: false,
        isMobile: false,
        firstList: { slug: 'clientes', name: 'Clientes' },
        listCount: 1,
        appName: 'Acme CRM',
        canInstall: false,
        ...over,
    };
}

const DEF: TourDef = {
    id: 'prueba',
    title: 'Prueba',
    description: 'Qué muestra {app}',
    cover: 'pp-piezas',
    minutes: 2,
    category: 'start',
    learn: 'primeros-pasos/primeros-pasos-piezas',
    next: ['otro'],
    available: () => true,
    steps: [
        { id: 'intro', title: 'Hola', body: 'Bienvenida a {app}' },
        { id: 'rail', target: 'rail-lists', route: '/lists', title: 'Riel', body: 'x', mobile: { target: 'topbar-menu', body: 'menú' } },
        { id: 'panel', target: 'panel-lists', title: 'Panel', body: 'x', mobile: 'skip' },
        { id: 'admin', target: 'rail-settings', title: 'Ajustes', body: 'x', when: (c) => c.isAdmin },
        { id: 'records', target: 'records-new', route: (c) => (c.firstList ? `/lists/${c.firstList.slug}/records` : null), title: 'R', body: 'x', advanceOn: 'click' },
        { id: 'desk', title: 'Atajos', body: 'x', device: 'desktop' },
        { id: 'center-click', title: 'Sin elemento', body: 'x', advanceOn: 'click' },
    ],
};

describe('pasos de un recorrido para cada persona', () => {
    it('escritorio y admin: todos los pasos, con el nombre de la app', () => {
        const steps = resolveSteps(DEF, ctx());
        expect(steps.map((s) => s.id)).toEqual(['intro', 'rail', 'panel', 'admin', 'records', 'desk', 'center-click']);
        expect(steps[0]!.body).toBe('Bienvenida a Acme CRM');
        expect(steps[4]!.route).toBe('/lists/clientes/records');
        expect(steps[4]!.advanceOn).toBe('click');
        // Sin elemento no hay nada que clicar: se avanza con «Siguiente».
        expect(steps[6]!.advanceOn).toBe('next');
        // Con ruta se espera más (la pantalla nueva tiene que cargar).
        expect(steps[1]!.waitMs).toBeGreaterThan(steps[2]!.waitMs);
    });

    it('rol sin permisos y sin listas: se omiten los pasos que no aplican', () => {
        const steps = resolveSteps(DEF, ctx({ isAdmin: false, firstList: null }));
        expect(steps.map((s) => s.id)).toEqual(['intro', 'rail', 'panel', 'desk', 'center-click']);
    });

    it('celular: la versión móvil del paso u omitirlo', () => {
        const steps = resolveSteps(DEF, ctx({ isMobile: true }));
        expect(steps.map((s) => s.id)).toEqual(['intro', 'rail', 'admin', 'records', 'center-click']);
        expect(steps[1]!.target).toBe('topbar-menu');
        expect(steps[1]!.body).toBe('menú');
    });

    it('en pantallas táctiles se «toca», no se «hace clic»', () => {
        expect(touchWording('Haz clic en el nombre de un registro.')).toBe('Toca el nombre de un registro.');
        expect(touchWording('Abre la ficha: haz clic para cambiarlo.')).toBe('Abre la ficha: toca para cambiarlo.');
        const def: TourDef = { ...DEF, steps: [{ id: 'x', target: 'records-row', title: 'T', body: 'Haz clic en una fila.' }] };
        expect(resolveSteps(def, ctx({ isMobile: true }))[0]!.body).toBe('Toca una fila.');
        expect(resolveSteps(def, ctx())[0]!.body).toBe('Haz clic en una fila.');
    });

    it('nombre de la app en cualquier texto', () => {
        expect(fillAppName('Usa {app} y {app}', 'X')).toBe('Usa X y X');
    });
});

describe('¿ya estoy en la pantalla del paso?', () => {
    it('misma ruta; los parámetros extra de la ubicación no obligan a navegar', () => {
        expect(routeMatches('/lists/a/records', '/lists/a/records', '?view=3')).toBe(true);
        expect(routeMatches('/lists/a/records', '/lists/a/records/', '')).toBe(true);
        expect(routeMatches('/lists/a/records', '/lists/b/records', '')).toBe(false);
    });

    it('los parámetros que pide el paso tienen que estar con ese valor', () => {
        expect(routeMatches('/settings?s=miembros', '/settings', '?s=miembros')).toBe(true);
        expect(routeMatches('/settings?s=miembros', '/settings', '?s=marca')).toBe(false);
        expect(routeMatches('/settings?s=miembros', '/settings', '')).toBe(false);
    });
});

describe('un paso cuyo elemento no aparece', () => {
    const step = (id: string): ResolvedStep => ({ kind: 'step', id, target: id, route: null, title: id, body: id, advanceOn: 'next', waitFor: null, art: null, tip: null, waitMs: 1 });
    const meta = { description: '', cover: 'x', minutes: 1, outcomes: [], learn: null, next: [] };

    it('sale del recorrido, el total se recalcula y se sigue hacia adelante', () => {
        tourStore.start({ tourId: 't', title: 'T', meta, steps: ['a', 'b', 'c', 'd'].map(step) });
        tourStore.goto(1, 1);
        expect(tourStore.drop(1, 1)).toBe(true);
        const r = tourStore.get()!;
        expect(r.steps.map((s) => s.id)).toEqual(['a', 'c', 'd']);
        expect(r.steps[r.index]!.id).toBe('c');
        tourStore.stop();
    });

    it('hacia atrás vuelve al anterior; sin nada hacia adelante, el recorrido termina', () => {
        tourStore.start({ tourId: 't', title: 'T', meta, steps: ['a', 'b', 'c'].map(step) });
        tourStore.goto(1, -1);
        expect(tourStore.drop(1, -1)).toBe(true);
        expect(tourStore.get()!.steps[tourStore.get()!.index]!.id).toBe('a');
        tourStore.goto(1, 1);
        expect(tourStore.drop(1, 1)).toBe(false);
        tourStore.stop();
        expect(tourStore.get()).toBeNull();
    });
});

describe('portada y cierre', () => {
    it('la corrida empieza con la portada y termina con el cierre; el progreso no los cuenta', () => {
        const { steps, meta } = buildRun(DEF, ctx());
        expect(steps[0]!.kind).toBe('intro');
        expect(steps.at(-1)!.kind).toBe('outro');
        expect(steps.filter((s) => s.kind === 'step').length).toBe(resolveSteps(DEF, ctx()).length);
        expect(stepProgress(steps, 0)).toEqual({ current: 0, total: 7 });
        expect(stepProgress(steps, 3)).toEqual({ current: 3, total: 7 });
        expect(meta.outcomes[0]).toBe('Hola');
        expect(meta.description).toBe('Qué muestra Acme CRM');
        expect(meta.learn).toBe('primeros-pasos/primeros-pasos-piezas');
    });

    it('quien ya aceptó el ofrecimiento entra directo al primer paso', () => {
        const { steps } = buildRun(DEF, ctx(), { skipIntro: true });
        expect(steps[0]!.kind).toBe('step');
        expect(steps.at(-1)!.kind).toBe('outro');
    });

    it('los pasos de «aparece» llevan lo que esperan; un paso sin elemento siempre avanza con Siguiente', () => {
        const def: TourDef = {
            ...DEF,
            steps: [
                { id: 'a', target: 'records-row', advanceOn: 'appear', waitFor: 'record-title', title: 'a', body: 'a', art: 'ficha-abrir', tip: 'Haz clic en el nombre.' },
                { id: 'b', advanceOn: 'input', title: 'b', body: 'b' },
            ],
        };
        const [a, b] = resolveSteps(def, ctx({ isMobile: true }));
        expect(a).toMatchObject({ advanceOn: 'appear', waitFor: 'record-title', art: 'ficha-abrir', tip: 'Toca el nombre.' });
        expect(b).toMatchObject({ advanceOn: 'next', waitFor: null });
    });

    it('el cierre recuerda lo que se vio (sin la portada)', () => {
        const { steps, meta } = buildRun(DEF, ctx());
        tourStore.start({ tourId: 'p', title: 'P', meta, steps });
        tourStore.markShown();
        expect(tourStore.get()!.shown).toBe(0);
        tourStore.goto(1, 1);
        tourStore.markShown();
        tourStore.goto(2, 1);
        tourStore.markShown();
        expect(tourStore.get()!.seen).toEqual(['Hola', 'Riel']);
        tourStore.stop();
    });
});

describe('¿se ve lo suficiente para señalarlo?', () => {
    it('entero, o con el borde de arriba a la vista si es más alto que la pantalla', async () => {
        const { wellInView } = await import('./geometry');
        expect(wellInView({ top: 100, left: 0, width: 50, height: 50 }, VIEW)).toBe(true);
        expect(wellInView({ top: 900, left: 0, width: 50, height: 50 }, VIEW)).toBe(false);
        expect(wellInView({ top: 60, left: 0, width: 400, height: 1200 }, VIEW)).toBe(true);
        expect(wellInView({ top: 500, left: 0, width: 400, height: 1200 }, VIEW)).toBe(false);
    });
});
