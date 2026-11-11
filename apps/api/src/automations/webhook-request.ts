import { createHmac } from 'node:crypto';
import { joinUrl, type ConnectionParts } from '../connectors/connection-parts';
import { MERGE_TAG_RE } from './merge-tags';

/**
 * Construcción de la petición de `call_webhook` (v0.1.155).
 *
 * Antes el único camino era un `body_template` de texto: para pegarle a una
 * API real (por ejemplo un gateway de WhatsApp que pide
 * `application/x-www-form-urlencoded` con `secret`, `account`, `recipient`,
 * `message`) había que escribir el cuerpo a mano y adivinar el content-type.
 * Ahora el config admite filas clave/valor —cuerpo, cabeceras y parámetros de
 * la URL— y el tipo de contenido se elige.
 *
 * PURO a propósito: el probador de la UI y el motor arman EXACTAMENTE la misma
 * petición, así lo que se prueba es lo que después se ejecuta.
 */

/**
 * Resuelve las variables de una plantilla. `escapeValue` (opcional) escapa
 * cada VALOR interpolado —no la plantilla—: lo usa el cuerpo crudo JSON/XML
 * para que un dato del registro no rompa el formato ni inyecte claves.
 */
export type MergeFn = (raw: unknown, escapeValue?: (s: string) => string) => string;

/** Un valor como contenido de un string JSON (sin las comillas de afuera). */
export function escapeJsonFragment(s: string): string {
    return JSON.stringify(s).slice(1, -1);
}

/** Un valor como texto de XML/HTML. */
export function escapeMarkup(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

/** El escapador de los valores de un cuerpo crudo según su tipo de contenido. */
export function rawBodyEscaper(contentType: WebhookContentType): ((s: string) => string) | undefined {
    if (contentType === 'json') return escapeJsonFragment;
    if (contentType === 'xml' || contentType === 'html') return escapeMarkup;
    return undefined;
}

export interface WebhookRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    /** `undefined` en GET/HEAD. */
    body?: string;
}

interface KeyValue {
    key: string;
    value: string;
}

/** Acepta filas `[{key,value}]` (UI nueva) o un objeto plano (config legacy). */
function readPairs(raw: unknown, merge: MergeFn): KeyValue[] {
    if (Array.isArray(raw)) {
        return raw
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .map((r) => ({ key: String(r.key ?? '').trim(), value: merge(r.value) }))
            .filter((r) => r.key !== '');
    }
    if (raw !== null && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>)
            .map(([key, value]) => ({ key: key.trim(), value: merge(value) }))
            .filter((r) => r.key !== '');
    }
    return [];
}

/**
 * Tipos de contenido soportados. Los tres primeros arman el cuerpo desde las
 * filas clave/valor; los tres últimos mandan el cuerpo TAL CUAL se escribe
 * (no tiene sentido "una fila por dato" en un XML).
 *
 * `multipart` sólo lleva campos de TEXTO: subir archivos por webhook no está
 * soportado (habría que resolver adjuntos y streamearlos), y ofrecerlo a medias
 * sería peor que no ofrecerlo.
 */
export const WEBHOOK_CONTENT_TYPES = ['json', 'form', 'multipart', 'text', 'xml', 'html'] as const;
export type WebhookContentType = (typeof WEBHOOK_CONTENT_TYPES)[number];

/** Los que se escriben a mano (sin filas clave/valor). */
export const RAW_BODY_TYPES: readonly WebhookContentType[] = ['text', 'xml', 'html'];

const MIME: Record<WebhookContentType, string> = {
    json: 'application/json',
    form: 'application/x-www-form-urlencoded',
    multipart: 'multipart/form-data',
    text: 'text/plain; charset=utf-8',
    xml: 'application/xml',
    html: 'text/html; charset=utf-8',
};

/** ¿La conexión le agrega algo a la petición (credencial, cabeceras, firma)? */
function connectionCarries(c: ConnectionParts): boolean {
    return Object.keys(c.headers).length > 0 || c.query.length > 0 || c.body.length > 0 || c.signingSecret !== null;
}

