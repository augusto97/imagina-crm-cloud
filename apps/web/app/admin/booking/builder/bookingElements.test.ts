import { describe, expect, it } from 'vitest';
import { BOOKING_CLASSIC_THEME, BOOKING_LABEL_DEFAULTS, bookingLabel, defaultBookingConfig, type BookingConfig } from '@imagina-base/shared';

import { effectiveTheme } from '../../forms/design/themeOps';
import type { BookingSection } from '../bookingDesignOps';
import {
    BOOKING_ELEMENTS,
    BOOKING_ELEMENT_IDS,
    BOOKING_SETTINGS_GROUPS,
    BOOKING_SETTINGS_GROUP_INFO,
    bookingElementVisible,
    bookingVisibilityLabel,
    isBookingElement,
    problemTarget,
    setBookingElementVisible,
} from './bookingElements';

function base(): BookingConfig {
    return defaultBookingConfig({ listName: 'Citas', userId: 7, fields: [] });
}

describe('partes de la página de la agenda', () => {
    it('cada parte tiene su ficha y se reconoce por su id con «@»', () => {
        for (const id of BOOKING_ELEMENT_IDS) {
            expect(isBookingElement(id)).toBe(true);
            expect(BOOKING_ELEMENTS[id].label.length).toBeGreaterThan(0);
            expect(BOOKING_ELEMENTS[id].hint.length).toBeGreaterThan(0);
        }
        expect(isBookingElement('@foo')).toBe(false);
        expect(isBookingElement(null)).toBe(false);
    });

    it('los pasos llevan la vista previa a donde se ven y tienen su texto propio', () => {
        expect(BOOKING_ELEMENTS['@services'].step).toBe('service');
        expect(BOOKING_ELEMENTS['@staff'].step).toBe('staff');
        expect(BOOKING_ELEMENTS['@calendar'].step).toBe('date');
        expect(BOOKING_ELEMENTS['@details'].step).toBe('details');
        expect(BOOKING_ELEMENTS['@submit'].step).toBe('details');
        expect(BOOKING_ELEMENTS['@done'].step).toBe('done');
        for (const id of BOOKING_ELEMENT_IDS) {
            const key = BOOKING_ELEMENTS[id].labelKey;
            if (key) expect(BOOKING_LABEL_DEFAULTS[key].length).toBeGreaterThan(0);
        }
    });

    it('ocultar y volver a mostrar el título, la descripción, el lugar y la franja deja todo como estaba', () => {
        const c = base();
        for (const id of ['@title', '@description', '@location', '@band'] as const) {
            expect(bookingElementVisible(c, id)).toBe(true);
            const hidden = setBookingElementVisible(c, id, false);
            expect(bookingElementVisible(hidden, id)).toBe(false);
            // Sólo cambia esa parte.
            for (const o of BOOKING_ELEMENT_IDS.filter((x) => x !== id)) expect(bookingElementVisible(hidden, o)).toBe(bookingElementVisible(c, o));
            const shown = setBookingElementVisible(hidden, id, true);
            expect(bookingElementVisible(shown, id)).toBe(true);
            expect(effectiveTheme(shown.settings, BOOKING_CLASSIC_THEME)).toEqual(effectiveTheme(c.settings, BOOKING_CLASSIC_THEME));
            expect(shown.settings.display).toEqual(c.settings.display);
        }
    });

    it('quien atiende «oculto» es que se asigna solo, y la autorización y el captcha se piden o no', () => {
        let c = base();
        expect(bookingElementVisible(c, '@staff')).toBe(true);
        c = setBookingElementVisible(c, '@staff', false);
        expect(c.settings.choose_staff).toBe('auto');
        c = setBookingElementVisible(c, '@consent', true);
        expect(c.settings.data_consent).toBe(true);
        c = setBookingElementVisible(c, '@captcha', true);
        expect(c.settings.captcha).toBe(true);
        c = setBookingElementVisible(c, '@progress', false);
        expect(effectiveTheme(c.settings, BOOKING_CLASSIC_THEME).layout.progress).toBe('none');
        c = setBookingElementVisible(c, '@card', false);
        expect(effectiveTheme(c.settings, BOOKING_CLASSIC_THEME).layout.container).toBe('plain');
        c = setBookingElementVisible(c, '@cover', true);
        expect(effectiveTheme(c.settings, BOOKING_CLASSIC_THEME).cover.enabled).toBe(true);
    });

    it('lo que siempre está no se oculta y su interruptor no hace nada', () => {
        const c = base();
        for (const id of ['@page', '@services', '@calendar', '@details', '@submit', '@done'] as const) {
            expect(bookingElementVisible(c, id)).toBeNull();
            expect(setBookingElementVisible(c, id, false)).toBe(c);
        }
        expect(bookingVisibilityLabel('@staff')).toBe('El cliente elige quién lo atiende');
    });

    it('lo que falta para publicar lleva a la parte o al grupo de ajustes donde se arregla', () => {
        expect(problemTarget('servicios')).toEqual({ element: '@services' });
        expect(problemTarget('atienden')).toEqual({ element: '@staff' });
        expect(problemTarget('diseno')).toEqual({ design: true });
        const sections: BookingSection[] = ['disponibilidad', 'reglas', 'aprobacion', 'correos', 'campos', 'medir', 'publicar'];
        for (const s of sections) {
            const t = problemTarget(s);
            expect('group' in t).toBe(true);
            if ('group' in t) expect(BOOKING_SETTINGS_GROUP_INFO[t.group].section).toBe(s);
        }
        expect(new Set(BOOKING_SETTINGS_GROUPS.map((g) => BOOKING_SETTINGS_GROUP_INFO[g].section)).size).toBe(BOOKING_SETTINGS_GROUPS.length);
    });

    it('un texto vacío de un paso usa el de siempre', () => {
        const c = base();
        expect(bookingLabel(c.settings.labels, 'submit')).toBe(BOOKING_LABEL_DEFAULTS.submit);
        expect(bookingLabel({ ...c.settings.labels, submit: '  Reservar  ' }, 'submit')).toBe('Reservar');
    });
});
