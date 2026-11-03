import { describe, expect, it } from 'vitest';
import { Bell, List } from 'lucide-react';
import { MOBILE_NAV_DEFAULT_ITEMS, type MobileNavSection } from '@imagina-base/shared';

import { PLATFORM_TABS, platformTabGroups } from '@/admin/platform/platformTabs';
import { settingsSectionGroups } from '@/cloud/settingsSections';

import {
    MORE_TAB,
    activeMobileTab,
    isTabRoot,
    moveItem,
    resolveMobileTabs,
    withItemCount,
    type MobileNavContext,
    type MobileNavEntity,
} from './mobileNav';

const all = (): boolean => true;
const defaults = { items: [...MOBILE_NAV_DEFAULT_ITEMS], labels: true };

function ctxWith(over: Partial<MobileNavContext> = {}, off: MobileNavSection[] = []): MobileNavContext {
    return { available: (s) => !off.includes(s), ...over };
}

const listEntity = (slug: string, name: string): MobileNavEntity => ({ name, to: `/lists/${slug}/records`, prefix: `/lists/${slug}`, icon: List });
const dashEntity = (id: number, name: string): MobileNavEntity => ({ name, to: `/dashboards/${id}`, prefix: `/dashboards/${id}`, icon: Bell });

/**
 * v0.1.342 — la navegación del celular; v0.1.347 — la barra personalizable:
 * qué botones se dibujan según lo que la persona puede usar y qué pestaña
 * queda marcada en cada pantalla.
 */
describe('barra inferior del celular', () => {
    const tabs = resolveMobileTabs(defaults, ctxWith());

    it('la de siempre: Listas · Mi trabajo · Buscar · Avisos (+ Más)', () => {
        expect(tabs.map((t) => t.key)).toEqual(['lists', 'mywork', 'search', 'inbox']);
        // Sin avisos (módulo apagado), Favoritos toma su lugar.
        expect(resolveMobileTabs(defaults, ctxWith({}, ['inbox'])).map((t) => t.key)).toEqual(['lists', 'mywork', 'search', 'favorites']);
    });

    it('cada ruta marca su pestaña', () => {
        expect(activeMobileTab('/', tabs)).toBe('lists');
        expect(activeMobileTab('/lists', tabs)).toBe('lists');
        expect(activeMobileTab('/lists/clientes/records', tabs)).toBe('lists');
        expect(activeMobileTab('/lists/clientes/records/12', tabs)).toBe('lists');
        expect(activeMobileTab('/folders/3', tabs)).toBe('lists');
        expect(activeMobileTab('/my-work', tabs)).toBe('mywork');
        expect(activeMobileTab('/approvals/4', tabs)).toBe('mywork');
        expect(activeMobileTab('/avisos', tabs)).toBe('inbox');
        // Todo lo que se alcanza desde «Más» deja «Más» marcada.
        for (const p of ['/menu', '/menu/barra', '/favorites', '/dashboards/2', '/agents', '/aprende', '/ideas', '/novedades', '/settings', '/platform']) {
            expect(activeMobileTab(p, tabs)).toBe(MORE_TAB.key);
        }
        // Un prefijo parecido no es la misma sección.
        expect(activeMobileTab('/listsx', tabs)).toBe(MORE_TAB.key);
        expect(activeMobileTab('/my-workspace', tabs)).toBe(MORE_TAB.key);
    });

    it('tocar la pestaña en su inicio sube al principio', () => {
        for (const t of tabs.filter((x) => x.to)) {
            expect(activeMobileTab(t.to!, tabs)).toBe(t.key);
            expect(isTabRoot(t.to!, t)).toBe(true);
        }
        expect(isTabRoot('/', tabs[0]!)).toBe(true);
        expect(isTabRoot('/lists/clientes/records', tabs[0]!)).toBe(false);
        expect(isTabRoot('/menu', MORE_TAB)).toBe(true);
    });

    it('una barra propia: secciones, una lista y un tablero puntuales', () => {
        const config = { items: ['dashboards', 'list:5', 'dashboard:2', 'search', 'lists'], labels: false };
        const ctx = ctxWith({
            lists: new Map([[5, listEntity('ventas', 'Ventas')]]),
            dashboards: new Map([[2, dashEntity(2, 'Cartera')]]),
        });
        const mine = resolveMobileTabs(config, ctx);
        expect(mine.map((t) => [t.key, t.label])).toEqual([
            ['dashboards', 'Tableros'],
            ['list:5', 'Ventas'],
            ['dashboard:2', 'Cartera'],
            ['search', 'Buscar'],
            ['lists', 'Listas'],
        ]);
        // La ruta más específica gana: la lista puntual a «Listas», el tablero puntual a «Tableros».
        expect(activeMobileTab('/lists/ventas/records/9', mine)).toBe('list:5');
        expect(activeMobileTab('/lists/otra/records', mine)).toBe('lists');
        expect(activeMobileTab('/dashboards/2', mine)).toBe('dashboard:2');
        expect(activeMobileTab('/dashboards/7', mine)).toBe('dashboards');
        expect(activeMobileTab('/dashboards', mine)).toBe('dashboards');
        // Sin «Mi trabajo» en la barra, se llega desde «Más».
        expect(activeMobileTab('/my-work', mine)).toBe(MORE_TAB.key);
    });

    it('lo que ya no se puede usar se saltea y la barra nunca queda con menos de dos', () => {
        const config = { items: ['dashboards', 'dashboard:2', 'list:99', 'platform'], labels: true };
        // Sin tableros (permiso o plan), sin plataforma (no es operador) y la lista 99 ya no existe.
        const ctx = ctxWith({ lists: new Map(), dashboards: new Map() }, ['dashboards', 'platform']);
        expect(resolveMobileTabs(config, ctx).map((t) => t.key)).toEqual(['lists', 'mywork']);
        // Mientras cargan las listas, el botón queda en su lugar (sin saltos).
        const pending = resolveMobileTabs({ items: ['list:5', 'search'], labels: true }, ctxWith());
        expect(pending.map((t) => [t.key, t.pending === true])).toEqual([
            ['list:5', true],
            ['search', false],
        ]);
    });

    it('elegir la cantidad: achicar quita del final, agrandar suma lo que falta', () => {
        const items = ['lists', 'mywork', 'search', 'inbox'];
        expect(withItemCount(items, 3, all)).toEqual(['lists', 'mywork']);
        expect(withItemCount(items, 6, all)).toEqual(['lists', 'mywork', 'search', 'inbox', 'dashboards']);
        // Lo que la persona no puede usar no se suma.
        expect(withItemCount(['lists', 'search'], 5, (s) => s !== 'mywork' && s !== 'inbox')).toEqual(['lists', 'search', 'dashboards', 'favorites']);
        // Nunca menos de 2 ni más de 5 (sin contar «Más»).
        expect(withItemCount(items, 1, all)).toHaveLength(2);
        expect(withItemCount(items, 9, all)).toHaveLength(5);
    });

    it('ordenar: subir y bajar un botón', () => {
        expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
        expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
        expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
        expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    });
});

