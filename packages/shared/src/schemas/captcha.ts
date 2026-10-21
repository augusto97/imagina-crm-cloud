import { z } from 'zod';

/**
 * v0.1.289 — Verificación anti-robots (captcha) de los formularios públicos.
 *
 * Tres proveedores, los tres con el mismo contrato: el navegador dibuja un
 * widget con la llave PÚBLICA del sitio, el widget entrega un token, y el
 * servidor lo verifica UNA vez contra el `siteverify` del proveedor con la
 * llave SECRETA. Las llaves las carga el operador en Plataforma y,
 * opcionalmente, cada empresa las suyas en Ajustes (gana la de la empresa).
 *
 * Todo lo que depende del proveedor vive aquí (script, verificación, dominios
 * para la CSP y los pasos para conseguir las llaves): la página pública, el
 * servidor y los paneles leen lo mismo.
 */
export const CAPTCHA_PROVIDERS = ['turnstile', 'hcaptcha', 'recaptcha'] as const;
export const captchaProviderSchema = z.enum(CAPTCHA_PROVIDERS);
export type CaptchaProvider = z.infer<typeof captchaProviderSchema>;

export interface CaptchaProviderInfo {
    label: string;
    /** Una línea para elegir. */
    blurb: string;
    recommended: boolean;
    /** Script del widget (se carga con `render=explicit&onload=…`). */
    script_url: string;
    /** Endpoint de verificación del token (POST x-www-form-urlencoded). */
    verify_url: string;
    /** Orígenes que la CSP de la página tiene que permitir, por directiva. */
    csp: { script: string[]; frame: string[]; connect: string[]; style: string[] };
    /** Dónde se crean las llaves. */
    console_url: string;
    /** Pasos breves para conseguir las llaves. */
    steps: string[];
    /** Cómo se llaman las llaves en el panel del proveedor. */
    site_key_label: string;
    secret_label: string;
}

export const CAPTCHA_PROVIDER_INFO: Record<CaptchaProvider, CaptchaProviderInfo> = {
    turnstile: {
        label: 'Cloudflare Turnstile',
        blurb: 'Gratis, sin imágenes que adivinar y respetuoso con la privacidad. La mayoría de las personas no ve ningún desafío.',
        recommended: true,
        script_url: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
        verify_url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        csp: {
            script: ['https://challenges.cloudflare.com'],
            frame: ['https://challenges.cloudflare.com'],
            connect: ['https://challenges.cloudflare.com'],
            style: [],
        },
        console_url: 'https://dash.cloudflare.com/?to=/:account/turnstile',
        steps: [
            'Entra a tu cuenta de Cloudflare (es gratis) y abre «Turnstile».',
            'Toca «Agregar widget» (Add widget), ponle un nombre y agrega el dominio donde se ven tus formularios (el de esta app y, si los insertas, el de tu sitio).',
            'Elige el modo «Administrado» (Managed) y crea el widget.',
            'Copia la «Clave del sitio» (Site Key) y la «Clave secreta» (Secret Key) y pégalas aquí.',
        ],
        site_key_label: 'Site Key',
        secret_label: 'Secret Key',
    },
    hcaptcha: {
        label: 'hCaptcha',
        blurb: 'Alternativa independiente de Google, con plan gratis. Puede pedir resolver imágenes.',
        recommended: false,
        script_url: 'https://js.hcaptcha.com/1/api.js',
        verify_url: 'https://api.hcaptcha.com/siteverify',
        csp: {
            script: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
            frame: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
            connect: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
            style: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
        },
        console_url: 'https://dashboard.hcaptcha.com/sites',
        steps: [
            'Crea una cuenta gratis en hCaptcha y entra al panel.',
            'En «Sites», agrega un sitio nuevo con el dominio donde se ven tus formularios.',
            'Copia la «Sitekey» del sitio.',
            'En «Settings» (tu cuenta), copia la «Secret Key» y pega las dos aquí.',
        ],
        site_key_label: 'Sitekey',
        secret_label: 'Secret Key',
    },
    recaptcha: {
        label: 'Google reCAPTCHA v2',
        blurb: 'La casilla «No soy un robot» de Google. Conocida por todos, pero comparte datos con Google.',
        recommended: false,
        script_url: 'https://www.google.com/recaptcha/api.js',
        verify_url: 'https://www.google.com/recaptcha/api/siteverify',
        csp: {
            script: ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
            frame: ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
            connect: ['https://www.google.com/recaptcha/'],
            style: [],
        },
        console_url: 'https://www.google.com/recaptcha/admin/create',
        steps: [
            'Entra a la consola de reCAPTCHA de Google con tu cuenta.',
            'Crea un sitio nuevo, elige «reCAPTCHA v2» → «Casilla de verificación "No soy un robot"».',
            'Agrega los dominios donde se ven tus formularios y acepta las condiciones.',
            'Copia la «Clave del sitio» y la «Clave secreta» y pégalas aquí.',
        ],
        site_key_label: 'Clave del sitio',
        secret_label: 'Clave secreta',
    },
};

/** Guardar llaves (Plataforma o empresa). `secret` vacío = conservar la guardada. */
export const captchaKeysInputSchema = z.object({
    provider: captchaProviderSchema,
    site_key: z
        .string()
        .trim()
        .min(10, 'La llave del sitio parece incompleta')
        .max(200)
        .regex(/^[A-Za-z0-9_\-.]+$/, 'La llave del sitio tiene caracteres que no corresponden'),
    secret: z.string().trim().max(400).default(''),
});
export type CaptchaKeysInput = z.infer<typeof captchaKeysInputSchema>;

/** Lo que muestran los paneles: nunca el secreto, sólo sus últimos caracteres. */
export const captchaKeysStatusSchema = z.object({
    configured: z.boolean(),
    provider: captchaProviderSchema.nullable(),
    site_key: z.string().nullable(),
    secret_hint: z.string().nullable(),
    /** El secreto guardado no se puede descifrar con la clave actual del servidor. */
    secret_unreadable: z.boolean().default(false),
});
export type CaptchaKeysStatus = z.infer<typeof captchaKeysStatusSchema>;

/**
 * Para el constructor de formularios: ¿se puede pedir captcha y con qué?
 * `source` dice de dónde salen las llaves; `null` = no hay llaves (la opción
 * aparece deshabilitada con el motivo).
 */
export const captchaAvailabilitySchema = z.object({
    provider: captchaProviderSchema.nullable(),
    source: z.enum(['tenant', 'platform']).nullable(),
    /** La persona puede cargar las llaves de la empresa (es admin). */
    can_configure: z.boolean().default(false),
});
export type CaptchaAvailability = z.infer<typeof captchaAvailabilitySchema>;

/** Los orígenes de la CSP de la página de un formulario con este proveedor. */
export function captchaCspSources(provider: CaptchaProvider | null): CaptchaProviderInfo['csp'] {
    if (!provider) return { script: [], frame: [], connect: [], style: [] };
    return CAPTCHA_PROVIDER_INFO[provider].csp;
}
