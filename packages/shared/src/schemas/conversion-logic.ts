/**
 * v0.1.374 (ADR-S97) — Medir conversiones de formularios y agendas: la lógica
 * SIN Zod (la importan las páginas públicas, que tienen que ser chicas). Los
 * esquemas viven en `conversion.ts`.
 *
 * El formulario (o la agenda) vive en un marco de OTRO dominio dentro del
 * sitio de la empresa: la etiqueta de Google Ads del sitio no ve lo que pasa
 * adentro. Al enviar, el marco le avisa al sitio y el script de inserción
 * (`embed.js`) lo convierte en un evento DEL SITIO (`dataLayer`, `gtag`,
 * `fbq`, un evento del navegador): la conversión se dispara donde aterrizó el
 * anuncio, que es donde Google la atribuye.
 */

// shared no trae los tipos del navegador: lo justo de `URL` y `URLSearchParams`.
declare const URL: { new (input: string): { protocol: string; host: string; href: string } };
declare const URLSearchParams: { new (init: string): { get(name: string): string | null } };

/** Los datos de origen que se pueden guardar en columnas del registro. */
export const ATTRIBUTION_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'gbraid',
    'wbraid',
    'fbclid',
    'msclkid',
    'ttclid',
    'page_url',
    'referrer',
] as const;
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type AttributionData = Partial<Record<AttributionKey, string>>;

/** Cómo se llama cada dato en la interfaz (y la columna que se crea). */
export const ATTRIBUTION_LABELS: Record<AttributionKey, string> = {
    utm_source: 'Origen (utm_source)',
    utm_medium: 'Medio (utm_medium)',
    utm_campaign: 'Campaña (utm_campaign)',
    utm_term: 'Término (utm_term)',
    utm_content: 'Contenido (utm_content)',
    gclid: 'ID de clic de Google (gclid)',
    gbraid: 'ID de clic de Google en iPhone (gbraid)',
    wbraid: 'ID de clic de Google en iPhone, web (wbraid)',
    fbclid: 'ID de clic de Meta (fbclid)',
    msclkid: 'ID de clic de Microsoft (msclkid)',
    ttclid: 'ID de clic de TikTok (ttclid)',
    page_url: 'Página donde se llenó',
    referrer: 'Llegó desde',
};

/** Lo que «Crear las columnas» arma sin preguntar (el resto se agrega a mano). */
export const ATTRIBUTION_DEFAULT_KEYS: readonly AttributionKey[] = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'page_url', 'referrer'];

/** Datos que son direcciones (columna de tipo enlace o texto). */
export const ATTRIBUTION_URL_KEYS: ReadonlySet<AttributionKey> = new Set(['page_url', 'referrer']);
/** Los identificadores de clic de los anuncios. */
export const ATTRIBUTION_CLICK_KEYS: ReadonlySet<AttributionKey> = new Set(['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid']);

/** La clave de la configuración donde se guarda la columna de un dato. */
export function attributionFieldKey(k: AttributionKey): `${AttributionKey}_field_id` {
    return `${k}_field_id`;
}

const MAX_TEXT = 300;
const MAX_URL = 1000;
const CLICK_RE = /^[A-Za-z0-9._~-]{4,300}$/;

/**
 * Limpia lo que manda el navegador (de la dirección del sitio o del marco):
 * sólo las claves conocidas, texto sin caracteres de control y con tope, los
 * ids de clic con su forma y las direcciones http(s). Lo raro se descarta
 * (nunca hace fallar el envío).
 */
export function cleanAttribution(raw: unknown): AttributionData {
    const out: AttributionData = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const src = raw as Record<string, unknown>;
    for (const k of ATTRIBUTION_KEYS) {
        const v = src[k];
        if (typeof v !== 'string') continue;
        // eslint-disable-next-line no-control-regex
        const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
        if (s === '') continue;
        if (ATTRIBUTION_URL_KEYS.has(k)) {
            if (s.length > MAX_URL || !/^https?:\/\/[^\s]+$/i.test(s)) continue;
            out[k] = s;
        } else if (ATTRIBUTION_CLICK_KEYS.has(k)) {
            if (CLICK_RE.test(s)) out[k] = s;
        } else {
            out[k] = s.slice(0, MAX_TEXT);
        }
    }
    return out;
}

/** Los datos de origen que trae una dirección (`?utm_source=…&gclid=…`). */
export function attributionFromSearch(search: string): AttributionData {
    const out: Record<string, string> = {};
    let params: { get(name: string): string | null };
    try {
        params = new URLSearchParams(search);
    } catch {
        return {};
    }
    for (const k of ATTRIBUTION_KEYS) {
        if (k === 'page_url' || k === 'referrer') continue;
        const v = params.get(k);
        if (v) out[k] = v;
    }
    return cleanAttribution(out);
}

