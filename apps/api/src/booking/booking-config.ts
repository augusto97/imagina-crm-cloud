import { randomBytes } from 'node:crypto';
import {
    BOOKING_MAPPING_KEYS,
    BOOKING_MAPPING_TYPES,
    bookingConfigSchema,
    isBookingQuestionType,
    jsonbKeyForField,
    type BookingConfig,
    type BookingMapping,
    type BookingServiceItem,
    type BookingStaff,
    type BookingStatus,
    type Field,
} from '@imagina-base/shared';

/**
 * D5 — Piezas puras de la agenda en el servidor: leer y sanear la
 * configuración contra los campos REALES de la lista y armar el `data` del
 * registro de una cita. Sin base ni red (se testean aparte).
 */

export function newBookingToken(): string {
    return randomBytes(18).toString('base64url');
}

/** La configuración guardada (tolerante: lo que no valida cae al default). */
export function readBookingConfig(raw: unknown): BookingConfig {
    const parsed = bookingConfigSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : bookingConfigSchema.parse({});
}

type FieldLike = Pick<Field, 'id' | 'type' | 'config'>;

/** Campos que la PÁGINA escribe: no se pueden preguntar como pregunta extra. */
export function mappedFieldIds(m: BookingMapping): Set<number> {
    return new Set(BOOKING_MAPPING_KEYS.map((k) => m[k]).filter((v): v is number => typeof v === 'number'));
}

