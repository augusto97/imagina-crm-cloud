import { randomUUID } from 'node:crypto';
import {
    meetingActionKind,
    parseTeamsChannelRef,
    parseTeamsChatRef,
    type ConnectorAction,
    type IntegrationKey,
    type IntegrationProvider,
} from '@imagina-base/shared';
import { buildWooRequest, checkWooResponse } from './woocommerce/wc-api';

/**
 * Peticiones de las apps de la galería (v0.1.203, ADR-S22 fase 4).
 *
 * Cada acción ya armada («Enviar mensaje a Slack», «Agregar fila en Google
 * Sheets») se traduce aquí a la petición HTTP real. Es código y no filas
 * clave/valor a propósito: Gmail quiere un mensaje RFC 2822 en base64, Sheets
 * un arreglo de filas, Calendar objetos anidados con zona horaria. Nadie que
 * use la galería tiene que ver nada de esto.
 *
 * PURO, igual que `buildWebhookRequest` y `compileConnectorCall`: el probador
 * del editor y el motor arman exactamente la misma petición, y los tests
 * verifican la forma sin salir a la red.
 */

export interface IntegrationCreds {
    /** El dato secreto que pegó la empresa (clave de API, token del bot). */
    secret: string;
    /** Access token OAuth vigente (ya renovado por el service). */
    accessToken: string;
    /** Datos NO secretos guardados en la conexión (cuenta, servidor). */
    fields: Record<string, string>;
    /**
     * Segundo secreto, si la app lo tiene (v0.1.251: el secreto de eventos de
     * Wompi, con el que se verifican sus avisos de pago).
     */
    signingSecret?: string;
}

export interface IntegrationRequest {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers: Record<string, string>;
    body?: string;
}

/** Valores ya resueltos (merge aplicado). Los parámetros «de a renglón» vienen partidos. */
export interface IntegrationValues {
    values: Record<string, string>;
    lines: Record<string, string[]>;
}

import { IntegrationInputError } from './integration-errors';
export { IntegrationInputError };

export type MergeFn = (raw: unknown) => string;

/**
 * Parámetros que se escriben uno por renglón y se mergean de a uno. Mergear el
 * texto entero y partir DESPUÉS rompería una celda cuyo valor trae saltos de
 * línea (un campo de texto largo del registro).
 */
const LINE_PARAMS: Partial<Record<string, readonly string[]>> = {
    'google_sheets.append_row': ['values'],
    'woocommerce.update_product': ['meta'],
};

/**
 * SEC-33 (v0.1.239): parámetros que viajan como HTML cuando la acción lo pide
 * (`html` = sí). Ahí los valores interpolados se ESCAPAN — si no, el texto de
 * un registro (que puede escribir un cliente desde el portal o un formulario
 * por webhook) metía HTML propio en un correo que sale con la cuenta de la
 * empresa: enlaces y botones falsos con remitente legítimo.
 */
const HTML_PARAMS: Partial<Record<string, readonly string[]>> = {
    'gmail.send_email': ['body'],
    'outlook.send_email': ['body'],
};

/**
 * Resuelve los valores con las mismas reglas que las acciones con nombre de la
 * fase 2: vacío toma el default, obligatorios vacíos no salen.
 */
export function compileIntegrationValues(
    integration: IntegrationKey,
    action: ConnectorAction,
    raw: Record<string, unknown>,
    merge: MergeFn,
    /** Igual que `merge`, pero escapando los valores interpolados (HTML). */
    mergeHtml: MergeFn,
): IntegrationValues & { missing: string[] } {
    const lineKeys = LINE_PARAMS[`${integration}.${action.key}`] ?? [];
    const htmlKeys = HTML_PARAMS[`${integration}.${action.key}`] ?? [];
    const htmlParam = action.params.find((p) => p.key === 'html');
    const asHtml =
        htmlKeys.length > 0 &&
        isTrue(String(raw.html ?? htmlParam?.default ?? ''));
    const values: Record<string, string> = {};
    const lines: Record<string, string[]> = {};
    const missing: string[] = [];
    for (const param of action.params) {
        const given = raw[param.key];
        const source =
            given === undefined || given === null || given === '' ? param.default : String(given);
        if (lineKeys.includes(param.key)) {
            const rows = source.split(/\r?\n/).map((line) => merge(line));
            // Los renglones vacíos del MEDIO son columnas vacías a propósito;
            // los del final son el Enter de más que quedó al escribir.
            while (rows.length > 0 && rows[rows.length - 1]!.trim() === '') rows.pop();
            lines[param.key] = rows;
            if (param.required && rows.length === 0) missing.push(param.label);
            continue;
        }
        const value = asHtml && htmlKeys.includes(param.key) ? mergeHtml(source) : merge(source);
        values[param.key] = value;
        if (param.required && value.trim() === '') missing.push(param.label);
    }
    return { values, lines, missing };
}

// --- Utilidades --------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' };

function bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
}

function form(pairs: Array<[string, string]>): string {
    return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** Una cabecera de correo no puede traer saltos de línea (inyección de cabeceras). */
function headerSafe(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
}

const MAX_RECIPIENTS = 25;

/**
 * Destinatarios saneados y CAPADOS, mismo criterio que `send_email` (SEC-08):
 * una variable que resuelve a una lista enorme no convierte la cuenta de la
 * empresa en un relay.
 */
export function emailList(raw: string): string[] {
    const seen = new Set<string>();
    for (const part of raw.split(/[,;]/)) {
        const addr = part.trim();
        if (/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(addr)) seen.add(addr.toLowerCase());
        if (seen.size >= MAX_RECIPIENTS) break;
    }
    return [...seen];
}

function isTrue(value: string | undefined): boolean {
    return ['true', '1', 'si', 'sí', 'yes'].includes((value ?? '').trim().toLowerCase());
}

/** El `error.message` de una respuesta de Google (vacío si no hay). */
function googleErrorMessage(json: Record<string, unknown> | null): string {
    return graphErrorMessage(json);
}

/**
 * v0.1.384 — Los motivos de un error de Google: `errors[].reason` (APIs
 * viejas, como Calendar y Gmail), `details[].reason` (las nuevas) y el
 * `status` («PERMISSION_DENIED»).
 */
export function googleErrorReasons(json: Record<string, unknown> | null): string[] {
    const err = json?.error;
    if (!err || typeof err !== 'object') return [];
    const e = err as { errors?: unknown; details?: unknown; status?: unknown };
    const out: string[] = [];
    const push = (v: unknown): void => {
        if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v);
    };
    for (const list of [e.errors, e.details]) {
        if (Array.isArray(list)) for (const item of list) push((item as { reason?: unknown })?.reason);
    }
    push(e.status);
    return out;
}

