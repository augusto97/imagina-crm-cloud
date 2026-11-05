import { z } from 'zod';
import { GOOGLE_ADS_SEND_TO_RE, GOOGLE_TAG_ID_RE, META_PIXEL_ID_RE, REDIRECT_MAX_DELAY_S, REDIRECT_URL_RE, type AttributionKey, type PublicDirectTags } from './conversion-logic';

/**
 * v0.1.374 (ADR-S97) — Medir conversiones de un formulario o una agenda
 * insertados en el sitio de la empresa. Lo mismo vale para los dos; cada uno
 * guarda su copia en sus ajustes (`settings.conversion` y
 * `settings.attribution`).
 */

/**
 * De dónde sale el valor de la conversión: ninguno, uno fijo, lo que se
 * cobra al enviar (formulario), el resultado de un cálculo (formulario) o el
 * precio del servicio (agenda). Lo que no aplica a cada uno se lee como
 * «ninguno».
 */
export const CONVERSION_VALUE_MODES = ['none', 'fixed', 'payment', 'calc', 'price'] as const;
export type ConversionValueMode = (typeof CONVERSION_VALUE_MODES)[number];

export const conversionSettingsSchema = z.object({
    /** La acción de conversión de Google Ads (`AW-123456789/AbC`); null = no se dispara. */
    google_ads: z.string().regex(GOOGLE_ADS_SEND_TO_RE).nullable().catch(null).default(null),
    /** Registrar el evento estándar del píxel de Meta del sitio (Lead o Schedule). */
    meta_event: z.boolean().catch(false).default(false),
    value: z.enum(CONVERSION_VALUE_MODES).catch('none').default('none'),
    /** El valor fijo (value = fixed). */
    amount: z.number().min(0).max(1_000_000_000_000).nullable().catch(null).default(null),
    currency: z.string().regex(/^[A-Z]{3}$/).catch('COP').default('COP'),
    /** El cálculo del formulario que da el valor (value = calc). */
    calc_key: z.string().max(40).nullable().catch(null).default(null),
    /**
     * Conversiones mejoradas: además, mandarle el correo y el teléfono de quien
     * respondió a las etiquetas del sitio (Google los cifra antes de usarlos).
     * Apagado por defecto: es un dato personal.
     */
    share_contact: z.boolean().catch(false).default(false),
    /**
     * v0.1.375 — En el ENLACE DIRECTO (sin el sitio de por medio), cargar las
     * etiquetas de la empresa por su ID: la de Google Ads (sale de
     * `google_ads`), Google Analytics y el píxel de Meta. Apagado por
     * defecto. Insertado en un sitio no se cargan nunca: ahí manda el sitio.
     */
    direct_tags: z.boolean().catch(false).default(false),
    google_tag_id: z.string().regex(GOOGLE_TAG_ID_RE).nullable().catch(null).default(null),
    meta_pixel_id: z.string().regex(META_PIXEL_ID_RE).nullable().catch(null).default(null),
    /** Mostrar «Esta página usa cookies de Google y Meta para medir las campañas». */
    cookie_notice: z.boolean().catch(true).default(true),
});
export type ConversionSettings = z.infer<typeof conversionSettingsSchema>;
export const CONVERSION_SETTINGS_DEFAULT: ConversionSettings = {
    google_ads: null,
    meta_event: false,
    value: 'none',
    amount: null,
    currency: 'COP',
    calc_key: null,
    share_contact: false,
    direct_tags: false,
    google_tag_id: null,
    meta_pixel_id: null,
    cookie_notice: true,
};

const fieldRef = z.number().int().positive().nullable().catch(null).default(null);

/**
 * De dónde vino cada registro: con `enabled`, lo que trae la dirección del
 * sitio (o del enlace) se guarda en estas columnas. Cada clave termina en
 * `_field_id`, así migrar una empresa la traduce sola.
 */
export const attributionSettingsSchema = z.object({
    enabled: z.boolean().catch(false).default(false),
    utm_source_field_id: fieldRef,
    utm_medium_field_id: fieldRef,
    utm_campaign_field_id: fieldRef,
    utm_term_field_id: fieldRef,
    utm_content_field_id: fieldRef,
    gclid_field_id: fieldRef,
    gbraid_field_id: fieldRef,
    wbraid_field_id: fieldRef,
    fbclid_field_id: fieldRef,
    msclkid_field_id: fieldRef,
    ttclid_field_id: fieldRef,
    page_url_field_id: fieldRef,
    referrer_field_id: fieldRef,
});
export type AttributionSettings = z.infer<typeof attributionSettingsSchema>;
export const ATTRIBUTION_SETTINGS_DEFAULT: AttributionSettings = attributionSettingsSchema.parse({});

/** Tipos de columna que pueden guardar un dato de origen. */
export const ATTRIBUTION_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'long_text', 'url']);

/** La columna elegida para un dato (null = ninguna). */
export function attributionFieldFor(a: AttributionSettings, k: AttributionKey): number | null {
    return (a as Record<string, unknown>)[`${k}_field_id`] as number | null;
}

/** Una dirección de gracias (https, con variables sólo después del dominio). */
export const redirectUrlSchema = z.string().max(2000).regex(REDIRECT_URL_RE, 'La dirección tiene que empezar con https:// (las variables van después del dominio)');

/** Segundos que se ve la pantalla de gracias antes de ir a la dirección (0 = enseguida). */
export const redirectDelaySchema = z.number().int().min(0).max(REDIRECT_MAX_DELAY_S).catch(0).default(0);

/** Lo que el navegador manda con el envío (el servidor lo vuelve a limpiar). */
export const attributionInputSchema = z.record(z.string().max(40), z.string().max(1200)).optional();

/** Lo que la página pública necesita para avisarle al sitio. */
export interface PublicConversion {
    google_ads: string | null;
    meta_event: boolean;
    /** ¿Se guarda de dónde vino? (la página manda los datos con el envío). */
    attribution: boolean;
    /** v0.1.375 — Las etiquetas del enlace directo (null = no carga ninguna). */
    direct?: PublicDirectTags | null;
}

/** Lo que vuelve con un envío o una reserva para el evento del sitio. */
export interface ConversionResult {
    submission_id: string;
    value: number | null;
    currency: string | null;
    user_data?: { email?: string; phone_number?: string } | null;
}
