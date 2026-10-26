import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { roleSchema } from './membership';

/**
 * D2 + E5 — Mesa de ayuda por correo + SLA y escalamiento.
 *
 * Una lista puede leer el BUZÓN de soporte de la empresa por IMAP (usuario +
 * contraseña de aplicación, cifrada en reposo): cada correo nuevo crea un
 * ticket (un registro), las respuestas del cliente se suman como comentarios
 * visibles para él y el equipo contesta desde la ficha por el correo de la
 * empresa. Sobre los tickets corre una política de SLA por lista (primera
 * respuesta y resolución en horas HÁBILES de la empresa) con avisos «en
 * riesgo» y «vencido» y escalamiento.
 *
 * Qué vive dónde:
 *  - la CONEXIÓN del buzón (host, usuario, contraseña cifrada, cursor por UID)
 *    en la tabla `helpdesk_mailboxes` — es una credencial y no viaja en las
 *    plantillas ni en la ficha;
 *  - el MAPEO a campos, los estados, las protecciones, las plantillas de
 *    respuesta y la política de SLA en `lists.settings.helpdesk` — es
 *    configuración de la lista, referencia campos por ID (`*_field_id`, como
 *    toda la app) y así la re-apuntan solas las plantillas de lista y la
 *    migración de empresa.
 */

// ─────────────────────────── Buzón (IMAP) ───────────────────────────

/** `tls` = TLS desde el inicio (993); `starttls` = se cifra tras el saludo (143); `none` = sin cifrar. */
export const IMAP_SECURITY = ['tls', 'starttls', 'none'] as const;
export type ImapSecurity = (typeof IMAP_SECURITY)[number];

export const IMAP_PRESET_KEYS = ['gmail', 'outlook', 'zoho', 'generic'] as const;
export type ImapPresetKey = (typeof IMAP_PRESET_KEYS)[number];

export interface ImapPreset {
    key: ImapPresetKey;
    label: string;
    host: string;
    port: number;
    security: ImapSecurity;
    /** Pasos para la contraseña de aplicación, en lenguaje claro. */
    steps: string[];
    /** Enlace directo a donde se crea la contraseña de aplicación (si existe). */
    app_password_url: string | null;
    /** Algo que conviene saber ANTES de intentar (p. ej. Microsoft). */
    warning: string | null;
}

export const IMAP_PRESETS: Record<ImapPresetKey, ImapPreset> = {
    gmail: {
        key: 'gmail',
        label: 'Gmail / Google Workspace',
        host: 'imap.gmail.com',
        port: 993,
        security: 'tls',
        steps: [
            'Activa la verificación en dos pasos en la cuenta de Google del buzón de soporte (myaccount.google.com → Seguridad).',
            'Entra a myaccount.google.com/apppasswords y crea una contraseña de aplicación con el nombre «Imagina Base».',
            'Copia la contraseña de 16 letras que te muestra Google y pégala aquí (los espacios no importan).',
            'Usuario: la dirección completa del buzón (soporte@tuempresa.com).',
        ],
        app_password_url: 'https://myaccount.google.com/apppasswords',
        warning:
            'En Google Workspace el administrador puede tener desactivadas las contraseñas de aplicación: si no aparece la opción, pídele que la habilite.',
    },
    outlook: {
        key: 'outlook',
        label: 'Outlook / Microsoft 365',
        host: 'outlook.office365.com',
        port: 993,
        security: 'tls',
        steps: [
            'Activa la verificación en dos pasos de la cuenta de Microsoft del buzón de soporte.',
            'Crea una contraseña de aplicación en account.microsoft.com → Seguridad → Opciones de seguridad avanzadas (o en mysignins.microsoft.com, en Microsoft 365).',
            'Usuario: la dirección completa del buzón y, como contraseña, la de aplicación.',
        ],
        app_password_url: 'https://account.microsoft.com/security',
        warning:
            'Microsoft ya no permite entrar por IMAP con contraseña en la mayoría de las cuentas (Microsoft 365 desde 2022 y Outlook.com desde septiembre de 2024). Si «Probar conexión» dice que el usuario o la contraseña no son válidos, reenvía los correos de soporte a un buzón de Gmail, Zoho o de tu hosting y conecta ese.',
    },
    zoho: {
        key: 'zoho',
        label: 'Zoho Mail',
        host: 'imap.zoho.com',
        port: 993,
        security: 'tls',
        steps: [
            'En Zoho Mail, ve a Configuración → Cuentas de correo → Acceso IMAP y actívalo.',
            'En accounts.zoho.com → Seguridad → Contraseñas específicas de la aplicación, genera una con el nombre «Imagina Base».',
            'Si tu cuenta es de una organización usa el servidor imappro.zoho.com; si está en Europa o India, imap.zoho.eu o imap.zoho.in.',
        ],
        app_password_url: 'https://accounts.zoho.com/home#security/app_password',
        warning: null,
    },
    generic: {
        key: 'generic',
        label: 'Otro proveedor (hosting, cPanel…)',
        host: '',
        port: 993,
        security: 'tls',
        steps: [
            'Busca en tu proveedor de correo los datos de «IMAP» (servidor entrante): suele ser mail.tudominio.com o imap.tudominio.com, puerto 993 con SSL/TLS.',
            'Usuario: casi siempre la dirección completa del buzón. Contraseña: la del buzón o una contraseña de aplicación si tu proveedor las ofrece.',
        ],
        app_password_url: null,
        warning: null,
    },
};

