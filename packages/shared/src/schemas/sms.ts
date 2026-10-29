import { z } from 'zod';
import { idSchema } from './common';
import { businessWindowOfDay, type BusinessCalendar } from './business-hours';
import { normalizePhone, splitPhone } from '../field-types/phone';
import { addDaysYmd, resolveTimeZone, zonedDayAndMinute } from './timezone';

/**
 * SMS — mensajes de texto con la cuenta de CADA empresa (v0.1.332, ADR-S82).
 *
 * Cinco proveedores por clave (Twilio, BulkGate, Infobip, LabsMobile y
 * Onurix); cualquier otro sale por la «API personalizada» de Integraciones.
 * El SMS NO pasa por la plataforma: lo paga cada empresa con su cuenta, así que
 * no hay cuota de plataforma como la del correo (ADR-S18).
 *
 * Este archivo tiene lo que comparten el servidor y la interfaz y que tiene que
 * dar EXACTAMENTE lo mismo en los dos lados: cuántos SMS ocupa un texto (lo que
 * ve el editor es lo que se cobra), cómo se le quitan las tildes, el horario de
 * la Ley 2300 de 2023, los estados y las columnas de la lista.
 */

// ── Proveedores ──────────────────────────────────────────────────────────

export const SMS_PROVIDER_KEYS = ['sms_twilio', 'sms_bulkgate', 'sms_infobip', 'sms_labsmobile', 'sms_onurix'] as const;
export type SmsProviderKey = (typeof SMS_PROVIDER_KEYS)[number];

export function isSmsProvider(key: unknown): key is SmsProviderKey {
    return typeof key === 'string' && (SMS_PROVIDER_KEYS as readonly string[]).includes(key);
}

/**
 * Cómo llega el estado de entrega de cada proveedor:
 * - `auto`: la app le pasa la URL de avisos en CADA envío (Twilio, Infobip,
 *   LabsMobile) — no hay nada que configurar.
 * - `manual`: la URL se pega una vez en el panel del proveedor (BulkGate).
 * - `poll`: el proveedor no avisa; la app pregunta el estado (Onurix).
 */
export type SmsDeliveryMode = 'auto' | 'manual' | 'poll';

export const SMS_PROVIDER_META: Record<
    SmsProviderKey,
    { label: string; delivery: SmsDeliveryMode; /** Mensajes por segundo en un envío masivo. */ rate: number; sender: boolean }
> = {
    sms_twilio: { label: 'Twilio', delivery: 'auto', rate: 1, sender: true },
    sms_bulkgate: { label: 'BulkGate', delivery: 'manual', rate: 5, sender: true },
    sms_infobip: { label: 'Infobip', delivery: 'auto', rate: 10, sender: true },
    sms_labsmobile: { label: 'LabsMobile', delivery: 'auto', rate: 5, sender: true },
    sms_onurix: { label: 'Onurix', delivery: 'poll', rate: 5, sender: false },
};

/** País que toma un número local (sin indicativo) si la conexión no dice otro. */
export const SMS_DEFAULT_COUNTRY = 'CO';
/** Tope de destinatarios de un envío a una selección. */
export const SMS_BULK_MAX = 500;
/** Tope de partes de un mensaje (los proveedores rechazan textos más largos). */
export const SMS_MAX_SEGMENTS = 6;

// ── Cuántos SMS ocupa un texto ───────────────────────────────────────────

/**
 * Alfabeto GSM 03.38 (3GPP TS 23.038), la tabla básica SIN el escape (0x1B).
 * Trae ñ Ñ é É ü Ü ¿ ¡ à è ì ò ù Ç, pero NO á í ó ú ni Á Í Ó Ú: una sola «á»
 * pasa el mensaje entero a Unicode (UCS-2), donde cada SMS lleva 70
 * caracteres en vez de 160.
 */
const GSM7_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Tabla de extensión: cada uno de estos ocupa DOS posiciones (escape + carácter). */
const GSM7_EXTENDED = '^{}\\[~]|€\f';

