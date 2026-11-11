import { widgetButtonLabel, type ContactWidgetConfig, type WidgetProblem } from '@imagina-base/shared';

/**
 * v0.1.408 — Las secciones del editor del widget (el menú de la izquierda) y
 * lo que dice cada una de cómo está, para leerlo sin abrirla. Puro: lo prueba
 * `widgetSections.test.ts`.
 */

export type WidgetSection = 'buttons' | 'look' | 'hours' | 'show' | 'greeting' | 'publish';
export type WidgetEditorMode = 'edit' | 'stats';

export const WIDGET_SECTIONS: readonly WidgetSection[] = ['buttons', 'look', 'hours', 'show', 'greeting', 'publish'];

export const WIDGET_SECTION_INFO: Record<WidgetSection, { label: string; title: string; hint: string; group: string }> = {
    buttons: { label: 'Botones', title: 'Botones', hint: 'Lo que puede hacer quien visita tu sitio. Se ven en este orden.', group: 'El widget' },
    look: { label: 'Apariencia', title: 'Apariencia', hint: 'Cómo se ve el botón redondo y lo que se abre al tocarlo.', group: 'El widget' },
    hours: { label: 'Horario', title: 'Horario de atención', hint: 'En qué días y horas atiendes, y qué dice el panel el resto del tiempo.', group: 'Cuándo y dónde' },
    show: { label: 'Dónde aparece', title: 'Dónde aparece', hint: 'Pegas el código una sola vez en todo tu sitio y aquí eliges en qué páginas se ve.', group: 'Cuándo y dónde' },
    greeting: { label: 'Saludo', title: 'Saludo', hint: 'Un mensaje junto al botón para invitar a escribir, antes de que lo abran.', group: 'Cuándo y dónde' },
    publish: { label: 'Instalar', title: 'Instalar en tu sitio', hint: 'Publícalo y pega el código una sola vez en tu sitio.', group: 'Publicar' },
};

/** `?t=` de la dirección → modo y sección (también los nombres de antes de v0.1.408). */
export function widgetLocation(param: string | null): { mode: WidgetEditorMode; section: WidgetSection } {
    if (param === 'stats') return { mode: 'stats', section: 'buttons' };
    const section = (WIDGET_SECTIONS as readonly string[]).includes(param ?? '') ? (param as WidgetSection) : 'buttons';
    return { mode: 'edit', section };
}

const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** «lun a vie», «lun a sáb», «lun, mié, vie», «todos los días». */
export function workingDaysText(week: ReadonlyArray<ReadonlyArray<unknown>>): string {
    const on = week.map((d) => d.length > 0);
    const n = on.filter(Boolean).length;
    if (n === 0) return 'sin días';
    if (n === 7) return 'todos los días';
    // Semana empezando el lunes (domingo al final).
    const order = [1, 2, 3, 4, 5, 6, 0];
    const days = order.filter((i) => on[i]);
    const run = order.findIndex((i) => on[i]);
    const contiguous = days.every((d, k) => order[run + k] === d);
    if (contiguous && days.length >= 3) return `${DAY_SHORT[days[0]!]} a ${DAY_SHORT[days[days.length - 1]!]}`;
    return days.map((d) => DAY_SHORT[d]).join(', ');
}

/** Lo que dice cada sección en el menú (cómo está ahora). */
export function widgetSectionSummary(section: WidgetSection, config: ContactWidgetConfig, enabled: boolean): string {
    switch (section) {
        case 'buttons': {
            const labels = config.buttons.map((b) => widgetButtonLabel(b));
            if (labels.length === 0) return 'Sin botones';
            if (labels.length <= 2) return labels.join(' y ');
            return `${labels.slice(0, 2).join(', ')} y ${labels.length - 2} más`;
        }
        case 'look':
            return `${config.layout === 'card' ? 'Panel tipo chat' : 'Botones apilados'} · ${config.position === 'right' ? 'a la derecha' : 'a la izquierda'}`;
        case 'hours':
            return config.hours.enabled ? `Atiendes ${workingDaysText(config.hours.week)}` : 'Siempre disponible';
        case 'show': {
            const pages = config.display.pages === 'all' ? 'Todas las páginas' : config.display.pages === 'only' ? 'Sólo algunas páginas' : 'Todas menos algunas';
            const devices = config.display.devices === 'desktop' ? ' · sólo computador' : config.display.devices === 'mobile' ? ' · sólo celular' : '';
            return pages + devices;
        }
        case 'greeting': {
            const g = config.greeting;
            if (!g.enabled) return 'Apagado';
            const text = g.text.trim();
            if (text) return `«${text.length > 34 ? `${text.slice(0, 33)}…` : text}»`;
            return g.rules.length > 0 ? 'Un saludo por página' : 'Sin texto todavía';
        }
        case 'publish':
            return enabled ? 'Publicado' : 'Sin publicar';
    }
}

/** En qué sección se arregla cada problema (los de un botón, en Botones; el horario, en Horario). */
export function problemSection(p: WidgetProblem): WidgetSection {
    if (p.button_id) return 'buttons';
    // «Fuera de horario no quedaría ningún botón»: se arregla en «Cuándo se ve» de cada botón.
    if (/botón/.test(p.message)) return 'buttons';
    if (/horario/i.test(p.message)) return 'hours';
    return 'publish';
}

/** Las secciones con algo pendiente para publicar. */
export function sectionsWithProblems(problems: readonly WidgetProblem[]): ReadonlySet<WidgetSection> {
    return new Set(problems.map(problemSection));
}
