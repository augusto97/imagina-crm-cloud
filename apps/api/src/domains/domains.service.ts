import { Resolver } from 'node:dns/promises';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
    brandingSchema,
    customDomainInputSchema,
    type DomainDnsReport,
    type PublicBoot,
    type TenantDomain,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';
import { FilesService } from '../files/files.service';

/**
 * Dominio personalizado por tenant (ADR-S17, white-label completo).
 *
 * Dos niveles de entrada white-label a la app:
 * - Subdominio automático `slug.PUBLIC_BASE_DOMAIN` (si el operador configuró
 *   la base) — no requiere nada del cliente.
 * - Dominio propio (`crm.acme.com`): el cliente crea un CNAME hacia la
 *   plataforma y Caddy emite el certificado on-demand (el endpoint `ask`
 *   valida contra este service que el dominio esté registrado).
 *
 * La resolución Host→tenant corre SIN sesión (boot público) sobre la conexión
 * base: `tenants` no tiene RLS por tenant y sólo exponemos datos de marca.
 */
@Injectable()
export class DomainsService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly files: FilesService,
    ) {}

    /** Base de subdominios (o null si el operador no la configuró). */
    baseDomain(): string | null {
        return this.env.PUBLIC_BASE_DOMAIN !== '' ? this.env.PUBLIC_BASE_DOMAIN : null;
    }

    /** Host destino del CNAME del cliente (base, o el host de APP_BASE_URL). */
    targetHost(): string {
        return this.baseDomain() ?? new URL(this.env.APP_BASE_URL).hostname.toLowerCase();
    }

    /** Normaliza un Host de request: sin puerto, minúsculas, sin punto final. */
    private normalizeHost(raw: string | undefined): string | null {
        if (!raw) return null;
        const host = raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
        return host !== '' ? host : null;
    }

    /**
     * Host de la request → tenant white-label (boot público, sin sesión).
     * `tenant: null` = dominio de la plataforma (o desconocido): marca default.
     */
    async resolveHost(rawHost: string | undefined): Promise<PublicBoot> {
        const host = this.normalizeHost(rawHost);
        if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return { tenant: null };

        const base = this.baseDomain();
        if (host === base || host === this.targetHost()) return { tenant: null };

        // 1) Dominio propio exacto.
        let [row] = await this.db
            .select({ id: tenants.id, slug: tenants.slug, settings: tenants.settings, archivedAt: tenants.archivedAt })
            .from(tenants)
            .where(eq(tenants.customDomain, host))
            .limit(1);

        // 2) Subdominio automático `slug.base` (un solo label extra).
        if (!row && base && host.endsWith(`.${base}`)) {
            const slug = host.slice(0, -(base.length + 1));
            if (/^[a-z0-9-]+$/.test(slug)) {
                [row] = await this.db
                    .select({ id: tenants.id, slug: tenants.slug, settings: tenants.settings, archivedAt: tenants.archivedAt })
                    .from(tenants)
                    .where(eq(tenants.slug, slug))
                    .limit(1);
            }
        }
        if (!row || row.archivedAt !== null) return { tenant: null };

        const parsed = brandingSchema.safeParse((row.settings as Record<string, unknown>)?.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return {
            tenant: {
                id: row.id,
                slug: row.slug,
                app_name: b.app_name,
                primary_color: b.primary_color,
                // URL firmada: el visitante todavía no tiene sesión.
                logo_url: b.logo_file_id !== null ? this.files.signedUrl(row.id, b.logo_file_id, 3600) : null,
            },
        };
    }

    /**
     * ¿Emitimos certificado para este dominio? (endpoint `ask` del
     * `on_demand_tls` de Caddy). Acepta la base, subdominios `slug.base` de
     * tenants vivos y dominios propios registrados. Todo lo demás → no.
     */
    async isServableDomain(rawDomain: string | undefined): Promise<boolean> {
        const host = this.normalizeHost(rawDomain);
        if (!host) return false;
        if (host === this.targetHost() || host === this.baseDomain()) return true;
        const resolved = await this.resolveHost(host);
        return resolved.tenant !== null;
    }

    /** Estado del dominio del workspace + datos para las instrucciones. */
    async getForTenant(tenantId: number): Promise<TenantDomain> {
        const [row] = await this.db
            .select({ domain: tenants.customDomain, slug: tenants.slug })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const base = this.baseDomain();
        return {
            domain: row?.domain ?? null,
            base_domain: base,
            subdomain: base && row ? `${row.slug}.${base}` : null,
            target: this.targetHost(),
        };
    }

    /** Registra el dominio propio del tenant (admin). */
    async set(tenantId: number, rawDomain: string): Promise<TenantDomain> {
        const { domain } = customDomainInputSchema.parse({ domain: rawDomain });

        // Reservados: la base de la plataforma y sus subdominios (esos se
        // resuelven por slug), y el host principal de la app.
        const base = this.baseDomain();
        if (domain === this.targetHost() || (base && (domain === base || domain.endsWith(`.${base}`)))) {
            throw new BadRequestException({
                code: 'domain_reserved',
                message: `Los subdominios de ${base ?? this.targetHost()} son automáticos (${'slug'}.${base ?? '...'}) — configurá acá solo un dominio TUYO`,
                data: { status: 400 },
            });
        }

        const [taken] = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.customDomain, domain))
            .limit(1);
        if (taken && taken.id !== tenantId) {
            throw new ConflictException({
                code: 'domain_taken',
                message: 'Ese dominio ya está registrado por otro workspace',
                data: { status: 409 },
            });
        }

        await this.db
            .update(tenants)
            .set({ customDomain: domain, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
        return this.getForTenant(tenantId);
    }

    /** Quita el dominio propio (la entrada por subdominio/base sigue). */
    async clear(tenantId: number): Promise<TenantDomain> {
        await this.db
            .update(tenants)
            .set({ customDomain: null, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
        return this.getForTenant(tenantId);
    }

    /**
     * Origen público del tenant para URLs absolutas en emails (magic links):
     * con dominio propio → `https://dominio`; si no → APP_BASE_URL global.
     */
    async baseUrlFor(tenantId: number): Promise<string> {
        const [row] = await this.db
            .select({ domain: tenants.customDomain })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        return row?.domain ? `https://${row.domain}` : this.env.APP_BASE_URL;
    }

    /**
     * Verificación EN VIVO del apuntamiento del dominio propio: CNAME →
     * target (o A/AAAA coincidente con el de la plataforma, para apex que no
     * admiten CNAME). Fallo de red = `unknown`, nunca un falso `missing`.
     */
    async dnsReport(tenantId: number): Promise<DomainDnsReport | null> {
        const { domain, target } = await this.getForTenant(tenantId);
        if (!domain) return null;

        const resolver = new Resolver({ timeout: 2000, tries: 1 });
        resolver.setServers(['1.1.1.1', '8.8.8.8']);
        const failed = (err: unknown): boolean => {
            const code = (err as NodeJS.ErrnoException).code;
            return code !== 'ENOTFOUND' && code !== 'ENODATA';
        };

        // 1) CNAME directo (el camino recomendado).
        try {
            const cnames = (await resolver.resolveCname(domain)).map((c) => c.toLowerCase().replace(/\.$/, ''));
            if (cnames.length > 0) {
                return cnames.includes(target)
                    ? { domain, target, type: 'CNAME', status: 'ok', current: cnames[0] }
                    : { domain, target, type: 'CNAME', status: 'partial', current: cnames[0] };
            }
        } catch (err) {
            if (failed(err)) return { domain, target, type: 'CNAME', status: 'unknown' };
        }

        // 2) Sin CNAME (apex): comparamos A del dominio vs A del target.
        try {
            const [theirs, ours] = await Promise.all([resolver.resolve4(domain), resolver.resolve4(target)]);
            if (theirs.length === 0) return { domain, target, type: 'A', status: 'missing' };
            const match = theirs.some((ip) => ours.includes(ip));
            return { domain, target, type: 'A', status: match ? 'ok' : 'partial', current: theirs[0] };
        } catch (err) {
            return { domain, target, type: 'A', status: failed(err) ? 'unknown' : 'missing' };
        }
    }
}