const BASIC = new Set(Array.from(GSM7_BASIC));
const EXTENDED = new Set(Array.from(GSM7_EXTENDED));

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SmsSegmentInfo {
    encoding: SmsEncoding;
    /** Caracteres como los ve una persona. */
    chars: number;
    /** Posiciones que ocupa en la codificación (septetos o unidades UTF-16). */
    units: number;
    /** Cuántos SMS se cobran (0 si el texto está vacío). */
    segments: number;
    /** Cuánto lleva cada SMS: 160/153 en GSM-7, 70/67 en Unicode. */
    per_segment: number;
    /** Cuánto queda en el último SMS antes de pasar a uno más. */
    remaining: number;
    /** Los caracteres que lo pasaron a Unicode (sin repetir, hasta 12). */
    non_gsm: string[];
}

function isGsmChar(c: string): boolean {
    return BASIC.has(c) || EXTENDED.has(c);
}

/** ¿Todo el texto entra en GSM-7? */
export function isGsm7Text(text: string): boolean {
    for (const c of text) if (!isGsmChar(c)) return false;
    return true;
}

/**
 * Cuántos SMS ocupa `text`. Un mensaje largo se parte en varios con una
 * cabecera que los une (UDH), y por eso cada parte lleva menos: 153 en GSM-7 y
 * 67 en Unicode. Una pareja escape+carácter de la tabla de extensión (o un
 * emoji, que son dos unidades UTF-16) nunca se parte entre dos SMS: si no
 * entra al final de una parte, salta entera a la siguiente.
 */
export function smsSegments(text: string): SmsSegmentInfo {
    const chars = Array.from(text ?? '');
    const nonGsm: string[] = [];
    for (const c of chars) {
        if (!isGsmChar(c) && !nonGsm.includes(c)) nonGsm.push(c);
    }
    const encoding: SmsEncoding = nonGsm.length === 0 ? 'gsm7' : 'ucs2';
    const widths = chars.map((c) => (encoding === 'gsm7' ? (EXTENDED.has(c) ? 2 : 1) : c.length));
    const units = widths.reduce((a, b) => a + b, 0);
    const single = encoding === 'gsm7' ? 160 : 70;
    const multi = encoding === 'gsm7' ? 153 : 67;
    if (units === 0) {
        return { encoding, chars: 0, units: 0, segments: 0, per_segment: single, remaining: single, non_gsm: [] };
    }
    if (units <= single) {
        return { encoding, chars: chars.length, units, segments: 1, per_segment: single, remaining: single - units, non_gsm: nonGsm.slice(0, 12) };
    }
    let segments = 1;
    let used = 0;
    for (const w of widths) {
        if (used + w > multi) {
            segments++;
            used = 0;
        }
        used += w;
    }
    return { encoding, chars: chars.length, units, segments, per_segment: multi, remaining: multi - used, non_gsm: nonGsm.slice(0, 12) };
}

/**
 * Lo que no está en GSM-7 y tiene un equivalente legible que sí. Las letras con
 * tilde que el alfabeto YA trae (é, É, à, è, ì, ò, ù, ñ, ü…) se conservan.
 */
const TRANSLITERATION: Record<string, string> = {
    á: 'a',
    í: 'i',
    ó: 'o',
    ú: 'u',
    Á: 'A',
    Í: 'I',
    Ó: 'O',
    Ú: 'U',
    À: 'A',
    È: 'E',
    Ì: 'I',
    Ò: 'O',
    Ù: 'U',
    â: 'a',
    ê: 'e',
    î: 'i',
    ô: 'o',
    û: 'u',
    Â: 'A',
    Ê: 'E',
    Î: 'I',
    Ô: 'O',
    Û: 'U',
    ã: 'a',
    õ: 'o',
    Ã: 'A',
    Õ: 'O',
    ë: 'e',
    ï: 'i',
    Ë: 'E',
    Ï: 'I',
    ÿ: 'y',
    ý: 'y',
    Ý: 'Y',
    ç: 'c',
    š: 's',
    Š: 'S',
    ž: 'z',
    Ž: 'Z',
    ª: 'a',
    º: 'o',
    '°': 'o',
    '“': '"',
    '”': '"',
    '„': '"',
    '«': '"',
    '»': '"',
    '‘': "'",
    '’': "'",
    '‚': "'",
    '´': "'",
    '`': "'",
    '–': '-',
    '—': '-',
    '−': '-',
    '…': '...',
    '•': '-',
    '·': '-',
    ' ': ' ',
    ' ': ' ',
    ' ': ' ',
    '\t': ' ',
    '​': '',
    '﻿': '',
};

