import {
    BOOKING_MAPPING_KEYS,
    BOOKING_MAPPING_TYPES,
    BOOKING_MAX_QUESTIONS,
    BOOKING_MAX_SERVICES,
    BOOKING_MAX_STAFF,
    bookingPriceLabel,
    buildPublicFormItems,
    defaultBookingWeek,
    isBookingQuestionType,
    newBookingItemId,
    newFormItemId,
    staffLabel,
    timeZoneLabel,
    type BookingConfig,
    type BookingException,
    type BookingInterval,
    type BookingMappingKey,
    type BookingQuestion,
    type BookingServiceItem,
    type BookingStaff,
    type PublicBookingMeta,
} from '@imagina-base/shared';

/**
 * D5 — Operaciones PURAS del constructor de la agenda (sin React): cada una
 * devuelve una configuración nueva. El constructor sólo las llama y guarda el
 * historial; los tests las prueban solas.
 */

type FieldLike = { id: number; type: string; slug: string; label: string; is_required?: boolean; config?: unknown };

// ── Servicios ───────────────────────────────────────────────────────────

export function addService(config: BookingConfig, name = 'Servicio nuevo'): { config: BookingConfig; id: string } {
    const id = newBookingItemId('svc');
    if (config.services.length >= BOOKING_MAX_SERVICES) return { config, id: config.services[config.services.length - 1]?.id ?? id };
    const svc: BookingServiceItem = { id, name, duration_min: 30, description: '', price: null, option_value: null, active: true };
    return { config: { ...config, services: [...config.services, svc] }, id };
}

