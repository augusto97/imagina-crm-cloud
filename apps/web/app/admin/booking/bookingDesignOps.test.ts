import { describe, expect, it } from 'vitest';
import { BOOKING_CLASSIC_THEME, bookingConfigSchema, publicThemePresets, type BookingConfig } from '@imagina-base/shared';

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
    staffCalendarsFrom,
    setDayIntervals,
    setException,
    setMapping,
    setReminders,
    addTimeOff,
    copyHolidaysToAll,
    setDefaultDuration,
    setHolidayCountry,
    setHolidayWorked,
    setServiceDayIntervals,
    setServiceHours,
    toggleServiceDuration,
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
        expect(meta.staff).toEqual([{ id: c.staff[0]!.id, name: 'Dra. Ruiz', kind: 'user', services: [], title: '', bio: '', photo_url: null }]);
        expect(meta.services[0]!.price_label).toBe('$ 80.000');
        expect(meta.choose_staff).toBe(false);
        expect(meta.time_zone_label).toContain('Bogotá');
    });

    it('v0.1.349 — festivos: país, marcados y copiar a todos', () => {
        let c = addStaff(base(), 'user', 12, 'America/Mexico_City').config;
        c = addStaff(c, 'resource').config;
        const [a, b] = c.staff;
        // El primero toma el país de la zona; el siguiente, el de quien ya atiende.
        expect(a!.availability.holiday_country).toBe('MX');
        expect(b!.availability.holiday_country).toBe('MX');
        c = setHolidayWorked(c, a!.id, '2026-09-16', true, true);
        c = setHolidayWorked(c, a!.id, '2026-04-02', false, false);
        expect(c.staff[0]!.availability.holiday_work).toEqual(['2026-09-16']);
        expect(c.staff[0]!.availability.holiday_off).toEqual(['2026-04-02']);
        c = copyHolidaysToAll(c, a!.id);
        expect(c.staff[1]!.availability.holiday_work).toEqual(['2026-09-16']);
        // Cambiar de país olvida lo marcado del anterior.
        c = setHolidayCountry(c, a!.id, 'CO');
        expect(c.staff[0]!.availability).toMatchObject({ holiday_country: 'CO', holiday_work: [], holiday_off: [] });
        c = setHolidayCountry(c, a!.id, null);
        expect(c.staff[0]!.availability.holiday_country).toBeNull();
    });

    it('v0.1.349 — vacaciones ordenadas y con el rango al derecho', () => {
        let c = addStaff(base(), 'user', 12).config;
        const id = c.staff[0]!.id;
        c = addTimeOff(c, id, '2026-12-31', '2026-12-20');
        c = addTimeOff(c, id, '2026-07-01', '2026-07-15', 'Viaje');
        expect(c.staff[0]!.availability.time_off.map((t) => [t.from, t.to])).toEqual([
            ['2026-07-01', '2026-07-15'],
            ['2026-12-20', '2026-12-31'],
        ]);
    });

    it('v0.1.349 — duraciones del servicio y su horario propio', () => {
        let c = base();
        const svc = c.services[0]!.id;
        c = toggleServiceDuration(c, svc, 60, true);
        c = toggleServiceDuration(c, svc, 90, true);
        expect(c.services[0]!.durations).toEqual([60, 90]);
        // La de por defecto no se agrega como extra.
        c = toggleServiceDuration(c, svc, c.services[0]!.duration_min, true);
        expect(c.services[0]!.durations).toEqual([60, 90]);
        // Cambiar la de por defecto: la anterior queda como opción.
        const before = c.services[0]!.duration_min;
        c = setDefaultDuration(c, svc, 60);
        expect(c.services[0]!.duration_min).toBe(60);
        expect(c.services[0]!.durations).toEqual([before, 90].sort((x, y) => x - y));
        c = setServiceHours(c, svc, true);
        expect(c.services[0]!.hours?.[1]).toEqual([{ start: '08:00', end: '12:00' }]);
        expect(c.services[0]!.hours?.[0]).toEqual([]);
        c = setServiceDayIntervals(c, svc, 6, [{ start: '09:00', end: '11:00' }]);
        expect(c.services[0]!.hours?.[6]).toEqual([{ start: '09:00', end: '11:00' }]);
        c = setServiceHours(c, svc, false);
        expect(c.services[0]!.hours).toBeNull();
    });

    it('v0.1.349 — un rango de fechas a medias se avisa en Reglas', () => {
        const c = { ...base(), rules: { ...base().rules, window_mode: 'range' as const, range_start: '2026-12-01', range_end: null } };
        expect(sectionProblems(c, fields).reglas?.length).toBeGreaterThan(0);
    });

    it('lo que falta por sección', () => {
        const p = sectionProblems(bookingConfigSchema.parse({}), fields);
        expect(Object.keys(p).sort()).toEqual(['atienden', 'campos', 'servicios']);
    });
});

function updatePrice(c: BookingConfig, price: number): BookingConfig {
    return { ...c, services: c.services.map((s) => ({ ...s, price })) };
}