/**
 * «Quitar tildes para que entre en menos SMS»: cambia lo que no está en GSM-7
 * por su equivalente legible (á→a, Ó→O, comillas tipográficas → ", raya → -) y
 * CONSERVA lo que el alfabeto sí trae (é, ñ, ü, ¿, ¡…). Lo que no tiene
 * equivalente (un emoji) queda tal cual: el mensaje sigue en Unicode y el
 * contador lo dice.
 */
export function stripSmsAccents(text: string): string {
    let out = '';
    for (const c of text ?? '') {
        if (isGsmChar(c)) {
            out += c;
            continue;
        }
        const mapped = TRANSLITERATION[c];
        if (mapped !== undefined) {
            out += mapped;
            continue;
        }
        const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out += base !== '' && isGsm7Text(base) ? base : c;
    }
    return out;
}

/** El texto final que sale: con o sin tildes, y sin espacios de más en los bordes. */
export function finalSmsText(text: string, stripAccents: boolean): string {
    const t = (text ?? '').replace(/\r\n/g, '\n').trim();
    return stripAccents ? stripSmsAccents(t) : t;
}

/** «2 SMS · 145 caracteres» (lo que muestra el contador). */
export function smsCounterLabel(info: SmsSegmentInfo): string {
    const sms = info.segments === 1 ? '1 SMS' : `${info.segments} SMS`;
    const chars = info.chars === 1 ? '1 carácter' : `${info.chars} caracteres`;
    return `${sms} · ${chars}`;
}

// ── Horario para mensajes comerciales y de cobranza (Ley 2300 de 2023) ──

/**
 * Ley 2300 de 2023, art. 3: los gestores de cobranza (y, por el mismo artículo,
 * los mensajes publicitarios por SMS, apps o correo) sólo pueden contactar «de
 * lunes a viernes de 7:00 a. m. a 7:00 p. m., y sábados de 8:00 a. m. a 3:00
 * p. m., excluyendo cualquier tipo de contacto con el consumidor los domingos y
 * días festivos». Las horas son las de la ZONA de la empresa (ADR-S33) y los
 * festivos, los de Colombia (los mismos de las fórmulas y del SLA). El final de
 * cada franja es exclusivo: a las 7:00 p. m. en punto ya no sale.
 *
 * La app ayuda a cumplir, no asesora: el texto de la opción le pide a la
 * empresa que lo confirme su abogado.
 */
export const SMS_COMMERCIAL_CALENDARS: ReadonlyArray<Omit<BusinessCalendar, 'timeZone'>> = [
    { days: [1, 2, 3, 4, 5], start: '07:00', end: '19:00', holidays: 'co' },
    { days: [6], start: '08:00', end: '15:00', holidays: 'co' },
];

/** La zona que se usa para el horario: la de la empresa o, sin ella, la de Colombia (la ley es colombiana). */
export const SMS_LAW_TIME_ZONE = 'America/Bogota';

/** La franja permitida de un día (ms), o null si ese día no se puede (domingo, festivo). */
export function commercialWindowOfDay(ymd: string, timeZone: string): [number, number] | null {
    for (const cal of SMS_COMMERCIAL_CALENDARS) {
        const w = businessWindowOfDay(ymd, { ...cal, timeZone });
        if (w) return w;
    }
    return null;
}

/** ¿Se puede mandar en este instante? */
export function isWithinCommercialHours(at: Date, timeZone: string | null | undefined): boolean {
    const tz = resolveTimeZone(timeZone, SMS_LAW_TIME_ZONE);
    const w = commercialWindowOfDay(zonedDayAndMinute(at, tz).ymd, tz);
    const t = at.getTime();
    return w !== null && t >= w[0] && t < w[1];
}

/**
 * El siguiente momento en que se puede mandar: `at` mismo si ya está dentro de
 * la franja, si no el comienzo de la próxima (salteando domingos y festivos).
 */
