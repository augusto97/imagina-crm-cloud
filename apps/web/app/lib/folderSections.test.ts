import { describe, expect, it } from 'vitest';

import type { ListGroup } from '@/types/list';

import { favoriteSections } from './favoriteSections';
import { foldText, matchesListQuery, sectionsByFolder } from './folderSections';

const g = (id: number, position: number, name = `G${id}`): ListGroup => ({ id, name, position, icon: null, color: null });
const l = (id: number, group_id: number | null) => ({ id, group_id, name: `L${id}`, slug: `l${id}`, description: null });

describe('sectionsByFolder', () => {
    it('ordena por position, omite carpetas vacías y deja "sin carpeta" al final', () => {
        const groups = [g(1, 2), g(2, 1), g(3, 0)];
        const s = sectionsByFolder([l(10, 1), l(11, null), l(12, 2), l(13, 1)], groups);
        expect(s.map((x) => x.group?.id ?? null)).toEqual([2, 1, null]);
        expect(s[1]!.items.map((x) => x.id)).toEqual([10, 13]);
    });

    it('una carpeta desconocida cae a "sin carpeta" en vez de desaparecer', () => {
        const s = sectionsByFolder([l(1, 99)], [g(1, 0)]);
        expect(s).toHaveLength(1);
        expect(s[0]!.group).toBeNull();
        expect(s[0]!.items[0]!.id).toBe(1);
    });
});

describe('matchesListQuery', () => {
    it('busca sin acentos por nombre, slug, descripción y carpeta', () => {
        const list = { name: 'Facturación', slug: 'facturas', description: 'Cobros del mes' };
        expect(matchesListQuery(list, 'facturacion')).toBe(true);
        expect(matchesListQuery(list, 'COBROS')).toBe(true);
        expect(matchesListQuery(list, 'ventas', 'Ventas y clientes')).toBe(true);
        expect(matchesListQuery(list, 'ventas')).toBe(false);
        expect(matchesListQuery(list, '   ')).toBe(true);
        expect(foldText('Ñandú')).toBe('nandu');
    });
});

describe('favoriteSections', () => {
    const groups = [g(1, 0, 'Clientes'), g(2, 1, 'Tienda')];
    const lists = [l(1, 2), l(2, null), l(3, 1), l(4, 1)];
    const dashboards = [{ id: 7 }, { id: 8 }];
    const favs = { lists: [4, 1, 2, 999], dashboards: [8] };

    it('por carpeta: carpetas en orden del menú, sin carpeta y dashboards al final', () => {
        const s = favoriteSections(favs, lists, dashboards, groups, 'folders');
        expect(s.map((x) => x.key)).toEqual(['g-1', 'g-2', 'root', 'dashboards']);
        expect(s[0]!.lists.map((x) => x.id)).toEqual([4]);
        expect(s[3]!.dashboards.map((x) => x.id)).toEqual([8]);
    });

    it('por tipo: listas en el orden en que se anclaron, y los ids borrados se descartan', () => {
        const s = favoriteSections(favs, lists, dashboards, groups, 'type');
        expect(s.map((x) => x.kind)).toEqual(['lists', 'dashboards']);
        expect(s[0]!.lists.map((x) => x.id)).toEqual([4, 1, 2]);
    });

    it('sin nada anclado no hay secciones', () => {
        expect(favoriteSections({ lists: [], dashboards: [] }, lists, dashboards, groups, 'folders')).toEqual([]);
    });
});
