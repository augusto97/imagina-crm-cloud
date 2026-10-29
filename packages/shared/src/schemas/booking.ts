import { z } from 'zod';
import type { PublicDataConsent } from './data-consent';
import { SMS_BOOKING_REMINDER_DEFAULT } from './sms';
import {
    FORM_FIELD_TYPES,
    formFieldItemSchema,
    formHeadingItemSchema,
    formTextItemSchema,
    type FormFieldType,
    type PublicFormCaptcha,
    type PublicFormItem,
} from './form';

/**
 * D5 — Agenda de citas pública, estilo Calendly.
 *
 * Una PÁGINA DE AGENDA es una puerta de entrada a una lista, como un
 * formulario (ADR-S39), pero en vez de preguntas libres ofrece HORARIOS: el
 * visitante elige un servicio, quién lo atiende (una persona del equipo o un
 * recurso: un consultorio, una sala) y un horario libre; la reserva crea el
 * registro de la cita en la lista.
 *
 * Todo lo que apunta a la lista va por ID (regla de oro nº 1): los campos del
 * mapeo terminan en `_field_id` (los recorren el blueprint y la migración de
 * empresa sin nombrarlos uno por uno) y las personas del equipo en
 * `staff_user_id`.
 *
 * La disponibilidad es SIEMPRE la del servidor (`computeBookingSlots`, puro y
 * en este paquete): horario semanal y excepciones en la zona horaria de la
 * empresa (ADR-S33) − citas ya tomadas (los registros de la lista que no
 * están cancelados) − márgenes − aviso mínimo − tope diario.
 */

// ─────────────────────────── Constantes ───────────────────────────

/** Qué le pasó a una cita (el disparador «Cuando se agenda, reprograma o cancela una cita»). */
export const BOOKING_EVENTS = ['booked', 'rescheduled', 'cancelled'] as const;
export type BookingEvent = (typeof BOOKING_EVENTS)[number];
export const BOOKING_EVENT_LABELS: Record<BookingEvent, string> = {
    booked: 'Se agendó',
    rescheduled: 'Se reprogramó',
    cancelled: 'Se canceló',
};
/** `{{cita.evento}}`: la palabra que va en un mensaje («Tu cita fue agendada»). */
export const BOOKING_EVENT_WORDS: Record<BookingEvent, string> = {
    booked: 'agendada',
    rescheduled: 'reprogramada',
    cancelled: 'cancelada',
};

/** Estado de una cita (columna `status` de `booking_appointments`). */
export const BOOKING_STATUSES = ['confirmed', 'rescheduled', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Etiquetas de las opciones que la página crea en el campo de estado si no existen. */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
    confirmed: 'Confirmada',
    rescheduled: 'Reprogramada',
    cancelled: 'Cancelada',
};

/** Cada cuánto se ofrecen los horarios (minutos). */
export const BOOKING_SLOT_INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

/** Preguntas extra: los tipos del formulario, salvo archivos (subir archivos a una cita queda para después). */
export const BOOKING_QUESTION_TYPES = FORM_FIELD_TYPES.filter((t) => t !== 'file') as Exclude<FormFieldType, 'file'>[];
const BOOKING_QUESTION_SET = new Set<string>(BOOKING_QUESTION_TYPES);
export function isBookingQuestionType(type: string): boolean {
    return BOOKING_QUESTION_SET.has(type);
}

/** Tipos aceptados por cada campo del mapeo (lo valida el servidor al guardar). */
export const BOOKING_MAPPING_TYPES = {
    start_field_id: ['datetime'],
    end_field_id: ['datetime'],
    duration_field_id: ['duration', 'number'],
    person_field_id: ['user'],
    resource_field_id: ['select', 'text'],
    service_field_id: ['select', 'text'],
    name_field_id: ['text'],
    email_field_id: ['email', 'text'],
    phone_field_id: ['phone', 'text'],
    status_field_id: ['select'],
} as const satisfies Record<string, readonly string[]>;
export type BookingMappingKey = keyof typeof BOOKING_MAPPING_TYPES;
export const BOOKING_MAPPING_KEYS = Object.keys(BOOKING_MAPPING_TYPES) as BookingMappingKey[];