/** Carpeta por defecto: la bandeja de entrada. */
export const DEFAULT_IMAP_FOLDER = 'INBOX';

/** Puerto típico de cada modo (el editor los sincroniza solos, como el SMTP). */
export function defaultImapPort(security: ImapSecurity): number {
    return security === 'tls' ? 993 : 143;
}

export const helpdeskMailboxInputSchema = z.object({
    preset: z.enum(IMAP_PRESET_KEYS).default('generic'),
    host: z
        .string()
        .trim()
        .min(1, 'Escribe el servidor IMAP')
        .max(255)
        .regex(/^[A-Za-z0-9.\-:[\]]+$/, 'Va sólo el nombre del servidor (sin «imap://», barras ni espacios)'),
    port: z.number().int().min(1).max(65535),
    security: z.enum(IMAP_SECURITY),
    username: z.string().trim().min(1, 'Escribe el usuario del buzón').max(255),
    /** Vacío u omitido = conservar la guardada. */
    password: z.string().max(500).optional(),
    folder: z.string().trim().min(1).max(255).default(DEFAULT_IMAP_FOLDER),
    /** La dirección que ven los clientes (y a la que responden). */
    support_address: z.string().trim().toLowerCase().email('Escribe la dirección de soporte (soporte@tuempresa.com)').max(255),
    /** Marcar como leídos los correos que se procesan (por defecto no se toca nada del buzón). */
    mark_seen: z.boolean().default(false),
    /** Aceptar un certificado que no se puede verificar (servidores propios). */
    allow_invalid_cert: z.boolean().default(false),
    enabled: z.boolean().default(true),
});
export type HelpdeskMailboxInput = z.infer<typeof helpdeskMailboxInputSchema>;

/** «Probar conexión» se puede pedir con lo que hay en el formulario (sin guardar). */
export const helpdeskMailboxTestSchema = helpdeskMailboxInputSchema.partial({ support_address: true });
export type HelpdeskMailboxTestInput = z.infer<typeof helpdeskMailboxTestSchema>;

/** Paso en que se cortó la prueba de conexión. */
export const IMAP_DIAGNOSTIC_STEPS = ['dns', 'connect', 'tls', 'auth', 'folder', 'ok'] as const;
export type ImapDiagnosticStep = (typeof IMAP_DIAGNOSTIC_STEPS)[number];

export interface ImapDiagnostic {
    ok: boolean;
    step: ImapDiagnosticStep;
    /** Una línea: qué pasó. */
    message: string;
    /** Qué hacer, en lenguaje claro. */
    hints: string[];
    /** Carpetas que se ven con esa cuenta (para elegir otra que no sea INBOX). */
    folders?: string[];
    /** Correos en la carpeta elegida (si se pudo abrir). */
    messages?: number;
}

export const HELPDESK_MESSAGE_STATUSES = ['ticket', 'reply', 'ignored', 'failed', 'sent'] as const;
export type HelpdeskMessageStatus = (typeof HELPDESK_MESSAGE_STATUSES)[number];

