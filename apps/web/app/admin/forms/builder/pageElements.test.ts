import { describe, expect, it } from 'vitest';
import { formConfigSchema, type FormConfig } from '@imagina-base/shared';

import { effectiveTheme } from '../design/themeOps';
import { PAGE_ELEMENTS, PAGE_ELEMENT_IDS, elementVisible, isPageElement, setElementVisible, visibilityLabel } from './pageElements';

function classic(): FormConfig {
    return formConfigSchema.parse({
        items: [{ id: 'aaaa1', type: 'field', field_id: 1 }],
        settings: { title: 'Contacto' },
    });
}

describe('partes del formulario que no son preguntas', () => {
    it('cada parte tiene su ficha y se reconoce por su id con «@»', () => {
        for (const id of PAGE_ELEMENT_IDS) {
            expect(isPageElement(id)).toBe(true);
            expect(PAGE_ELEMENTS[id].label.length).toBeGreaterThan(0);
        }
        expect(isPageElement('aaaa1')).toBe(false);
        expect(isPageElement(null)).toBe(false);
    });

    it('ocultar y volver a mostrar el título, la descripción y la franja deja todo como estaba', () => {
        const base = classic();
        for (const id of ['@title', '@description', '@band'] as const) {
            expect(elementVisible(base, id)).toBe(true);
            const hidden = setElementVisible(base, id, false);
            expect(elementVisible(hidden, id)).toBe(false);
            // Sólo cambia esa parte: el resto del diseño sigue igual.
            const others = PAGE_ELEMENT_IDS.filter((x) => x !== id && elementVisible(base, x) !== null);
            for (const o of others) expect(elementVisible(hidden, o)).toBe(elementVisible(base, o));
            const shown = setElementVisible(hidden, id, true);
            expect(elementVisible(shown, id)).toBe(true);
            expect(effectiveTheme(shown.settings)).toEqual(effectiveTheme(base.settings));
        }
    });

    it('el logo, la portada, el avance, la tarjeta y la bienvenida se apagan y prenden', () => {
        let c = classic();
        c = setElementVisible(c, '@logo', false);
        expect(c.settings.show_logo).toBe(false);
        c = setElementVisible(c, '@cover', true);
        expect(effectiveTheme(c.settings).cover.enabled).toBe(true);
        c = setElementVisible(c, '@progress', false);
        expect(effectiveTheme(c.settings).layout.progress).toBe('none');
        c = setElementVisible(c, '@card', false);
        expect(effectiveTheme(c.settings).layout.container).toBe('plain');
        c = setElementVisible(c, '@welcome', true);
        expect(c.settings.welcome.enabled).toBe(true);
        expect(elementVisible(c, '@card')).toBe(false);
    });

    it('lo que siempre está no se oculta y su interruptor no hace nada', () => {
        const c = classic();
        for (const id of ['@page', '@submit', '@thanks', '@payment'] as const) {
            expect(elementVisible(c, id)).toBeNull();
            expect(setElementVisible(c, id, false)).toBe(c);
        }
        expect(visibilityLabel('@title')).toBe('Mostrar el título');
        expect(visibilityLabel('@card')).toMatch(/tarjeta/);
    });
});
