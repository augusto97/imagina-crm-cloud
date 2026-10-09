import { z } from 'zod';

/**
 * Correo de la empresa por su CUENTA de Google o Microsoft (v0.1.249, ADR-S29).
 *
 * Tercera forma de envío de un workspace, junto al correo de la plataforma y
 * al SMTP propio: los correos de la empresa (automatizaciones, enlaces del
 * portal, avisos) salen por la API de Gmail o de Microsoft Graph con una
 * conexión de Integraciones. Sin host, puerto ni contraseña de aplicación — y
 * en Microsoft 365, donde el SMTP con contraseña ya no existe, es la única vía.
 *
 * Por la API y NO por SMTP+OAuth a propósito: el SMTP de Gmail con OAuth pide
 * el permiso `https://mail.google.com/`, que es RESTRINGIDO y exige la
 * auditoría de seguridad CASA. `gmail.send` es sólo "sensible".
 */

/** Las apps de Integraciones que pueden mandar el correo de la empresa. */
export const MAIL_ACCOUNT_INTEGRATIONS = ['gmail', 'outlook'] as const;
export type MailAccountIntegration = (typeof MAIL_ACCOUNT_INTEGRATIONS)[number];

export function isMailAccountIntegration(v: unknown): v is MailAccountIntegration {
    return typeof v === 'string' && (MAIL_ACCOUNT_INTEGRATIONS as readonly string[]).includes(v);
}

/** Tipo de cuenta: los límites del proveedor cambian mucho entre una y otra. */
export const MAIL_ACCOUNT_KINDS = ['gmail_personal', 'google_workspace', 'outlook_personal', 'microsoft_365'] as const;
export type MailAccountKind = (typeof MAIL_ACCOUNT_KINDS)[number];

export interface MailAccountLimits {
    kind: MailAccountKind;
    /** «Gmail (cuenta personal)», «Google Workspace»… */
    label: string;
    /** Destinatarios por día que el proveedor tolera (aproximado: el proveedor no lo publica exacto). */
    daily_recipients: number;
    /** Lo que dice la tarjeta, en lenguaje claro. */
    daily_label: string;
    /** Destinatarios por mensaje (to + cc + cco). */
    per_message: number;
    /** Ritmo por minuto, cuando el proveedor lo fija. */
    per_minute: number | null;
    /** Qué pasa si se pasa. */
    on_exceed: string;
}

const PERSONAL_GOOGLE = /@(gmail|googlemail)\.com$/i;
const PERSONAL_MICROSOFT = /@(outlook|hotmail|live|msn)\.[a-z.]+$/i;

/**
 * Qué tipo de cuenta es, por su dirección. Una cuenta de Google con dominio
 * propio es de Workspace; una de Microsoft con dominio propio es de 365.
 */
export function mailAccountKind(integration: MailAccountIntegration, address: string | null): MailAccountKind {
    const a = (address ?? '').trim();
    if (integration === 'gmail') return PERSONAL_GOOGLE.test(a) ? 'gmail_personal' : 'google_workspace';
    return PERSONAL_MICROSOFT.test(a) ? 'outlook_personal' : 'microsoft_365';
}

/**
 * Límites PUBLICADOS por cada proveedor (los de envío desde la cuenta, que
 * son los que aplican a la API). Son orientativos a propósito y así se dicen:
 * el proveedor cuenta también lo que la persona manda a mano desde su bandeja,
 * y endurece los números en cuentas nuevas o con poca reputación.
 */
