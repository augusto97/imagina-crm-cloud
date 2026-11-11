import { describe, expect, it } from 'vitest';
import { readContactWidgetConfig } from '@imagina-base/shared';

import { problemSection, sectionsWithProblems, widgetLocation, widgetSectionSummary, workingDaysText } from './widgetSections';

const base = readContactWidgetConfig({});

describe('widgetSections (v0.1.408)', () => {
    it('lee la sección de la dirección y acepta las pestañas de antes', () => {
        expect(widgetLocation(null)).toEqual({ mode: 'edit', section: 'buttons' });
        expect(widgetLocation('look')).toEqual({ mode: 'edit', section: 'look' });
        expect(widgetLocation('greeting')).toEqual({ mode: 'edit', section: 'greeting' });
        expect(widgetLocation('stats')).toEqual({ mode: 'stats', section: 'buttons' });
        expect(widgetLocation('cualquiera')).toEqual({ mode: 'edit', section: 'buttons' });
    });

    it('resume los días de atención', () => {
        const week = (on: number[]): unknown[][] => [0, 1, 2, 3, 4, 5, 6].map((d) => (on.includes(d) ? [{ start: '08:00', end: '18:00' }] : []));
        expect(workingDaysText(week([1, 2, 3, 4, 5]))).toBe('lun a vie');
        expect(workingDaysText(week([1, 2, 3, 4, 5, 6]))).toBe('lun a sáb');
        expect(workingDaysText(week([1, 3, 5]))).toBe('lun, mié, vie');
        expect(workingDaysText(week([0, 1, 2, 3, 4, 5, 6]))).toBe('todos los días');
        expect(workingDaysText(week([]))).toBe('sin días');
    });

    it('dice cómo está cada sección', () => {
        expect(widgetSectionSummary('buttons', base, false)).toBe('Sin botones');
        const three = {
            ...base,
            buttons: [
                { ...base.buttons[0], id: 'a', type: 'whatsapp', label: '' },
                { ...base.buttons[0], id: 'b', type: 'form', label: 'Cotiza' },
                { ...base.buttons[0], id: 'c', type: 'call', label: '' },
            ],
        } as unknown as typeof base;
        expect(widgetSectionSummary('buttons', three, false)).toBe('WhatsApp, Cotiza y 1 más');
        expect(widgetSectionSummary('look', { ...base, layout: 'menu', position: 'left' }, false)).toBe('Botones apilados · a la izquierda');
        expect(widgetSectionSummary('hours', base, false)).toBe('Siempre disponible');
        expect(widgetSectionSummary('show', { ...base, display: { ...base.display, pages: 'only', devices: 'mobile' } }, false)).toBe('Sólo algunas páginas · sólo celular');
        expect(widgetSectionSummary('greeting', base, false)).toBe('Apagado');
        expect(widgetSectionSummary('greeting', { ...base, greeting: { ...base.greeting, enabled: true, text: '¿Te ayudamos?' } }, false)).toBe('«¿Te ayudamos?»');
        expect(widgetSectionSummary('publish', base, true)).toBe('Publicado');
    });

    it('lleva cada problema a la sección donde se arregla', () => {
        expect(problemSection({ button_id: 'x', message: '«WhatsApp»: escribe el número' })).toBe('buttons');
        expect(problemSection({ button_id: null, message: 'Agrega al menos un botón.' })).toBe('buttons');
        expect(problemSection({ button_id: null, message: 'Horario de atención: marca al menos un día con horario.' })).toBe('hours');
        expect(problemSection({ button_id: null, message: 'Fuera de horario no quedaría ningún botón: deja alguno «Siempre».' })).toBe('buttons');
        expect([...sectionsWithProblems([{ button_id: null, message: 'Horario de atención: marca al menos un día con horario.' }])]).toEqual(['hours']);
    });
});