const GOOGLE_APP_LABEL: Partial<Record<IntegrationKey, string>> = {
    gmail: 'Gmail',
    google_calendar: 'Google Calendar',
    google_sheets: 'Google Sheets',
};

/**
 * v0.1.384 — Un error de Google en palabras, con la salida (lo mismo que se
 * hizo con Microsoft en v0.1.363/v0.1.366). `null` = no es uno de los casos
 * conocidos (sigue el mensaje general).
 */
export function googleProblem(integration: IntegrationKey, status: number, json: Record<string, unknown> | null, actionKey = ''): string | null {
    const app = GOOGLE_APP_LABEL[integration];
    if (!app || status < 400 || status === 401) return null;
    const said = googleErrorMessage(json);
    const reasons = googleErrorReasons(json).map((r) => r.toLowerCase());
    const has = (...keys: string[]): boolean => keys.some((k) => reasons.includes(k.toLowerCase()));
    const quote = said !== '' ? ` Google dijo: «${said.slice(0, 240)}».` : '';
    const meeting = meetingActionKind(integration, actionKey);

    if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') || /insufficient (authentication )?scopes/i.test(said)) {
        return `La conexión de ${app} no tiene el permiso que hace falta: al conectarla quedó sin marcar una casilla en la pantalla de Google. Vuelve a conectarla en Ajustes → Integraciones → ${app} y deja marcadas todas las casillas.`;
    }
    if (has('accessNotConfigured', 'SERVICE_DISABLED') || /has not been used in project|it is disabled/i.test(said)) {
        return `La API de ${app} no está activada en el proyecto de Google de la plataforma. Quien administra la plataforma tiene que activarla en Google Cloud (la guía está en Plataforma → Integraciones → Google).`;
    }
    if (status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED')) {
        return `Google frenó los pedidos de esta cuenta por un momento (demasiados seguidos o se pasó el límite del día). Vuelve a intentarlo en unos minutos.${quote}`;
    }
    if (has('domainPolicy') || (status === 403 && /domain administrator|administrator|admin policy|google workspace/i.test(said))) {
        return `El administrador de Google Workspace de tu empresa no deja que esta app use ${app}. Pídele que la marque como de confianza: en Ajustes → Integraciones → ${app}, toca «¿Tu empresa bloquea la app?» y mándale el mensaje.${quote}`;
    }
    if (integration === 'google_calendar') {
        if (has('requiredAccessLevel') || /writer access|need to have .*access/i.test(said)) {
            return 'La cuenta conectada puede ver ese calendario, pero no hacer cambios. Deja el calendario vacío (tu calendario principal), usa otro o pide permiso para editarlo.';
        }
        if (status === 400 && /conference/i.test(said)) {
            return 'Google no dejó crear la videollamada de Meet en ese calendario: puede que tu empresa tenga Google Meet apagado para esta cuenta. Apaga «Con enlace de Google Meet» o conecta otra cuenta.';
        }
        if (status === 404 && meeting === 'create') {
            return 'No encontramos ese calendario: revisa su ID en «Calendario» (vacío = tu calendario principal) y que la cuenta conectada lo tenga.';
        }
    }
    return null;
}

/** El `error.message` de una respuesta de Microsoft Graph (vacío si no hay). */
export function graphErrorMessage(json: Record<string, unknown> | null): string {
    const err = json?.error;
    if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
        return String((err as Record<string, unknown>).message).trim();
    }
    return '';
}

