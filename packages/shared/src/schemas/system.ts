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