/** Un correo procesado (o enviado), para el panel y el hilo de la ficha. */
export interface HelpdeskMessageDto {
    id: number;
    direction: 'in' | 'out';
    status: HelpdeskMessageStatus;
    /** Por qué se ignoró / falló (en lenguaje claro). */
    reason: string | null;
    record_id: number | null;
    from_email: string | null;
    from_name: string | null;
    to: string | null;
    subject: string | null;
    at: string;
}

export interface HelpdeskMailboxDto {
    id: number;
    list_id: number;
    preset: ImapPresetKey;
    host: string;
    port: number;
    security: ImapSecurity;
    username: string;
    folder: string;
    support_address: string;
    mark_seen: boolean;
    allow_invalid_cert: boolean;
    enabled: boolean;
    /** `unreadable`: la contraseña se guardó con otra `SECRETS_KEY` (hay que reescribirla). */
    password_state: 'ok' | 'none' | 'unreadable';
    state: {
        last_check_at: string | null;
        last_ok_at: string | null;
        last_error: string | null;
        /** Correos que esperan (límite del plan o solo-lectura): siguen en el buzón. */
        pending_reason: string | null;
        running: boolean;
        counts: { tickets: number; replies: number; ignored: number; failed: number };
    };
    recent: HelpdeskMessageDto[];
}

// ─────────────────────────── Ajustes en la lista ───────────────────────────

export const replyTemplateSchema = z.object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1, 'Ponle un nombre a la plantilla').max(120),
    body: z.string().max(20_000),
});
export type ReplyTemplate = z.infer<typeof replyTemplateSchema>;

/** Hora del día `HH:MM` (24 h). `24:00` vale como fin del día. */
const hhmmSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Hora inválida (HH:MM)');

export const businessCalendarSchema = z.object({
    /** Días laborables (0 = domingo … 6 = sábado). */
    days: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
    start: hhmmSchema.default('08:00'),
    end: hhmmSchema.default('18:00'),
    /** Festivos que no cuentan: los de Colombia (calculados) o ninguno. */
    holidays: z.enum(['co', 'none']).default('co'),
});
export type BusinessCalendarConfig = z.infer<typeof businessCalendarSchema>;

export const slaTargetSchema = z.object({
    /** Valor de la opción de prioridad; null = la de todos (o la que aplica si no hay otra). */
    priority: z.string().max(190).nullable().default(null),
    first_response_hours: z.number().min(0).max(8760).nullable().default(null),
    resolution_hours: z.number().min(0).max(8760).nullable().default(null),
});
export type SlaTarget = z.infer<typeof slaTargetSchema>;

/**
 * Política de SLA de la lista. Las claves terminan en `_field_id` /
 * `_user_ids` a propósito: el blueprint de plantillas y la migración de
 * empresa las re-apuntan por convención.
 */
export const slaPolicySchema = z.object({
    enabled: z.boolean().default(false),
    /** Campo de prioridad (selección); null = una sola política para todos. */
    priority_field_id: idSchema.nullable().default(null),
    targets: z.array(slaTargetSchema).max(30).default([]),
    calendar: businessCalendarSchema.default({}),
    /** Al cuánto por ciento del tiempo se avisa «en riesgo». */
    at_risk_percent: z.number().int().min(10).max(99).default(75),
    // A quién se avisa (en riesgo y vencido).
    notify_user_ids: z.array(idSchema).max(50).default([]),
    notify_roles: z.array(roleSchema).max(5).default([]),
    /** C1 — equipos que reciben el aviso (todas sus personas del equipo de trabajo). */
    notify_team_ids: z.array(idSchema).max(20).default([]),
    /** Un campo Persona del ticket (el responsable): también recibe el aviso. */
    notify_assignee_field_id: idSchema.nullable().default(null),
    // Escalamiento al VENCER.
    escalate_user_ids: z.array(idSchema).max(50).default([]),
    escalate_roles: z.array(roleSchema).max(5).default([]),
    escalate_team_ids: z.array(idSchema).max(20).default([]),
    /** Poner un campo al vencer (p. ej. prioridad → Urgente, o responsable → el jefe). */
    escalate_set_field_id: idSchema.nullable().default(null),
    escalate_set_value: z.string().max(190).nullable().default(null),
    escalate_set_user_id: idSchema.nullable().default(null),
    // Las columnas GUARDADAS que el SLA mantiene al día (las crea «Crear columnas»).
    first_due_field_id: idSchema.nullable().default(null),
    resolution_due_field_id: idSchema.nullable().default(null),
    sla_status_field_id: idSchema.nullable().default(null),
});
export type SlaPolicy = z.infer<typeof slaPolicySchema>;