export function nextCommercialSendTime(at: Date, timeZone: string | null | undefined): Date {
    const tz = resolveTimeZone(timeZone, SMS_LAW_TIME_ZONE);
    const t = at.getTime();
    let ymd = zonedDayAndMinute(at, tz).ymd;
    for (let i = 0; i < 40; i++) {
        const w = commercialWindowOfDay(ymd, tz);
        if (w) {
            if (t < w[0]) return new Date(w[0]);
            if (t < w[1]) return new Date(t);
        }
        ymd = addDaysYmd(ymd, 1);
    }
    return new Date(t);
}

// ── Estados ──────────────────────────────────────────────────────────────

export const SMS_STATUSES = ['programado', 'en_cola', 'enviando', 'enviado', 'entregado', 'fallido', 'cancelado'] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

/** Lo que se ve (y se escribe en la columna «Estado del último SMS»). `enviando` se ve como «En cola». */
export const SMS_STATUS_OPTIONS: Record<Exclude<SmsStatus, 'enviando'>, { value: string; label: string; color: string }> = {
    programado: { value: 'programado', label: 'Programado', color: '#A855F7' },
    en_cola: { value: 'en_cola', label: 'En cola', color: '#94A3B8' },
    enviado: { value: 'enviado', label: 'Enviado', color: '#64748B' },
    entregado: { value: 'entregado', label: 'Entregado', color: '#22C55E' },
    fallido: { value: 'fallido', label: 'Fallido', color: '#EF4444' },
    cancelado: { value: 'cancelado', label: 'Cancelado', color: '#F59E0B' },
};

export function smsStatusLabel(status: SmsStatus | null | undefined): string {
    if (!status) return '';
    const shown = status === 'enviando' ? 'en_cola' : status;
    return SMS_STATUS_OPTIONS[shown].label;
}

const FINAL: ReadonlySet<SmsStatus> = new Set(['entregado', 'fallido', 'cancelado']);
const RANK: Record<SmsStatus, number> = { programado: 0, en_cola: 1, enviando: 2, enviado: 3, entregado: 4, fallido: 4, cancelado: 4 };

/**
 * Los proveedores mandan los estados en cualquier orden y los REINTENTAN: un
 * «enviado» tardío no pisa un «entregado», y un estado final (entregado,
 * fallido, cancelado) no cambia más. Devuelve el que queda, o null si nada.
 */
export function nextSmsStatus(current: SmsStatus | null, incoming: SmsStatus): SmsStatus | null {
    if (current === incoming) return null;
    if (current === null) return incoming;
    if (FINAL.has(current)) return null;
    return RANK[incoming] > RANK[current] ? incoming : null;
}

// ── Teléfonos ────────────────────────────────────────────────────────────

/**
 * El destinatario en formato internacional (`+573001112233`). Un número local
 * toma el indicativo del país de la conexión (Colombia si no dice otro).
 */
export function smsRecipient(raw: unknown, defaultCountry?: string | null): { ok: true; e164: string } | { ok: false; error: string } {
    const n = normalizePhone(typeof raw === 'number' ? String(raw) : raw, (defaultCountry ?? '').trim() || SMS_DEFAULT_COUNTRY);
    if (!n.ok) return { ok: false, error: n.error };
    if (!n.value.startsWith('+')) return { ok: false, error: 'El número necesita el indicativo del país (por ejemplo +57 300 111 2233).' };
    const digits = n.value.slice(1);
    if (digits.length < 8) return { ok: false, error: 'El teléfono es demasiado corto.' };
    return { ok: true, e164: n.value };
}

/** «+57 300…»: lo que queda en la actividad (el número entero ya está en el registro). */
export function maskSmsPhone(e164: string): string {
    const { dial, national } = splitPhone(e164);
    if (dial === '') return `${String(e164).slice(0, 4)}…`;
    return `+${dial} ${national.slice(0, 3)}…`;
}

// ── Columnas de la lista ─────────────────────────────────────────────────

/**
 * Qué columnas de una lista reflejan el SMS. Viven en `lists.settings.sms` con
 * claves `*_field_id` (plantillas y la migración de empresa las re-mapean
 * solas). El texto del mensaje NO se escribe: en el registro queda cuándo se
 * mandó el último y cómo terminó.
 */
export const SMS_FIELD_ROLES = ['phone', 'last_at', 'last_status'] as const;
export type SmsFieldRole = (typeof SMS_FIELD_ROLES)[number];