export function updateService(config: BookingConfig, id: string, patch: Partial<BookingServiceItem>): BookingConfig {
    return { ...config, services: config.services.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Quitar un servicio también lo saca de lo que ofrece cada persona o recurso. */
export function removeService(config: BookingConfig, id: string): BookingConfig {
    return {
        ...config,
        services: config.services.filter((s) => s.id !== id),
        staff: config.staff.map((st) => ({ ...st, services: st.services.filter((x) => x !== id) })),
    };
}

export function moveService(config: BookingConfig, id: string, delta: -1 | 1): BookingConfig {
    return { ...config, services: moveBy(config.services, id, delta) };
}

// ── Quién atiende ───────────────────────────────────────────────────────

export function addStaff(config: BookingConfig, kind: 'user' | 'resource', userId: number | null = null): { config: BookingConfig; id: string } {
    const id = newBookingItemId('stf');
    if (config.staff.length >= BOOKING_MAX_STAFF) return { config, id: config.staff[config.staff.length - 1]?.id ?? id };
    const st: BookingStaff = {
        id,
        kind,
        staff_user_id: kind === 'user' ? userId : null,
        name: kind === 'resource' ? 'Recurso nuevo' : '',
        option_value: null,
        services: [],
        availability: { week: defaultBookingWeek(), exceptions: [], skip_holidays: true },
        connection_id: null,
        read_busy: true,
        create_events: true,
        active: true,
    };
    return { config: { ...config, staff: [...config.staff, st] }, id };
}

export function updateStaff(config: BookingConfig, id: string, patch: Partial<BookingStaff>): BookingConfig {
    return { ...config, staff: config.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeStaff(config: BookingConfig, id: string): BookingConfig {
    return { ...config, staff: config.staff.filter((s) => s.id !== id) };
}

/** ¿Qué servicios ofrece? Vacío = todos; marcar todos de nuevo vuelve a «todos». */
export function toggleStaffService(config: BookingConfig, staffId: string, serviceId: string, on: boolean): BookingConfig {
    const st = config.staff.find((s) => s.id === staffId);
    if (!st) return config;
    const all = config.services.map((s) => s.id);
    const current = st.services.length === 0 ? all : st.services;
    const next = on ? [...new Set([...current, serviceId])] : current.filter((x) => x !== serviceId);
    const normalized = next.length === all.length && all.every((x) => next.includes(x)) ? [] : all.filter((x) => next.includes(x));
    return updateStaff(config, staffId, { services: normalized });
}

// ── Disponibilidad ──────────────────────────────────────────────────────

function setAvailability(config: BookingConfig, staffId: string, fn: (a: BookingStaff['availability']) => BookingStaff['availability']): BookingConfig {
    return { ...config, staff: config.staff.map((s) => (s.id === staffId ? { ...s, availability: fn(s.availability) } : s)) };
}

export function setDayIntervals(config: BookingConfig, staffId: string, dow: number, intervals: BookingInterval[]): BookingConfig {
    return setAvailability(config, staffId, (a) => ({ ...a, week: a.week.map((d, i) => (i === dow ? intervals : d)) }));
}

/** Copiar el horario de un día a los días hábiles (lunes a viernes). */
export function copyDayToWeekdays(config: BookingConfig, staffId: string, fromDow: number): BookingConfig {
    return setAvailability(config, staffId, (a) => {
        const src = a.week[fromDow] ?? [];
        return { ...a, week: a.week.map((d, i) => (i >= 1 && i <= 5 ? src.map((x) => ({ ...x })) : d)) };
    });
}

/** Un tramo nuevo después del último del día (o 08:00–12:00 si no hay). */
export function nextInterval(day: BookingInterval[]): BookingInterval | null {
    const last = day[day.length - 1];
    if (!last) return { start: '08:00', end: '12:00' };
    const [h, m] = last.end.split(':').map(Number) as [number, number];
    const startMin = h * 60 + m + 60;
    if (startMin >= 23 * 60) return null;
    const endMin = Math.min(startMin + 4 * 60, 24 * 60);
    const fmt = (v: number): string => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    return { start: fmt(startMin), end: endMin === 24 * 60 ? '24:00' : fmt(endMin) };
}

export function setException(config: BookingConfig, staffId: string, ex: BookingException): BookingConfig {
    return setAvailability(config, staffId, (a) => ({
        ...a,
        exceptions: [...a.exceptions.filter((e) => e.date !== ex.date), ex].sort((x, y) => x.date.localeCompare(y.date)),
    }));
}

export function removeException(config: BookingConfig, staffId: string, date: string): BookingConfig {
    return setAvailability(config, staffId, (a) => ({ ...a, exceptions: a.exceptions.filter((e) => e.date !== date) }));
}

/** ¿Algún tramo del día se pisa con otro o termina antes de empezar? */
export function dayProblem(day: BookingInterval[]): string | null {
    const sorted = [...day].sort((a, b) => a.start.localeCompare(b.start));
    for (const [i, t] of sorted.entries()) {
        if (t.end <= t.start) return 'Un tramo termina antes de empezar.';
        const next = sorted[i + 1];
        if (next && next.start < t.end) return 'Dos tramos se pisan.';
    }
    return null;
}

// ── Campos de la lista ──────────────────────────────────────────────────

/** Los campos de la lista que sirven para un dato de la cita. */
export function mappingCandidates<F extends FieldLike>(fields: readonly F[], key: BookingMappingKey): F[] {
    const types = BOOKING_MAPPING_TYPES[key] as readonly string[];
    return fields.filter((f) => types.includes(f.type));
}

export function setMapping(config: BookingConfig, key: BookingMappingKey, fieldId: number | null): BookingConfig {
    const mapping = { ...config.mapping, [key]: fieldId };
    // Otro campo de estado: los valores elegidos eran del anterior.
    if (key === 'status_field_id' && fieldId !== config.mapping.status_field_id) {
        mapping.status_confirmed = null;
        mapping.status_rescheduled = null;
        mapping.status_cancelled = null;
    }
    // Un campo que ahora escribe la página deja de ser una pregunta.
    const questions = fieldId === null ? config.questions : config.questions.filter((q) => q.type !== 'field' || q.field_id !== fieldId);
    return { ...config, mapping, questions };
}

/** Los campos que todavía se pueden preguntar (no los escribe la página, no están ya). */
export function availableQuestionFields<F extends FieldLike>(fields: readonly F[], config: BookingConfig): F[] {
    const mapped = new Set(BOOKING_MAPPING_KEYS.map((k) => config.mapping[k]).filter((v): v is number => typeof v === 'number'));
    const asked = new Set(config.questions.flatMap((q) => (q.type === 'field' ? [q.field_id] : [])));
    return fields.filter((f) => isBookingQuestionType(f.type) && !mapped.has(f.id) && !asked.has(f.id));
}

export function addQuestion(config: BookingConfig, fieldId: number): BookingConfig {
    if (config.questions.length >= BOOKING_MAX_QUESTIONS) return config;
    const q: BookingQuestion = {
        id: newFormItemId(),
        type: 'field',
        field_id: fieldId,
        label: '',
        help: '',
        placeholder: '',
        required: false,
        hidden: false,
        display: 'auto',
        show_if: null,
    } as BookingQuestion;
    return { ...config, questions: [...config.questions, q] };
}

export function updateQuestion(config: BookingConfig, id: string, patch: Record<string, unknown>): BookingConfig {
    return { ...config, questions: config.questions.map((q) => (q.id === id ? ({ ...q, ...patch } as BookingQuestion) : q)) };
}

export function removeQuestion(config: BookingConfig, id: string): BookingConfig {
    // Una condición que dependía de esta pregunta se suelta.
    const removed = config.questions.find((q) => q.id === id);
    const fid = removed?.type === 'field' ? removed.field_id : null;
    return {
        ...config,
        questions: config.questions
            .filter((q) => q.id !== id)
            .map((q) => (fid !== null && q.show_if?.field_id === fid ? ({ ...q, show_if: null } as BookingQuestion) : q)),
    };
}

export function moveQuestion(config: BookingConfig, id: string, delta: -1 | 1): BookingConfig {
    return { ...config, questions: moveBy(config.questions, id, delta) };
}

// ── Recordatorios ───────────────────────────────────────────────────────

export function setReminders(config: BookingConfig, minutes: number[]): BookingConfig {
    const unique = [...new Set(minutes.filter((m) => Number.isInteger(m) && m >= 10 && m <= 20_160))].sort((a, b) => b - a).slice(0, 5);
    return {
        ...config,
        notifications: {
            ...config.notifications,
            reminders: unique.map((m) => config.notifications.reminders.find((r) => r.minutes_before === m) ?? { id: `rem${m}`.slice(0, 24), minutes_before: m }),
        },
    };
}

/** «1 día antes», «2 h antes», «30 min antes». */
export function reminderLabel(minutes: number): string {
    if (minutes % 1440 === 0) return minutes === 1440 ? '1 día antes' : `${minutes / 1440} días antes`;
    if (minutes % 60 === 0) return minutes === 60 ? '1 hora antes' : `${minutes / 60} horas antes`;
    return `${minutes} min antes`;
}

// ── Vista previa ────────────────────────────────────────────────────────

export interface PreviewContext {
    name: string;
    fields: readonly FieldLike[];
    members: ReadonlyArray<{ id: number; name: string }>;
    accent: string;
    logoUrl: string | null;
    company: string;
    timeZone: string;
    numberFormat: 'comma_dot' | 'dot_comma' | 'space_comma';
    captchaProvider: string | null;
    dataConsent: PublicBookingMeta['data_consent'];
}

/**
 * Lo que la página pública recibe del servidor, armado con la configuración
 * EN EDICIÓN (la vista previa usa la página real: lo que se ve es lo que se
 * publica). Los horarios los pide la página aparte.
 */
export function buildPreviewMeta(config: BookingConfig, ctx: PreviewContext): PublicBookingMeta {
    const s = config.settings;
    const names = new Map(ctx.members.map((m) => [m.id, m.name]));
    const staff = config.staff.filter((x) => x.active && (x.kind === 'resource' || x.staff_user_id !== null));
    const questionFields = ctx.fields.filter((f) => isBookingQuestionType(f.type)) as Parameters<typeof buildPublicFormItems>[1];
    return {
        title: s.title || ctx.name,
        description: s.description,
        location: s.location,
        accent_color: s.accent_color ?? ctx.accent,
        logo_url: s.show_logo ? ctx.logoUrl : null,
        company: ctx.company,
        time_zone: ctx.timeZone,
        time_zone_label: timeZoneLabel(ctx.timeZone),
        number_format: ctx.numberFormat,
        services: config.services
            .filter((x) => x.active && staff.some((st) => st.services.length === 0 || st.services.includes(x.id)))
            .map((x) => ({ id: x.id, name: x.name, duration_min: x.duration_min, description: x.description, price_label: bookingPriceLabel(x.price, ctx.numberFormat) })),
        staff: staff.map((x) => ({
            id: x.id,
            name: x.name.trim() || (x.kind === 'user' && x.staff_user_id !== null ? (names.get(x.staff_user_id) ?? staffLabel(x)) : staffLabel(x)),
            kind: x.kind,
            services: x.services,
        })),
        choose_staff: s.choose_staff === 'visitor' && staff.length > 1,
        ask_phone: s.ask_phone,
        questions: buildPublicFormItems({ items: config.questions, settings: {} } as never, questionFields),
        max_days_ahead: config.rules.max_days_ahead,
        min_notice_min: config.rules.min_notice_min,
        closed: null,
        success_message: s.success_message,
        stamp: '',
        captcha: s.captcha && ctx.captchaProvider ? ({ provider: ctx.captchaProvider, site_key: '' } as PublicBookingMeta['captcha']) : null,
        data_consent: s.data_consent ? ctx.dataConsent : null,
    };
}

/** Lo que falta por sección del constructor (para el punto rojo de cada una). */
export type BookingSection = 'servicios' | 'atienden' | 'disponibilidad' | 'reglas' | 'campos' | 'correos' | 'publicar';

export function sectionProblems(config: BookingConfig, fields: readonly FieldLike[]): Partial<Record<BookingSection, string[]>> {
    const out: Partial<Record<BookingSection, string[]>> = {};
    const push = (k: BookingSection, msg: string): void => {
        (out[k] ??= []).push(msg);
    };
    const typeOf = new Map(fields.map((f) => [f.id, f.type]));
    if (!config.services.some((s) => s.active)) push('servicios', 'Agrega al menos un servicio.');
    const staff = config.staff.filter((s) => s.active);
    if (staff.length === 0) push('atienden', 'Agrega al menos una persona o recurso que atienda.');
    if (staff.some((s) => s.kind === 'user' && s.staff_user_id === null)) push('atienden', 'Hay una persona sin elegir.');
    for (const s of staff) {
        const week = s.availability.week.some((d) => d.length > 0);
        const extra = s.availability.exceptions.some((e) => !e.closed && e.intervals.length > 0);
        if (!week && !extra) push('disponibilidad', 'Alguien no tiene horario.');
        if (s.availability.week.some((d) => dayProblem(d) !== null)) push('disponibilidad', 'Hay tramos que se pisan o terminan antes de empezar.');
    }
    const m = config.mapping;
    if (m.start_field_id === null || typeOf.get(m.start_field_id) !== 'datetime') push('campos', 'Elige el campo de fecha y hora del inicio.');
    if (staff.some((s) => s.kind === 'user') && m.person_field_id === null) push('campos', 'Elige el campo Persona de quién atiende.');
    if (staff.some((s) => s.kind === 'resource') && m.resource_field_id === null) push('campos', 'Elige el campo del recurso.');
    return out;
}

function moveBy<T extends { id: string }>(items: readonly T[], id: string, delta: -1 | 1): T[] {
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return [...items];
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
}
