import { z } from 'zod';

/**
 * Config SMTP de plataforma (superadmin). Se guarda en Redis y el MailService
 * la usa si está presente, con fallback al transporte por env. `pass` nunca se
 * devuelve en el GET (solo el flag `configured`).
 */
export const smtpConfigSchema = z.object({
    host: z.string().trim().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    user: z.string().max(255).optional().default(''),
    pass: z.string().max(2048).optional().default(''),
    from: z.string().trim().min(1).max(255),
});
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

/** Vista pública (sin password) + flag de si hay config guardada. */
export const smtpConfigPublicSchema = z.object({
    /**
     * v0.1.150 — la contraseña guardada no se puede descifrar (cambió
     * `SECRETS_KEY` entre el guardado y ahora). El panel lo dice y pide
     * reescribirla: antes esto reventaba el GET con un 500 y el panel entero
     * desaparecía, mientras los correos se "enviaban" al logger.
     */
    password_unreadable: z.boolean().default(false),
    configured: z.boolean(),
    host: z.string().default(''),
    port: z.number().default(587),
    secure: z.boolean().default(false),
    user: z.string().default(''),
    from: z.string().default(''),
});
export type SmtpConfigPublic = z.infer<typeof smtpConfigPublicSchema>;

/**
 * Diagnóstico de CONECTIVIDAD al servidor SMTP (v0.1.151). Un "Connection
 * timeout" al enviar no dice nada útil: puede ser el host mal escrito, el
 * puerto equivocado, TLS mal elegido o —lo más común en un VPS— el proveedor
 * bloqueando el correo saliente. El backend prueba los puertos SMTP desde el
 * SERVIDOR (que es quien envía) y devuelve qué responde cada uno.
 */
export const smtpPortProbeSchema = z.object({
    port: z.number(),
    /** open = hubo conexión TCP; timeout = nadie respondió; refused = puerto cerrado. */
    status: z.enum(['open', 'timeout', 'refused', 'error']),
    /** Milisegundos que tardó el intento. */
    ms: z.number(),
    /** Saludo del servidor (`220 smtp.acme.com ESMTP`), si lo mandó. */
    greeting: z.string().optional(),
    /** Código de error de red (ECONNREFUSED, EHOSTUNREACH…). */
    error: z.string().optional(),
});
export type SmtpPortProbe = z.infer<typeof smtpPortProbeSchema>;

export const smtpDiagnosticSchema = z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    dns: z.object({
        ok: z.boolean(),
        addresses: z.array(z.string()),
        error: z.string().optional(),
    }),
    ports: z.array(smtpPortProbeSchema),
    /**
     * ok = se conecta; tls_mismatch = conecta pero la opción "conexión segura"
     * no corresponde al puerto; port_closed = ese puerto no, pero otro sí;
     * all_blocked = ningún puerto SMTP responde; dns_failed = el host no resuelve.
     */
    verdict: z.enum(['ok', 'tls_mismatch', 'port_closed', 'all_blocked', 'dns_failed']),
    hints: z.array(z.string()),
});
export type SmtpDiagnostic = z.infer<typeof smtpDiagnosticSchema>;

/** Permite diagnosticar lo que hay en el formulario, sin guardarlo antes. */
export const smtpDiagnoseInputSchema = z.object({
    host: z.string().trim().max(255).optional(),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
});
export type SmtpDiagnoseInput = z.infer<typeof smtpDiagnoseInputSchema>;

/**
 * Un registro DNS recomendado para el SMTP propio del workspace
 * (SPF/DKIM/DMARC), con su estado verificado en vivo por el backend
 * (`GET /workspaces/current/smtp/dns`).
 */
export const dnsRecordCheckSchema = z.object({
    purpose: z.enum(['spf', 'dkim', 'dmarc']),
    type: z.enum(['TXT', 'CNAME']),
    /** Host a crear, relativo al dominio (ej. `@`, `_dmarc`, `google._domainkey`). */
    host: z.string(),
    /** Valor exacto a copiar. Vacío en DKIM (la clave la genera el proveedor). */
    value: z.string(),
    /** ok = ya está; missing = falta; partial = hay TXT pero no matchea. */
    status: z.enum(['ok', 'missing', 'partial', 'unknown']),
    /** Valor actual encontrado en el DNS (para diagnóstico). */
    current: z.string().optional(),
    /** Guía humana (dónde obtener el valor cuando no lo podemos derivar). */
    note: z.string().optional(),
});
export type DnsRecordCheck = z.infer<typeof dnsRecordCheckSchema>;