function parseJson(body: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(body);
        return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

// --- Fechas de eventos --------------------------------------------------------

export type EventWindow =
    | { allDay: true; startDate: string; endDate: string }
    | { allDay: false; utc: boolean; start: string; end: string };

function fmtDate(d: Date): string {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fmtDateTime(d: Date): string {
    return `${fmtDate(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Ventana del evento a partir de lo que llega del registro.
 *
 * - Una fecha con hora sale de un campo `datetime`, que la app guarda en UTC:
 *   el evento se crea en ESE instante (zona UTC).
 * - Una fecha sola + «Hora de inicio» escrita a mano es hora LOCAL de la zona
 *   elegida.
 * - Una fecha sola sin hora es un evento de todo el día.
 *
 * La aritmética va sobre componentes con `Date.UTC`: nunca se parsea con la
 * zona del servidor, que es justo lo que corre las fechas un día.
 */
export function eventWindow(dateRaw: string, timeRaw: string, durationRaw: string): EventWindow {
    const date = dateRaw.trim();
    let y: number, m: number, d: number;
    let hh: number | null = null;
    let mm = 0;
    let ss = 0;
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/.exec(date);
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
    if (iso) {
        y = Number(iso[1]);
        m = Number(iso[2]);
        d = Number(iso[3]);
        if (iso[4] !== undefined) {
            hh = Number(iso[4]);
            mm = Number(iso[5]);
            ss = Number(iso[6] ?? 0);
        }
    } else if (dmy) {
        d = Number(dmy[1]);
        m = Number(dmy[2]);
        y = Number(dmy[3]);
    } else {
        throw new IntegrationInputError(
            date === ''
                ? 'Falta la fecha del evento.'
                : `La fecha «${date}» no tiene el formato AAAA-MM-DD.`,
        );
    }
    const base = new Date(Date.UTC(y, m - 1, d));
    if (base.getUTCFullYear() !== y || base.getUTCMonth() !== m - 1 || base.getUTCDate() !== d) {
        throw new IntegrationInputError(`La fecha «${date}» no existe.`);
    }

    const minutes = Number(durationRaw);
    const duration = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 7 * 24 * 60) : 60;

    if (hh !== null) {
        const start = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
        const end = new Date(start.getTime() + duration * 60_000);
        return { allDay: false, utc: true, start: fmtDateTime(start), end: fmtDateTime(end) };
    }
    const time = /^(\d{1,2}):(\d{2})$/.exec(timeRaw.trim());
    if (time) {
        const h = Number(time[1]);
        const min = Number(time[2]);
        if (h > 23 || min > 59) {
            throw new IntegrationInputError(`La hora «${timeRaw.trim()}» no es válida (HH:MM).`);
        }
        const start = new Date(Date.UTC(y, m - 1, d, h, min, 0));
        const end = new Date(start.getTime() + duration * 60_000);
        return { allDay: false, utc: false, start: fmtDateTime(start), end: fmtDateTime(end) };
    }
    if (timeRaw.trim() !== '') {
        throw new IntegrationInputError(`La hora «${timeRaw.trim()}» no es válida (HH:MM).`);
    }
    const next = new Date(base.getTime() + 24 * 60 * 60_000);
    return { allDay: true, startDate: fmtDate(base), endDate: fmtDate(next) };
}

/**
 * v0.1.366 — La ventana del evento con un FIN opcional (que manda sobre la
 * duración). Inicio y fin pueden venir en bases distintas —una fecha y hora de
 * un campo (UTC) y una hora escrita a mano (local)—: Graph y Google aceptan la
 * zona por separado en cada punta, así que cada una lleva la suya.
 */
export type EventTimes =
    | { allDay: true; startDate: string; endDate: string }
    | { allDay: false; start: string; startUtc: boolean; end: string; endUtc: boolean };

export function eventTimes(v: Record<string, string>): EventTimes {
    const win = eventWindow(v.date ?? '', v.time ?? '', v.duration ?? '');
    const endRaw = (v.end ?? '').trim();
    if (win.allDay) {
        if (endRaw === '') return win;
        const d = parseDateOnly(endRaw);
        if (!d) {
            throw new IntegrationInputError(
                `El evento es de todo el día: el fin va sin hora (AAAA-MM-DD). Para un evento con hora, pon la Hora de inicio.`,
            );
        }
        const next = fmtDate(new Date(d.getTime() + 24 * 60 * 60_000));
        if (next <= win.startDate) throw new IntegrationInputError('El fin del evento es anterior al inicio.');
        return { allDay: true, startDate: win.startDate, endDate: next };
    }
    if (endRaw === '') return { allDay: false, start: win.start, startUtc: win.utc, end: win.end, endUtc: win.utc };

    let end: string;
    let endUtc: boolean;
    const hhmm = /^(\d{1,2}):(\d{2})$/.exec(endRaw);
    const full = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z)?$/.exec(endRaw);
    if (hhmm) {
        if (win.utc) {
            throw new IntegrationInputError(
                'El inicio trae la hora de un campo: el fin tiene que ser otra fecha y hora (o usa la duración).',
            );
        }
        const h = Number(hhmm[1]);
        const m = Number(hhmm[2]);
        if (h > 23 || m > 59) throw new IntegrationInputError(`La hora de fin «${endRaw}» no es válida (HH:MM).`);
        end = `${win.start.slice(0, 10)}T${pad(h)}:${pad(m)}:00`;
        endUtc = false;
    } else if (full) {
        const d = new Date(
            Date.UTC(Number(full[1]), Number(full[2]) - 1, Number(full[3]), Number(full[4]), Number(full[5]), Number(full[6] ?? 0)),
        );
        if (Number.isNaN(d.getTime()) || fmtDate(d) !== `${full[1]}-${full[2]}-${full[3]}`) {
            throw new IntegrationInputError(`La fecha de fin «${endRaw}» no existe.`);
        }
        end = fmtDateTime(d);
        // Con «Z» es un instante (un campo de fecha y hora); sin ella, una hora
        // escrita a mano en la zona elegida.
        endUtc = full[7] === 'Z';
    } else {
        throw new IntegrationInputError(
            `El fin «${endRaw}» no tiene el formato AAAA-MM-DD HH:MM ni HH:MM.`,
        );
    }
    if (endUtc === win.utc && end <= win.start) {
        throw new IntegrationInputError('El fin del evento tiene que ser después del inicio.');
    }
    return { allDay: false, start: win.start, startUtc: win.utc, end, endUtc };
}

function parseDateOnly(raw: string): Date | null {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    const [y, m, d] = iso
        ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
        : dmy
          ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
          : [NaN, NaN, NaN];
    if (!Number.isFinite(y)) return null;
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d ? date : null;
}

/**
 * El id del evento que se cambia o se cancela. Lo más común al armarlo mal es
 * pegar el ENLACE de la reunión en vez del id: se dice eso, no «no existe».
 */
export function eventIdOf(raw: string): string {
    const id = raw.trim();
    if (id === '') {
        throw new IntegrationInputError(
            'Falta el id del evento. Guárdalo en un campo al crearlo («Guardar en el registro») y úsalo aquí con su variable.',
        );
    }
    if (/^https?:\/\//i.test(id)) {
        throw new IntegrationInputError(
            'Eso es un enlace, no el id del evento: usa la variable del campo donde guardaste el id al crearlo.',
        );
    }
    if (/\s/.test(id) || id.length > 1024) {
        throw new IntegrationInputError(`«${id.slice(0, 60)}» no parece el id de un evento.`);
    }
    return id;
}

// --- Gmail: mensaje RFC 2822 ---------------------------------------------------

function mimeWord(text: string): string {
    // Sólo se codifica si hace falta: un asunto ASCII viaja legible.
    return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrap76(b64: string): string {
    return b64.replace(/.{1,76}/g, (chunk) => `${chunk}\r\n`).trimEnd();
}

export function buildRfc2822(args: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    html: boolean;
}): string {
    const lines = [`To: ${args.to.join(', ')}`];
    if (args.cc.length > 0) lines.push(`Cc: ${args.cc.join(', ')}`);
    if (args.bcc.length > 0) lines.push(`Bcc: ${args.bcc.join(', ')}`);
    lines.push(`Subject: ${mimeWord(headerSafe(args.subject))}`);
    lines.push('MIME-Version: 1.0');
    lines.push(`Content-Type: ${args.html ? 'text/html' : 'text/plain'}; charset="UTF-8"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76(Buffer.from(args.body, 'utf8').toString('base64')));
    return lines.join('\r\n');
}

// --- Sheets -------------------------------------------------------------------

/** El ID de la planilla, desde el enlace que pega la persona o el ID pelado. */
export function spreadsheetId(raw: string): string {
    const text = raw.trim();
    const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/.exec(text);
    if (fromUrl) return fromUrl[1]!;
    if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
    throw new IntegrationInputError(
        'No reconocemos la hoja de cálculo: pega el enlace completo (https://docs.google.com/spreadsheets/d/…).',
    );
}

/**
 * Una celda que empieza con `=`, `@` o `+` Sheets la interpreta como fórmula
 * (o se come el `+` de un teléfono). El contenido sale de un registro —lo
 * escribió cualquiera—, así que se fuerza texto con el apóstrofo, que es el
 * escape nativo de Sheets y no se ve en la celda. Los negativos sí son números.
 */
export function sheetCell(value: string): string {
    if (/^[=@+]/.test(value)) return `'${value}`;
    if (value.startsWith('-') && !/^-\d+([.,]\d+)?$/.test(value)) return `'${value}`;
    return value;
}

// --- Construcción por integración ---------------------------------------------

function wasServer(creds: IntegrationCreds): string {
    const raw = (creds.fields.server ?? '').trim() || 'https://was.imagina.cloud';
    return raw.replace(/\/+$/, '');
}

function phone(raw: string): string {
    return raw.replace(/[\s().-]/g, '');
}

/** Invitados obligatorios y opcionales, sin repetir (el tope de SEC-08 vale para la suma). */
function eventAttendees(v: Record<string, string>): Array<{ email: string; optional: boolean }> {
    const required = emailList(v.attendees ?? '');
    const optional = emailList(v.optional_attendees ?? '').filter((e) => !required.includes(e));
    return [
        ...required.map((email) => ({ email, optional: false })),
        ...optional.map((email) => ({ email, optional: true })),
    ].slice(0, MAX_RECIPIENTS);
}

function googleTimes(times: EventTimes, tz: string): Record<string, unknown> {
    if (times.allDay) return { start: { date: times.startDate }, end: { date: times.endDate } };
    const point = (value: string, utc: boolean): Record<string, string> => ({
        dateTime: utc ? `${value}Z` : value,
        timeZone: utc ? 'UTC' : tz,
    });
    return { start: point(times.start, times.startUtc), end: point(times.end, times.endUtc) };
}

function graphTimes(times: EventTimes, tz: string): Record<string, unknown> {
    if (times.allDay) {
        return {
            isAllDay: true,
            start: { dateTime: `${times.startDate}T00:00:00`, timeZone: tz },
            end: { dateTime: `${times.endDate}T00:00:00`, timeZone: tz },
        };
    }
    return {
        start: { dateTime: times.start, timeZone: times.startUtc ? 'UTC' : tz },
        end: { dateTime: times.end, timeZone: times.endUtc ? 'UTC' : tz },
    };
}

function eventBodyGoogle(v: Record<string, string>): Record<string, unknown> {
    const tz = (v.timezone ?? '').trim() || 'UTC';
    const body: Record<string, unknown> = { summary: v.title ?? '', ...googleTimes(eventTimes(v), tz) };
    if ((v.description ?? '').trim() !== '') body.description = v.description;
    if ((v.location ?? '').trim() !== '') body.location = v.location!.trim();
    const attendees = eventAttendees(v);
    if (attendees.length > 0) body.attendees = attendees.map((a) => (a.optional ? { email: a.email, optional: true } : { email: a.email }));
    // v0.1.348 — Google crea la sala de Meet si se le pide con un id único
    // por pedido (reusar uno hace que ignore el pedido).
    if (isTrue(v.meet)) {
        body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
    }
    return body;
}

function graphAttendees(v: Record<string, string>): Array<Record<string, unknown>> {
    return eventAttendees(v).map((a) => ({ emailAddress: { address: a.email }, type: a.optional ? 'optional' : 'required' }));
}

function eventBodyGraph(v: Record<string, string>): Record<string, unknown> {
    const tz = (v.timezone ?? '').trim() || 'UTC';
    const body: Record<string, unknown> = {
        subject: v.title ?? '',
        body: { contentType: 'Text', content: v.description ?? '' },
        ...graphTimes(eventTimes(v), tz),
    };
    if ((v.location ?? '').trim() !== '') body.location = { displayName: v.location!.trim() };
    const attendees = graphAttendees(v);
    if (attendees.length > 0) body.attendees = attendees;
    // v0.1.348 — reunión de Teams en el evento: Outlook le pone el enlace y se
    // lo manda a los invitados. Sólo cuentas de trabajo o estudiantiles.
    if (isTrue(v.teams_meeting)) {
        body.isOnlineMeeting = true;
        body.onlineMeetingProvider = 'teamsForBusiness';
    }
    return body;
}

/**
 * v0.1.366 — Lo que cambia al reprogramar: SÓLO lo que se completó (una
 * automatización que mueve la fecha no le borra la descripción). La duración
 * vacía la completa antes `prepareIntegrationRequest` con la que el evento ya
 * tenía.
 */
function eventPatch(v: Record<string, string>, flavor: 'graph' | 'google'): Record<string, unknown> {
    const tz = (v.timezone ?? '').trim() || 'UTC';
    const body: Record<string, unknown> = {};
    const has = (k: string): boolean => (v[k] ?? '').trim() !== '';
    if (has('title')) body[flavor === 'graph' ? 'subject' : 'summary'] = headerSafe(v.title!);
    if (has('description')) body[flavor === 'graph' ? 'body' : 'description'] = flavor === 'graph' ? { contentType: 'Text', content: v.description } : v.description;
    if (has('location')) body.location = flavor === 'graph' ? { displayName: v.location!.trim() } : v.location!.trim();
    if (has('date')) {
        const times = eventTimes(v);
        Object.assign(body, flavor === 'graph' ? { isAllDay: times.allDay, ...graphTimes(times, tz) } : googleTimes(times, tz));
    } else if (has('time') || has('end') || has('duration')) {
        throw new IntegrationInputError('Para cambiar la hora, completa también el Inicio nuevo (la fecha, o una variable con la fecha y hora).');
    }
    if (has('attendees') || has('optional_attendees')) {
        body.attendees =
            flavor === 'graph'
                ? graphAttendees(v)
                : eventAttendees(v).map((a) => (a.optional ? { email: a.email, optional: true } : { email: a.email }));
    }
    if (Object.keys(body).length === 0) {
        throw new IntegrationInputError('No hay nada que cambiar: completa al menos un dato (por ejemplo el Inicio nuevo).');
    }
    return body;
}

function googleCalendarPath(v: Record<string, string>): string {
    const calendar = (v.calendar ?? '').trim() || 'primary';
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`;
}

/** Qué devolvió el calendario al crear o cambiar un evento (para `{{reunion.*}}`). */
export interface MeetingResult {
    id: string;
    /** El enlace para unirse (Teams o Meet); vacío si el evento no tiene videollamada. */
    enlace: string;
    /** El enlace para abrir el evento en el calendario. */
    web: string;
    titulo: string;
    /** Google todavía está creando la sala de Meet (hay que volver a leer el evento). */
    pending: boolean;
    /** v0.1.384 — Google creó el evento pero NO pudo crear la sala de Meet. */
    failed: boolean;
}

function httpsOr(value: unknown): string {
    return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
}

export function meetingResult(integration: IntegrationKey, body: string): MeetingResult | null {
    const json = parseJson(body);
    if (!json || typeof json.id !== 'string' || json.id === '') return null;
    if (integration === 'google_calendar') {
        const conf = (json.conferenceData ?? {}) as {
            entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
            createRequest?: { status?: { statusCode?: string } };
        };
        const video = (conf.entryPoints ?? []).find((e) => e.entryPointType === 'video')?.uri;
        const enlace = httpsOr(json.hangoutLink) || httpsOr(video);
        const code = conf.createRequest?.status?.statusCode;
        return {
            id: json.id,
            enlace,
            web: httpsOr(json.htmlLink),
            titulo: typeof json.summary === 'string' ? json.summary : '',
            pending: enlace === '' && code === 'pending',
            failed: enlace === '' && code === 'failure',
        };
    }
    const online = (json.onlineMeeting ?? {}) as { joinUrl?: unknown };
    return {
        id: json.id,
        enlace: httpsOr(online.joinUrl) || httpsOr(json.onlineMeetingUrl),
        web: httpsOr(json.webLink),
        titulo: typeof json.subject === 'string' ? json.subject : '',
        pending: false,
        failed: false,
    };
}

/** v0.1.384 — ¿La acción pidió videollamada (Meet o Teams)? */
export function wantsVideoCall(integration: string, values: Record<string, string>): boolean {
    return integration === 'google_calendar' ? isTrue(values.meet) : isTrue(values.teams_meeting);
}

/**
 * v0.1.384 — Qué decir cuando se pidió videollamada y el evento volvió sin
 * enlace (`null` = salió bien o no se pidió). Sin esto el historial decía
 * «creado» y el `{{reunion.enlace}}` del WhatsApp siguiente salía vacío.
 */
export function videoCallNote(integration: string, meet: MeetingResult | null, wanted: boolean): string | null {
    if (!wanted || !meet || meet.enlace !== '') return null;
    if (integration === 'google_calendar') {
        return meet.pending
            ? 'Google todavía estaba creando la videollamada de Meet: el enlace aparece en el evento en unos segundos, pero no llegó a tiempo para los pasos siguientes'
            : 'sin videollamada de Meet: Google no pudo crearla (puede que tu empresa tenga Google Meet apagado para esta cuenta)';
    }
    return 'sin enlace de Teams: la cuenta no tiene Teams o Microsoft no creó la reunión';
}

/** Volver a leer un evento de Google cuya sala de Meet todavía se estaba creando. */
export function googleEventReadRequest(calendar: string, eventId: string, accessToken: string): IntegrationRequest {
    const cal = calendar.trim() || 'primary';
    return {
        url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}?fields=id,summary,htmlLink,hangoutLink,conferenceData`,
        method: 'GET',
        headers: { accept: 'application/json', ...bearer(accessToken) },
    };
}