function originOf(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        // Con usuario en la dirección (`https://api.x.com@otro.com/`) el host
        // real es el de después de la arroba: `URL` ya lo resuelve así.
        return u.origin.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * La credencial de una conexión (token, usuario y contraseña, cabeceras fijas,
 * firma) sólo se manda al servidor de la conexión: mismo esquema, host y
 * puerto que su dirección. Se revisa sobre la URL YA resuelta, así una
 * variable no puede mover el destino. Sin esto, cualquier acción podía apuntar
 * la credencial de una conexión a otro servidor y leerla ahí.
 */
export function assertConnectionOrigin(connection: ConnectionParts, url: string): void {
    if (!connectionCarries(connection)) return;
    const name = connection.name ? `«${connection.name}»` : 'elegida';
    const base = originOf(connection.baseUrl);
    if (base === null) {
        throw new Error(
            `La conexión ${name} no tiene una dirección (URL base) válida, así que su credencial no se envía. Un administrador tiene que completarla en Ajustes → Integraciones → Avanzado: API personalizada.`,
        );
    }
    const target = originOf(url);
    if (target !== base) {
        throw new Error(
            `La conexión ${name} sólo envía su credencial a ${base} y esta acción llama a ${target ?? 'una dirección que no es válida'}. Cambia la URL de la acción o la dirección de la conexión (Ajustes → Integraciones).`,
        );
    }
}

/** Codifica un valor para la URL sin tocar lo que ya venía codificado (`%20`). */
function encodeKeepingEscapes(value: string, keep: RegExp): string {
    let out = '';
    const chars = Array.from(value);
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i]!;
        if (c === '%' && /^[0-9A-Fa-f]{2}$/.test(`${chars[i + 1] ?? ''}${chars[i + 2] ?? ''}`)) out += c;
        else if (keep.test(c)) out += c;
        else out += encodeURIComponent(c);
    }
    return out;
}

/** Un valor en la ruta: conserva las barras salvo que intente subir de carpeta. */
function encodePathValue(value: string): string {
    const climbs = value.split('/').some((seg) => seg === '..' || seg === '.');
    return encodeKeepingEscapes(value, climbs ? /[A-Za-z0-9\-_.~@]/ : /[A-Za-z0-9\-_.~@/]/);
}

/**
 * Resuelve las variables de la URL de la acción, valor por valor:
 *  - una variable al PRINCIPIO es la dirección entera (un campo con la URL) y
 *    se copia tal cual — la misma regla del campo «Botón»;
 *  - las demás se codifican según dónde caen: en el servidor (antes de la
 *    primera barra) sólo letras, números, punto, guion y dos puntos; en la
 *    ruta se conservan las barras; después del «?» se codifica todo.
 * Así el valor de un registro (que puede venir de un formulario público o de
 * un webhook entrante) no agrega parámetros, no corta la ruta ni cambia el
 * servidor. El texto que escribió quien armó la acción no se toca.
 */
