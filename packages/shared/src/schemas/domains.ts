import { z } from 'zod';

/**
 * Dominio personalizado por workspace (ADR-S17, white-label completo):
 * la empresa entra a la app por su propio dominio/subdominio.
 *
 * - Nivel 1: subdominio de la plataforma (`slug.BASE`) — automático si el
 *   operador configuró `PUBLIC_BASE_DOMAIN`.
 * - Nivel 2: dominio propio del cliente (`crm.acme.com`) — CNAME hacia la
 *   plataforma + certificado on-demand de Caddy.
 */

/** Hostname válido (RFC-ish): labels alfanuméricos con guiones, TLD ≥ 2. */
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const customDomainInputSchema = z.object({
    domain: z
        .string()
        .trim()
        .toLowerCase()
        .regex(HOSTNAME_RE, 'Dominio inválido (ej. crm.tuempresa.com)'),
});
export type CustomDomainInput = z.infer<typeof customDomainInputSchema>;

/** Estado del dominio del workspace + datos para armar las instrucciones. */
export const tenantDomainSchema = z.object({
    /** Dominio propio configurado (null = sin dominio propio). */
    domain: z.string().nullable(),
    /** Base de la plataforma (null = el operador no configuró subdominios). */
    base_domain: z.string().nullable(),
    /** Subdominio automático `slug.base` (null si no hay base). */
    subdomain: z.string().nullable(),
    /** Host destino del CNAME que debe crear el cliente. */
    target: z.string(),
});
export type TenantDomain = z.infer<typeof tenantDomainSchema>;

/** Verificación en vivo del apuntamiento DNS del dominio propio. */
export const domainDnsReportSchema = z.object({
    domain: z.string(),
    target: z.string(),
    /** Tipo de registro esperado/encontrado (CNAME normal; A para apex). */
    type: z.enum(['CNAME', 'A']),
    status: z.enum(['ok', 'missing', 'partial', 'unknown']),
    /** Valor actual encontrado (para diagnóstico cuando no matchea). */
    current: z.string().optional(),
});
export type DomainDnsReport = z.infer<typeof domainDnsReportSchema>;

/**
 * Boot público SIN sesión: el front lo llama con el Host de la URL para
 * saber si está en un dominio white-label y pintar la marca ANTES del login.
 */
export const publicBootSchema = z.object({
    tenant: z
        .object({
            id: z.number().int().positive(),
            slug: z.string(),
            app_name: z.string().nullable(),
            primary_color: z.string().nullable(),
            logo_url: z.string().nullable(),
        })
        .nullable(),
});
export type PublicBoot = z.infer<typeof publicBootSchema>;
