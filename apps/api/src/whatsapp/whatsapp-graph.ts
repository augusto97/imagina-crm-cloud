import { createHmac } from 'node:crypto';
import { META_GRAPH_DEFAULT_URL, META_GRAPH_DEFAULT_VERSION } from '@imagina-base/shared';
import type { Env } from '../config/env';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';

/**
 * D3 — Peticiones a la Graph API de Meta (WhatsApp Cloud API).
 *
 * PURO, igual que `integration-calls.ts`: lo que prueba el editor («Probar
 * ahora»), lo que manda la ficha y lo que ejecuta una automatización salen de
 * las MISMAS funciones, y los tests verifican la forma sin salir a la red.
 */

export interface GraphBase {
    url: string;
    version: string;
}

/**
 * La base de la Graph API. En producción SIEMPRE la de Meta (una variable mal
 * puesta no puede desviar los mensajes de una empresa); la versión sí se
 * puede adelantar sin un release.
 */
export function graphBase(env: Pick<Env, 'NODE_ENV' | 'META_GRAPH_URL' | 'META_GRAPH_VERSION'>): GraphBase {
    const url = env.NODE_ENV === 'production' || env.META_GRAPH_URL === '' ? META_GRAPH_DEFAULT_URL : env.META_GRAPH_URL;
    return { url: url.replace(/\/+$/, ''), version: env.META_GRAPH_VERSION || META_GRAPH_DEFAULT_VERSION };
}

/** Lo que hace falta para hablar con Meta en nombre de una empresa. */
export interface WhatsappCreds {
    token: string;
    phoneNumberId: string;
    wabaId: string;
    /** Clave secreta de la app: firma los avisos y el `appsecret_proof`. */
    appSecret: string;
}

export function whatsappCreds(creds: IntegrationCreds): WhatsappCreds {
    return {
        token: creds.secret,
        phoneNumberId: (creds.fields.phone_number_id ?? '').trim(),
        wabaId: (creds.fields.waba_id ?? '').trim(),
        appSecret: creds.signingSecret ?? '',
    };
}

/**
 * `appsecret_proof` = HMAC-SHA256(token, clave secreta de la app). Meta lo
 * valida cuando viene: un token robado no sirve sin la clave, y al conectar
 * prueba que la clave pegada es la de la app del token.
 */
export function appSecretProof(token: string, appSecret: string): string {
    return createHmac('sha256', appSecret).update(token, 'utf8').digest('hex');
}

const ID_RE = /^\d{5,30}$/;

/** Un id de Meta es numérico: lo que no lo es no viaja en la URL. */
export function isMetaId(v: string): boolean {
    return ID_RE.test(v);
}

function url(base: GraphBase, path: string, creds: WhatsappCreds, query: Record<string, string> = {}): string {
    const q = new URLSearchParams(query);
    if (creds.appSecret !== '' && creds.token !== '') q.set('appsecret_proof', appSecretProof(creds.token, creds.appSecret));
    const qs = q.toString();
    return `${base.url}/${base.version}/${path}${qs ? `?${qs}` : ''}`;
}

