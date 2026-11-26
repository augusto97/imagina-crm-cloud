// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
    designRecordHref,
    hasOwnDesign,
    layoutHasConversation,
    readUnplacedOpenPref,
    recordSidePanel,
    safeDesignBack,
    shouldOfferDesignedLayout,
    usesDesignedLayout,
    writeUnplacedOpenPref,
    type LayoutSuggestionInput,
} from './recordModalMode';
import { suggestedTemplateFor } from './LayoutSuggestion';

const page = (types: string[]) => ({ sections: [{ blocks: [types.map((type) => ({ type }))] }] });

describe('recordModalMode', () => {
    beforeEach(() => window.localStorage.clear());

    it('la ficha diseñada sólo con record_layout = crm', () => {
        expect(usesDesignedLayout({ record_layout: 'crm' })).toBe(true);
        expect(usesDesignedLayout({ record_layout: 'classic' })).toBe(false);
        expect(usesDesignedLayout({})).toBe(false);
        expect(usesDesignedLayout(null)).toBe(false);
    });

    it('detecta si el diseño trae la conversación, en cualquier pestaña', () => {
        expect(layoutHasConversation({ pages: [page(['fields']), page(['activity'])] })).toBe(true);
        expect(layoutHasConversation({ pages: [page(['comments'])] })).toBe(true);
        expect(layoutHasConversation({ pages: [page(['fields', 'chart'])] })).toBe(false);
        expect(layoutHasConversation(null)).toBe(false);
    });

    it('el panel al costado: nada si el diseño trae la conversación, aside o pestañas si no', () => {
        expect(recordSidePanel({ designed: true, hasConversation: true, narrow: false })).toBe('none');
        expect(recordSidePanel({ designed: true, hasConversation: true, narrow: true })).toBe('none');
        // Mientras el diseño carga, sin un panel que aparezca y desaparezca.
        expect(recordSidePanel({ designed: true, hasConversation: null, narrow: false })).toBe('none');
        expect(recordSidePanel({ designed: true, hasConversation: false, narrow: false })).toBe('aside');
        expect(recordSidePanel({ designed: true, hasConversation: false, narrow: true })).toBe('tabs');
        // La ficha simple, como siempre.
        expect(recordSidePanel({ designed: false, hasConversation: null, narrow: false })).toBe('aside');
        expect(recordSidePanel({ designed: false, hasConversation: true, narrow: true })).toBe('tabs');
    });

    it('la tarjeta «Esta lista se puede ver como ficha»: a quién y cuándo', () => {
        const base: LayoutSuggestionInput = {
            listId: 7,
            settings: { record_layout: 'classic' },
            canManageLists: true,
            isGuest: false,
            impersonating: false,
            mirror: false,
            dismissed: [],
        };
        expect(shouldOfferDesignedLayout(base)).toBe(true);
        expect(shouldOfferDesignedLayout({ ...base, settings: {} })).toBe(true);
        expect(shouldOfferDesignedLayout({ ...base, canManageLists: false })).toBe(false);
        expect(shouldOfferDesignedLayout({ ...base, isGuest: true })).toBe(false);
        expect(shouldOfferDesignedLayout({ ...base, impersonating: true })).toBe(false);
        expect(shouldOfferDesignedLayout({ ...base, mirror: true })).toBe(false);
        expect(shouldOfferDesignedLayout({ ...base, settings: { record_layout: 'crm' } })).toBe(false);
        // Ya diseñó la suya y volvió a la simple: ya eligió.
        expect(shouldOfferDesignedLayout({ ...base, settings: { record_layout: 'classic', record_layout_v3: { pages: [] } } })).toBe(false);
        expect(shouldOfferDesignedLayout({ ...base, settings: { crm_template_id: 'custom' } })).toBe(false);
        // «Ahora no» en ESTA lista; en otra, sí.
        expect(shouldOfferDesignedLayout({ ...base, dismissed: [7] })).toBe(false);
        expect(shouldOfferDesignedLayout({ ...base, dismissed: [8] })).toBe(true);
        // Mientras no se sabe, nada.
        expect(shouldOfferDesignedLayout({ ...base, dismissed: null })).toBe(false);
        expect(hasOwnDesign({ record_layout_v3: null })).toBe(false);
    });

    it('la plantilla sugerida sale del nombre y los campos de la lista', () => {
        expect(suggestedTemplateFor({ name: 'Clientes' }, [])).toBe('contact');
        expect(
            suggestedTemplateFor({ name: 'Cosas' }, [
                { slug: 'monto', label: 'Monto', type: 'currency' },
                { slug: 'etapa', label: 'Etapa', type: 'select', config: { options: [{ value: 'ganado', label: 'Ganado' }] } },
            ]),
        ).toBe('deal');
    });

    it('el editor con el registro de muestra y una vuelta segura', () => {
        const href = designRecordHref('ventas', 12, '/lists/ventas/records?record=12&tab=p1');
        const u = new URL(href, 'https://x.test');
        expect(u.pathname).toBe('/lists/ventas/template-editor');
        expect(u.searchParams.get('record')).toBe('12');
        expect(u.searchParams.get('back')).toBe('/lists/ventas/records?record=12&tab=p1');
        expect(safeDesignBack('/lists/ventas/records?record=12')).toBe('/lists/ventas/records?record=12');
        expect(safeDesignBack('https://otro.test/lists/x')).toBeNull();
        expect(safeDesignBack('//otro.test/lists/x')).toBeNull();
        expect(safeDesignBack('/settings')).toBeNull();
        expect(safeDesignBack(null)).toBeNull();
    });

    it('«Otros campos» arranca como dice el diseño y recuerda lo que eligió la persona', () => {
        expect(readUnplacedOpenPref(3, false)).toBe(false);
        expect(readUnplacedOpenPref(3, true)).toBe(true);
        writeUnplacedOpenPref(3, true);
        expect(readUnplacedOpenPref(3, false)).toBe(true);
        writeUnplacedOpenPref(3, false);
        expect(readUnplacedOpenPref(3, true)).toBe(false);
        // Es por lista.
        expect(readUnplacedOpenPref(4, true)).toBe(true);
    });
});
