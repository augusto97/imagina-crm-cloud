import { describe, expect, it } from 'vitest';

import { PLATFORM_TABS, platformTabGroups } from '@/admin/platform/platformTabs';
import { settingsSectionGroups } from '@/cloud/settingsSections';

import { MOBILE_TAB_ROOT, isTabRoot, mobileTabFromPath } from './mobileNav';

/**
 * v0.1.342 — la navegación del celular: qué pestaña queda marcada en cada
 * pantalla, y Ajustes/Plataforma agrupados por tema (el índice táctil).
 */
describe('barra inferior del celular', () => {
    it('cada ruta marca su pestaña', () => {
        expect(mobileTabFromPath('/')).toBe('lists');
        expect(mobileTabFromPath('/lists')).toBe('lists');
        expect(mobileTabFromPath('/lists/clientes/records')).toBe('lists');
        expect(mobileTabFromPath('/lists/clientes/records/12')).toBe('lists');
        expect(mobileTabFromPath('/folders/3')).toBe('lists');
        expect(mobileTabFromPath('/my-work')).toBe('mywork');
        expect(mobileTabFromPath('/approvals/4')).toBe('mywork');
        expect(mobileTabFromPath('/avisos')).toBe('inbox');
        // Todo lo que se alcanza desde «Más» deja «Más» marcada.
        for (const p of ['/menu', '/favorites', '/dashboards/2', '/agents', '/learn', '/ideas', '/novedades', '/settings', '/platform']) {
            expect(mobileTabFromPath(p)).toBe('more');
        }
        // Un prefijo parecido no es la misma sección.
        expect(mobileTabFromPath('/listsx')).toBe('more');
        expect(mobileTabFromPath('/my-workspace')).toBe('more');
    });

    it('la raíz de cada pestaña es una ruta que la marca', () => {
        for (const [tab, root] of Object.entries(MOBILE_TAB_ROOT)) {
            expect(mobileTabFromPath(root)).toBe(tab);
            expect(isTabRoot(root, tab as keyof typeof MOBILE_TAB_ROOT)).toBe(true);
        }
        expect(isTabRoot('/', 'lists')).toBe(true);
        expect(isTabRoot('/lists/clientes/records', 'lists')).toBe(false);
        expect(isTabRoot('/settings', 'more')).toBe(false);
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
