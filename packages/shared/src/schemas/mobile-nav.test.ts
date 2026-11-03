import { describe, expect, it } from 'vitest';

import {
    MOBILE_NAV_DEFAULT_ITEMS,
    MOBILE_NAV_MAX_ITEMS,
    MOBILE_NAV_SECTIONS,
    effectiveMobileNav,
    mobileNavConfigSchema,
    mobileNavItemKey,
    parseMobileNavItem,
    readMobileNavConfig,
} from './mobile-nav';

describe('barra de abajo personalizable (v0.1.347)', () => {
    it('reconoce secciones, listas y tableros por ID', () => {
        for (const s of MOBILE_NAV_SECTIONS) expect(parseMobileNavItem(s)).toEqual({ kind: 'section', section: s });
        expect(parseMobileNavItem('list:12')).toEqual({ kind: 'list', id: 12 });
        expect(parseMobileNavItem('dashboard:3')).toEqual({ kind: 'dashboard', id: 3 });
        for (const bad of ['more', 'list:0', 'list:-1', 'list:abc', 'dashboard:', 'view:2', 'LISTS', '', 12, null]) {
            expect(parseMobileNavItem(bad)).toBeNull();
        }
        expect(mobileNavItemKey({ kind: 'list', id: 7 })).toBe('list:7');
        expect(mobileNavItemKey({ kind: 'section', section: 'dashboards' })).toBe('dashboards');
    });

    it('«Más» no se elige: va siempre; de 2 a 5 botones, sin repetir', () => {
        expect(mobileNavConfigSchema.safeParse({ items: ['lists', 'more'] }).success).toBe(false);
        expect(mobileNavConfigSchema.safeParse({ items: ['lists'] }).success).toBe(false);
        expect(mobileNavConfigSchema.safeParse({ items: ['lists', 'lists'] }).success).toBe(false);
        const six = ['lists', 'mywork', 'search', 'inbox', 'dashboards', 'favorites'];
        expect(six.length).toBeGreaterThan(MOBILE_NAV_MAX_ITEMS);
        expect(mobileNavConfigSchema.safeParse({ items: six }).success).toBe(false);
        const ok = mobileNavConfigSchema.parse({ items: ['lists', 'dashboards', 'list:4'] });
        expect(ok.labels).toBe(true);
    });

    it('lo guardado se lee con tolerancia y manda la propia, después la del equipo', () => {
        expect(readMobileNavConfig({ items: ['nada'] })).toBeNull();
        expect(readMobileNavConfig('x')).toBeNull();
        const team = { items: ['lists', 'dashboards'], labels: true };
        const own = { items: ['dashboards', 'search', 'scan'], labels: false };
        expect(effectiveMobileNav({ own, team })).toEqual({ config: own, source: 'own' });
        expect(effectiveMobileNav({ own: null, team })).toEqual({ config: team, source: 'team' });
        const def = effectiveMobileNav(null);
        expect(def.source).toBe('default');
        expect(def.config.items).toEqual([...MOBILE_NAV_DEFAULT_ITEMS]);
    });
});