describe('v0.1.350 — dónde es la cita y el calendario de cada persona', () => {
    function withVideo(staffPatch: Record<string, unknown> = {}): BookingConfig {
        return bookingConfigSchema.parse({
            services: [{ id: 'svcvid', name: 'Asesoría', duration_min: 30, location: { kind: 'video' } }],
            staff: [{ id: 'stfana', kind: 'user', staff_user_id: 12, ...staffPatch }],
            mapping: { start_field_id: 1, person_field_id: 2 },
        });
    }

    it('sabe qué calendario tiene cada persona: el suyo o la conexión de la empresa', () => {
        const c = bookingConfigSchema.parse({
            staff: [
                { id: 'stfana', kind: 'user', staff_user_id: 12, calendar_source: 'person' },
                { id: 'stfbeto', kind: 'user', staff_user_id: 13, calendar_source: 'connection', connection_id: 7 },
                { id: 'stfsala', kind: 'resource', name: 'Sala 1' },
            ],
        });
        const out = staffCalendarsFrom(c, [{ id: 12, calendar: { provider: 'google_calendar' } }, { id: 13, calendar: null }], [{ id: 7, provider: 'outlook' }]);
        expect(out).toEqual({ stfana: { provider: 'google_calendar' }, stfbeto: { provider: 'outlook' }, stfsala: { provider: null } });
    });

    it('una videollamada sin calendario ni enlace fijo se avisa en «Quién atiende», con el nombre', () => {
        const c = withVideo();
        const p = sectionProblems(c, fields, { staffCalendars: { stfana: { provider: null } }, memberNames: new Map([[12, 'Ana Ruiz']]) });
        expect(p.atienden?.[0]).toContain('«Ana Ruiz» no puede atender «Asesoría» por videollamada');
        // Con su Google Calendar, sí.
        expect(sectionProblems(c, fields, { staffCalendars: { stfana: { provider: 'google_calendar' } } }).atienden).toBeUndefined();
        // Con un enlace fijo, también.
        expect(sectionProblems(withVideo({ meeting_url: 'https://zoom.us/j/1' }), fields, { staffCalendars: { stfana: { provider: null } } }).atienden).toBeUndefined();
        // Teams pedido y su calendario es de Google: se avisa.
        const teams = { ...c, services: c.services.map((s) => ({ ...s, location: { ...s.location, video: 'teams' as const } })) };
        expect(sectionProblems(teams, fields, { staffCalendars: { stfana: { provider: 'google_calendar' } } }).atienden?.[0]).toContain('Microsoft Teams');
        // Sin saber de los calendarios (cargando), no se acusa a nadie.
        expect(sectionProblems(c, fields).atienden).toBeUndefined();
    });

    it('un enlace fijo, una dirección o un teléfono que faltan se avisan en Servicios', () => {
        const base2 = bookingConfigSchema.parse({ services: [{ id: 'svcuno', name: 'Consulta', duration_min: 30 }], staff: [{ id: 'stfana', kind: 'user', staff_user_id: 12 }] });
        const loc = (location: Record<string, unknown>): BookingConfig => bookingConfigSchema.parse({ ...base2, services: [{ ...base2.services[0], location }] });
        expect(sectionProblems(loc({ kind: 'link' }), fields).servicios?.[0]).toContain('enlace');
        expect(sectionProblems(loc({ kind: 'link', url: 'https://zoom.us/j/1' }), fields).servicios).toBeUndefined();
        expect(sectionProblems(loc({ kind: 'in_person' }), fields).servicios?.[0]).toContain('dirección');
        expect(sectionProblems(loc({ kind: 'phone', phone: 'company' }), fields).servicios?.[0]).toContain('número');
    });

    it('la vista previa dice dónde es cada servicio, sin enlaces', () => {
        const c = bookingConfigSchema.parse({
            services: [{ id: 'svcuno', name: 'Consulta', duration_min: 30, location: { kind: 'link', url: 'https://zoom.us/j/secreto' } }],
            staff: [{ id: 'stfana', kind: 'user', staff_user_id: 12 }],
        });
        const meta = buildPreviewMeta(c, {
            name: 'Agenda',
            fields,
            members: [{ id: 12, name: 'Ana' }],
            accent: '#0e7490',
            logoUrl: null,
            company: 'Acme',
            timeZone: 'America/Bogota',
            numberFormat: 'dot_comma',
            captchaProvider: null,
            dataConsent: null,
        });
        expect(meta.services[0]!.location.kind).toBe('link');
        expect(JSON.stringify(meta)).not.toContain('secreto');
    });

    it('v0.1.354 — la vista previa lleva el diseño: el de siempre, o el tema con su color y qué se muestra', () => {
        const ctx = {
            name: 'Agenda',
            fields,
            members: [{ id: 12, name: 'Ana' }],
            accent: '#0e7490',
            logoUrl: null,
            company: 'Acme',
            timeZone: 'America/Bogota',
            numberFormat: 'dot_comma' as const,
            captchaProvider: null,
            dataConsent: null,
        };
        const base = bookingConfigSchema.parse({ services: [{ id: 'svcuno', name: 'Consulta', duration_min: 30 }], staff: [{ id: 'stfana', kind: 'user', staff_user_id: 12 }] });
        const plain = buildPreviewMeta(base, ctx);
        // Sin tema: el de siempre de la agenda (con «Paso X de Y»), en el color de la marca.
        expect(plain.theme!.progress).toBe(BOOKING_CLASSIC_THEME.layout.progress);
        expect(plain.theme!.choice_style).toBe('list');
        expect(plain.accent_color).toBe('#0e7490');
        expect(plain.display).toMatchObject({ calendar_layout: 'side', slot_style: 'grid', week_start: 'monday' });
        const cards = publicThemePresets('#0e7490').find((x) => x.id === 'cards')!.theme;
        const themed = structuredClone(base);
        themed.settings.theme = { ...cards, colors: { ...cards.colors, accent: '#7c3aed' } };
        themed.settings.display = { ...themed.settings.display, show_prices: false, slot_style: 'list' };
        const meta = buildPreviewMeta(themed, ctx);
        expect(meta.theme!.choice_style).toBe('cards');
        expect(meta.accent_color).toBe('#7c3aed');
        expect(meta.display).toMatchObject({ show_prices: false, slot_style: 'list' });
    });
});