export const MAIL_ACCOUNT_LIMITS: Record<MailAccountKind, MailAccountLimits> = {
    gmail_personal: {
        kind: 'gmail_personal',
        label: 'Gmail (cuenta personal)',
        daily_recipients: 500,
        daily_label: 'Unos 500 destinatarios por día',
        per_message: 100,
        per_minute: null,
        on_exceed: 'Google bloquea el envío de la cuenta por hasta 24 horas.',
    },
    google_workspace: {
        kind: 'google_workspace',
        label: 'Google Workspace',
        daily_recipients: 2000,
        daily_label: 'Hasta 2.000 correos por día (500 en cuentas de prueba de Workspace)',
        per_message: 500,
        per_minute: null,
        on_exceed: 'Google bloquea el envío de la cuenta por hasta 24 horas.',
    },
    outlook_personal: {
        kind: 'outlook_personal',
        label: 'Outlook.com / Hotmail (cuenta personal)',
        daily_recipients: 5000,
        daily_label: 'Hasta 5.000 destinatarios por día (bastante menos en cuentas nuevas)',
        per_message: 500,
        per_minute: null,
        on_exceed: 'Microsoft frena el envío y puede pedir verificar la cuenta o suspenderla.',
    },
    microsoft_365: {
        kind: 'microsoft_365',
        label: 'Microsoft 365',
        daily_recipients: 10000,
        daily_label: 'Hasta 10.000 destinatarios por día',
        per_message: 500,
        per_minute: 30,
        on_exceed: 'Microsoft bloquea el envío de la casilla hasta 24 horas.',
    },
};

/** Lo que vale para TODAS las cuentas: va en la tarjeta tal cual. */
export const MAIL_ACCOUNT_NOTES: readonly string[] = [
    'Sirve para correos de trabajo: avisos de automatizaciones, enlaces del portal, recordatorios de facturas. No para campañas ni envíos masivos.',
    'El remitente es siempre la cuenta conectada. Si una automatización pide otro remitente, esa dirección queda como «responder a».',
    'Los correos quedan en la carpeta «Enviados» de esa cuenta.',
    'El límite lo cuenta el proveedor junto con lo que esa persona manda a mano desde su bandeja.',
    'Si quien conectó la cuenta se va de la empresa o quita el acceso, el correo deja de salir. Conviene conectar una casilla compartida (por ejemplo notificaciones@tuempresa.com).',
];

export const setMailAccountSchema = z.object({
    connection_id: z.number().int().positive(),
});
export type SetMailAccountInput = z.infer<typeof setMailAccountSchema>;

const limitsSchema = z.object({
    kind: z.enum(MAIL_ACCOUNT_KINDS),
    label: z.string(),
    daily_recipients: z.number(),
    daily_label: z.string(),
    per_message: z.number(),
    per_minute: z.number().nullable(),
    on_exceed: z.string(),
});

/** Una conexión de Gmail u Outlook que puede quedar como cuenta de envío. */
export const mailAccountCandidateSchema = z.object({
    connection_id: z.number(),
    name: z.string(),
    integration: z.enum(MAIL_ACCOUNT_INTEGRATIONS),
    /** La dirección con la que se conectó (`ana@acme.co`). */
    address: z.string().nullable(),
    /** Visible para todo el equipo (las privadas no se pueden elegir). */
    shared: z.boolean(),
    /** Autorizada y vigente. */
    ready: z.boolean(),
    problem: z.string().nullable(),
});
export type MailAccountCandidate = z.infer<typeof mailAccountCandidateSchema>;

export const tenantMailStatusSchema = z.object({
    /** Por dónde salen HOY los correos de la empresa. */
    mode: z.enum(['platform', 'smtp', 'account']),
    smtp_configured: z.boolean(),
    account: z
        .object({
            connection_id: z.number(),
            /** `null` = la conexión elegida ya no existe. */
            name: z.string().nullable(),
            integration: z.enum(MAIL_ACCOUNT_INTEGRATIONS).nullable(),
            address: z.string().nullable(),
            limits: limitsSchema.nullable(),
            /** Destinatarios que salieron hoy por esta vía (día UTC). */
            sent_today: z.number(),
            /** Motivo por el que HOY no saldría un correo (`null` = todo bien). */
            problem: z.string().nullable(),
        })
        .nullable(),
    candidates: z.array(mailAccountCandidateSchema),
    notes: z.array(z.string()),
});
export type TenantMailStatus = z.infer<typeof tenantMailStatusSchema>;
