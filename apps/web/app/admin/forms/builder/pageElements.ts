import { DEFAULT_PUBLIC_THEME, type FormConfig, type PublicElementColorKey, type PublicTheme } from '@imagina-base/shared';

import { effectiveTheme, patchThemeSection, type ThemeResetKey } from '../design/themeOps';
import { updateSettings } from '../formDesignOps';

/**
 * v0.1.377 — Las partes del formulario que no son preguntas: el logo, el
 * título, la descripción, la franja, la portada, el botón, el avance, la
 * pantalla de agradecimiento, la tarjeta y la página. En la vista previa se
 * tocan como una pregunta (id con `@`) y cada una tiene su panel: qué dice,
 * si se muestra, y su diseño (los colores y las secciones del tema que la
 * cambian a ella, no todo el diseño).
 */

export const PAGE_ELEMENT_IDS = [
    '@page',
    '@card',
    '@cover',
    '@band',
    '@logo',
    '@title',
    '@description',
    '@welcome',
    '@progress',
    '@submit',
    '@thanks',
    '@captcha',
    '@consent',
    '@payment',
    '@subscription',
] as const;
export type PageElementId = (typeof PAGE_ELEMENT_IDS)[number];

const IDS: ReadonlySet<string> = new Set(PAGE_ELEMENT_IDS);
export function isPageElement(id: string | null | undefined): id is PageElementId {
    return !!id && IDS.has(id);
}

export interface PageElementInfo {
    label: string;
    /** Una línea: qué es y dónde se ve. */
    hint: string;
    /** Las secciones del diseño que lo cambian (se muestran abiertas, sin el resto). */
    sections: ThemeResetKey[];
    /** Sus colores propios. */
    colors: PublicElementColorKey[];
    /** El grupo de Ajustes que tiene lo demás de este elemento (si aplica). */
    settingsGroup?: SettingsGroupId;
}

export const PAGE_ELEMENTS: Record<PageElementId, PageElementInfo> = {
    '@page': {
        label: 'Página y fondo',
        hint: 'Todo lo que rodea al formulario: el fondo, el ancho y la separación.',
        sections: ['background', 'layout', 'split'],
        colors: [],
    },
    '@card': {
        label: 'Tarjeta',
        hint: 'El recuadro donde van las preguntas.',
        sections: ['card'],
        colors: [],
    },
    '@cover': {
        label: 'Portada',
        hint: 'Una imagen o un degradado arriba del formulario.',
        sections: ['cover'],
        colors: [],
    },
    '@band': {
        label: 'Franja de color',
        hint: 'La línea de color arriba de la tarjeta.',
        sections: [],
        colors: ['band'],
    },
    '@logo': {
        label: 'Logo',
        hint: 'El de la empresa, otro propio de este formulario, o ninguno.',
        sections: [],
        colors: [],
    },
    '@title': {
        label: 'Título',
        hint: 'Lo primero que lee quien responde.',
        sections: ['typography'],
        colors: ['title'],
    },
    '@description': {
        label: 'Descripción',
        hint: 'Unas líneas debajo del título.',
        sections: [],
        colors: ['description', 'link'],
    },
    '@welcome': {
        label: 'Bienvenida',
        hint: 'Una pantalla antes de la primera pregunta.',
        sections: [],
        colors: ['title', 'description'],
        settingsGroup: 'welcome',
    },
    '@progress': {
        label: 'Avance',
        hint: 'La barra o los pasos de un formulario de varias páginas.',
        sections: [],
        colors: ['progress', 'progress_track'],
    },
    '@submit': {
        label: 'Botón de enviar',
        hint: 'El botón del final (y «Siguiente» en varias páginas).',
        sections: ['button'],
        colors: ['button_bg', 'button_text', 'button_border'],
    },
    '@thanks': {
        label: 'Pantalla de agradecimiento',
        hint: 'Lo que ve la persona al enviar.',
        sections: [],
        colors: ['title', 'description'],
        settingsGroup: 'after',
    },
    '@captcha': {
        label: 'Verificación anti-robots',
        hint: 'La casilla «No soy un robot» antes de enviar.',
        sections: [],
        colors: [],
        settingsGroup: 'security',
    },
    '@consent': {
        label: 'Autorización de datos',
        hint: 'La casilla de tratamiento de datos personales.',
        sections: [],
        colors: ['link'],
        settingsGroup: 'security',
    },
    '@payment': {
        label: 'Cobro',
        hint: 'El total a pagar al enviar.',
        sections: [],
        colors: [],
        settingsGroup: 'charge',
    },
    '@subscription': {
        label: 'Planes',
        hint: 'Los planes para suscribirse al enviar.',
        sections: ['choices'],
        colors: ['choice_bg', 'choice_text', 'choice_border', 'choice_selected_bg', 'choice_selected_text'],
        settingsGroup: 'charge',
    },
};