function headers(creds: WhatsappCreds, json = false): Record<string, string> {
    return {
        authorization: `Bearer ${creds.token}`,
        accept: 'application/json',
        ...(json ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    };
}

/** El número: cómo se ve, a nombre de quién y su calidad. */
export function phoneInfoRequest(base: GraphBase, creds: WhatsappCreds): IntegrationRequest {
    return {
        url: url(base, encodeURIComponent(creds.phoneNumberId), creds, {
            fields: 'display_phone_number,verified_name,quality_rating',
        }),
        method: 'GET',
        headers: headers(creds),
    };
}

/** Los números de la cuenta (para comprobar que el número es de ESA cuenta). */
export function wabaPhonesRequest(base: GraphBase, creds: WhatsappCreds): IntegrationRequest {
    return {
        url: url(base, `${encodeURIComponent(creds.wabaId)}/phone_numbers`, creds, { fields: 'id,display_phone_number', limit: '100' }),
        method: 'GET',
        headers: headers(creds),
    };
}

/** Una página de plantillas de la cuenta. */
export function templatesRequest(base: GraphBase, creds: WhatsappCreds, after?: string | null): IntegrationRequest {
    return {
        url: url(base, `${encodeURIComponent(creds.wabaId)}/message_templates`, creds, {
            fields: 'id,name,language,status,category,components,parameter_format,rejected_reason',
            limit: '100',
            ...(after ? { after } : {}),
        }),
        method: 'GET',
        headers: headers(creds),
    };
}

/** ¿La app está suscrita a los avisos de la cuenta? */
export function subscribedAppsRequest(base: GraphBase, creds: WhatsappCreds): IntegrationRequest {
    return { url: url(base, `${encodeURIComponent(creds.wabaId)}/subscribed_apps`, creds), method: 'GET', headers: headers(creds) };
}

/**
 * Suscribe la app a la cuenta de WhatsApp Business. Con `override` además le
 * dice a Meta adónde mandar los avisos de ESTA cuenta (sin tocar la URL de la
 * app, que puede estar sirviendo a otra cosa).
 */
export function subscribeAppRequest(
    base: GraphBase,
    creds: WhatsappCreds,
    override?: { callbackUrl: string; verifyToken: string },
): IntegrationRequest {
    return {
        url: url(base, `${encodeURIComponent(creds.wabaId)}/subscribed_apps`, creds),
        method: 'POST',
        headers: headers(creds, true),
        body: JSON.stringify(override ? { override_callback_uri: override.callbackUrl, verify_token: override.verifyToken } : {}),
    };
}

/** Un mensaje (plantilla o texto). */
export function sendRequest(base: GraphBase, creds: WhatsappCreds, payload: Record<string, unknown>): IntegrationRequest {
    return {
        url: url(base, `${encodeURIComponent(creds.phoneNumberId)}/messages`, creds),
        method: 'POST',
        headers: headers(creds, true),
        body: JSON.stringify(payload),
    };
}

export function templatePayload(to: string, name: string, language: string, components: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: { name, language: { code: language }, ...(components.length > 0 ? { components } : {}) },
    };
}

export function textPayload(to: string, text: string, previewUrl: boolean): Record<string, unknown> {
    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: previewUrl, body: text.slice(0, 4096) },
    };
}

/** La URL tal como se muestra (sin el `appsecret_proof`). */
export function shownUrl(raw: string): string {
    return raw.replace(/([?&])appsecret_proof=[^&]*/g, '$1appsecret_proof=••••').replace(/[?&]$/, '');
}

// ── Respuestas ──────────────────────────────────────────────────────────

export interface MetaError {
    status: number;
    code: number | null;
    subcode: number | null;
    type: string | null;
    message: string;
    details: string | null;
}