export const helpdeskSettingsSchema = z.object({
    // Mapeo del correo a los campos del ticket (null = no se guarda).
    /** null = el campo de título de la lista. */
    title_field_id: idSchema.nullable().default(null),
    from_name_field_id: idSchema.nullable().default(null),
    from_email_field_id: idSchema.nullable().default(null),
    /** Relación hacia la lista de contactos: se vincula al que tenga ese correo. */
    contact_field_id: idSchema.nullable().default(null),
    /** Campo de correo de la lista de contactos por el que se busca (null = el primero). */
    contact_match_field_id: idSchema.nullable().default(null),
    received_at_field_id: idSchema.nullable().default(null),
    /** Copia del cuerpo en texto plano (texto largo), además de la descripción. */
    body_text_field_id: idSchema.nullable().default(null),
    /** Campo Archivo donde van los adjuntos. */
    attachments_field_id: idSchema.nullable().default(null),
    // Estados (selección): los usan la reapertura y el reloj del SLA.
    status_field_id: idSchema.nullable().default(null),
    initial_status: z.string().max(190).nullable().default(null),
    /** Estados que PAUSAN el reloj («Esperando al cliente»). */
    paused_statuses: z.array(z.string().max(190)).max(50).default([]),
    /** Estados que CIERRAN el ticket («Resuelto», «Cerrado»). */
    closed_statuses: z.array(z.string().max(190)).max(50).default([]),
    /** Al llegar una respuesta a un ticket cerrado, pasa a este estado (null = no se reabre). */
    reopen_status: z.string().max(190).nullable().default(null),
    // Protecciones.
    max_per_sender_hour: z.number().int().min(1).max(1000).default(20),
    max_size_mb: z.number().int().min(1).max(50).default(20),
    /** Direcciones o dominios (`@spam.com`) que nunca crean tickets. */
    blocked_senders: z.array(z.string().trim().toLowerCase().min(1).max(255)).max(500).default([]),
    // Respuestas.
    reply_templates: z.array(replyTemplateSchema).max(50).default([]),
    /** Firma del que responde (la de Ajustes → Firma de email) al final de cada respuesta. */
    include_signature: z.boolean().default(true),
    sla: slaPolicySchema.default({}),
});
export type HelpdeskSettings = z.infer<typeof helpdeskSettingsSchema>;

/**
 * Lo que el servidor pone en `settings.helpdesk.mailbox` al conectar el buzón
 * (la ficha muestra el compositor «Responder por correo» sólo con buzón).
 * Nunca lleva secretos.
 */
export interface HelpdeskMailboxMarker {
    id: number;
    support_address: string;
}

/** Ajustes de la lista con defaults (tolerante: nunca lanza). */
export function readHelpdeskSettings(listSettings: unknown): HelpdeskSettings {
    const raw = (listSettings as Record<string, unknown> | null | undefined)?.helpdesk;
    const parsed = helpdeskSettingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : helpdeskSettingsSchema.parse({});
}

export function readHelpdeskMailboxMarker(listSettings: unknown): HelpdeskMailboxMarker | null {
    const raw = ((listSettings as Record<string, unknown> | null | undefined)?.helpdesk as Record<string, unknown> | undefined)?.mailbox;
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    const id = Number(m.id);
    if (!Number.isInteger(id) || id <= 0 || typeof m.support_address !== 'string') return null;
    return { id, support_address: m.support_address };
}

/**
 * Las columnas que mantiene el SLA (vencimientos y estado): nadie las escribe
 * a mano — ni una persona, ni una automatización, ni un import. Las usan el
 * servidor (rechaza la edición) y la interfaz (candado con el motivo).
 */
export function helpdeskManagedFieldIds(listSettings: unknown): number[] {
    const sla = readHelpdeskSettings(listSettings).sla;
    if (!sla.enabled) return [];
    return [sla.first_due_field_id, sla.resolution_due_field_id, sla.sla_status_field_id].filter((v): v is number => typeof v === 'number' && v > 0);
}