/** Los colores y las secciones de diseño que cambian a TODAS las preguntas. */
export const QUESTION_STYLE = {
    sections: ['inputs', 'choices'] as ThemeResetKey[],
    colors: ['label', 'help', 'required', 'input_text', 'placeholder'] as PublicElementColorKey[],
    choiceColors: ['choice_bg', 'choice_text', 'choice_border', 'choice_selected_bg', 'choice_selected_text'] as PublicElementColorKey[],
    contentColors: ['heading', 'text', 'link'] as PublicElementColorKey[],
};

// ───────────────────────────── Mostrar u ocultar ─────────────────────────────

/** Si el elemento se muestra; `null` = no se puede ocultar (siempre está). */
export function elementVisible(config: FormConfig, id: PageElementId, base: PublicTheme = DEFAULT_PUBLIC_THEME): boolean | null {
    const s = config.settings;
    const t = effectiveTheme(s, base);
    switch (id) {
        case '@logo':
            return s.show_logo;
        case '@title':
            return t.layout.show_title;
        case '@description':
            return t.layout.show_description;
        case '@band':
            return t.layout.band;
        case '@cover':
            return t.cover.enabled;
        case '@progress':
            return t.layout.progress !== 'none';
        case '@welcome':
            return s.welcome.enabled;
        case '@card':
            return t.layout.container === 'card';
        default:
            return null;
    }
}

export function setElementVisible(config: FormConfig, id: PageElementId, on: boolean, base: PublicTheme = DEFAULT_PUBLIC_THEME): FormConfig {
    switch (id) {
        case '@logo':
            return updateSettings(config, { show_logo: on });
        case '@title':
            return patchThemeSection(config, 'layout', { show_title: on }, base);
        case '@description':
            return patchThemeSection(config, 'layout', { show_description: on }, base);
        case '@band':
            return patchThemeSection(config, 'layout', { band: on }, base);
        case '@cover':
            return patchThemeSection(config, 'cover', { enabled: on }, base);
        case '@progress':
            return patchThemeSection(config, 'layout', { progress: on ? 'bar' : 'none' }, base);
        case '@welcome':
            return updateSettings(config, { welcome: { ...config.settings.welcome, enabled: on } });
        case '@card':
            return patchThemeSection(config, 'layout', { container: on ? 'card' : 'plain' }, base);
        default:
            return config;
    }
}

/** El texto que dice «Mostrar …» en el interruptor de cada elemento. */
export function visibilityLabel(id: PageElementId): string {
    switch (id) {
        case '@card':
            return 'Mostrar las preguntas dentro de una tarjeta';
        case '@progress':
            return 'Mostrar el avance';
        case '@welcome':
            return 'Mostrar una bienvenida antes de empezar';
        case '@cover':
            return 'Mostrar una portada';
        case '@band':
            return 'Mostrar la franja de color';
        case '@logo':
            return 'Mostrar el logo';
        case '@title':
            return 'Mostrar el título';
        case '@description':
            return 'Mostrar la descripción';
        default:
            return 'Mostrar';
    }
}

// ───────────────────────────── Ajustes agrupados ─────────────────────────────

export const SETTINGS_GROUPS = [
    'general',
    'welcome',
    'after',
    'email',
    'limits',
    'save',
    'charge',
    'record',
    'security',
    'embed',
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number];

export const SETTINGS_GROUP_INFO: Record<SettingsGroupId, { title: string; hint: string }> = {
    general: { title: 'General', hint: 'Nombre interno y cómo se responde.' },
    welcome: { title: 'Bienvenida', hint: 'Una pantalla antes de la primera pregunta.' },
    after: { title: 'Al enviar', hint: 'Agradecimiento, página de gracias y «enviar otra».' },
    email: { title: 'Correo de quien responde', hint: 'Confirmar el correo y mandarle una copia.' },
    limits: { title: 'Cupos y cierre', hint: 'Hasta qué día o cuántas respuestas recibe.' },
    save: { title: 'Guardar el avance', hint: 'Seguir después, en el dispositivo o por correo.' },
    charge: { title: 'Cobrar o suscribir', hint: 'Que paguen o se suscriban al enviar.' },
    record: { title: 'Registros', hint: 'El registro que se crea y el enlace para actualizarlo.' },
    security: { title: 'Seguridad y datos', hint: 'Anti-robots y autorización de datos personales.' },
    embed: { title: 'Medir conversiones', hint: 'Google Ads, Meta, de dónde vino cada respuesta y respuestas desde la dirección.' },
};