export function mergeUrl(raw: unknown, merge: MergeFn): string {
    const template = typeof raw === 'string' ? raw : '';
    if (template === '') return merge(raw);
    const re = new RegExp(MERGE_TAG_RE.source, 'g');
    let out = '';
    let last = 0;
    for (let m = re.exec(template); m !== null; m = re.exec(template)) {
        out += template.slice(last, m.index);
        last = m.index + m[0].length;
        if (out.trim() === '') {
            out += merge(m[0]);
            continue;
        }
        const soFar = out.trim();
        const inQuery = /[?#]/.test(soFar);
        const inAuthority = !inQuery && /^[a-z][a-z0-9+.-]*:(\/{0,2}[^/]*)?$/i.test(soFar);
        out += merge(
            m[0],
            inQuery
                ? (v) => encodeKeepingEscapes(v, /[A-Za-z0-9\-_.~]/)
                : inAuthority
                  ? (v) => encodeKeepingEscapes(v.replace(/%/g, '%25'), /[A-Za-z0-9\-.:]/)
                  : encodePathValue,
        );
    }
    return out + template.slice(last);
}

/**
 * v0.1.196 — `connection` son las partes YA resueltas de un conector (base
 * URL, cabeceras con la credencial inyectada, query fija y secreto de firma).
 * Llega como argumento porque esta función es pura y síncrona a propósito:
 * descifrar aquí adentro obligaría a hacer I/O y el probador de la UI dejaría
 * de armar exactamente la misma petición que el motor.
 */
export function buildWebhookRequest(
    cfg: Record<string, unknown>,
    merge: MergeFn,
    fallback: { recordId: number | null; listId: number },
    connection?: ConnectionParts | null,
): WebhookRequest {
    const method = String(cfg.method ?? 'POST').toUpperCase();
    const contentType: WebhookContentType = (WEBHOOK_CONTENT_TYPES as readonly string[]).includes(
        String(cfg.content_type),
    )
        ? (cfg.content_type as WebhookContentType)
        : 'json';

    // Query params: se agregan a la URL respetando lo que ya traiga escrito.
    // Con conexión, lo que escribe la acción puede ser sólo el path (`/send`);
    // una URL absoluta gana siempre sobre la base del conector.
    let url = mergeUrl(cfg.url, merge).trim();
    if (connection) {
        url = joinUrl(connection.baseUrl, url);
        // La credencial de una conexión sólo viaja a SU servidor (ver abajo).
        if (url !== '') assertConnectionOrigin(connection, url);
    }
    const query = [...(connection?.query ?? []), ...readPairs(cfg.query_params, merge)];
    if (query.length > 0) {
        const qs = query
            .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
            .join('&');
        url += (url.includes('?') ? '&' : '?') + qs;
    }

    // Las de la conexión van primero y las de la acción pueden pisarlas: el
    // conector pone el default, la acción afina un caso puntual.
    const headers: Record<string, string> = { ...(connection?.headers ?? {}) };
    for (const h of readPairs(cfg.headers, merge)) headers[h.key.toLowerCase()] = h.value;

    // Cuerpo: filas clave/valor si las hay; si no, la plantilla cruda; si no,
    // el payload por defecto con el registro que disparó.
    const actionParams = readPairs(cfg.body_params, merge);
    // El cuerpo crudo se escribe a mano: los VALORES de las variables se
    // escapan según el formato (JSON / XML / HTML). Antes un nombre con
    // comillas rompía el JSON o, peor, inyectaba claves
    // (`","admin":true,"x":"`) en la petición.
    const rawTemplate =
        typeof cfg.body_template === 'string' && cfg.body_template.trim() !== ''
            ? merge(cfg.body_template, rawBodyEscaper(contentType))
            : '';
    // Los campos de la conexión (auth de tipo `body`) sólo entran cuando el
    // cuerpo se arma con filas. Con una plantilla cruda manda lo escrito: meter
    // claves ahí adentro sería reescribirle el JSON al usuario.
    const params =
        actionParams.length > 0 || rawTemplate === ''
            ? [...(connection?.body ?? []), ...actionParams]
            : actionParams;

    const raw = RAW_BODY_TYPES.includes(contentType);
    let body: string | undefined;
    if (method === 'GET' || method === 'HEAD') {
        body = undefined;
    } else if (!raw && params.length > 0) {
        if (contentType === 'form') {
            body = params
                .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
                .join('&');
            headers['content-type'] ??= MIME.form;
        } else if (contentType === 'multipart') {
            // Boundary determinista por longitud: no hace falta azar, sólo que
            // no aparezca en el contenido (se verifica y se alarga si aparece).
            let boundary = '----ImaginaBase' + String(body ?? '').length.toString(36) + 'x9f3';
            while (params.some((p) => p.value.includes(boundary))) boundary += 'x';
            body =
                params
                    .map(
                        (p) =>
                            `--${boundary}\r\nContent-Disposition: form-data; name="${p.key.replace(/"/g, '')}"\r\n\r\n${p.value}\r\n`,
                    )
                    .join('') + `--${boundary}--\r\n`;
            headers['content-type'] ??= `${MIME.multipart}; boundary=${boundary}`;
        } else {
            body = JSON.stringify(Object.fromEntries(params.map((p) => [p.key, p.value])));
            headers['content-type'] ??= MIME.json;
        }
    } else if (rawTemplate !== '') {
        body = rawTemplate;
        headers['content-type'] ??= MIME[contentType];
    } else {
        body = JSON.stringify({ record_id: fallback.recordId, list_id: fallback.listId });
        headers['content-type'] ??= MIME.json;
    }

    // Firma HMAC del cuerpo (opcional): el receptor puede verificar que el
    // pedido salió de aquí y que nadie lo tocó en el camino. El secreto de la
    // CONEXIÓN manda sobre el escrito en la acción: después de convertir, el
    // inline ya no existe, y mientras convivan gana el que está cifrado.
    const signing = connection?.signingSecret ?? (cfg.secret ? String(cfg.secret) : '');
    if (signing !== '' && body !== undefined) {
        headers['x-imagina-signature'] =
            'sha256=' + createHmac('sha256', signing).update(body).digest('hex');
    }

    return { url, method, headers, body };
}