// ─────────────────────────── Google Ads ───────────────────────────

/** El «send_to» de una acción de conversión de Google Ads: `AW-123456789/AbC-dEf_1`. */
export const GOOGLE_ADS_SEND_TO_RE = /^AW-\d{6,14}\/[A-Za-z0-9_-]{4,80}$/;

/**
 * Lo que la persona pega de Google Ads (la etiqueta completa, el fragmento de
 * evento o sólo el «AW-…/…») → el «send_to» canónico. null = no se reconoce.
 */
export function parseGoogleAdsSendTo(raw: string): string | null {
    const m = /AW-\d{6,14}\/[A-Za-z0-9_-]{4,80}/.exec(raw ?? '');
    return m && GOOGLE_ADS_SEND_TO_RE.test(m[0]) ? m[0] : null;
}

// ─────────────────────────── El evento ───────────────────────────

/** El nombre del evento en el `dataLayer` (Google Tag Manager). */
export const CONVERSION_EVENT_FORM = 'imagina_form_submit';
export const CONVERSION_EVENT_BOOKING = 'imagina_booking';
/** El evento del navegador (`window.addEventListener(...)`) para quien no usa Tag Manager. */
export const CONVERSION_DOM_EVENT_FORM = 'imagina:form-submit';
export const CONVERSION_DOM_EVENT_BOOKING = 'imagina:booking';

/** Lo que el marco le manda al sitio cuando alguien envía o agenda. */
export interface ImaginaConversionEvent {
    kind: 'form' | 'booking';
    /** El identificador público del formulario o la agenda. */
    id: string;
    /** El título público. */
    name: string;
    /** Único por envío: Google y Meta lo usan para no contar dos veces. */
    submission_id: string;
    value: number | null;
    currency: string | null;
    /** Formulario: la pantalla final que vio (su nombre), null = la de siempre. */
    ending?: string | null;
    /** Formulario: la respuesta espera la confirmación por correo. */
    pending_confirmation?: boolean;
    /** Agenda: el servicio, quién atiende, cuándo y si quedó por confirmar. */
    service?: string;
    staff?: string;
    start?: string;
    status?: 'confirmed' | 'pending';
    /** La acción de conversión de Google Ads a disparar con el `gtag` del sitio. */
    google_ads?: string | null;
    /** El evento estándar del píxel de Meta del sitio (`Lead` / `Schedule`). */
    meta_event?: 'Lead' | 'Schedule' | null;
    /** Conversiones mejoradas (sólo si el formulario lo pide). */
    user_data?: { email?: string; phone_number?: string } | null;
}

/** Redondea un valor de conversión (null si no es un número usable). */
export function conversionValue(n: unknown): number | null {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12 ? Math.round(n * 100) / 100 : null;
}

// ─────────────────────── Página de gracias ───────────────────────

/**
 * Una dirección de gracias: https, y las variables (`{{…}}`) nunca en el
 * sitio (el dominio), sólo en la ruta, la consulta o el ancla — si no, lo que
 * escribe un visitante podría cambiar a dónde se lo lleva.
 */
