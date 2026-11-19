import { z } from 'zod';
import { platformBrandSchema } from './platform-brand';

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

/**
 * v0.1.245 — qué dominio se configura: el del EQUIPO (`app`, ADR-S17) o el
 * del PORTAL DEL CLIENTE (`portal`): un dominio aparte para que los clientes
 * de la empresa vean sólo su marca y nunca el login del equipo.
 */
export const domainKindSchema = z.enum(['app', 'portal']);
export type DomainKind = z.infer<typeof domainKindSchema>;

/**
 * v0.1.423 — En la consola de la plataforma también figuran los dominios de
 * las TIENDAS (uno por tienda, en `shops.custom_domain`).
 */
export const platformDomainKindSchema = z.enum(['app', 'portal', 'shop']);
export type PlatformDomainKind = z.infer<typeof platformDomainKindSchema>;

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
    /**
     * SEC-32 (v0.1.228) — dominio pedido que todavía no probó ser del cliente.
     * No se usa para nada (ni certificado, ni marca, ni enlaces) hasta que
     * aparezca el registro TXT con el código: así nadie "reserva" el dominio
     * de otra empresa. `domain` es siempre el VERIFICADO.
     */
    pending: z
        .object({
            domain: z.string(),
            /** Nombre del TXT a crear (FQDN). */
            txt_name: z.string(),
            /** Valor exacto del TXT. */
            txt_value: z.string(),
        })
        .nullable()
        .default(null),
});
export type TenantDomain = z.infer<typeof tenantDomainSchema>;

/** Resultado de "Verificar" el dominio pedido (SEC-32). */
export const domainVerifyResultSchema = z.object({
    verified: z.boolean(),
    /** found = TXT presente con otro valor; missing = no hay TXT; unknown = DNS no respondió. */
    status: z.enum(['ok', 'missing', 'mismatch', 'unknown']),
    domain: tenantDomainSchema,
});
export type DomainVerifyResult = z.infer<typeof domainVerifyResultSchema>;

/** Verificación en vivo del apuntamiento DNS del dominio propio. */
export const domainDnsReportSchema = z.object({
    domain: z.string(),
    target: z.string(),
    /** Tipo de registro esperado/encontrado (CNAME normal; A para apex). */
    type: z.enum(['CNAME', 'A']),
    status: z.enum(['ok', 'missing', 'partial', 'unknown']),
    /** Valor actual encontrado (para diagnóstico cuando no matchea). */
    current: z.string().optional(),
    /**
     * v0.1.245 — con el dominio verificado: ¿el servidor ya lo atiende (con
     * certificado)? Los enlaces sólo salen por un dominio que responde.
     */
    serving: z.enum(['ok', 'no']).optional(),
});
export type DomainDnsReport = z.infer<typeof domainDnsReportSchema>;

/**
 * v0.1.246 — Plataforma → Dominios. Con el camino de ServerAvatar (alias por
 * panel) cada dominio se habilita A MANO en el servidor: el operador necesita
 * ver qué empresas pidieron o verificaron uno, si ya apunta y si ya responde.
 */
export const platformDomainSchema = z.object({
    tenant_id: z.number().int(),
    tenant_name: z.string(),
    tenant_slug: z.string(),
    kind: platformDomainKindSchema,
    /** v0.1.423 — La tienda, si es el dominio de una tienda. */
    shop_id: z.number().int().nullable().default(null),
    shop_name: z.string().nullable().default(null),
    domain: z.string(),
    /** pending = esperando el TXT de verificación; verified = es de la empresa. */
    state: z.enum(['pending', 'verified']),
    requested_at: z.string().nullable(),
    /** Apuntamiento DNS en vivo (null si el DNS no se pudo consultar). */
    dns: domainDnsReportSchema.nullable(),
    /** Sólo verificados: ¿el servidor ya lo atiende con certificado? */
    serving: z.enum(['ok', 'no']).nullable(),
});
export type PlatformDomain = z.infer<typeof platformDomainSchema>;

/** Dominio que una empresa dejó de usar: hay que sacar el alias del servidor. */
export const retiredDomainSchema = z.object({
    domain: z.string(),
    tenant_name: z.string(),
    removed_at: z.string(),
});
export type RetiredDomain = z.infer<typeof retiredDomainSchema>;

export const platformDomainsSchema = z.object({
    /** Host al que las empresas apuntan su CNAME (el de la app). */
    target: z.string(),
    domains: z.array(platformDomainSchema),
    retired: z.array(retiredDomainSchema),
    /**
     * v0.1.423 — Con tiendas en su dominio: ¿el servidor web ya le pasa a la
     * app lo que no es un archivo (paso único por servidor)? `null` = no hay
     * tiendas con dominio, no hace falta.
     */
    site_routing: z.enum(['ok', 'missing', 'unknown']).nullable().default(null),
});
export type PlatformDomains = z.infer<typeof platformDomainsSchema>;

export const platformDomainCheckSchema = z.object({
    tenant_id: z.number().int().positive(),
    kind: platformDomainKindSchema,
    shop_id: z.number().int().positive().optional(),
});

/**
 * v0.1.423 — ¿El servidor web ya manda al API lo que no es un archivo (el
 * paso único para servir tiendas en su dominio)? Se sabe pidiendo
 * `/_imagina/site` por el dominio de la plataforma: sin ese paso contesta el
 * SPA (HTML), con él contesta el API (JSON).
 */
export const siteProbeSchema = z.object({
    ok: z.literal(true),
    shop_id: z.number().int().nullable(),
});
export type SiteProbe = z.infer<typeof siteProbeSchema>;

/**
 * Boot público SIN sesión: el front lo llama con el Host de la URL para
 * saber si está en un dominio white-label y pintar la marca ANTES del login.
 */
export const publicBootSchema = z.object({
    tenant: z
        .object({
            id: z.number().int().positive(),
            slug: z.string(),
            /** Nombre de la empresa (respaldo cuando no eligió un nombre de app). */
            name: z.string().default(''),
            app_name: z.string().nullable(),
            primary_color: z.string().nullable(),
            /** v0.1.326 — barras del sistema del teléfono (null = neutro). */
            app_bar_color: z.string().nullable().default(null),
            logo_url: z.string().nullable(),
            /**
             * v0.1.245 — por qué dominio se entró: `app` (el del equipo o el
             * subdominio automático) o `portal` (el dominio de sus clientes,
             * que abre el portal directo y nunca la app del equipo).
             */
            surface: z.enum(['app', 'portal']).default('app'),
            /**
             * v0.1.450 (ADR-S108) — la empresa del dominio es una AGENCIA: en
             * su dominio también entran a sus empresas cliente (con su marca).
             */
            is_agency: z.boolean().default(false),
            /**
             * v0.1.450 — la marca de la app es la de la agencia de esta empresa
             * (nunca la de la plataforma).
             */
            white_label: z.boolean().default(false),
        })
        .nullable(),
    /**
     * v0.1.327 — la marca de la plataforma (Plataforma → Marca). En el dominio
     * de una empresa no se usa (white-label); viaja igual porque es pública.
     */
    platform: platformBrandSchema.default({}),
    /**
     * v0.1.423 — El dominio es el de una TIENDA: la app del equipo nunca se
     * abre ahí. Si el servidor web todavía manda ese dominio al SPA, el SPA va
     * a la página de la tienda por esta ruta.
     */
    shop: z.object({ path: z.string() }).nullable().default(null),
});
export type PublicBoot = z.infer<typeof publicBootSchema>;
