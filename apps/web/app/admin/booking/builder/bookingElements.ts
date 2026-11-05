import { BOOKING_CLASSIC_THEME, type BookingConfig, type BookingLabelKey, type PublicElementColorKey } from '@imagina-base/shared';

import { effectiveTheme, patchThemeSection, type ThemeResetKey } from '../../forms/design/themeOps';
import type { BookingSection } from '../bookingDesignOps';

/**
 * v0.1.378 — Las partes de la página de la agenda, como las del formulario
 * (v0.1.377): en la vista previa se tocan (id con `@`) y cada una tiene su
 * panel con «Mostrar», «Contenido» y «Estilo». Los pasos (servicios, quién
 * atiende, fecha y hora, tus datos, confirmación) llevan la vista previa a
 * ese paso al elegirlos.
 */

export const BOOKING_ELEMENT_IDS = [
    '@page',
    '@card',
    '@cover',
    '@band',
    '@logo',
    '@title',
    '@description',
    '@location',
    '@progress',
    '@services',
    '@staff',
    '@calendar',
    '@details',
    '@consent',
    '@captcha',
    '@submit',
    '@done',
] as const;
export type BookingElementId = (typeof BOOKING_ELEMENT_IDS)[number];

const IDS: ReadonlySet<string> = new Set(BOOKING_ELEMENT_IDS);
export function isBookingElement(id: string | null | undefined): id is BookingElementId {
    return !!id && IDS.has(id);
}

/** El paso de la página donde se ve cada parte (la vista previa va ahí al elegirla). */
export type BookingStep = 'service' | 'staff' | 'date' | 'details' | 'done';

export interface BookingElementInfo {
    label: string;
    hint: string;
    sections: ThemeResetKey[];
    colors: PublicElementColorKey[];
    step?: BookingStep;
    /** El texto propio de la página que se edita en esta parte. */
    labelKey?: BookingLabelKey;
}

export const BOOKING_ELEMENTS: Record<BookingElementId, BookingElementInfo> = {
    '@page': { label: 'Página y fondo', hint: 'Todo lo que rodea a la agenda: el fondo, el ancho y la separación.', sections: ['background', 'layout', 'split'], colors: [] },
    '@card': { label: 'Tarjeta', hint: 'El recuadro donde va la agenda.', sections: ['card'], colors: [] },
    '@cover': { label: 'Portada', hint: 'Una imagen o un degradado arriba de la agenda.', sections: ['cover'], colors: [] },
    '@band': { label: 'Franja de color', hint: 'La línea de color arriba de la tarjeta.', sections: [], colors: ['band'] },
    '@logo': { label: 'Logo', hint: 'El de la empresa (se cambia en Ajustes → Marca).', sections: [], colors: [] },
    '@title': { label: 'Título', hint: 'Lo primero que lee el cliente.', sections: ['typography'], colors: ['title'] },
    '@description': { label: 'Descripción', hint: 'Unas líneas debajo del título.', sections: [], colors: ['description', 'link'] },
    '@location': { label: 'Dónde es la cita', hint: 'Una dirección o «Videollamada». Va en la página, el correo y el archivo del calendario.', sections: [], colors: ['description'] },
    '@progress': { label: 'Avance', hint: '«Paso 2 de 4» y el botón «Volver».', sections: [], colors: ['progress', 'progress_track'] },
    '@services': {
        label: 'Servicios',
        hint: 'Lo que se puede agendar y cuánto dura cada cosa.',
        sections: ['choices'],
        colors: ['heading', 'choice_bg', 'choice_text', 'choice_border'],
        step: 'service',
        labelKey: 'service',
    },
    '@staff': {
        label: 'Quién atiende',
        hint: 'Las personas del equipo o los recursos (una sala, un consultorio) que atienden.',
        sections: ['choices'],
        colors: ['heading', 'choice_bg', 'choice_text', 'choice_border'],
        step: 'staff',
        labelKey: 'staff',
    },
    '@calendar': {
        label: 'Fecha y hora',
        hint: 'El calendario y los horarios libres, calculados con el horario de cada uno.',
        sections: [],
        colors: ['heading', 'day_bg', 'day_text', 'day_selected_bg', 'day_selected_text', 'slot_bg', 'slot_text', 'slot_border'],
        step: 'date',
        labelKey: 'date',
    },
    '@details': {
        label: 'Tus datos',
        hint: 'Nombre, correo, teléfono y lo que más le preguntas al cliente.',
        sections: ['inputs'],
        colors: ['heading', 'label', 'help', 'required', 'input_text', 'placeholder'],
        step: 'details',
        labelKey: 'details',
    },
    '@consent': { label: 'Autorización de datos', hint: 'La casilla de tratamiento de datos personales.', sections: [], colors: ['link'], step: 'details' },
    '@captcha': { label: 'Verificación anti-robots', hint: 'La casilla «No soy un robot» antes de agendar.', sections: [], colors: [], step: 'details' },
    '@submit': { label: 'Botón de agendar', hint: 'El botón que confirma la cita.', sections: ['button'], colors: ['button_bg', 'button_text', 'button_border'], step: 'details', labelKey: 'submit' },
    '@done': { label: 'Confirmación', hint: 'Lo que ve el cliente al agendar.', sections: [], colors: ['heading', 'description'], step: 'done', labelKey: 'done' },
};