export const HELPDESK_MANAGED_REASON = 'Lo calcula el SLA de la mesa de ayuda: no se edita a mano.';

/** PATCH de los ajustes (todas las claves opcionales; las ausentes no se tocan). */
export const updateHelpdeskSettingsSchema = helpdeskSettingsSchema
    .omit({ sla: true })
    .partial()
    .extend({ sla: slaPolicySchema.partial().optional() });
export type UpdateHelpdeskSettingsInput = z.infer<typeof updateHelpdeskSettingsSchema>;

// ─────────────────────────── SLA: estados ───────────────────────────

/** Valores de la opción del campo «Estado del SLA» (y del estado calculado). */
export const SLA_STATUS_VALUES = ['a_tiempo', 'en_riesgo', 'vencido', 'cumplido', 'pausado'] as const;
export type SlaStatusValue = (typeof SLA_STATUS_VALUES)[number];

export const SLA_STATUS_OPTIONS: ReadonlyArray<{ value: SlaStatusValue; label: string; color: string }> = [
    { value: 'a_tiempo', label: 'A tiempo', color: 'green' },
    { value: 'en_riesgo', label: 'En riesgo', color: 'amber' },
    { value: 'vencido', label: 'Vencido', color: 'red' },
    { value: 'cumplido', label: 'Cumplido', color: 'blue' },
    { value: 'pausado', label: 'Pausado', color: 'gray' },
];

