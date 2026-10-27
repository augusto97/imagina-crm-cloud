import { describe, expect, it } from 'vitest';
import type { Capability, HelpConfigView, HelpGuide } from '@imagina-base/shared';

import { byCategory, guidesForScreens, resolveGuideRoute, searchGuides, visibleGuides, type GuideViewer } from './guideAccess';
import { linkKind } from './RichLite';

function guide(over: Partial<HelpGuide> & { id: string }): HelpGuide {
    return {
        title: `¿Cómo ${over.id}?`,
        category: 'lists',
        minutes: 1,
        body: '1. Paso',
        screens: [],
        related: [],
        ...over,
    };
}

const SYSTEM: HelpGuide[] = [
    guide({ id: 'importar', title: '¿Cómo importo un Excel o un CSV?', keywords: 'subir archivo hoja de calculo', requires: ['import_records'], if_restricted: 'hide', screens: ['records'] }),
    guide({ id: 'invitar', title: '¿Cómo invito a mi equipo?', category: 'team', admin_only: true, if_restricted: 'note', screens: ['settings:miembros'] }),
    guide({ id: 'vistas', title: '¿Cómo veo una lista como tablero?', category: 'views', screens: ['records'], body: 'Usa **+ Vista** para crear un kanban.' }),
    guide({ id: 'ajustes', title: '¿Qué hay en Ajustes?', category: 'account', screens: ['settings'] }),
];

const EMPTY: HelpConfigView = { support: { email: null, whatsapp: null, url: null, note: null }, videos: {}, hidden: [], custom: [] };

const viewer = (role: string, caps: Capability[]): GuideViewer => ({ role, isAdmin: role === 'admin', caps: new Set(caps) });

describe('qué guías ve cada persona', () => {
    it('admin: todas, sin marcas', () => {
        const v = visibleGuides(SYSTEM, EMPTY, viewer('admin', ['import_records']));
        expect(v.map((g) => g.guide.id)).toEqual(['importar', 'invitar', 'vistas', 'ajustes']);
        expect(v.every((g) => !g.restricted)).toBe(true);
    });

    it('lector: oculta lo que no puede hacer, marca «lo hace un administrador» lo que vale la pena saber', () => {
        const v = visibleGuides(SYSTEM, EMPTY, viewer('viewer', []));
        expect(v.map((g) => g.guide.id)).toEqual(['invitar', 'vistas', 'ajustes']);
        expect(v.find((g) => g.guide.id === 'invitar')!.restricted).toBe(true);
    });

    it('el operador oculta guías, les pega un video y suma las suyas (por rol)', () => {
        const cfg: HelpConfigView = {
            ...EMPTY,
            hidden: ['ajustes'],
            videos: { vistas: 'https://youtu.be/dQw4w9WgXcQ', importar: 'https://evil.example/x' },
            custom: [
                { id: 'op-todos01', title: '¿Para todos?', category: 'start', minutes: 1, body: 'x', video_url: 'https://vimeo.com/123456789', screens: [], roles: [] },
                { id: 'op-admin01', title: '¿Sólo admins?', category: 'team', minutes: 1, body: 'x', video_url: null, screens: [], roles: ['admin'] },
            ],
        };
        const v = visibleGuides(SYSTEM, cfg, viewer('agent', ['import_records']));
        expect(v.map((g) => g.guide.id)).toEqual(['importar', 'invitar', 'vistas', 'op-todos01']);
        expect(v.find((g) => g.guide.id === 'vistas')!.videoSrc).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
        // Un enlace que no es de YouTube/Vimeo/Loom nunca llega a un iframe.
        expect(v.find((g) => g.guide.id === 'importar')!.videoSrc).toBeNull();
        expect(v.find((g) => g.guide.id === 'op-todos01')!.videoSrc).toContain('player.vimeo.com');
        expect(v.find((g) => g.guide.id === 'op-todos01')!.guide.source).toBe('custom');
    });
});

describe('buscador de la ayuda', () => {
    const all = visibleGuides(SYSTEM, EMPTY, viewer('admin', ['import_records']));

    it('sin acentos, por palabras y sin palabras vacías («cómo», «un»)', () => {
        expect(searchGuides(all, 'cómo IMPORTO un excel').map((g) => g.guide.id)).toEqual(['importar']);
        expect(searchGuides(all, 'hoja calculo').map((g) => g.guide.id)).toEqual(['importar']);
        expect(searchGuides(all, 'kanban').map((g) => g.guide.id)).toEqual(['vistas']);
        expect(searchGuides(all, 'nada que ver')).toEqual([]);
    });

    it('encuentra la misma palabra conjugada o en plural', () => {
        expect(searchGuides(all, '¿cómo importar?').map((g) => g.guide.id)).toEqual(['importar']);
        expect(searchGuides(all, 'invitación').map((g) => g.guide.id)).toEqual(['invitar']);
        expect(searchGuides(all, 'tableros').map((g) => g.guide.id)).toEqual(['vistas']);
    });

    it('lo que coincide en el título va antes que lo que coincide en el texto', () => {
        const res = searchGuides(all, 'tablero');
        expect(res[0]!.guide.id).toBe('vistas');
    });
});

describe('«En esta pantalla»', () => {
    const all = visibleGuides(SYSTEM, EMPTY, viewer('admin', ['import_records']));

    it('primero la sección puntual, después la pantalla', () => {
        expect(guidesForScreens(all, ['settings', 'settings:miembros']).map((g) => g.guide.id)).toEqual(['invitar', 'ajustes']);
        expect(guidesForScreens(all, ['records']).map((g) => g.guide.id)).toEqual(['importar', 'vistas']);
        expect(guidesForScreens(all, [])).toEqual([]);
    });

    it('las guías propias del operador para esa pantalla van primero', () => {
        const cfg: HelpConfigView = {
            ...EMPTY,
            custom: [{ id: 'op-soporte1', title: '¿Cómo pido soporte?', category: 'start', minutes: 1, body: 'x', video_url: null, screens: ['records'], roles: [] }],
        };
        const withCustom = visibleGuides(SYSTEM, cfg, viewer('admin', ['import_records']));
        expect(guidesForScreens(withCustom, ['records'])[0]!.guide.id).toBe('op-soporte1');
    });

    it('por categoría, en el orden del catálogo', () => {
        expect(byCategory(all).map((c) => c.id)).toEqual(['lists', 'views', 'team', 'account']);
    });
});

describe('«Ir ahí» y enlaces de las guías', () => {
    it('{list} se reemplaza por una lista que la persona ve; sin ninguna, el índice', () => {
        expect(resolveGuideRoute('/lists/{list}/edit?s=permisos', 'clientes')).toBe('/lists/clientes/edit?s=permisos');
        expect(resolveGuideRoute('/lists/{list}/records', null)).toBe('/lists');
        expect(resolveGuideRoute('/settings?s=marca', null)).toBe('/settings?s=marca');
    });

    it('sólo https, mailto o una pantalla de la app', () => {
        expect(linkKind('https://ayuda.acme.co')).toBe('external');
        expect(linkKind('mailto:soporte@acme.co')).toBe('mail');
        expect(linkKind('/settings?s=miembros')).toBe('internal');
        expect(linkKind('javascript:alert(1)')).toBeNull();
        expect(linkKind('http://inseguro.co')).toBeNull();
        expect(linkKind('//otro-sitio.com')).toBeNull();
    });
});