// ───────────────────────────── Mostrar u ocultar ─────────────────────────────

/** Si la parte se muestra; `null` = no se puede ocultar (siempre está). */
export function bookingElementVisible(config: BookingConfig, id: BookingElementId): boolean | null {
    const s = config.settings;
    const t = effectiveTheme(s, BOOKING_CLASSIC_THEME);
    switch (id) {
        case '@logo':
            return s.show_logo;
        case '@title':
            return t.layout.show_title;
        case '@description':
            return t.layout.show_description;
        case '@location':
            return s.display.show_location;
        case '@band':
            return t.layout.band;
        case '@cover':
            return t.cover.enabled;
        case '@progress':
            return t.layout.progress !== 'none';
        case '@card':
            return t.layout.container === 'card';
        case '@staff':
            return s.choose_staff === 'visitor';
        case '@consent':
            return s.data_consent;
        case '@captcha':
            return s.captcha;
        default:
            return null;
    }
}

export function setBookingElementVisible(config: BookingConfig, id: BookingElementId, on: boolean): BookingConfig {
    const s = config.settings;
    const set = (patch: Partial<BookingConfig['settings']>): BookingConfig => ({ ...config, settings: { ...s, ...patch } });
    const base = BOOKING_CLASSIC_THEME;
    switch (id) {
        case '@logo':
            return set({ show_logo: on });
        case '@title':
            return patchThemeSection(config, 'layout', { show_title: on }, base);
        case '@description':
            return patchThemeSection(config, 'layout', { show_description: on }, base);
        case '@location':
            return set({ display: { ...s.display, show_location: on } });
        case '@band':
            return patchThemeSection(config, 'layout', { band: on }, base);
        case '@cover':
            return patchThemeSection(config, 'cover', { enabled: on }, base);
        case '@progress':
            return patchThemeSection(config, 'layout', { progress: on ? 'steps' : 'none' }, base);
        case '@card':
            return patchThemeSection(config, 'layout', { container: on ? 'card' : 'plain' }, base);
        case '@staff':
            return set({ choose_staff: on ? 'visitor' : 'auto' });
        case '@consent':
            return set({ data_consent: on });
        case '@captcha':
            return set({ captcha: on });
        default:
            return config;
    }
}

/** El texto del interruptor de cada parte. */
export function bookingVisibilityLabel(id: BookingElementId): string {
    switch (id) {
        case '@logo':
            return 'Mostrar el logo de la empresa';
        case '@title':
            return 'Mostrar el título';
        case '@description':
            return 'Mostrar la descripción';
        case '@location':
            return 'Mostrar dónde es la cita';
        case '@band':
            return 'Mostrar la franja de color';
        case '@cover':
            return 'Mostrar una portada';
        case '@progress':
            return 'Mostrar el avance';
        case '@card':
            return 'Mostrar la agenda dentro de una tarjeta';
        case '@staff':
            return 'El cliente elige quién lo atiende';
        case '@consent':
            return 'Pedir la autorización de datos';
        case '@captcha':
            return 'Pedir la verificación anti-robots';
        default:
            return 'Mostrar';
    }
}

// ───────────────────────────── Ajustes agrupados ─────────────────────────────

export const BOOKING_SETTINGS_GROUPS = ['availability', 'rules', 'approval', 'emails', 'record', 'measure', 'publish'] as const;
export type BookingSettingsGroup = (typeof BOOKING_SETTINGS_GROUPS)[number];

export const BOOKING_SETTINGS_GROUP_INFO: Record<BookingSettingsGroup, { title: string; hint: string; section: BookingSection }> = {
    availability: { title: 'Horario y disponibilidad', hint: 'El horario de cada uno, días especiales, festivos y vacaciones.', section: 'disponibilidad' },
    rules: { title: 'Reglas', hint: 'Márgenes entre citas, anticipación, hasta cuándo y topes.', section: 'reglas' },
    approval: { title: 'Aprobación y seguridad', hint: 'Si alguien aprueba cada cita y cómo frenar reservas falsas.', section: 'aprobacion' },
    emails: { title: 'Correos y recordatorios', hint: 'La confirmación, los recordatorios y los avisos al cliente.', section: 'correos' },
    record: { title: 'Dónde se guarda la cita', hint: 'En qué campo de la lista queda cada dato y los valores del estado.', section: 'campos' },
    measure: { title: 'Medir conversiones', hint: 'Google Ads, Meta, la página de gracias y de dónde vino cada cita.', section: 'medir' },
    publish: { title: 'Publicar y compartir', hint: 'El enlace, insertarla en tu sitio, el código QR y dónde se puede insertar.', section: 'publicar' },
};

/**
 * Dónde se arregla lo que falta de cada sección del editor anterior: los
 * servicios y quién atiende son partes de la página; lo demás, un grupo de
 * Ajustes.
 */
export function problemTarget(section: BookingSection): { element: BookingElementId } | { group: BookingSettingsGroup } | { design: true } {
    if (section === 'servicios') return { element: '@services' };
    if (section === 'atienden') return { element: '@staff' };
    if (section === 'diseno') return { design: true };
    const group = BOOKING_SETTINGS_GROUPS.find((g) => BOOKING_SETTINGS_GROUP_INFO[g].section === section);
    return group ? { group } : { design: true };
}