export const BOOKING_MAX_SERVICES = 30;
export const BOOKING_MAX_STAFF = 30;
export const BOOKING_MAX_QUESTIONS = 30;
/** Días de horarios que se piden de una vez (un mes con margen). */
export const BOOKING_MAX_RANGE_DAYS = 62;

// ─────────────────────────── Esquemas ───────────────────────────

const itemIdSchema = z.string().regex(/^[a-z0-9]{4,24}$/);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** «08:30» (24 h). «24:00» vale sólo como fin de un tramo. */
const hhmm = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Usa el formato HH:MM');

/** Minutos desde la medianoche de un «HH:MM». */
export function hhmmToMinutes(v: string): number {
    const [h, m] = v.split(':').map(Number) as [number, number];
    return h * 60 + m;
}

/** Minutos → «HH:MM». */
export function minutesToHhmm(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const bookingIntervalSchema = z
    .object({ start: hhmm, end: hhmm })
    .refine((i) => hhmmToMinutes(i.end) > hhmmToMinutes(i.start), { message: 'El tramo termina antes de empezar' });
export type BookingInterval = z.infer<typeof bookingIntervalSchema>;

/** Horario de un día: varios tramos («8-12 y 14-18»). */
const dayScheduleSchema = z.array(bookingIntervalSchema).max(6).default([]);

/** Lunes a viernes, 8 a 12 y 14 a 18: el punto de partida de quien atiende. */
export function defaultBookingWeek(): BookingInterval[][] {
    const work: BookingInterval[] = [
        { start: '08:00', end: '12:00' },
        { start: '14:00', end: '18:00' },
    ];
    // Índice = día de la semana de JS (0 = domingo).
    return [[], work, work, work, work, work, []].map((d) => d.map((i) => ({ ...i })));
}

/** Un día con otro horario o cerrado (vacaciones, un sábado de jornada especial). */
export const bookingExceptionSchema = z.object({
    date: isoDate,
    closed: z.boolean().default(true),
    intervals: z.array(bookingIntervalSchema).max(6).default([]),
    note: z.string().max(120).default(''),
});
export type BookingException = z.infer<typeof bookingExceptionSchema>;

export const bookingAvailabilitySchema = z.object({
    /** 7 días, índice = día de la semana de JS (0 = domingo … 6 = sábado). */
    week: z.array(dayScheduleSchema).length(7).default(defaultBookingWeek),
    exceptions: z.array(bookingExceptionSchema).max(366).default([]),
    /** No atender los festivos de Colombia (salvo que una excepción diga otra cosa). */
    skip_holidays: z.boolean().default(true),
});
export type BookingAvailability = z.infer<typeof bookingAvailabilitySchema>;

/** Un tipo de cita. */
export const bookingServiceSchema = z.object({
    id: itemIdSchema,
    name: z.string().trim().min(1).max(120),
    duration_min: z.number().int().min(5).max(720).default(30),
    description: z.string().max(1000).default(''),
    /** Sólo informativo (no se cobra): en la moneda de la empresa. */
    price: z.number().min(0).max(1_000_000_000_000).nullable().default(null),
    /** El valor de la opción en el campo «servicio» de la lista (si es una selección). */
    option_value: z.string().max(190).nullable().default(null),
    active: z.boolean().default(true),
});
export type BookingServiceItem = z.infer<typeof bookingServiceSchema>;

/** Quien atiende: una persona del equipo o un recurso (sala, consultorio, vehículo). */
export const bookingStaffSchema = z.object({
    id: itemIdSchema,
    kind: z.enum(['user', 'resource']).default('user'),
    /** Persona del equipo (kind = user). */
    staff_user_id: z.number().int().positive().nullable().default(null),
    /** Nombre del recurso, o cómo se muestra la persona (vacío = su nombre). */
    name: z.string().max(120).default(''),
    /** El valor de la opción en el campo «recurso» de la lista (si es una selección). */
    option_value: z.string().max(190).nullable().default(null),
    /** Servicios que ofrece (vacío = todos). */
    services: z.array(itemIdSchema).max(BOOKING_MAX_SERVICES).default([]),
    availability: bookingAvailabilitySchema.default({}),
    /** Conexión de Google Calendar u Outlook de esta persona (Ajustes → Integraciones). */
    connection_id: z.number().int().positive().nullable().default(null),
    /** Descontar sus horarios ocupados de ese calendario (sólo inicio y fin). */
    read_busy: z.boolean().default(true),
    /** Crear el evento de cada cita en ese calendario. */
    create_events: z.boolean().default(true),
    active: z.boolean().default(true),
});
export type BookingStaff = z.infer<typeof bookingStaffSchema>;

export const bookingRulesSchema = z.object({
    buffer_before_min: z.number().int().min(0).max(240).default(0),
    buffer_after_min: z.number().int().min(0).max(240).default(0),
    /** No reservar (ni reprogramar o cancelar) con menos de esto de anticipación. */
    min_notice_min: z.number().int().min(0).max(60 * 24 * 60).default(120),
    /** Hasta cuántos días hacia adelante se puede reservar. */
    max_days_ahead: z.number().int().min(1).max(365).default(60),
    slot_interval_min: z
        .number()
        .int()
        .refine((v) => (BOOKING_SLOT_INTERVALS as readonly number[]).includes(v), { message: 'Intervalo no válido' })
        .default(30),
    /** Tope de citas por día por persona o recurso (null = sin tope). */
    max_per_day: z.number().int().min(1).max(200).nullable().default(null),
    allow_reschedule: z.boolean().default(true),
    allow_cancel: z.boolean().default(true),
});
export type BookingRules = z.infer<typeof bookingRulesSchema>;

const fieldRef = z.number().int().positive().nullable().default(null);

/** Qué campo de la lista guarda cada dato de la cita. */
export const bookingMappingSchema = z.object({
    start_field_id: fieldRef,
    end_field_id: fieldRef,
    duration_field_id: fieldRef,
    person_field_id: fieldRef,
    resource_field_id: fieldRef,
    service_field_id: fieldRef,
    name_field_id: fieldRef,
    email_field_id: fieldRef,
    phone_field_id: fieldRef,
    status_field_id: fieldRef,
    /** Valores (opción) del campo de estado. null = la página no escribe ese estado. */
    status_confirmed: z.string().max(190).nullable().default(null),
    status_rescheduled: z.string().max(190).nullable().default(null),
    status_cancelled: z.string().max(190).nullable().default(null),
});
export type BookingMapping = z.infer<typeof bookingMappingSchema>;

/** Preguntas extra: las mismas piezas del constructor de formularios (sin páginas). */
export const bookingQuestionSchema = z.discriminatedUnion('type', [formFieldItemSchema, formHeadingItemSchema, formTextItemSchema]);
export type BookingQuestion = z.infer<typeof bookingQuestionSchema>;

export const bookingReminderSchema = z.object({
    id: itemIdSchema,
    /** Cuánto antes del inicio sale el recordatorio. */
    minutes_before: z.number().int().min(10).max(60 * 24 * 14),
});
export type BookingReminder = z.infer<typeof bookingReminderSchema>;

export const bookingNotificationsSchema = z.object({
    /** Correo de confirmación al cliente (con el .ics y los enlaces para reprogramar o cancelar). */
    confirm_email: z.boolean().default(true),
    reminders: z
        .array(bookingReminderSchema)
        .max(5)
        .default(() => [
            { id: 'rem24h', minutes_before: 24 * 60 },
            { id: 'rem1h', minutes_before: 60 },
        ]),
    /** Si el equipo mueve o cancela la cita desde la app, avisarle al cliente por correo. */
    notify_client_on_team_change: z.boolean().default(true),
    /** Texto que va en el correo de confirmación (indicaciones, qué traer). */
    email_note: z.string().max(2000).default(''),
    /**
     * v0.1.332 — los MISMOS recordatorios también por SMS, con una conexión de
     * SMS de la empresa y un texto con `{{cita.*}}`. El teléfono es el del
     * campo «Teléfono» del mapeo de la página.
     */
    sms_reminders: z
        .object({
            enabled: z.boolean().default(false),
            connection_id: z.number().int().positive().nullable().default(null),
            text: z.string().max(1000).default(SMS_BOOKING_REMINDER_DEFAULT),
            strip_accents: z.boolean().default(true),
        })
        .default({}),
});
export type BookingNotifications = z.infer<typeof bookingNotificationsSchema>;

export const bookingSettingsSchema = z.object({
    title: z.string().max(200).default(''),
    description: z.string().max(5000).default(''),
    /** Dónde es la cita (dirección, «Videollamada»): se ve en la página, el correo y el .ics. */
    location: z.string().max(500).default(''),
    /** Color del botón y los detalles; null = el color de la marca. */
    accent_color: hexColor.nullable().default(null),
    show_logo: z.boolean().default(true),
    /** Sitios que pueden insertarla por iframe; vacío = cualquiera. */
    allowed_domains: z.array(z.string().max(253)).max(50).default([]),
    /** Con varias personas o recursos: el visitante elige (con «el primero disponible») o se asigna solo. */
    choose_staff: z.enum(['visitor', 'auto']).default('visitor'),
    /** Teléfono del cliente: pedirlo y si es obligatorio. */
    ask_phone: z.enum(['required', 'optional', 'hidden']).default('optional'),
    success_message: z.string().max(2000).default('Te enviamos la confirmación a tu correo.'),
    closed_message: z.string().max(1000).default('Esta agenda no está recibiendo reservas en este momento.'),
    captcha: z.boolean().default(false),
    /** Autorización de tratamiento de datos (Ley 1581): si la empresa la tiene activa. */
    data_consent: z.boolean().default(true),
});
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;

export const bookingConfigSchema = z.object({
    settings: bookingSettingsSchema.default({}),
    services: z.array(bookingServiceSchema).max(BOOKING_MAX_SERVICES).default([]),
    staff: z.array(bookingStaffSchema).max(BOOKING_MAX_STAFF).default([]),
    rules: bookingRulesSchema.default({}),
    mapping: bookingMappingSchema.default({}),
    questions: z.array(bookingQuestionSchema).max(BOOKING_MAX_QUESTIONS).default([]),
    notifications: bookingNotificationsSchema.default({}),
});
export type BookingConfig = z.infer<typeof bookingConfigSchema>;

// ─────────────────────────── DTOs de la app ───────────────────────────

export interface BookingPageDto {
    id: number;
    list_id: number;
    name: string;
    enabled: boolean;
    config: BookingConfig;
    /** Dirección pública relativa (`/api/v1/public/b/:token`). */
    public_path: string;
    /** La dirección absoluta (dominio propio de la empresa si responde). */
    public_url?: string;
    public_origin?: string;
    bookings_count: number;
    last_booked_at: string | null;
    /** Citas futuras confirmadas (para el contador del panel). */
    upcoming_count: number;
    /** Lo que impide publicarla, en lenguaje claro (vacío = lista para publicar). */
    problems: string[];
    created_at: string;
    updated_at: string;
}

export const createBookingPageSchema = z.object({
    name: z.string().trim().min(1).max(120),
    config: bookingConfigSchema.optional(),
});
export type CreateBookingPageInput = z.infer<typeof createBookingPageSchema>;

export const updateBookingPageSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    config: bookingConfigSchema.optional(),
    /** Emite una dirección nueva: la anterior deja de funcionar. */
    regenerate_token: z.boolean().optional(),
});
export type UpdateBookingPageInput = z.infer<typeof updateBookingPageSchema>;