export const SMS_FIELD_ROLE_META: Record<
    SmsFieldRole,
    { label: string; help: string; types: readonly string[]; slug: string; create: { label: string; type: string } }
> = {
    phone: {
        label: 'Teléfono',
        help: 'A qué número se manda desde el registro y en un envío a varios.',
        types: ['phone', 'text'],
        slug: 'telefono',
        create: { label: 'Teléfono', type: 'phone' },
    },
    last_at: {
        label: 'Último SMS',
        help: 'Cuándo salió el último SMS del registro.',
        types: ['datetime', 'date'],
        slug: 'sms_ultimo',
        create: { label: 'Último SMS', type: 'datetime' },
    },
    last_status: {
        label: 'Estado del último SMS',
        help: 'Programado, en cola, enviado, entregado o fallido. Se actualiza solo con el aviso del proveedor.',
        types: ['select', 'text'],
        slug: 'sms_estado',
        create: { label: 'Estado del último SMS', type: 'select' },
    },
};

export const SMS_FIELD_KEYS: Record<SmsFieldRole, string> = {
    phone: 'phone_field_id',
    last_at: 'last_at_field_id',
    last_status: 'last_status_field_id',
};

export type SmsListFields = Record<SmsFieldRole, number | null>;

export const smsListFieldsSchema = z.object({
    phone: idSchema.nullable(),
    last_at: idSchema.nullable(),
    last_status: idSchema.nullable(),
});

/** Lee `settings.sms` (tolerante: lo que no es un id queda en null). */
export function readSmsListFields(settings: unknown): SmsListFields {
    const raw = ((settings ?? {}) as Record<string, unknown>).sms;
    const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = {} as SmsListFields;
    for (const role of SMS_FIELD_ROLES) {
        const n = Number(obj[SMS_FIELD_KEYS[role]]);
        out[role] = Number.isInteger(n) && n > 0 ? n : null;
    }
    return out;
}

export function writeSmsListFields(fields: SmsListFields): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const role of SMS_FIELD_ROLES) out[SMS_FIELD_KEYS[role]] = fields[role];
    return out;
}

/** Lo que ya existe con el nombre esperado y, para el teléfono, el primer campo Teléfono. */
export function suggestSmsFields(fields: ReadonlyArray<{ id: number; slug: string; type: string }>): SmsListFields {
    const out = {} as SmsListFields;
    for (const role of SMS_FIELD_ROLES) {
        const meta = SMS_FIELD_ROLE_META[role];
        out[role] = fields.find((f) => f.slug === meta.slug && meta.types.includes(f.type))?.id ?? null;
    }
    if (out.phone === null) out.phone = fields.find((f) => f.type === 'phone')?.id ?? null;
    return out;
}

export const updateSmsListFieldsSchema = z.object({ fields: smsListFieldsSchema });
export type UpdateSmsListFieldsInput = z.infer<typeof updateSmsListFieldsSchema>;

export interface SmsListColumns {
    list_id: number;
    list_name: string;
    fields: SmsListFields;
    candidates: Record<SmsFieldRole, Array<{ id: number; label: string; type: string }>>;
}

// ── API ──────────────────────────────────────────────────────────────────

const messageSchema = z.string().max(2000);
const senderSchema = z.string().trim().max(20);

/** «Enviar SMS» desde un registro. */
export const smsSendSchema = z.object({
    connection_id: idSchema,
    /** Vacío = el teléfono del registro. Admite variables. */
    to: z.string().trim().max(200).optional(),
    message: messageSchema.refine((v) => v.trim() !== '', { message: 'Escribe el mensaje.' }),
    sender: senderSchema.optional(),
    strip_accents: z.boolean().default(false),
    respect_hours: z.boolean().default(false),
});
export type SmsSendInput = z.infer<typeof smsSendSchema>;

/**
 * «Probar ahora» del editor de automatizaciones: resuelve las variables con un
 * registro REAL y muestra lo que saldría. Sólo manda de verdad con `send`
 * («Enviarme una prueba»), al número que se escribe.
 */
export const smsTestSendSchema = z.object({
    connection_id: idSchema,
    values: z.record(z.unknown()).default({}),
    record_id: z.number().int().positive().optional(),
    send: z.boolean().default(false),
    /** Número propio para «Enviarme una prueba». */
    to: z.string().trim().max(200).optional(),
});
export type SmsTestSendInput = z.infer<typeof smsTestSendSchema>;