/** El evento como está (para conservar su duración al reprogramarlo). */
export function eventReadRequest(integration: IntegrationKey, v: Record<string, string>, accessToken: string): IntegrationRequest {
    const id = eventIdOf(v.event_id ?? '');
    if (integration === 'google_calendar') {
        return {
            url: `${googleCalendarPath(v)}/${encodeURIComponent(id)}?fields=start,end`,
            method: 'GET',
            headers: { accept: 'application/json', ...bearer(accessToken) },
        };
    }
    return {
        url: `${GRAPH_BASE}/v1.0/me/events/${encodeURIComponent(id)}?$select=start,end,isAllDay`,
        method: 'GET',
        headers: { accept: 'application/json', ...bearer(accessToken), Prefer: 'outlook.timezone="UTC"' },
    };
}

/** Los minutos que dura un evento leído (null si no se entiende). */
export function eventDurationMinutes(body: string): number | null {
    const json = parseJson(body);
    if (!json) return null;
    const point = (raw: unknown): number => {
        const o = (raw ?? {}) as { dateTime?: unknown; date?: unknown };
        const text = typeof o.dateTime === 'string' ? o.dateTime : typeof o.date === 'string' ? `${o.date}T00:00:00Z` : '';
        // Graph devuelve la hora sin zona (pedida en UTC); Google, con su desfase.
        const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
        return Date.parse(withZone);
    };
    const start = point(json.start);
    const end = point(json.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 60_000);
}

