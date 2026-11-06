/**
 * v0.1.374 (ADR-S97) — Medir conversiones: las piezas que comparten el
 * formulario y la agenda en el servidor (el id de cada envío, guardar de
 * dónde vino el registro, el valor y las conversiones mejoradas).
 */
import { randomBytes } from 'node:crypto';
import {
    ATTRIBUTION_FIELD_TYPES,
    ATTRIBUTION_KEYS,
    attributionFieldFor,
    attributionFieldKey,
    cleanAttribution,
    conversionValue,
    directTagsNotice,
    googleAdsIdFromSendTo,
    jsonbKeyForField,
    validateFieldValue,
    type AttributionSettings,
    type ConversionResult,
    type ConversionSettings,
    type PublicConversion,
    type PublicDirectTags,
} from '@imagina-base/shared';

/** Único por envío o reserva: Google y Meta lo usan para no contar dos veces la misma conversión. */
export function newSubmissionId(): string {
    return randomBytes(9).toString('base64url');
}

interface FieldLike {
    id: number;
    type: string;
    config?: Record<string, unknown>;
}

/**
 * Las columnas de origen que valen: de la lista, de un tipo que guarda texto
 * o una dirección, una por dato, y nunca una que el formulario ya pregunta (o
 * que otra cosa escribe: `taken`).
 */
export function cleanAttributionSettings(a: AttributionSettings, fields: ReadonlyArray<FieldLike>, taken: ReadonlySet<number> = new Set()): AttributionSettings {
    const typeOf = new Map(fields.map((f) => [f.id, f.type]));
    const used = new Set<number>();
    const out: Record<string, unknown> = { enabled: a.enabled };
    for (const k of ATTRIBUTION_KEYS) {
        const id = attributionFieldFor(a, k);
        const ok = id !== null && ATTRIBUTION_FIELD_TYPES.has(typeOf.get(id) ?? '') && !taken.has(id) && !used.has(id);
        if (ok) used.add(id);
        out[attributionFieldKey(k)] = ok ? id : null;
    }
    return out as AttributionSettings;
}

/** Las columnas que llena el origen (para que nada más las escriba). */
export function attributionColumnIds(a: AttributionSettings): number[] {
    return ATTRIBUTION_KEYS.flatMap((k) => {
        const id = attributionFieldFor(a, k);
        return id !== null ? [id] : [];
    });
}

/** ¿Guarda algo? (encendido y con al menos una columna). */
export function attributionActive(a: AttributionSettings): boolean {
    return a.enabled && ATTRIBUTION_KEYS.some((k) => attributionFieldFor(a, k) !== null);
}

/**
 * Lo que va al registro: cada dato de origen que trajo el navegador, en su
 * columna, pasado por el validador del campo (un dato que el campo no
 * acepta se descarta: nunca hace fallar el envío).
 */
export function attributionRecordData(a: AttributionSettings, fields: ReadonlyArray<FieldLike>, raw: unknown): Record<string, unknown> {
    if (!attributionActive(a)) return {};
    const clean = cleanAttribution(raw);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: Record<string, unknown> = {};
    for (const k of ATTRIBUTION_KEYS) {
        const id = attributionFieldFor(a, k);
        const value = clean[k];
        const field = id !== null ? byId.get(id) : undefined;
        if (!field || value === undefined || !ATTRIBUTION_FIELD_TYPES.has(field.type)) continue;
        const res = validateFieldValue({ type: field.type as Parameters<typeof validateFieldValue>[0]['type'], config: field.config ?? {}, is_required: false }, value);
        if (res.ok && res.value !== null) out[jsonbKeyForField(field.id)] = res.value;
    }
    return out;
}

/** Lo que la página necesita para avisarle al sitio (el evento sale siempre; esto suma Google Ads, Meta y el origen). */
export function publicConversion(c: ConversionSettings, a: AttributionSettings): PublicConversion {
    return { google_ads: c.google_ads, meta_event: c.meta_event, attribution: attributionActive(a), direct: directTags(c) };
}

/**
 * v0.1.375 — Las etiquetas que carga el ENLACE DIRECTO (null = ninguna): las
 * de la empresa, por ID (la de Google Ads sale de su acción de conversión).
 */
export function directTags(c: ConversionSettings): PublicDirectTags | null {
    if (!c.direct_tags) return null;
    const google_ads_id = googleAdsIdFromSendTo(c.google_ads);
    const t: PublicDirectTags = {
        google_ads: google_ads_id ? c.google_ads : null,
        google_ads_id,
        google_tag_id: c.google_tag_id,
        meta_pixel_id: c.meta_pixel_id,
        notice: null,
    };
    if (!t.google_ads_id && !t.google_tag_id && !t.meta_pixel_id) return null;
    if (c.cookie_notice) t.notice = directTagsNotice(t) || null;
    return t;
}

/**
 * El resultado de la conversión de un envío: su id, el valor (de donde lo
 * pida la configuración) y, si se pidió, el correo y el teléfono para las
 * conversiones mejoradas (normalizados como los pide Google).
 */
export function conversionResult(
    c: ConversionSettings,
    opts: {
        payment?: { amount: number; currency: string } | null;
        calcs?: Record<string, number>;
        price?: number | null;
        email?: string | null;
        phone?: string | null;
    },
): ConversionResult {
    let value: number | null = null;
    let currency: string | null = null;
    if (c.value === 'fixed') value = conversionValue(c.amount);
    else if (c.value === 'payment' && opts.payment && opts.payment.amount > 0) {
        value = conversionValue(opts.payment.amount);
        currency = opts.payment.currency;
    } else if (c.value === 'calc' && c.calc_key) value = conversionValue(opts.calcs?.[c.calc_key]);
    else if (c.value === 'price') value = conversionValue(opts.price ?? null);
    if (value !== null && currency === null) currency = c.currency;
    const out: ConversionResult = { submission_id: newSubmissionId(), value, currency: value === null ? null : currency };
    if (c.share_contact) {
        const email = typeof opts.email === 'string' ? opts.email.trim().toLowerCase() : '';
        const phone = typeof opts.phone === 'string' ? opts.phone.replace(/[^\d+]/g, '') : '';
        const ud: { email?: string; phone_number?: string } = {};
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ud.email = email;
        if (/^\+\d{8,15}$/.test(phone)) ud.phone_number = phone;
        out.user_data = Object.keys(ud).length ? ud : null;
    }
    return out;
}