/** Vista previa del constructor: los horarios con la configuración EN EDICIÓN. */
export const bookingPreviewSlotsSchema = z.object({
    config: bookingConfigSchema,
    service_id: itemIdSchema,
    staff_id: z.union([itemIdSchema, z.literal('any')]).default('any'),
    from: isoDate,
    to: isoDate,
});
export type BookingPreviewSlotsInput = z.infer<typeof bookingPreviewSlotsSchema>;

// ─────────────────────────── Público ───────────────────────────

export interface PublicBookingService {
    id: string;
    name: string;
    duration_min: number;
    description: string;
    /** Precio legible con la moneda de la empresa («$ 80.000»), o null. */
    price_label: string | null;
}

export interface PublicBookingStaff {
    id: string;
    name: string;
    kind: 'user' | 'resource';
    /** Servicios que ofrece (ids). */
    services: string[];
}

export interface PublicBookingMeta {
    title: string;
    description: string;
    location: string;
    accent_color: string;
    logo_url: string | null;
    company: string;
    /** Zona de la empresa: los horarios se calculan en ese reloj. */
    time_zone: string;
    time_zone_label: string;
    number_format: 'comma_dot' | 'dot_comma' | 'space_comma';
    services: PublicBookingService[];
    staff: PublicBookingStaff[];
    /** El visitante elige quién lo atiende (con «el primero disponible»). */
    choose_staff: boolean;
    ask_phone: 'required' | 'optional' | 'hidden';
    questions: PublicFormItem[];
    max_days_ahead: number;
    min_notice_min: number;
    /** null = recibe reservas; si no, el mensaje de cerrado. */
    closed: string | null;
    success_message: string;
    stamp: string;
    captcha?: PublicFormCaptcha | null;
    data_consent?: PublicDataConsent | null;
}