function parseJson(body: string): Record<string, unknown> | null {
    try {
        const v: unknown = JSON.parse(body);
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** El error de Meta (`{error:{code,message,error_data:{details}}}`) o null si salió bien. */
export function parseMetaError(status: number, body: string): MetaError | null {
    const json = parseJson(body);
    const err = json?.error;
    if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        const data = (e.error_data ?? {}) as Record<string, unknown>;
        return {
            status,
            code: Number.isFinite(Number(e.code)) ? Number(e.code) : null,
            subcode: Number.isFinite(Number(e.error_subcode)) ? Number(e.error_subcode) : null,
            type: typeof e.type === 'string' ? e.type : null,
            message: typeof e.message === 'string' ? e.message : `HTTP ${status}`,
            details: typeof data.details === 'string' ? data.details : null,
        };
    }
    if (status >= 400) return { status, code: null, subcode: null, type: null, message: `HTTP ${status}`, details: null };
    return null;
}

const ERROR_TEXT: Record<number, string> = {
    3: 'Al token le falta un permiso para esto (whatsapp_business_messaging y whatsapp_business_management).',
    4: 'Meta frenó los pedidos por exceso (límite de la app). Prueba en unos minutos.',
    10: 'Al token le falta un permiso para esto (whatsapp_business_messaging y whatsapp_business_management).',
    200: 'Al token le falta un permiso para esto (whatsapp_business_messaging y whatsapp_business_management).',
    294: 'Al token le falta un permiso para esto (whatsapp_business_messaging y whatsapp_business_management).',
    368: 'La cuenta está restringida por infringir las políticas de WhatsApp: revisa el aviso en tu administrador de Meta.',
    80007: 'Meta frenó los envíos por exceso de pedidos (límite de la cuenta). Prueba en unos minutos.',
    130429: 'Se superó el límite de envíos por segundo de la cuenta. Prueba en unos minutos.',
    131000: 'Meta tuvo un error interno. Prueba de nuevo en unos minutos.',
    131005: 'Meta negó el acceso: revisa que el token tenga los permisos de WhatsApp y acceso a esta cuenta.',
    131008: 'Falta un dato obligatorio en el envío.',
    131009: 'Un dato del envío no es válido.',
    131021: 'No se puede mandar un mensaje al mismo número de la empresa.',
    131026: 'El mensaje no se pudo entregar: el número no tiene WhatsApp, o el contacto no aceptó las condiciones más recientes de WhatsApp.',
    131031: 'La cuenta de WhatsApp Business está bloqueada o restringida: revísala en tu administrador de Meta.',
    131042: 'Hay un problema con el método de pago de tu cuenta de WhatsApp Business: revísalo en tu administrador de Meta.',
    131045: 'El número de la empresa no está bien registrado en la Cloud API (falta el certificado).',
    131047: 'Pasaron más de 24 h desde el último mensaje del contacto: usa una plantilla.',
    131049: 'Meta decidió no entregarlo para cuidar la experiencia del contacto (límite de mensajes de marketing). Prueba más tarde o con una plantilla de utilidad.',
    131050: 'El contacto pidió no recibir mensajes de marketing de tu empresa.',
    131051: 'WhatsApp no admite ese tipo de mensaje.',
    131052: 'Meta no pudo descargar el adjunto del contacto.',
    131053: 'Meta no pudo descargar el adjunto: revisa que el enlace sea público y el formato sea válido.',
    131056: 'Demasiados mensajes al mismo número en poco tiempo. Espera un momento.',
    132000: 'La cantidad de variables no coincide con la plantilla: actualiza las plantillas y revisa la acción.',
    132001: 'La plantilla no existe en ese idioma o todavía no está aprobada.',
    132005: 'El texto de las variables es demasiado largo.',
    132007: 'El contenido de las variables infringe las políticas de WhatsApp.',
    132012: 'Una variable tiene un formato que la plantilla no acepta.',
    132015: 'La plantilla está pausada por baja calidad.',
    132016: 'La plantilla está desactivada por baja calidad.',
    132018: 'Una variable tiene saltos de línea, tabuladores o demasiados espacios seguidos.',
    133010: 'El número de la empresa no está registrado en la Cloud API.',
    135000: 'Meta tuvo un error genérico. Prueba de nuevo en unos minutos.',
};

/** El error de Meta en lenguaje claro (con el motivo original al final). */
export function metaErrorText(err: MetaError): string {
    const original = [err.message, err.details].filter((x): x is string => typeof x === 'string' && x !== '').join(' — ');
    if (err.code === 190) {
        return 'El token de acceso venció o se revocó: genera uno nuevo para el usuario del sistema (sin vencimiento) y actualízalo en Integraciones.';
    }
    if (err.code === 100 && /appsecret_proof/i.test(err.message)) {
        return 'La clave secreta de la app no corresponde al token: copia la clave de la MISMA app de Meta (Configuración → Básica).';
    }
    if (err.code === 100 && (err.subcode === 33 || /does not exist|cannot be loaded/i.test(err.message))) {
        return 'Meta no encuentra ese identificador o el token no tiene acceso a él: revisa el ID del número y el de la cuenta de WhatsApp Business.';
    }
    const known = err.code !== null ? ERROR_TEXT[err.code] : undefined;
    if (known) return original !== '' ? `${known} (Meta: ${original})` : known;
    if (err.status === 401) return 'Meta rechazó el token: actualízalo en Integraciones.';
    return `Meta rechazó el pedido: ${original || `HTTP ${err.status}`}`;
}

/**
 * ¿Es un error de la CONEXIÓN (token, permisos, cuenta, pago) y no de este
 * mensaje? Ésos abren un problema: van a fallar todos los envíos hasta que
 * alguien lo arregle.
 */
export function isSystemicMetaError(err: MetaError): boolean {
    if (err.code === null) return err.status === 401;
    if ([190, 3, 10, 200, 294, 368, 131005, 131031, 131042, 131045, 133010].includes(err.code)) return true;
    if (err.code === 100 && (/appsecret_proof/i.test(err.message) || err.subcode === 33)) return true;
    return false;
}

/** Resultado de un envío: el id del mensaje (`wamid…`) o el error. */
export function parseSendResponse(
    status: number,
    body: string,
): { ok: true; wamid: string; waId: string | null } | { ok: false; error: MetaError } {
    const err = parseMetaError(status, body);
    if (err) return { ok: false, error: err };
    const json = parseJson(body);
    const msgs = Array.isArray(json?.messages) ? (json!.messages as Array<Record<string, unknown>>) : [];
    const contacts = Array.isArray(json?.contacts) ? (json!.contacts as Array<Record<string, unknown>>) : [];
    const wamid = typeof msgs[0]?.id === 'string' ? (msgs[0]!.id as string) : null;
    if (!wamid) {
        return { ok: false, error: { status, code: null, subcode: null, type: null, message: 'Meta no devolvió el id del mensaje.', details: null } };
    }
    return { ok: true, wamid, waId: typeof contacts[0]?.wa_id === 'string' ? (contacts[0]!.wa_id as string) : null };
}

export interface ParsedTemplate {
    metaId: string;
    name: string;
    language: string;
    category: string;
    status: string;
    parameterFormat: 'POSITIONAL' | 'NAMED';
    components: Array<Record<string, unknown>>;
    rejectedReason: string | null;
}

/** Una página de `/{waba}/message_templates` y el cursor de la siguiente. */
export function parseTemplatesPage(body: string): { templates: ParsedTemplate[]; after: string | null } {
    const json = parseJson(body);
    const data = Array.isArray(json?.data) ? (json!.data as unknown[]) : [];
    const templates: ParsedTemplate[] = [];
    for (const raw of data) {
        if (raw === null || typeof raw !== 'object') continue;
        const t = raw as Record<string, unknown>;
        const name = typeof t.name === 'string' ? t.name.slice(0, 512) : '';
        const language = typeof t.language === 'string' ? t.language.slice(0, 16) : '';
        if (name === '' || language === '') continue;
        const reason = typeof t.rejected_reason === 'string' && t.rejected_reason !== 'NONE' ? t.rejected_reason : null;
        templates.push({
            metaId: typeof t.id === 'string' ? t.id.slice(0, 64) : String(t.id ?? '').slice(0, 64),
            name,
            language,
            category: typeof t.category === 'string' ? t.category.slice(0, 32) : '',
            status: typeof t.status === 'string' ? t.status.slice(0, 32) : '',
            parameterFormat: String(t.parameter_format ?? '').toUpperCase() === 'NAMED' ? 'NAMED' : 'POSITIONAL',
            components: Array.isArray(t.components)
                ? (t.components as unknown[]).filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
                : [],
            rejectedReason: reason,
        });
    }
    const paging = (json?.paging ?? {}) as Record<string, unknown>;
    const cursors = (paging.cursors ?? {}) as Record<string, unknown>;
    const after = typeof paging.next === 'string' && typeof cursors.after === 'string' ? cursors.after : null;
    return { templates, after };
}

export interface PhoneInfo {
    displayPhone: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
}

export function parsePhoneInfo(body: string): PhoneInfo {
    const json = parseJson(body) ?? {};
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    return { displayPhone: s(json.display_phone_number), verifiedName: s(json.verified_name), qualityRating: s(json.quality_rating) };
}

/** Los ids de los números de una cuenta (`/{waba}/phone_numbers`). */
export function parseWabaPhoneIds(body: string): string[] {
    const json = parseJson(body);
    const data = Array.isArray(json?.data) ? (json!.data as Array<Record<string, unknown>>) : [];
    return data.map((p) => String(p.id ?? '')).filter((id) => id !== '');
}

/** ¿Hay alguna app suscrita a la cuenta? (`/{waba}/subscribed_apps`). */
export function parseSubscribedApps(body: string): boolean {
    const json = parseJson(body);
    return Array.isArray(json?.data) && (json!.data as unknown[]).length > 0;
}