export const REDIRECT_URL_RE = /^https:\/\/[^\s/?#{}]+([/?#][^\s]*)?$/;
export const REDIRECT_MAX_DELAY_S = 10;

const VAR_RE = /\{\{\s*([A-Za-z0-9_.]{1,60})\s*\}\}/g;

/** Las variables que usa una dirección (para avisar en el editor). */
export function redirectVariables(template: string): string[] {
    const out = new Set<string>();
    for (const m of (template ?? '').matchAll(VAR_RE)) out.add(m[1]!);
    return [...out];
}

/**
 * Completa las variables de una dirección de gracias. Cada valor va
 * codificado (no puede agregar una `/` ni un `&`); una variable sin valor
 * queda vacía. Si el resultado no es una dirección https del MISMO sitio, se
 * devuelve la dirección sin variables.
 */
export function fillRedirectUrl(template: string, resolve: (key: string) => string | number | null | undefined): string {
    const host = /^https:\/\/([^\s/?#{}]+)/.exec(template)?.[1]?.toLowerCase() ?? null;
    if (!host) return template;
    const filled = template.replace(VAR_RE, (_m, key: string) => {
        const v = resolve(key);
        return v === null || v === undefined ? '' : encodeURIComponent(String(v).slice(0, 300));
    });
    try {
        const u = new URL(filled);
        if (u.protocol === 'https:' && u.host.toLowerCase() === host) return u.href;
    } catch {
        // abajo
    }
    return template.replace(VAR_RE, '');
}

// ─────────── Enlace directo: las etiquetas de Google y Meta (v0.1.375) ───────────
// Sin sitio (el anuncio lleva directo al formulario o a la agenda), no hay
// etiqueta del sitio que reciba el evento: la página carga las de la empresa
// POR ID —nunca código pegado— y la conversión se dispara ahí.

/** El ID de una etiqueta de Google Analytics 4 (`G-ABC123`). */
export const GOOGLE_TAG_ID_RE = /^G-[A-Z0-9]{4,20}$/;
/** El ID de un píxel de Meta (sólo números). */
export const META_PIXEL_ID_RE = /^\d{8,20}$/;

/** Lo que la persona pega de Google (el fragmento entero o sólo el «G-…») → el ID. */
export function parseGoogleTagId(raw: string): string | null {
    const m = /\bG-[A-Z0-9]{4,20}\b/.exec((raw ?? '').toUpperCase());
    return m && GOOGLE_TAG_ID_RE.test(m[0]) ? m[0] : null;
}

/** Lo que la persona pega de Meta (`fbq('init', '123…')`, la imagen `tr?id=` o el número) → el ID. */
export function parseMetaPixelId(raw: string): string | null {
    const s = (raw ?? '').trim();
    const m = /fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{8,20})/.exec(s) ?? /[?&]id=(\d{8,20})\b/.exec(s) ?? /^(\d{8,20})$/.exec(s.replace(/\s+/g, ''));
    return m && META_PIXEL_ID_RE.test(m[1]!) ? m[1]! : null;
}

/** `AW-123456789/AbC` → `AW-123456789` (la etiqueta que se configura en la página). */
export function googleAdsIdFromSendTo(sendTo: string | null | undefined): string | null {
    const m = /^(AW-\d{6,14})\//.exec(sendTo ?? '');
    return m ? m[1]! : null;
}

/**
 * Los parámetros de la dirección que pueden ver Google y Meta: la campaña y
 * los ids de clic. Nada más (las respuestas precargadas, un código para
 * seguir o actualizar un registro, el nombre de alguien), porque las
 * etiquetas mandan la dirección completa y Google prohíbe datos personales.
 */
export const TRACKING_URL_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'gclid',
    'gbraid',
    'wbraid',
    'gad_source',
    'gad_campaignid',
    'dclid',
    'fbclid',
    'msclkid',
    'ttclid',
] as const;

/** La dirección que ven las etiquetas: el sitio, la ruta y sólo la campaña. */
export function trackingSafeUrl(href: string): string {
    const m = /^(https?:\/\/[^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(href ?? '');
    if (!m) return '';
    const base = m[1]! + (m[2] || '/');
    if (!m[3]) return base;
    const keep: string[] = [];
    for (const part of m[3].slice(1).split('&')) {
        const eq = part.indexOf('=');
        const key = (eq >= 0 ? part.slice(0, eq) : part).toLowerCase();
        const val = eq >= 0 ? part.slice(eq + 1) : '';
        if (val !== '' && val.length <= 400 && (TRACKING_URL_PARAMS as readonly string[]).includes(key)) keep.push(`${key}=${val}`);
    }
    return keep.length ? `${base}?${keep.join('&')}` : base;
}

/** Lo que la página pública necesita para cargar las etiquetas en el enlace directo. */
export interface PublicDirectTags {
    /** La acción de conversión de Google Ads (la misma de «Medir conversiones»). */
    google_ads: string | null;
    /** La etiqueta de Google Ads que se carga (`AW-…`, sale de la acción). */
    google_ads_id: string | null;
    /** Google Analytics 4 (`G-…`). */
    google_tag_id: string | null;
    meta_pixel_id: string | null;
    /** La línea que avisa que la página usa cookies de medición (null = no se muestra). */
    notice: string | null;
}

/** El texto del aviso de cookies según qué etiquetas carga la página. */
export function directTagsNotice(t: Pick<PublicDirectTags, 'google_ads_id' | 'google_tag_id' | 'meta_pixel_id'>): string {
    const who = [t.google_ads_id || t.google_tag_id ? 'Google' : null, t.meta_pixel_id ? 'Meta' : null].filter(Boolean).join(' y ');
    return who ? `Esta página usa cookies de ${who} para medir las campañas.` : '';
}