/** Un horario libre: inicio y fin (ISO UTC) y quién puede atenderlo. */
export interface PublicBookingSlot {
    start: string;
    end: string;
    staff: string[];
}

export interface PublicBookingSlots {
    slots: PublicBookingSlot[];
    /** Primer día (zona de la empresa) en el que se puede reservar. */
    first_day: string;
    /** Último día (zona de la empresa) en el que se puede reservar. */
    last_day: string;
}

export const bookingSlotsQuerySchema = z.object({
    service: itemIdSchema,
    staff: z.union([itemIdSchema, z.literal('any')]).default('any'),
    from: isoDate,
    to: isoDate,
});
export type BookingSlotsQuery = z.infer<typeof bookingSlotsQuerySchema>;

export const bookAppointmentSchema = z.object({
    service_id: itemIdSchema,
    staff_id: z.union([itemIdSchema, z.literal('any')]).default('any'),
    start: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().max(60).optional(),
    /** Preguntas extra: clave = id del campo como texto. */
    values: z.record(z.string().regex(/^\d{1,12}$/), z.unknown()).default({}),
    stamp: z.string().max(200),
    /** Campo trampa: una persona nunca lo ve ni lo llena. */
    hp: z.string().max(500).optional(),
    captcha: z.string().max(4096).optional(),
    consent: z.boolean().optional(),
    consent_version: z.number().int().positive().max(1_000_000).optional(),
    /** Zona horaria del visitante (para el correo). */
    time_zone: z.string().max(64).optional(),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

/** Resumen de una cita (confirmación, página de gestión). */
export interface PublicAppointmentSummary {
    service: string;
    staff: string;
    start: string;
    end: string;
    status: BookingStatus;
    location: string;
    client_name: string;
    time_zone: string;
    /** Enlaces del cliente (reprogramar / cancelar / agregar al calendario). */
    manage_url: string;
    ics_url: string;
    can_reschedule: boolean;
    can_cancel: boolean;
    /** Si no se puede reprogramar o cancelar: por qué (aviso mínimo, ya pasó). */
    locked_reason: string | null;
}

export interface BookAppointmentResult {
    ok: true;
    appointment: PublicAppointmentSummary | null;
}

export const rescheduleAppointmentSchema = z.object({
    start: z.string().datetime({ offset: true }),
    staff_id: z.union([itemIdSchema, z.literal('any')]).optional(),
    time_zone: z.string().max(64).optional(),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
    reason: z.string().max(500).optional(),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/** Lo que la página de gestión de una cita necesita (resumen + lo de la agenda para reprogramar). */
export interface PublicManageMeta {
    appointment: PublicAppointmentSummary;
    booking: PublicBookingMeta;
    service_id: string;
    staff_id: string;
}

// ─────────────────────────── Disparador ───────────────────────────

/** Lo que el disparador «Cuando se agenda, reprograma o cancela una cita» lleva al motor. */
export interface BookingEventInfo {
    page_id: number;
    page_name: string;
    event: BookingEvent;
    /** Quién lo hizo: el cliente desde la página o el enlace, o el equipo desde la app. */
    by: 'client' | 'team';
    service: string;
    staff: string;
    /** ISO UTC. */
    start: string;
    end: string;
    /** Inicio y fin anteriores (sólo al reprogramar). */
    previous_start: string | null;
    previous_end: string | null;
    client_name: string;
    client_email: string;
    manage_url: string;
    cancel_url: string;
    time_zone: string;
}

/** ¿El evento coincide con el disparador? Sin página = cualquiera; sin eventos = los tres. */
export function bookingTriggerMatches(cfg: Record<string, unknown>, info: Pick<BookingEventInfo, 'page_id' | 'event'>): boolean {
    const page = Number(cfg.booking_page_id);
    if (Number.isInteger(page) && page > 0 && page !== info.page_id) return false;
    const events = Array.isArray(cfg.events) ? cfg.events.filter((e): e is BookingEvent => (BOOKING_EVENTS as readonly string[]).includes(String(e))) : [];
    return events.length === 0 || events.includes(info.event);
}

/**
 * «martes 3 de noviembre de 2026, 10:00 a. m.» en el reloj de `timeZone`.
 * Lo usan los correos, los avisos y `{{cita.inicio}}`: una persona lo lee.
 */
export function formatBookingWhen(
    iso: string,
    timeZone: string,
    timeFormat: 'h24' | 'h12' = 'h24',
    opts: { year?: boolean; weekday?: boolean } = {},
): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const tz = timeZone || 'UTC';
    const parts = new Intl.DateTimeFormat('es-CO', {
        timeZone: tz,
        ...(opts.weekday === false ? {} : { weekday: 'long' }),
        day: 'numeric',
        month: 'long',
        ...(opts.year === false ? {} : { year: 'numeric' }),
    }).format(d);
    return `${parts}, ${formatBookingTime(iso, tz, timeFormat)}`;
}

/** «10:00» o «10:00 a. m.» en el reloj de `timeZone`. */
export function formatBookingTime(iso: string, timeZone: string, timeFormat: 'h24' | 'h12' = 'h24'): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24;
    const m = p.find((x) => x.type === 'minute')?.value ?? '00';
    if (timeFormat === 'h12') return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
    return `${String(h).padStart(2, '0')}:${m}`;
}

/** El valor de `{{cita.x}}` (vacío sin cita). Las fechas, legibles en la zona de la empresa. */
export function bookingMergeValue(info: BookingEventInfo | undefined | null, key: string, timeFormat: 'h24' | 'h12' = 'h24'): string {
    if (!info) return '';
    switch (key) {
        case 'evento':
            return BOOKING_EVENT_WORDS[info.event];
        case 'evento_clave':
            return info.event;
        case 'servicio':
            return info.service;
        case 'persona':
            return info.staff;
        case 'inicio':
            return formatBookingWhen(info.start, info.time_zone, timeFormat);
        case 'fin':
            return formatBookingWhen(info.end, info.time_zone, timeFormat);
        case 'hora':
            return formatBookingTime(info.start, info.time_zone, timeFormat);
        case 'inicio_iso':
            return info.start;
        case 'fin_iso':
            return info.end;
        case 'inicio_anterior':
            return info.previous_start ? formatBookingWhen(info.previous_start, info.time_zone, timeFormat) : '';
        case 'cliente':
            return info.client_name;
        case 'email':
            return info.client_email;
        case 'pagina':
            return info.page_name;
        case 'enlace_reprogramar':
            return info.manage_url;
        case 'enlace_cancelar':
            return info.cancel_url;
        case 'por':
            return info.by === 'team' ? 'el equipo' : 'el cliente';
        default:
            return '';
    }
}

/** Una cita de ejemplo (la prueba de una automatización sin cita real). */
export function sampleBookingEvent(event: BookingEvent = 'booked', now: Date = new Date()): BookingEventInfo {
    const start = new Date(Math.ceil((now.getTime() + 2 * 86_400_000) / 3_600_000) * 3_600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
        page_id: 0,
        page_name: 'Agenda (ejemplo)',
        event,
        by: 'client',
        service: 'Consulta (ejemplo)',
        staff: 'Quien atiende (ejemplo)',
        start: start.toISOString(),
        end: end.toISOString(),
        previous_start: event === 'rescheduled' ? new Date(start.getTime() - 86_400_000).toISOString() : null,
        previous_end: event === 'rescheduled' ? new Date(end.getTime() - 86_400_000).toISOString() : null,
        client_name: 'Cliente de ejemplo',
        client_email: 'cliente@ejemplo.com',
        manage_url: 'https://ejemplo.com/cita',
        cancel_url: 'https://ejemplo.com/cita?accion=cancelar',
        time_zone: 'UTC',
    };
}

/** Variables `{{cita.x}}` del disparador (para el selector del editor). */
export const BOOKING_MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
    { tag: 'cita.evento', label: 'Qué pasó (agendada, reprogramada o cancelada)' },
    { tag: 'cita.servicio', label: 'Servicio' },
    { tag: 'cita.persona', label: 'Quién atiende' },
    { tag: 'cita.inicio', label: 'Inicio (fecha y hora)' },
    { tag: 'cita.fin', label: 'Fin (fecha y hora)' },
    { tag: 'cita.hora', label: 'Hora de inicio' },
    { tag: 'cita.inicio_anterior', label: 'Inicio anterior (al reprogramar)' },
    { tag: 'cita.inicio_iso', label: 'Inicio en formato ISO (para webhooks)' },
    { tag: 'cita.cliente', label: 'Nombre del cliente' },
    { tag: 'cita.email', label: 'Correo del cliente' },
    { tag: 'cita.pagina', label: 'Página de agenda' },
    { tag: 'cita.enlace_reprogramar', label: 'Enlace para reprogramar' },
    { tag: 'cita.enlace_cancelar', label: 'Enlace para cancelar' },
];

// ─────────────────────────── Ayudas puras ───────────────────────────

/** «$ 80.000» con los separadores de la empresa (el precio es sólo informativo). */
export function bookingPriceLabel(price: number | null, numberFormat: 'comma_dot' | 'dot_comma' | 'space_comma'): string | null {
    if (price === null) return null;
    const int = Math.round(price) === price;
    const fixed = int ? String(Math.round(price)) : price.toFixed(2);
    const [whole = '0', dec] = fixed.split('.');
    const sep = numberFormat === 'comma_dot' ? ',' : numberFormat === 'dot_comma' ? '.' : ' ';
    const decSep = numberFormat === 'comma_dot' ? '.' : ',';
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return `$ ${grouped}${dec ? `${decSep}${dec}` : ''}`;
}

/** Id corto y estable para un servicio, una persona o un recordatorio nuevo. */
export function newBookingItemId(prefix = ''): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = prefix;
    while (s.length < 10) s += chars[Math.floor(Math.random() * chars.length)];
    return s.slice(0, 24);
}