export const smtpDnsReportSchema = z.object({
    domain: z.string(),
    provider: z.string(),
    records: z.array(dnsRecordCheckSchema),
});
export type SmtpDnsReport = z.infer<typeof smtpDnsReportSchema>;

// ── Diagnóstico de la plataforma (v0.1.238) ──────────────────────────────

/**
 * Por dónde salió (o no) un correo:
 *  - `tenant_smtp`: el SMTP propio de la empresa;
 *  - `tenant_account`: la cuenta de Google o Microsoft de la empresa (v0.1.249);
 *  - `platform_smtp`: el de Plataforma → Correo;
 *  - `server_smtp`: el del `.env` del servidor;
 *  - `none`: no hay ninguno — el correo NO salió (transporte de registro).
 */
export const MAIL_VIAS = ['tenant_smtp', 'tenant_account', 'platform_smtp', 'server_smtp', 'none'] as const;
export type MailVia = (typeof MAIL_VIAS)[number];

/** Un intento de envío, tal como lo vio el servidor. */
export const mailLogEntrySchema = z.object({
    at: z.string(),
    to: z.string(),
    subject: z.string(),
    /** `account`: verificación, recuperación, invitaciones (sin empresa). */
    scope: z.enum(['account', 'tenant']),
    tenant_id: z.number().nullable().default(null),
    via: z.enum(MAIL_VIAS),
    status: z.enum(['sent', 'not_sent', 'failed']),
    error: z.string().nullable().default(null),
});
export type MailLogEntry = z.infer<typeof mailLogEntrySchema>;

/** Un error inesperado del servidor (lo que el usuario ve como "Error interno"). */
export const serverErrorEntrySchema = z.object({
    at: z.string(),
    source: z.enum(['request', 'database', 'process']),
    method: z.string().nullable().default(null),
    path: z.string().nullable().default(null),
    message: z.string(),
    detail: z.string().nullable().default(null),
});
export type ServerErrorEntry = z.infer<typeof serverErrorEntrySchema>;

/** Si los correos de CUENTA (sin empresa) tienen por dónde salir. */
export const accountMailStatusSchema = z.object({
    available: z.boolean(),
    via: z.enum(MAIL_VIAS),
    host: z.string().nullable().default(null),
    /** Motivo legible cuando `available` es false. */
    reason: z.string().nullable().default(null),
});
export type AccountMailStatus = z.infer<typeof accountMailStatusSchema>;

export const platformDiagnosticsSchema = z.object({
    account_mail: accountMailStatusSchema,
    mail: z.array(mailLogEntrySchema),
    errors: z.array(serverErrorEntrySchema),
});
export type PlatformDiagnostics = z.infer<typeof platformDiagnosticsSchema>;

/**
 * v0.1.278 — Uso del disco del servidor (Plataforma → Diagnóstico). `parts`
 * son las carpetas de la app que más crecen; `available` es false fuera del
 * layout de releases (desarrollo).
 */
export const diskUsageSchema = z.object({
    available: z.boolean(),
    path: z.string(),
    total_bytes: z.number(),
    free_bytes: z.number(),
    /** Por debajo del mínimo que pide una actualización. */
    low: z.boolean(),
    min_free_bytes: z.number(),
    parts: z.array(z.object({ key: z.string(), label: z.string(), bytes: z.number().nullable() })),
    /** Lo que liberaría «Liberar espacio» ahora (estimado). */
    reclaimable_bytes: z.number(),
});
export type DiskUsage = z.infer<typeof diskUsageSchema>;

export const diskCleanupResultSchema = z.object({
    freed_bytes: z.number(),
    removed: z.array(z.string()),
    free_bytes: z.number(),
});
export type DiskCleanupResult = z.infer<typeof diskCleanupResultSchema>;