/** Enviar a una selección de la tabla (y su vista previa). */
export const smsBulkSchema = z.object({
    connection_id: idSchema,
    record_ids: z.array(idSchema).min(1).max(SMS_BULK_MAX),
    message: messageSchema.refine((v) => v.trim() !== '', { message: 'Escribe el mensaje.' }),
    sender: senderSchema.optional(),
    strip_accents: z.boolean().default(false),
    respect_hours: z.boolean().default(false),
});
export type SmsBulkInput = z.infer<typeof smsBulkSchema>;

export interface SmsSendResult {
    ok: boolean;
    status: SmsStatus | null;
    /** Id del envío en la app. */
    message_id: number | null;
    /** Id que dio el proveedor. */
    provider_message_id: string | null;
    to: string;
    text: string;
    segments: number;
    encoding: SmsEncoding;
    /** Si quedó programado por el horario de la Ley 2300: cuándo sale. */
    scheduled_for: string | null;
    error: string | null;
    /** Lo que se mandó al proveedor (sin la clave). */
    request: { method: string; url: string; body: string } | null;
    response: { status: number; body: string } | null;
    sample_record_id?: number | null;
    /** En «Probar ahora» sin `send`: no salió nada. */
    simulated?: boolean;
}

export interface SmsConnectionSummary {
    id: number;
    name: string;
    provider: SmsProviderKey;
    account_label: string | null;
    /** Remitente de la conexión (vacío = el del proveedor). */
    sender: string;
    default_country: string;
}

/** Lo que muestra la ficha para «Enviar SMS». */
export interface SmsRecordInfo {
    connections: SmsConnectionSummary[];
    /** El número del registro (canónico), o null. */
    recipient: string | null;
    last: { status: SmsStatus; at: string; error: string | null; connection: string | null } | null;
    has_columns: boolean;
    can_send: boolean;
    can_setup: boolean;
}

export interface SmsBulkPreview {
    total: number;
    sendable: number;
    missing: Array<{ record_id: number; title: string; reason: string }>;
    segments_total: number;
    sample: Array<{ record_id: number; title: string; to: string; text: string; segments: number }>;
    /** Con «Respetar el horario» fuera de la franja: cuándo empezaría. */
    scheduled_for: string | null;
    /** Cuántos salen en Unicode (con tildes que no están en GSM-7). */
    ucs2: number;
}

export interface SmsBulkResult {
    batch_id: string;
    queued: number;
    skipped: number;
    scheduled_for: string | null;
}

export interface SmsMessageDto {
    id: number;
    to: string;
    status: SmsStatus;
    error: string | null;
    segments: number;
    encoding: SmsEncoding;
    source: string;
    list_id: number | null;
    record_id: number | null;
    created_at: string;
    sent_at: string | null;
    delivered_at: string | null;
    send_after: string | null;
}

export interface SmsBatchStatus {
    batch_id: string;
    total: number;
    counts: Partial<Record<SmsStatus, number>>;
    rows: Array<{ id: number; record_id: number | null; title: string; to: string; status: SmsStatus; error: string | null; segments: number }>;
    /** Ya no queda nada por mandar. */
    done: boolean;
}

/** Panel de una conexión de SMS (Integraciones → SMS). */
export interface SmsConnectionDetail {
    connection: SmsConnectionSummary & { can_edit: boolean; secret_state: 'none' | 'ok' | 'unreadable' };
    delivery: {
        mode: SmsDeliveryMode;
        /** La URL de avisos (para pegar en el proveedor si es `manual`). */
        url: string;
        last_hook_at: string | null;
    };
    totals: { sent_30d: number; delivered_30d: number; failed_30d: number; pending: number; segments_30d: number };
    recent: SmsMessageDto[];
    lists: Array<{ id: number; name: string }>;
    last_error: string | null;
}

/** El texto por defecto de un recordatorio de cita por SMS. */
export const SMS_BOOKING_REMINDER_DEFAULT = 'Hola {{cita.cliente}}, te recordamos tu cita de {{cita.servicio}} el {{cita.inicio}}. Para cambiarla: {{cita.enlace_reprogramar}}';