/** Lo que hay que completar antes de poder publicar (en lenguaje claro). */
export function bookingProblems(
    config: BookingConfig,
    fields: ReadonlyArray<{ id: number; type: string }>,
): string[] {
    const out: string[] = [];
    const typeOf = new Map(fields.map((f) => [f.id, f.type]));
    const m = config.mapping;
    if (m.start_field_id === null || typeOf.get(m.start_field_id) !== 'datetime') {
        out.push('Elige el campo de fecha y hora donde se guarda el inicio de la cita (Campos de la lista).');
    }
    if (!config.services.some((s) => s.active)) out.push('Agrega al menos un servicio.');
    const staff = config.staff.filter((s) => s.active);
    if (staff.length === 0) out.push('Agrega al menos una persona o recurso que atienda.');
    if (staff.some((s) => s.kind === 'user') && m.person_field_id === null) {
        out.push('Elige el campo Persona donde se guarda quién atiende (Campos de la lista).');
    }
    if (staff.some((s) => s.kind === 'resource') && m.resource_field_id === null) {
        out.push('Elige el campo donde se guarda el recurso (Campos de la lista).');
    }
    if (staff.some((s) => s.kind === 'user' && s.staff_user_id === null)) out.push('Hay una persona sin elegir en «Quién atiende».');
    for (const s of staff) {
        const week = s.availability.week.some((d) => d.length > 0);
        const extra = s.availability.exceptions.some((e) => !e.closed && e.intervals.length > 0);
        if (!week && !extra) out.push(`«${staffLabel(s)}» no tiene horario: agrégale al menos un tramo.`);
    }
    // SMS (ADR-S82): los recordatorios por SMS necesitan la conexión y el teléfono del cliente.
    const sms = config.notifications.sms_reminders;
    if (sms.enabled) {
        if (sms.connection_id === null) out.push('Elige la conexión de SMS de los recordatorios (Correos y recordatorios).');
        if (m.phone_field_id === null) out.push('Elige el campo donde se guarda el teléfono del cliente (Campos de la lista): sin él no hay a quién mandarle el SMS.');
        if (config.settings.ask_phone === 'hidden') out.push('La página no pide el teléfono: pídelo (opcional u obligatorio) para mandar los recordatorios por SMS.');
        if (config.notifications.reminders.length === 0) out.push('Agrega al menos un recordatorio (por ejemplo, 24 horas antes) para mandarlo por SMS.');
        if (sms.text.trim() === '') out.push('Escribe el texto del recordatorio por SMS.');
    }
    return out;
}