export const SLA_STATUS_LABELS: Record<SlaStatusValue, string> = Object.fromEntries(
    SLA_STATUS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SlaStatusValue, string>;

/** Qué objetivo: primera respuesta o resolución. */
export const SLA_TARGET_KINDS = ['first_response', 'resolution'] as const;
export type SlaTargetKind = (typeof SLA_TARGET_KINDS)[number];
export const SLA_TARGET_LABELS: Record<SlaTargetKind, string> = {
    first_response: 'primera respuesta',
    resolution: 'resolución',
};

/** Qué avisa el disparador «Cuando un SLA está en riesgo o se vence». */
export const SLA_ALERT_KINDS = ['at_risk', 'breached'] as const;
export type SlaAlertKind = (typeof SLA_ALERT_KINDS)[number];
export const SLA_ALERT_LABELS: Record<SlaAlertKind, string> = {
    at_risk: 'en riesgo',
    breached: 'vencido',
};

/** Objetivos que aplican a un ticket según su prioridad (o los de «todos»). */
export function slaTargetsFor(policy: Pick<SlaPolicy, 'targets' | 'priority_field_id'>, priority: string | null): SlaTarget | null {
    const exact = priority !== null && policy.priority_field_id !== null ? policy.targets.find((t) => t.priority === priority) : undefined;
    const fallback = policy.targets.find((t) => t.priority === null);
    const t = exact ?? fallback ?? null;
    if (!t) return null;
    if (t.first_response_hours === null && t.resolution_hours === null) return null;
    return t;
}

// ─────────────────────────── Ticket en la ficha ───────────────────────────

export interface HelpdeskSlaDto {
    status: SlaStatusValue | null;
    first_response_due: string | null;
    resolution_due: string | null;
    first_response_at: string | null;
    resolved_at: string | null;
    paused: boolean;
    priority: string | null;
}

export interface HelpdeskTicketDto {
    record_id: number;
    /** El buzón de la lista (null = la lista no lee correo: el compositor no se muestra). */
    support_address: string | null;
    customer_email: string | null;
    customer_name: string | null;
    subject: string | null;
    /** `TCK-0001` o `#12`: va en el asunto de cada respuesta. */
    token: string;
    messages: HelpdeskMessageDto[];
    sla: HelpdeskSlaDto | null;
    templates: Array<{ id: string; name: string }>;
    /** Quien mira puede responder por correo (edita el registro). */
    can_reply: boolean;
    include_signature: boolean;
}

export const helpdeskReplySchema = z.object({
    /** Texto de la respuesta (con variables `{{campo}}` ya resueltas o no). */
    body: z.string().trim().min(1, 'Escribe la respuesta').max(20_000),
    /** Destinatarios (separados por coma). Vacío = el cliente del ticket. */
    to: z.string().trim().max(2000).optional(),
    cc: z.string().trim().max(2000).optional(),
    subject: z.string().trim().max(400).optional(),
    /** Firma del que responde al final (default: lo que diga la lista). */
    signature: z.boolean().optional(),
    /** Después de enviar, poner el estado del ticket en este valor (p. ej. «Esperando al cliente»). */
    set_status: z.string().max(190).nullable().optional(),
});
export type HelpdeskReplyInput = z.infer<typeof helpdeskReplySchema>;

export interface HelpdeskReplyResult {
    ok: true;
    message_id: number;
    comment_id: number;
    to: string;
    subject: string;
    /** El correo salió pero algo de después no (p. ej. cambiar el estado). */
    warning?: string;
}

/** Vista previa de una plantilla con las variables del ticket resueltas. */
export const helpdeskTemplatePreviewSchema = z.object({ template_id: z.string().min(1).max(40) });

// ─────────────────────────── Token del ticket ───────────────────────────

/**
 * El identificador del ticket que va en el asunto: el ID automático de la
 * lista (`TCK-0001`) o, si no tiene, `#id`. Se escribe entre corchetes.
 */
export function ticketToken(autonumberText: string | null | undefined, recordId: number): string {
    const t = (autonumberText ?? '').trim();
    return t !== '' ? t : `#${recordId}`;
}

/** Asunto de una respuesta: `Re: <asunto> [TCK-0001]` (sin repetir `Re:` ni el token). */
export function replySubject(subject: string | null | undefined, token: string): string {
    let base = (subject ?? '').replace(/\s+/g, ' ').trim();
    const bracket = `[${token}]`;
    base = base.split(bracket).join('').replace(/\s+/g, ' ').trim();
    while (/^(re|rv|fw|fwd|res)\s*:/i.test(base)) base = base.replace(/^(re|rv|fw|fwd|res)\s*:\s*/i, '');
    return `Re: ${base || 'Tu solicitud'} ${bracket}`.trim();
}

export type ParsedTicketToken = { kind: 'id'; id: number } | { kind: 'code'; code: string };

/**
 * Tokens `[TCK-0001]` / `[#12]` de un asunto. Un código tiene que tener al
 * menos un dígito (así `[URGENTE]` o `[Externo]` no se confunden con un ticket).
 */
export function parseTicketTokens(subject: string | null | undefined): ParsedTicketToken[] {
    const out: ParsedTicketToken[] = [];
    const re = /\[\s*(#\d{1,15}|[\p{L}\p{N}_.#/-]{2,40})\s*\]/gu;
    for (const m of (subject ?? '').matchAll(re)) {
        const raw = m[1]!;
        if (raw.startsWith('#')) {
            const id = Number(raw.slice(1));
            if (Number.isSafeInteger(id) && id > 0) out.push({ kind: 'id', id });
        } else if (/\d/.test(raw)) {
            out.push({ kind: 'code', code: raw });
        }
        if (out.length >= 5) break;
    }
    return out;
}

/** `<abc@x>` / ` abc@x ` → `abc@x` (minúsculas: los comparamos sin importar mayúsculas). */
export function normalizeMessageId(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const v = raw.trim().replace(/^<+/, '').replace(/>+$/, '').trim().toLowerCase();
    return v !== '' && v.length <= 500 && !/\s/.test(v) ? v : null;
}

/** Los Message-ID de un `References` / `In-Reply-To` (puede traer varios). */
export function messageIdList(raw: string | string[] | null | undefined): string[] {
    const text = Array.isArray(raw) ? raw.join(' ') : (raw ?? '');
    const out: string[] = [];
    for (const m of text.matchAll(/<([^<>\s]+)>/g)) {
        const id = normalizeMessageId(m[1]);
        if (id && !out.includes(id)) out.push(id);
        if (out.length >= 50) break;
    }
    if (out.length === 0) {
        for (const part of text.split(/[\s,]+/)) {
            const id = part.includes('@') ? normalizeMessageId(part) : null;
            if (id && !out.includes(id)) out.push(id);
            if (out.length >= 50) break;
        }
    }
    return out;
}

/** ¿El remitente está en la lista de bloqueados? (`a@x.com` exacto o `@x.com` todo el dominio). */
export function isBlockedSender(email: string, blocked: readonly string[]): boolean {
    const e = email.trim().toLowerCase();
    const domain = e.includes('@') ? e.slice(e.lastIndexOf('@')) : '';
    return blocked.some((b) => {
        const v = b.trim().toLowerCase();
        if (v === '') return false;
        if (v.startsWith('@')) return domain === v;
        if (!v.includes('@')) return domain === `@${v}`;
        return e === v;
    });
}

// ─────────────────────────── Automatizaciones ───────────────────────────

/** «Cuando llega un correo»: un ticket nuevo, una respuesta o cualquiera. */
export const EMAIL_TRIGGER_KINDS = ['any', 'new', 'reply'] as const;
export type EmailTriggerKind = (typeof EMAIL_TRIGGER_KINDS)[number];

/** Lo que viaja en el evento (`{{correo.*}}`). */
export interface EmailEventInfo {
    tipo: 'nuevo' | 'respuesta';
    de: string;
    nombre: string;
    asunto: string;
    texto: string;
    message_id: string | null;
}

/** Lo que viaja en el evento del SLA (`{{sla.*}}`). */
export interface SlaEventInfo {
    alerta: SlaAlertKind;
    objetivo: SlaTargetKind;
    /** Instante ISO del vencimiento. */
    vence: string | null;
    prioridad: string | null;
    estado: SlaStatusValue | null;
}

export function emailTriggerMatches(cfg: Record<string, unknown>, info: Pick<EmailEventInfo, 'tipo'>): boolean {
    const kind = (EMAIL_TRIGGER_KINDS as readonly string[]).includes(String(cfg.email_kind)) ? (cfg.email_kind as EmailTriggerKind) : 'any';
    if (kind === 'new') return info.tipo === 'nuevo';
    if (kind === 'reply') return info.tipo === 'respuesta';
    return true;
}

export function slaTriggerMatches(cfg: Record<string, unknown>, info: Pick<SlaEventInfo, 'alerta' | 'objetivo'>): boolean {
    const alerts = Array.isArray(cfg.sla_alerts) ? (cfg.sla_alerts as unknown[]).map(String) : [];
    const targets = Array.isArray(cfg.sla_targets) ? (cfg.sla_targets as unknown[]).map(String) : [];
    if (alerts.length > 0 && !alerts.includes(info.alerta)) return false;
    if (targets.length > 0 && !targets.includes(info.objetivo)) return false;
    return true;
}

/** El selector de variables: el correo que llegó (`{{correo.*}}`). */
export const EMAIL_MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
    { tag: 'correo.de', label: 'Correo de quien escribió' },
    { tag: 'correo.nombre', label: 'Nombre de quien escribió' },
    { tag: 'correo.asunto', label: 'Asunto del correo' },
    { tag: 'correo.texto', label: 'Texto del correo' },
    { tag: 'correo.tipo', label: 'Ticket nuevo o respuesta' },
];

/** El selector de variables: la alerta del SLA (`{{sla.*}}`). */
export const SLA_MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
    { tag: 'sla.alerta', label: 'Alerta (en riesgo o vencido)' },
    { tag: 'sla.objetivo', label: 'Objetivo (primera respuesta o resolución)' },
    { tag: 'sla.vence', label: 'Vencimiento (fecha y hora)' },
    { tag: 'sla.prioridad', label: 'Prioridad del ticket' },
    { tag: 'sla.estado', label: 'Estado del SLA' },
];

/** Sólo en «Responder por correo» y las plantillas de respuesta: el ticket y su cliente. */
export const TICKET_MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
    { tag: 'ticket.numero', label: 'Número del ticket' },
    { tag: 'ticket.asunto', label: 'Asunto del ticket' },
    { tag: 'cliente.nombre', label: 'Nombre del cliente' },
    { tag: 'cliente.correo', label: 'Correo del cliente' },
    { tag: 'agente.nombre', label: 'Quien responde' },
];

export const helpdeskMessageDtoSchema = z.object({
    id: idSchema,
    direction: z.enum(['in', 'out']),
    status: z.enum(HELPDESK_MESSAGE_STATUSES),
    reason: z.string().nullable(),
    record_id: idSchema.nullable(),
    from_email: z.string().nullable(),
    from_name: z.string().nullable(),
    to: z.string().nullable(),
    subject: z.string().nullable(),
    at: isoDateTimeSchema,
});