function optionValues(field: FieldLike | undefined): Set<string> {
    const raw = (field?.config as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.flatMap((o) => (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string' ? [(o as { value: string }).value] : [])));
}

/**
 * Deja la configuración coherente con la lista: cada campo del mapeo existe y
 * es de un tipo que sirve (si no, queda sin elegir), las preguntas extra son
 * campos que se pueden preguntar y que la página no escribe, las personas que
 * no son del equipo se quitan (`members` = ids de quienes pueden atender) y
 * nada se repite. Un campo borrado o convertido deja de romper la página.
 */
export function sanitizeBookingConfig(config: BookingConfig, fields: ReadonlyArray<FieldLike>, members?: ReadonlySet<number>): BookingConfig {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const mapping: Record<string, unknown> = { ...config.mapping };
    for (const key of BOOKING_MAPPING_KEYS) {
        const id = config.mapping[key];
        const f = id !== null ? byId.get(id) : undefined;
        if (!f || !(BOOKING_MAPPING_TYPES[key] as readonly string[]).includes(f.type)) mapping[key] = null;
    }
    // Los valores de estado tienen que existir en las opciones del campo.
    const statusField = typeof mapping.status_field_id === 'number' ? byId.get(mapping.status_field_id) : undefined;
    const statusOpts = optionValues(statusField);
    for (const k of ['status_confirmed', 'status_rescheduled', 'status_cancelled'] as const) {
        const v = config.mapping[k];
        if (!statusField || v === null || !statusOpts.has(v)) mapping[k] = null;
    }
    const cleanMapping = mapping as BookingMapping;

    // Servicios: ids únicos; la opción del campo «servicio» sólo si existe.
    const serviceField = cleanMapping.service_field_id !== null ? byId.get(cleanMapping.service_field_id) : undefined;
    const serviceOpts = serviceField?.type === 'select' ? optionValues(serviceField) : null;
    const seenSvc = new Set<string>();
    const services: BookingServiceItem[] = [];
    for (const s of config.services) {
        if (seenSvc.has(s.id)) continue;
        seenSvc.add(s.id);
        services.push({ ...s, option_value: serviceOpts && s.option_value !== null && serviceOpts.has(s.option_value) ? s.option_value : null });
    }

    // Quién atiende: una persona una sola vez, sólo del equipo; recursos con nombre.
    const resourceField = cleanMapping.resource_field_id !== null ? byId.get(cleanMapping.resource_field_id) : undefined;
    const resourceOpts = resourceField?.type === 'select' ? optionValues(resourceField) : null;
    const seenUser = new Set<number>();
    const seenStaff = new Set<string>();
    const staff: BookingStaff[] = [];
    for (const s of config.staff) {
        if (seenStaff.has(s.id)) continue;
        seenStaff.add(s.id);
        let userId = s.kind === 'user' ? s.staff_user_id : null;
        if (userId !== null && (seenUser.has(userId) || (members && !members.has(userId)))) userId = null;
        if (userId !== null) seenUser.add(userId);
        const exceptions = [...new Map(s.availability.exceptions.map((e) => [e.date, e])).values()].sort((a, b) => a.date.localeCompare(b.date));
        staff.push({
            ...s,
            staff_user_id: userId,
            option_value: s.kind === 'resource' && resourceOpts && s.option_value !== null && resourceOpts.has(s.option_value) ? s.option_value : null,
            services: s.services.filter((id) => seenSvc.has(id)),
            availability: { ...s.availability, exceptions },
        });
    }

    // Preguntas extra: campos que se pueden preguntar, no escritos por la página, una vez.
    const mapped = mappedFieldIds(cleanMapping);
    const seenQ = new Set<number>();
    const seenItem = new Set<string>();
    const questions = config.questions.filter((q) => {
        if (seenItem.has(q.id)) return false;
        seenItem.add(q.id);
        if (q.type !== 'field') return true;
        const f = byId.get(q.field_id);
        if (!f || !isBookingQuestionType(f.type) || mapped.has(f.id) || seenQ.has(f.id)) return false;
        seenQ.add(f.id);
        return true;
    });
    const inForm = new Set(questions.flatMap((q) => (q.type === 'field' ? [q.field_id] : [])));
    const cleanQuestions = questions.map((q) => (q.show_if && !inForm.has(q.show_if.field_id) ? { ...q, show_if: null } : q));

    const reminders = [...new Map(config.notifications.reminders.map((r) => [r.minutes_before, r])).values()].sort(
        (a, b) => b.minutes_before - a.minutes_before,
    );

    return bookingConfigSchema.parse({
        ...config,
        mapping: cleanMapping,
        services,
        staff,
        questions: cleanQuestions,
        notifications: { ...config.notifications, reminders },
    });
}

/** El valor del campo de estado para un estado de la cita (null = no se escribe). */
export function statusValueFor(m: BookingMapping, status: BookingStatus): string | null {
    if (m.status_field_id === null) return null;
    return status === 'confirmed' ? m.status_confirmed : status === 'rescheduled' ? m.status_rescheduled ?? m.status_confirmed : m.status_cancelled;
}

/** ¿El valor del campo de estado de un registro es «cancelada»? */
export function isCancelledValue(m: BookingMapping, data: Record<string, unknown>): boolean {
    if (m.status_field_id === null || m.status_cancelled === null) return false;
    return data[jsonbKeyForField(m.status_field_id)] === m.status_cancelled;
}

export interface AppointmentDataInput {
    config: BookingConfig;
    fieldsById: ReadonlyMap<number, FieldLike>;
    service: BookingServiceItem;
    staff: BookingStaff;
    staffName: string;
    start: Date;
    end: Date;
    status: BookingStatus;
    client?: { name: string; email: string; phone: string | null };
}

/**
 * El `data` (claves `f{id}`) del registro de una cita, según el mapeo. En un
 * alta lleva todo; al reprogramar (sin `client`) sólo inicio, fin, quién
 * atiende y estado.
 */
export function appointmentRecordData(i: AppointmentDataInput): Record<string, unknown> {
    const m = i.config.mapping;
    const out: Record<string, unknown> = {};
    const put = (id: number | null, value: unknown): void => {
        if (id === null || value === undefined) return;
        out[jsonbKeyForField(id)] = value;
    };
    put(m.start_field_id, i.start.toISOString());
    put(m.end_field_id, i.end.toISOString());
    if (m.duration_field_id !== null) put(m.duration_field_id, Math.round((i.end.getTime() - i.start.getTime()) / 60_000));
    if (i.staff.kind === 'user') put(m.person_field_id, i.staff.staff_user_id ?? undefined);
    if (i.staff.kind === 'resource' && m.resource_field_id !== null) {
        const f = i.fieldsById.get(m.resource_field_id);
        put(m.resource_field_id, f?.type === 'select' ? (i.staff.option_value ?? undefined) : i.staffName);
    }
    if (m.service_field_id !== null) {
        const f = i.fieldsById.get(m.service_field_id);
        put(m.service_field_id, f?.type === 'select' ? (i.service.option_value ?? undefined) : i.service.name);
    }
    const status = statusValueFor(m, i.status);
    if (status !== null) put(m.status_field_id, status);
    if (i.client) {
        put(m.name_field_id, i.client.name);
        put(m.email_field_id, i.client.email);
        if (i.client.phone) put(m.phone_field_id, i.client.phone);
    }
    return out;
}

/** Quien atiende: clave del candado y de lo ocupado (`u:12` persona, `r:<página>:<id>` recurso). */
export function staffKey(pageId: number, s: Pick<BookingStaff, 'id' | 'kind' | 'staff_user_id'>): string {
    return s.kind === 'user' && s.staff_user_id !== null ? `u:${s.staff_user_id}` : `r:${pageId}:${s.id}`;
}