/** ¿Cancelar algo que ya no está? (404/410): no es un error, ya no está en el calendario. */
export function cancelAlreadyGone(status: number): boolean {
    return status === 404 || status === 410;
}

// --- Microsoft Teams (v0.1.348) -----------------------------------------------

export const GRAPH_BASE = 'https://graph.microsoft.com';

/**
 * El texto del mensaje como HTML de Teams: escapado (un registro no mete HTML
 * ni enlaces falsos en un mensaje que sale con la cuenta de la empresa) y con
 * los saltos de línea respetados. Teams colapsa los saltos de un mensaje de
 * texto plano.
 */
export function teamsHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\r?\n/g, '<br>');
}

function teamsMessageBody(v: Record<string, string>, withSubject: boolean): string {
    const message = v.message ?? '';
    if (message.trim() === '') throw new IntegrationInputError('El mensaje está vacío.');
    const subject = withSubject ? headerSafe(v.subject ?? '') : '';
    return JSON.stringify({
        ...(subject !== '' ? { subject } : {}),
        body: { contentType: 'html', content: teamsHtml(message) },
    });
}

/** Lo que va en la URL del mensaje directo hasta saber el chat (sólo se ve en la simulación). */
export const TEAMS_DM_CHAT_PLACEHOLDER = '{chat-uno-a-uno}';

/** ¿Quién es la cuenta conectada? (el chat uno a uno se arma con su id). */
export function teamsMeRequest(accessToken: string): IntegrationRequest {
    return {
        url: `${GRAPH_BASE}/v1.0/me?$select=id,userPrincipalName`,
        method: 'GET',
        headers: { accept: 'application/json', ...bearer(accessToken) },
    };
}

/**
 * Crea —o devuelve, si ya existe— el chat uno a uno entre la cuenta conectada
 * y la persona. Microsoft no duplica los chats uno a uno: pedirlo de nuevo
 * devuelve el mismo, así que no hace falta recordarlo.
 */
export function teamsOneOnOneRequest(accessToken: string, meId: string, email: string): IntegrationRequest {
    const member = (who: string): Record<string, unknown> => ({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `${GRAPH_BASE}/v1.0/users('${who.replace(/'/g, "''")}')`,
    });
    return {
        url: `${GRAPH_BASE}/v1.0/chats`,
        method: 'POST',
        headers: { ...JSON_HEADERS, ...bearer(accessToken) },
        body: JSON.stringify({ chatType: 'oneOnOne', members: [member(meId), member(email)] }),
    };
}

function mailRecipients(v: Record<string, string>): { to: string[]; cc: string[]; bcc: string[] } {
    const to = emailList(v.to ?? '');
    if (to.length === 0) {
        throw new IntegrationInputError(`«${(v.to ?? '').trim() || '(vacío)'}» no es un correo válido.`);
    }
    return { to, cc: emailList(v.cc ?? ''), bcc: emailList(v.bcc ?? '') };
}

