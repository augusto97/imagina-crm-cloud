import { describe, expect, it } from 'vitest';
import { bookingConfigSchema, type BookingConfig } from '@imagina-base/shared';

import {
    addQuestion,
    addService,
    addStaff,
    availableQuestionFields,
    buildPreviewMeta,
    copyDayToWeekdays,
    dayProblem,
    mappingCandidates,
    nextInterval,
    reminderLabel,
    removeQuestion,
    removeService,
    sectionProblems,
    setDayIntervals,
    setException,
    setMapping,
    setReminders,
    toggleStaffService,
} from './bookingDesignOps';

const fields = [
    { id: 1, type: 'datetime', slug: 'fecha', label: 'Fecha' },
    { id: 2, type: 'user', slug: 'profesional', label: 'Profesional' },
    { id: 3, type: 'text', slug: 'cliente', label: 'Cliente' },
    { id: 4, type: 'email', slug: 'email', label: 'Correo' },
    { id: 5, type: 'long_text', slug: 'motivo', label: 'Motivo' },
    { id: 6, type: 'select', slug: 'estado', label: 'Estado' },
    { id: 7, type: 'file', slug: 'adjunto', label: 'Adjunto' },
    { id: 8, type: 'relation', slug: 'empresa', label: 'Empresa' },
];

function base(): BookingConfig {
    return bookingConfigSchema.parse({ services: [{ id: 'svcuno', name: 'Consulta', duration_min: 30 }] });
}

describe('constructor de la agenda (operaciones puras)', () => {
    it('servicios: agregar y quitar (también de lo que ofrece cada persona)', () => {
        let c = base();
        const { config: c2, id } = addService(c, 'Control');
        c = c2;
        const { config: c3, id: staffId } = addStaff(c, 'user', 12);
        c = toggleStaffService(c3, staffId, 'svcuno', false);
        expect(c.staff[0]!.services).toEqual([id]);
        // Volver a marcar todos = «todos» (lista vacía).
        c = toggleStaffService(c, staffId, 'svcuno', true);
        expect(c.staff[0]!.services).toEqual([]);
        c = toggleStaffService(c, staffId, id, false);
        expect(c.staff[0]!.services).toEqual(['svcuno']);
        c = removeService(c, 'svcuno');
        expect(c.services.map((s) => s.name)).toEqual(['Control']);
        expect(c.staff[0]!.services).toEqual([]);
    });

    it('horario: tramos por día, copiar a los días hábiles, tramos que se pisan y excepciones ordenadas', () => {
        const added = addStaff(base(), 'resource');
        const id = added.id;
        let c = added.config;
        c = setDayIntervals(c, id, 1, [{ start: '09:00', end: '13:00' }]);
        c = copyDayToWeekdays(c, id, 1);
        expect(c.staff[0]!.availability.week.map((d) => d.length)).toEqual([0, 1, 1, 1, 1, 1, 0]);
        expect(c.staff[0]!.availability.week[5]).toEqual([{ start: '09:00', end: '13:00' }]);
        expect(nextInterval([{ start: '08:00', end: '12:00' }])).toEqual({ start: '13:00', end: '17:00' });
        expect(nextInterval([{ start: '18:00', end: '22:30' }])).toBeNull();
        expect(nextInterval([])).toEqual({ start: '08:00', end: '12:00' });
        expect(dayProblem([{ start: '08:00', end: '12:00' }, { start: '11:00', end: '13:00' }])).toBe('Dos tramos se pisan.');
        expect(dayProblem([{ start: '08:00', end: '12:00' }, { start: '12:00', end: '13:00' }])).toBeNull();
        c = setException(c, id, { date: '2026-12-24', closed: true, intervals: [], note: '' });
        c = setException(c, id, { date: '2026-12-08', closed: false, intervals: [{ start: '09:00', end: '11:00' }], note: '' });
        expect(c.staff[0]!.availability.exceptions.map((e) => e.date)).toEqual(['2026-12-08', '2026-12-24']);
        expect(sectionProblems(c, fields).disponibilidad).toBeUndefined();
        c = setDayIntervals(c, id, 2, [{ start: '10:00', end: '09:00' }]);
        expect(sectionProblems(c, fields).disponibilidad).toBeDefined();
    });

    it('campos: candidatos por tipo; un campo que escribe la página deja de ser pregunta; cambiar el estado suelta sus valores', () => {
        expect(mappingCandidates(fields, 'start_field_id').map((f) => f.slug)).toEqual(['fecha']);
        expect(mappingCandidates(fields, 'email_field_id').map((f) => f.slug)).toEqual(['cliente', 'email']);
        let c = addQuestion(base(), 4);
        expect(availableQuestionFields(fields, c).map((f) => f.slug)).toEqual(['fecha', 'cliente', 'motivo', 'estado']);
        c = setMapping(c, 'email_field_id', 4);
        expect(c.questions).toEqual([]);
        c = { ...c, mapping: { ...c.mapping, status_field_id: 6, status_confirmed: 'confirmada' } };
        c = setMapping(c, 'status_field_id', null);
        expect(c.mapping.status_confirmed).toBeNull();
        // Ni archivos ni relaciones se preguntan.
        expect(availableQuestionFields(fields, c).map((f) => f.slug)).not.toContain('adjunto');
        expect(availableQuestionFields(fields, c).map((f) => f.slug)).not.toContain('empresa');
        c = addQuestion(c, 5);
        const qid = c.questions[0]!.id;
        expect(removeQuestion(c, qid).questions).toEqual([]);
    });

    it('recordatorios: sin repetidos, de mayor a menor y con su etiqueta', () => {
        const c = setReminders(base(), [60, 1440, 60, 5, 2880]);
        expect(c.notifications.reminders.map((r) => r.minutes_before)).toEqual([2880, 1440, 60]);
        expect(reminderLabel(1440)).toBe('1 día antes');
        expect(reminderLabel(2880)).toBe('2 días antes');
        expect(reminderLabel(60)).toBe('1 hora antes');
        expect(reminderLabel(30)).toBe('30 min antes');
    });

    it('vista previa: sólo lo que atiende alguien, con el nombre de la persona y el precio legible', () => {
        let c = updatePrice(base(), 80000);
        const { config: c2 } = addStaff(c, 'user', 12);
        c = { ...c2, settings: { ...c2.settings, title: 'Pide tu cita' } };
        const meta = buildPreviewMeta(c, {
            name: 'Agenda',
            fields,
            members: [{ id: 12, name: 'Dra. Ruiz' }],
            accent: '#0e7490',
            logoUrl: null,
            company: 'Acme',
            timeZone: 'America/Bogota',
            numberFormat: 'dot_comma',
            captchaProvider: null,
            dataConsent: null,
        });
        expect(meta.title).toBe('Pide tu cita');
        expect(meta.staff).toEqual([{ id: c.staff[0]!.id, name: 'Dra. Ruiz', kind: 'user', services: [] }]);
        expect(meta.services[0]!.price_label).toBe('$ 80.000');
        expect(meta.choose_staff).toBe(false);
        expect(meta.time_zone_label).toContain('Bogotá');
    });

    it('lo que falta por sección', () => {
        const p = sectionProblems(bookingConfigSchema.parse({}), fields);
        expect(Object.keys(p).sort()).toEqual(['atienden', 'campos', 'servicios']);
    });
});

function updatePrice(c: BookingConfig, price: number): BookingConfig {
    return { ...c, services: c.services.map((s) => ({ ...s, price })) };
}
