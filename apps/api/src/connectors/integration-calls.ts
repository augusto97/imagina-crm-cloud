import type { ConnectorAction, IntegrationKey, IntegrationProvider } from '@imagina-base/shared';

/**
 * Peticiones de las apps de la galería (v0.1.203, ADR-S22 fase 4).
 *
 * Cada acción ya armada («Enviar mensaje a Slack», «Agregar fila en Google
 * Sheets») se traduce acá a la petición HTTP real. Es código y no filas
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
}

export interface IntegrationRequest {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
}

/** Valores ya resueltos (merge aplicado). Los parámetros «de a renglón» vienen partidos. */
export interface IntegrationValues {
    values: Record<string, string>;
    lines: Record<string, string[]>;
}

/** Dato mal cargado por quien armó la automatización: el mensaje es para esa persona. */
export class IntegrationInputError extends Error {
    readonly code = 'integration_input';
}

export type MergeFn = (raw: unknown) => string;

/**
 * Parámetros que se escriben uno por renglón y se mergean de a uno. Mergear el
 * texto entero y partir DESPUÉS rompería una celda cuyo valor trae saltos de
 * línea (un campo de texto largo del registro).
 */
const LINE_PARAMS: Partial<Record<string, readonly string[]>> = {
    'google_sheets.append_row': ['values'],
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
): IntegrationValues & { missing: string[] } {
    const lineKeys = LINE_PARAMS[`${integration}.${action.key}`] ?? [];
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
        const value = merge(source);
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
        'No reconocemos la hoja de cálculo: pegá el enlace completo (https://docs.google.com/spreadsheets/d/…).',
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

function eventBodyGoogle(v: Record<string, string>): Record<string, unknown> {
    const win = eventWindow(v.date ?? '', v.time ?? '', v.duration ?? '');
    const tz = (v.timezone ?? '').trim() || 'UTC';
    const body: Record<string, unknown> = { summary: v.title ?? '' };
    if ((v.description ?? '').trim() !== '') body.description = v.description;
    if (win.allDay) {
        body.start = { date: win.startDate };
        body.end = { date: win.endDate };
    } else {
        body.start = { dateTime: win.utc ? `${win.start}Z` : win.start, timeZone: win.utc ? 'UTC' : tz };
        body.end = { dateTime: win.utc ? `${win.end}Z` : win.end, timeZone: win.utc ? 'UTC' : tz };
    }
    const attendees = emailList(v.attendees ?? '');
    if (attendees.length > 0) body.attendees = attendees.map((email) => ({ email }));
    return body;
}

function eventBodyGraph(v: Record<string, string>): Record<string, unknown> {
    const win = eventWindow(v.date ?? '', v.time ?? '', v.duration ?? '');
    const tz = (v.timezone ?? '').trim() || 'UTC';
    const body: Record<string, unknown> = {
        subject: v.title ?? '',
        body: { contentType: 'Text', content: v.description ?? '' },
    };
    if (win.allDay) {
        body.isAllDay = true;
        body.start = { dateTime: `${win.startDate}T00:00:00`, timeZone: tz };
        body.end = { dateTime: `${win.endDate}T00:00:00`, timeZone: tz };
    } else {
        body.start = { dateTime: win.start, timeZone: win.utc ? 'UTC' : tz };
        body.end = { dateTime: win.end, timeZone: win.utc ? 'UTC' : tz };
    }
    const attendees = emailList(v.attendees ?? '');
    if (attendees.length > 0) {
        body.attendees = attendees.map((address) => ({ emailAddress: { address }, type: 'required' }));
    }
    return body;
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
    switch (`${integration}.${actionKey}`) {
        case 'whatsapp.send_text':
            return {
                url: `${wasServer(creds)}/api/send/whatsapp`,
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
                body: form([
                    ['secret', creds.secret],
                    ['account', creds.fields.account ?? ''],
                    ['recipient', phone(v.recipient ?? '')],
                    ['type', 'text'],
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
        case 'google_calendar.create_event': {
            const calendar = (v.calendar ?? '').trim() || 'primary';
            const body = eventBodyGoogle(v);
            const invite = Array.isArray(body.attendees) ? '?sendUpdates=all' : '';
            return {
                url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events${invite}`,
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify(body),
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
            return {
                url: 'https://graph.microsoft.com/v1.0/me/events',
                method: 'POST',
                headers: { ...JSON_HEADERS, ...bearer(creds.accessToken) },
                body: JSON.stringify(eventBodyGraph(v)),
            };
        default:
            throw new IntegrationInputError(`La acción «${actionKey}» no existe en esta app.`);
    }
}

// --- Respuestas -----------------------------------------------------------------

const SLACK_ERRORS: Record<string, string> = {
    channel_not_found: 'No existe ese canal o la app no lo ve. Revisá el nombre.',
    not_in_channel: 'La app no está en ese canal: invitala con /invite.',
    is_archived: 'El canal está archivado.',
    invalid_auth: 'La autorización de Slack ya no es válida: reconectá la app.',
    token_revoked: 'La autorización de Slack fue revocada: reconectá la app.',
    account_inactive: 'La autorización de Slack fue revocada: reconectá la app.',
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
): string | null {
    const json = parseJson(body);
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
                return 'No encontramos ese chat: revisá el ID y que el bot esté en el grupo o canal.';
            }
            if (status === 401) return 'El token del bot ya no es válido: actualizalo en Integraciones.';
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
        return 'La autorización venció o se revocó: reconectá la app en Ajustes → Integraciones.';
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
            return { ...out, ok: false, error: 'Telegram no reconoce ese token. Copialo de nuevo desde @BotFather.' };
        }
        if (status !== 200 || json?.ok !== true) {
            // Algo en el medio (un proxy, una caída) contestó en vez de
            // Telegram: no se sabe si el token sirve, y hay que decirlo.
            return {
                ...out,
                warning: `No pudimos comprobar el token ahora (respuesta ${status}). Se guardó igual: probalo con «Probar ahora» en una automatización.`,
            };
        }
        const result = json.result as Record<string, unknown> | undefined;
        const username = typeof result?.username === 'string' ? result.username : null;
        return { ...out, label: username ? `@${username}` : null };
    }
    if (integration === 'whatsapp') {
        const inner = json ? Number(json.status) : NaN;
        if (status === 401 || status === 403 || inner === 401 || inner === 403) {
            return { ...out, ok: false, error: 'WAS no reconoce esa clave de API. Copiala de nuevo desde tu panel.' };
        }
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
        if (inner >= 400 && json && typeof json.message === 'string') {
            return { ...out, ok: false, error: `WAS rechazó la clave: ${json.message}` };
        }
        // Un servidor que no contesta como esperamos NO bloquea: la clave puede
        // estar bien y el listado de cuentas no existir en esa versión.
        return {
            ...out,
            warning: 'No pudimos listar tus cuentas; escribí el identificador de la cuenta a mano.',
        };
    }
    return out;
}
