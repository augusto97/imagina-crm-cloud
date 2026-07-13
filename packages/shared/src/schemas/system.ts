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
    configured: z.boolean(),
    host: z.string().default(''),
    port: z.number().default(587),
    secure: z.boolean().default(false),
    user: z.string().default(''),
    from: z.string().default(''),
});
export type SmtpConfigPublic = z.infer<typeof smtpConfigPublicSchema>;

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