/** Nombre de quien atiende para los mensajes (la persona se nombra en el servidor). */
export function staffLabel(s: Pick<BookingStaff, 'name' | 'kind' | 'staff_user_id'>): string {
    if (s.name.trim() !== '') return s.name.trim();
    return s.kind === 'resource' ? 'Recurso sin nombre' : 'Persona del equipo';
}

/** ¿Este servicio lo ofrece esta persona o recurso? */
export function staffOffers(staff: Pick<BookingStaff, 'services'>, serviceId: string): boolean {
    return staff.services.length === 0 || staff.services.includes(serviceId);
}

/** Configuración de arranque de una página: un servicio y la persona que la crea. */
export function defaultBookingConfig(input: {
    listName: string;
    userId: number | null;
    fields: ReadonlyArray<{ id: number; type: string; slug: string; label: string }>;
}): BookingConfig {
    const pick = (types: readonly string[], hints: RegExp): number | null => {
        const byHint = input.fields.find((f) => types.includes(f.type) && hints.test(`${f.slug} ${f.label}`));
        return (byHint ?? input.fields.find((f) => types.includes(f.type)))?.id ?? null;
    };
    const pickHint = (types: readonly string[], hints: RegExp): number | null =>
        input.fields.find((f) => types.includes(f.type) && hints.test(`${f.slug} ${f.label}`))?.id ?? null;
    return bookingConfigSchema.parse({
        settings: { title: input.listName },
        services: [{ id: newBookingItemId('svc'), name: 'Cita', duration_min: 30 }],
        staff:
            input.userId !== null
                ? [{ id: newBookingItemId('stf'), kind: 'user', staff_user_id: input.userId }]
                : [],
        mapping: {
            start_field_id: pick(['datetime'], /fecha|inicio|hora|start|cita/i),
            end_field_id: pickHint(['datetime'], /fin\b|termina|end/i),
            duration_field_id: pick(['duration'], /duraci/i),
            person_field_id: pick(['user'], /profesional|responsable|asesor|atiende|persona|asignad/i),
            service_field_id: pickHint(['select', 'text'], /servicio|tipo|motivo|service/i),
            name_field_id: pickHint(['text'], /cliente|nombre|paciente|name/i),
            email_field_id: pick(['email'], /correo|email|mail/i),
            phone_field_id: pick(['phone'], /tel|celular|whatsapp|phone/i),
            status_field_id: pickHint(['select'], /estado|status/i),
        },
    });
}