export function buildIntegrationRequest(
    integration: IntegrationKey,
    actionKey: string,
    compiled: IntegrationValues,
    creds: IntegrationCreds,
): IntegrationRequest {
    const v = compiled.values;
    if (integration === 'woocommerce') return buildWooRequest(actionKey, compiled, creds);
    switch (`${integration}.${actionKey}`) {
        case 'whatsapp.send_text':
            // Exactamente los campos de la petición que ya funciona en
            // producción (webhook a mano): `type` se omite, WAS asume texto.
            return {
                url: `${wasServer(creds)}/api/send/whatsapp`,
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
                body: form([
                    ['secret', creds.secret],
                    ['account', creds.fields.account ?? ''],
                    ['recipient', phone(v.recipient ?? '')],
                    ['message', v.message ?? ''],
                ]),
            };
        case 'whatsapp.send_media': {
            const url = (v.url ?? '').trim();
            if (!/^https?:\/\//i.test(url)) {
                throw new IntegrationInputError('El enlace del archivo tiene que empezar con https://');
            }
            const kind = (v.kind ?? 'image').trim() || 'image';
            const pairs: Array<[string, string]> = [
                ['secret', creds.secret],
                ['account', creds.fields.account ?? ''],
                ['recipient', phone(v.recipient ?? '')],
            ];
            if (kind === 'document') {
                const name = decodeURIComponent(url.split(/[?#]/)[0]!.split('/').pop() || 'documento.pdf');
                pairs.push(
                    ['type', 'document'],
                    ['document_url', url],
                    ['document_name', name],
                    ['document_type', 'pdf'],
                );
            } else {
                pairs.push(['type', 'media'], ['media_url', url], ['media_type', kind]);
            }
            if ((v.caption ?? '').trim() !== '') pairs.push(['message', v.caption!]);
            return {
                url: `${wasServer(creds)}/api/send/whatsapp`,
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
                body: form(pairs),
            };
        }
        case 'telegram.send_message':
            return {
                url: `https://api.telegram.org/bot${creds.secret}/sendMessage`,
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({
                    chat_id: (v.chat_id ?? '').trim(),
                    text: v.text ?? '',
                    disable_notification: isTrue(v.silent),
                }),
            };
        case 'slack.send_message':
            return {
                url: 'https://slack.com/api/chat.postMessage',
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify({ channel: (v.channel ?? '').trim(), text: v.text ?? '' }),
            };
        case 'gmail.send_email': {
            const r = mailRecipients(v);
            const raw = buildRfc2822({
                ...r,
                subject: v.subject ?? '',
                body: v.body ?? '',
                html: isTrue(v.html),
            });
            return {
                url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
            };
        }
        // v0.1.384 — «Crear reunión de Google Meet» es el mismo evento con el enlace encendido.
        case 'google_calendar.create_meeting':
        case 'google_calendar.create_event': {
            const body = eventBodyGoogle(v);
            const q = new URLSearchParams();
            if (Array.isArray(body.attendees)) q.set('sendUpdates', 'all');
            if (body.conferenceData) q.set('conferenceDataVersion', '1');
            const query = q.toString() !== '' ? `?${q.toString()}` : '';
            return {
                url: `${googleCalendarPath(v)}${query}`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify(body),
            };
        }
        // v0.1.366 — reprogramar y cancelar. `sendUpdates=all`: a los invitados
        // les llega el cambio o la cancelación, igual que si se hiciera a mano.
        case 'google_calendar.update_event': {
            const id = eventIdOf(v.event_id ?? '');
            return {
                url: `${googleCalendarPath(v)}/${encodeURIComponent(id)}?sendUpdates=all`,
                method: 'PATCH',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify(eventPatch(v, 'google')),
            };
        }
        case 'google_calendar.cancel_event': {
            const id = eventIdOf(v.event_id ?? '');
            return {
                url: `${googleCalendarPath(v)}/${encodeURIComponent(id)}?sendUpdates=all`,
                method: 'DELETE',
                headers: { accept: 'application/json', ...bearer(creds.accessToken) },
            };
        }
        case 'google_sheets.append_row': {
            const id = spreadsheetId(v.spreadsheet ?? '');
            const sheet = (v.sheet ?? '').trim();
            const range = sheet !== '' ? `'${sheet.replace(/'/g, "''")}'!A1` : 'A1';
            const row = (compiled.lines.values ?? []).map(sheetCell);
            return {
                url:
                    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/` +
                    `${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify({ values: [row] }),
            };
        }
        case 'outlook.send_email': {
            const r = mailRecipients(v);
            const toList = (list: string[]): Array<{ emailAddress: { address: string } }> =>
                list.map((address) => ({ emailAddress: { address } }));
            return {
                url: 'https://graph.microsoft.com/v1.0/me/sendMail',
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify({
                    message: {
                        subject: headerSafe(v.subject ?? ''),
                        body: { contentType: isTrue(v.html) ? 'HTML' : 'Text', content: v.body ?? '' },
                        toRecipients: toList(r.to),
                        ...(r.cc.length > 0 ? { ccRecipients: toList(r.cc) } : {}),
                        ...(r.bcc.length > 0 ? { bccRecipients: toList(r.bcc) } : {}),
                    },
                    saveToSentItems: true,
                }),
            };
        }
        case 'outlook.create_event':
        case 'teams.create_meeting':
            return {
                url: `${GRAPH_BASE}/v1.0/me/events`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify(eventBodyGraph(v)),
            };
        // v0.1.366 — reprogramar y cancelar por el id (Outlook y Teams son el
        // mismo calendario de Microsoft 365). Microsoft le manda el cambio o la
        // cancelación a los invitados porque la cuenta conectada es la organizadora.
        case 'outlook.update_event':
        case 'teams.update_event': {
            const id = eventIdOf(v.event_id ?? '');
            return {
                url: `${GRAPH_BASE}/v1.0/me/events/${encodeURIComponent(id)}`,
                method: 'PATCH',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify(eventPatch(v, 'graph')),
            };
        }
        case 'outlook.cancel_event':
        case 'teams.cancel_event': {
            const id = eventIdOf(v.event_id ?? '');
            // Con mensaje, `cancel` (lo lleva el correo de cancelación); sin
            // mensaje, borrarlo: también avisa a los invitados.
            const message = (v.message ?? '').trim();
            return message !== ''
                ? {
                      url: `${GRAPH_BASE}/v1.0/me/events/${encodeURIComponent(id)}/cancel`,
                      method: 'POST',
                      headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                      body: JSON.stringify({ comment: message }),
                  }
                : {
                      url: `${GRAPH_BASE}/v1.0/me/events/${encodeURIComponent(id)}`,
                      method: 'DELETE',
                      headers: { accept: 'application/json', ...bearer(creds.accessToken) },
                  };
        }
        case 'teams.send_channel_message': {
            const ref = parseTeamsChannelRef(v.channel ?? '');
            if (!ref) {
                throw new IntegrationInputError(
                    'No reconocemos ese canal. Elígelo con «Elegir canal» o pega el vínculo del canal (en Teams: «…» junto al canal → «Obtener vínculo al canal»).',
                );
            }
            return {
                url: `${GRAPH_BASE}/v1.0/teams/${encodeURIComponent(ref.teamId)}/channels/${encodeURIComponent(ref.channelId)}/messages`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: teamsMessageBody(v, true),
            };
        }
        case 'teams.send_chat_message': {
            const ref = parseTeamsChatRef(v.chat ?? '');
            if (!ref) {
                throw new IntegrationInputError(
                    'No reconocemos ese chat. Pega el vínculo de un mensaje del chat (en Teams: «…» sobre un mensaje → «Copiar vínculo»).',
                );
            }
            return {
                url: `${GRAPH_BASE}/v1.0/chats/${encodeURIComponent(ref.chatId)}/messages`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: teamsMessageBody(v, false),
            };
        }
        case 'teams.send_direct_message': {
            // El chat se resuelve antes de mandar (`prepareIntegrationRequest`):
            // aquí queda el envío, con el chat por completar.
            const to = emailList(v.to ?? '');
            if (to.length !== 1) {
                throw new IntegrationInputError(
                    `«${(v.to ?? '').trim() || '(vacío)'}» no es un correo válido. Va UN correo: el de trabajo de la persona.`,
                );
            }
            return {
                url: `${GRAPH_BASE}/v1.0/chats/${TEAMS_DM_CHAT_PLACEHOLDER}/messages`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: teamsMessageBody(v, false),
            };
        }
        default:
            throw new IntegrationInputError(`La acción «${actionKey}» no existe en esta app.`);
    }
}

// --- Respuestas -----------------------------------------------------------------

const SLACK_ERRORS: Record<string, string> = {
    channel_not_found: 'No existe ese canal o la app no lo ve. Revisa el nombre.',
    not_in_channel: 'La app no está en ese canal: invítala con /invite.',
    is_archived: 'El canal está archivado.',
    invalid_auth: 'La autorización de Slack ya no es válida: reconecta la app.',
    token_revoked: 'La autorización de Slack fue revocada: reconecta la app.',
    account_inactive: 'La autorización de Slack fue revocada: reconecta la app.',
    msg_too_long: 'El mensaje es demasiado largo para Slack.',
    no_text: 'El mensaje está vacío.',
};

/**
 * ¿Salió bien? Varias de estas APIs contestan 200 con un error adentro
 * (Slack, Telegram, WAS): mirar sólo el status marcaría como exitoso un
 * mensaje que nunca se mandó, que es el fallo silencioso que ya costó caro con
 * el SMTP (v0.1.150). Devuelve el motivo legible, o `null` si salió bien.
 */
export function checkIntegrationResponse(
    integration: IntegrationKey,
    status: number,
    body: string,
    /** v0.1.366 — la acción: un error de calendario se explica distinto que uno de un mensaje. */
    actionKey = '',
): string | null {
    if (integration === 'woocommerce') return checkWooResponse(status, body);
    const json = parseJson(body);
    // v0.1.384 — Google: los casos conocidos, en palabras y con la salida.
    const google = googleProblem(integration, status, json, actionKey);
    if (google) return google;
    const meeting = meetingActionKind(integration, actionKey);
    if (meeting && status >= 400 && status !== 401) {
        const said = integration === 'google_calendar' ? googleErrorMessage(json) : graphErrorMessage(json);
        const quote = said !== '' ? ` Dijo: «${said.slice(0, 240)}».` : '';
        if (status === 404 || status === 410) {
            return 'No encontramos ese evento: puede que lo hayan borrado del calendario o que el id sea de otra cuenta.';
        }
        if (/organi[sz]er/i.test(said)) {
            return `Sólo quien organizó la reunión puede cambiarla o cancelarla, y la cuenta conectada no es la organizadora.${quote}`;
        }
        if (/MSA|personal Microsoft account|consumer|not supported for (this|the) (account|user)/i.test(said) || /onlineMeeting/i.test(said)) {
            return 'La reunión de Teams sólo se puede crear con cuentas de trabajo o estudiantiles de Microsoft 365 que tengan Teams, no con outlook.com o hotmail. Apaga el enlace de Teams o conecta otra cuenta.';
        }
        if (status === 403) {
            return integration === 'teams'
                ? `La conexión de Teams no tiene permiso para el calendario: vuelve a conectarla en Ajustes → Integraciones → Microsoft Teams (si tu empresa pide la aprobación del administrador, crea el enlace otra vez).${quote}`
                : `La cuenta conectada no tiene permiso sobre ese calendario.${quote}`;
        }
        if (status === 400 && /end.*(before|after)|start.*end/i.test(said)) {
            return `El fin del evento tiene que ser después del inicio.${quote}`;
        }
        return `${integration === 'google_calendar' ? 'Google Calendar' : 'Microsoft'} rechazó el pedido (HTTP ${status}).${quote}`;
    }
    if (integration === 'slack') {
        if (json && json.ok === false) {
            const code = String(json.error ?? 'error');
            return SLACK_ERRORS[code] ?? `Slack rechazó el mensaje (${code}).`;
        }
        return status >= 400 ? `Slack respondió ${status}.` : null;
    }
    if (integration === 'telegram') {
        if (json && json.ok === false) {
            const desc = String(json.description ?? '');
            if (/chat not found/i.test(desc)) {
                return 'No encontramos ese chat: revisa el ID y que el bot esté en el grupo o canal.';
            }
            if (status === 401) return 'El token del bot ya no es válido: actualízalo en Integraciones.';
            return `Telegram rechazó el mensaje: ${desc || status}.`;
        }
        return status >= 400 ? `Telegram respondió ${status}.` : null;
    }
    if (integration === 'whatsapp') {
        const inner = json ? Number(json.status) : NaN;
        if (status >= 400 || (Number.isFinite(inner) && inner >= 400)) {
            const msg = json && typeof json.message === 'string' ? json.message : `HTTP ${status}`;
            return `WhatsApp rechazó el envío: ${msg}`;
        }
        return null;
    }
    if (status === 401) {
        return 'La autorización venció o se revocó: reconecta la app en Ajustes → Integraciones.';
    }
    if (status >= 400 && (integration === 'teams' || integration === 'outlook')) {
        const said = graphErrorMessage(json);
        // Teams no tiene API para cuentas personales (outlook.com, hotmail).
        if (/MSA|personal Microsoft account|consumer|not supported for (this|the) (account|user)/i.test(said)) {
            return integration === 'teams'
                ? 'Teams sólo funciona con cuentas de trabajo o estudiantiles de Microsoft 365, no con outlook.com o hotmail.'
                : 'La reunión de Teams sólo se puede crear con cuentas de trabajo o estudiantiles de Microsoft 365, no con outlook.com o hotmail.';
        }
        if (integration === 'outlook' && /onlineMeeting/i.test(said)) {
            return 'Microsoft no pudo crear la reunión de Teams: hace falta una cuenta de trabajo o estudiantil con Teams. Apaga «Agregar reunión de Teams» o conecta otra cuenta.';
        }
        if (integration === 'teams') {
            if (status === 403) {
                return 'La cuenta conectada no puede escribir ahí: tiene que ser miembro del equipo y del canal (o del chat). ' +
                    (said !== '' ? `Microsoft dijo: «${said}».` : '');
            }
            if (status === 404) {
                return 'No encontramos ese canal o chat: puede que lo hayan borrado o que la cuenta conectada ya no sea miembro.';
            }
        }
    }
    if (status >= 400) {
        const err = json?.error;
        const msg =
            err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string'
                ? String((err as Record<string, unknown>).message)
                : typeof err === 'string'
                  ? err
                  : `HTTP ${status}`;
        return `El servicio rechazó el pedido: ${msg}`;
    }
    return null;
}

// --- Identidad de la cuenta conectada (OAuth) -----------------------------------

export function identityRequest(provider: IntegrationProvider, accessToken: string): IntegrationRequest {
    const url =
        provider === 'google'
            ? 'https://openidconnect.googleapis.com/v1/userinfo'
            : provider === 'microsoft'
              ? 'https://graph.microsoft.com/v1.0/me'
              : 'https://slack.com/api/auth.test';
    return { url, method: 'GET', headers: { accept: 'application/json', ...bearer(accessToken) } };
}

/** «ana@acme.com» / «Acme (Slack)». `null` si no se pudo leer: no es un error. */
export function identityLabel(provider: IntegrationProvider, body: string): string | null {
    const json = parseJson(body);
    if (!json) return null;
    if (provider === 'google') return typeof json.email === 'string' ? json.email : null;
    if (provider === 'microsoft') {
        const mail = typeof json.mail === 'string' && json.mail !== '' ? json.mail : json.userPrincipalName;
        return typeof mail === 'string' && mail !== '' ? mail : null;
    }
    if (json.ok === false) return null;
    return typeof json.team === 'string' && json.team !== '' ? json.team : null;
}

// --- Verificación de las apps por clave ---------------------------------------

export function verifyRequest(integration: IntegrationKey, creds: IntegrationCreds): IntegrationRequest | null {
    if (integration === 'telegram') {
        return {
            url: `https://api.telegram.org/bot${creds.secret}/getMe`,
            method: 'GET',
            headers: { accept: 'application/json' },
        };
    }
    if (integration === 'whatsapp') {
        return {
            url: `${wasServer(creds)}/api/get/wa.accounts?${form([
                ['secret', creds.secret],
                ['limit', '50'],
                ['page', '1'],
            ])}`,
            method: 'GET',
            headers: { accept: 'application/json' },
        };
    }
    return null;
}

export interface VerifyOutcome {
    ok: boolean;
    label: string | null;
    error: string | null;
    warning: string | null;
    options: Record<string, Array<{ value: string; label: string }>>;
    /**
     * Campos NO secretos que descubrió la verificación y hay que guardar con
     * la conexión (WooCommerce: cómo acepta la clave esa tienda).
     */
    fields?: Record<string, string>;
}

export function parseVerify(
    integration: IntegrationKey,
    status: number,
    body: string,
    creds: IntegrationCreds,
): VerifyOutcome {
    const json = parseJson(body);
    const out: VerifyOutcome = { ok: true, label: null, error: null, warning: null, options: {} };
    if (integration === 'telegram') {
        if (status === 401 || status === 404 || json?.ok === false) {
            return { ...out, ok: false, error: 'Telegram no reconoce ese token. Cópialo de nuevo desde @BotFather.' };
        }
        if (status !== 200 || json?.ok !== true) {
            // Algo en el medio (un proxy, una caída) contestó en vez de
            // Telegram: no se sabe si el token sirve, y hay que decirlo.
            return {
                ...out,
                warning: `No pudimos comprobar el token ahora (respuesta ${status}). Se guardó igual: pruébalo con «Probar ahora» en una automatización.`,
            };
        }
        const result = json.result as Record<string, unknown> | undefined;
        const username = typeof result?.username === 'string' ? result.username : null;
        return { ...out, label: username ? `@${username}` : null };
    }
    if (integration === 'whatsapp') {
        // El listado de cuentas es una AYUDA, nunca una puerta: las claves de
        // WAS (Zender) tienen permisos por función, y una clave creada sólo
        // para enviar recibe 403 al listar aunque mande perfecto. Rechazarla
        // por eso bloqueaba justo las claves que ya funcionan en producción.
        // Lo que prueba la clave de verdad es el mensaje de prueba.
        const inner = json ? Number(json.status) : NaN;
        const data = json?.data;
        if (status < 400 && Array.isArray(data)) {
            const accounts = data
                .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
                .map((a) => {
                    const value = String(a.unique ?? a.id ?? '');
                    const num = typeof a.phone === 'string' && a.phone !== '' ? a.phone : value;
                    const state = typeof a.status === 'string' && a.status !== '' ? ` · ${a.status}` : '';
                    return { value, label: `${num}${state}`, phone: num };
                })
                .filter((a) => a.value !== '');
            out.options.account = accounts.map(({ value, label }) => ({ value, label }));
            const chosen = accounts.find((a) => a.value === (creds.fields.account ?? ''));
            out.label = chosen ? chosen.phone : null;
            if (accounts.length === 0) {
                out.warning = 'La clave es válida pero no hay ningún número de WhatsApp conectado en WAS.';
            }
            return out;
        }
        const said = json && typeof json.message === 'string' && json.message.trim() !== '' ? json.message.trim() : null;
        const code = Number.isFinite(inner) && inner >= 400 ? inner : status;
        const detail = said ? ` (WAS respondió: «${said}»)` : code >= 400 ? ` (respuesta ${code})` : '';
        return {
            ...out,
            warning:
                `No pudimos listar tus cuentas con esta clave${detail}. Es normal si la clave sólo tiene ` +
                'permiso de envío: escribe el identificador de la cuenta a mano y manda un mensaje de prueba ' +
                'para confirmar que funciona.',
        };
    }
    return out;
}

// --- Mensaje de prueba ------------------------------------------------------------

export const TEST_MESSAGE = 'Prueba de conexión de Imagina Base: si te llegó este mensaje, la integración quedó lista.';

/**
 * Un envío REAL con la misma función que usa el motor: si la prueba pasa, la
 * automatización también. Sólo para las apps de mensajería por clave.
 */
export function testSendRequest(
    integration: IntegrationKey,
    creds: IntegrationCreds,
    to: string,
): IntegrationRequest | null {
    const target = to.trim();
    if (integration === 'whatsapp') {
        return buildIntegrationRequest(
            'whatsapp',
            'send_text',
            { values: { recipient: target, message: TEST_MESSAGE }, lines: {} },
            creds,
        );
    }
    if (integration === 'telegram') {
        return buildIntegrationRequest(
            'telegram',
            'send_message',
            { values: { chat_id: target, text: TEST_MESSAGE }, lines: {} },
            creds,
        );
    }
    return null;
}