describe('Ajustes por tema', () => {
    it('un admin ve los seis temas en orden y cada sección una sola vez', () => {
        const groups = settingsSectionGroups({ isAdmin: true });
        expect(groups.map((g) => g.label)).toEqual(['Empresa', 'Personas', 'Conexiones', 'Clientes', 'Mantenimiento', 'Cuenta']);
        const ids = groups.flatMap((g) => g.items.map((i) => i.id));
        expect(new Set(ids).size).toBe(ids.length);
        // Cada sección dice para qué sirve (es el renglón del índice táctil).
        expect(groups.flatMap((g) => g.items).every((i) => i.hint.length > 5)).toBe(true);
    });

    it('un agente sólo ve temas con algo adentro', () => {
        const groups = settingsSectionGroups({ isAdmin: false });
        expect(groups.map((g) => g.label)).toEqual(['Mantenimiento', 'Cuenta']);
    });

    it('un invitado sólo ve su cuenta', () => {
        const groups = settingsSectionGroups({ isAdmin: false, isGuest: true });
        expect(groups.map((g) => g.label)).toEqual(['Cuenta']);
        expect(groups[0]?.items.map((i) => i.id)).not.toContain('firma');
    });
});

describe('Plataforma por tema', () => {
    it('las tres secciones cubren todas las pestañas, sin repetir', () => {
        const groups = platformTabGroups();
        expect(groups.map((g) => g.label)).toEqual(['Clientes', 'La app', 'Servidor']);
        const ids = groups.flatMap((g) => g.items.map((t) => t.id));
        expect(ids.sort()).toEqual(PLATFORM_TABS.map((t) => t.id).sort());
        expect(groups.every((g) => g.items.length > 0)).toBe(true);
    });
});
