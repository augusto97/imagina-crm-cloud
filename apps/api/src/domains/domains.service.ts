import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import {
    brandingSchema,
    customDomainInputSchema,
    type DomainDnsReport,
    type DomainKind,
    type DomainVerifyResult,
    type PublicBoot,
    type TenantDomain,
} from '@imagina-base/shared';
import { and, eq, ne, or } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';
import { FilesService } from '../files/files.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import { REDIS } from '../redis/redis.module';

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
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
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

        const cols = {
            id: tenants.id,
            slug: tenants.slug,
            name: tenants.name,
            settings: tenants.settings,
            archivedAt: tenants.archivedAt,
            portalDomain: tenants.portalDomain,
        };
        // 1) Dominio propio exacto: el del equipo o el del portal del cliente.
        let [row] = await this.db
            .select(cols)
            .from(tenants)
            .where(or(eq(tenants.customDomain, host), eq(tenants.portalDomain, host)))
            .limit(1);

        // 2) Subdominio automático `slug.base` (un solo label extra).
        if (!row && base && host.endsWith(`.${base}`)) {
            const slug = host.slice(0, -(base.length + 1));
            if (/^[a-z0-9-]+$/.test(slug)) {
                [row] = await this.db.select(cols).from(tenants).where(eq(tenants.slug, slug)).limit(1);
            }
        }
        if (!row || row.archivedAt !== null) return { tenant: null };

        const parsed = brandingSchema.safeParse((row.settings as Record<string, unknown>)?.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return {
            tenant: {
                id: row.id,
                slug: row.slug,
                name: row.name,
                app_name: b.app_name,
                primary_color: b.primary_color,
                // URL firmada: el visitante todavía no tiene sesión.
                logo_url: b.logo_file_id !== null ? this.files.signedUrl(row.id, b.logo_file_id, 3600) : null,
                surface: row.portalDomain === host ? 'portal' : 'app',
            },
        };
    }

    /**
     * v0.1.241 — ¿el host es el dominio PROPIO de alguna empresa (el del equipo
     * o el del portal, v0.1.245)? Ese dominio lo controla ella (puede apuntarlo a otro servidor), así que nada de lo que
     * se abra ahí puede ver datos de otras empresas.
     */
    async isCustomDomainHost(rawHost: string | undefined): Promise<boolean> {
        const host = this.normalizeHost(rawHost);
        if (!host) return false;
        const [row] = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(or(eq(tenants.customDomain, host), eq(tenants.portalDomain, host)))
            .limit(1);
        return row !== undefined;
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

    /**
     * Resolución de TXT (inyectable en los tests). Servidores públicos, no
     * los del sistema: un DNS local con caché vieja no debe decidir.
     */
    resolveTxt: (name: string) => Promise<string[][]> = (name) => {
        const resolver = new Resolver({ timeout: 2000, tries: 1 });
        resolver.setServers(['1.1.1.1', '8.8.8.8']);
        return resolver.resolveTxt(name);
    };

    /** Columna y clave del pedido pendiente según el tipo de dominio. */
    private column(kind: DomainKind) {
        return kind === 'portal' ? tenants.portalDomain : tenants.customDomain;
    }

    /** Estado del dominio del workspace + datos para las instrucciones. */
    async getForTenant(tenantId: number, kind: DomainKind = 'app'): Promise<TenantDomain> {
        const [row] = await this.db
            .select({ domain: this.column(kind), slug: tenants.slug, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const base = this.baseDomain();
        const claim = readClaim(row?.settings, kind);
        return {
            domain: row?.domain ?? null,
            base_domain: base,
            subdomain: base && row ? `${row.slug}.${base}` : null,
            target: this.targetHost(),
            pending: claim
                ? { domain: claim.domain, txt_name: txtName(claim.domain), txt_value: txtValue(claim.token) }
                : null,
        };
    }

    /**
     * Pide un dominio propio (admin). SEC-32 (v0.1.228): pedir NO es tener.
     * Antes el dominio quedaba activo apenas se escribía — y como es único,
     * cualquier empresa podía "reservar" el dominio de otra y dejarla afuera
     * (o emitir magic links con él). Ahora queda PENDIENTE hasta que aparezca
     * en su DNS el TXT con el código de ESTA empresa; recién ahí se activa
     * (y si otra lo tenía, pasa a quien probó ser dueño).
     *
     * v0.1.245 — `kind` elige el dominio del equipo o el del portal del
     * cliente. Los dos de una misma empresa no pueden ser el mismo: uno abre
     * la app del equipo y el otro el portal.
     */
    async set(tenantId: number, rawDomain: string, kind: DomainKind = 'app'): Promise<TenantDomain> {
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

        const [row] = await this.db
            .select({ app: tenants.customDomain, portal: tenants.portalDomain, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const other = kind === 'portal' ? row?.app : row?.portal;
        const otherClaim = readClaim(row?.settings, kind === 'portal' ? 'app' : 'portal');
        if (other === domain || otherClaim?.domain === domain) {
            throw new BadRequestException({
                code: 'domain_in_use_other_kind',
                message:
                    kind === 'portal'
                        ? 'Ese dominio ya es el de tu equipo. El portal de clientes necesita uno distinto (por ejemplo clientes.tuempresa.com).'
                        : 'Ese dominio ya es el del portal de tus clientes. El equipo necesita uno distinto.',
                data: { status: 400 },
            });
        }
        if ((kind === 'portal' ? row?.portal : row?.app) === domain) return this.getForTenant(tenantId, kind);
        const current = readClaim(row?.settings, kind);
        // Pedir el MISMO dominio otra vez conserva el código (el cliente ya
        // pudo haber creado el TXT).
        const token = current?.domain === domain ? current.token : randomBytes(16).toString('hex');
        await this.writeClaim(tenantId, row?.settings, kind, { domain, token, requested_at: new Date().toISOString() });
        return this.getForTenant(tenantId, kind);
    }

    /**
     * Busca el TXT del dominio pedido. Si está, el dominio queda activo para
     * esta empresa (y deja de estarlo para cualquier otra que lo tuviera, sea
     * como dominio del equipo o del portal).
     */
    async verify(tenantId: number, kind: DomainKind = 'app'): Promise<DomainVerifyResult> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const claim = readClaim(row?.settings, kind);
        if (!claim) {
            return { verified: false, status: 'missing', domain: await this.getForTenant(tenantId, kind) };
        }
        let values: string[];
        try {
            values = (await this.resolveTxt(txtName(claim.domain))).map((chunks) => chunks.join(''));
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const status = code === 'ENOTFOUND' || code === 'ENODATA' ? 'missing' : 'unknown';
            return { verified: false, status, domain: await this.getForTenant(tenantId, kind) };
        }
        const expected = txtValue(claim.token);
        if (!values.includes(expected)) {
            const status = values.some((v) => v.startsWith('imagina-verify=')) ? 'mismatch' : 'missing';
            return { verified: false, status, domain: await this.getForTenant(tenantId, kind) };
        }
        await this.db.transaction(async (tx) => {
            // Quien probó ser dueño se lo lleva: el que lo tenía lo pierde, en
            // la columna que fuera (un dominio no sirve a dos empresas).
            await tx
                .update(tenants)
                .set({ customDomain: null, updatedAt: new Date() })
                .where(and(eq(tenants.customDomain, claim.domain), ne(tenants.id, tenantId)));
            await tx
                .update(tenants)
                .set({ portalDomain: null, updatedAt: new Date() })
                .where(and(eq(tenants.portalDomain, claim.domain), ne(tenants.id, tenantId)));
            const settings = { ...(row?.settings ?? {}) } as Record<string, unknown>;
            delete settings[claimKey(kind)];
            await tx
                .update(tenants)
                .set({
                    ...(kind === 'portal' ? { portalDomain: claim.domain } : { customDomain: claim.domain }),
                    settings,
                    updatedAt: new Date(),
                })
                .where(eq(tenants.id, tenantId));
        });
        return { verified: true, status: 'ok', domain: await this.getForTenant(tenantId, kind) };
    }

    /** Quita el dominio propio y el pedido pendiente (la entrada por subdominio/base sigue). */
    async clear(tenantId: number, kind: DomainKind = 'app'): Promise<TenantDomain> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = { ...(row?.settings ?? {}) } as Record<string, unknown>;
        delete settings[claimKey(kind)];
        await this.db
            .update(tenants)
            .set({ ...(kind === 'portal' ? { portalDomain: null } : { customDomain: null }), settings, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
        return this.getForTenant(tenantId, kind);
    }

    private async writeClaim(tenantId: number, current: unknown, kind: DomainKind, claim: DomainClaim): Promise<void> {
        const settings = { ...((current as Record<string, unknown> | null) ?? {}), [claimKey(kind)]: claim };
        await this.db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    }

    /**
     * Origen público del tenant para URLs absolutas en emails (magic links).
     * Para el EQUIPO: dominio propio → `https://dominio`; si no, APP_BASE_URL.
     * Para el PORTAL (v0.1.245): el dominio de sus clientes primero, después
     * el del equipo y por último APP_BASE_URL — sólo dominios VERIFICADOS.
     *
     * El subdominio automático `slug.base` NO se usa en enlaces a propósito:
     * existe sólo si el servidor web lo atiende (DNS y certificado comodín), y
     * un enlace a un host que no responde deja al cliente afuera.
     */
    async baseUrlFor(tenantId: number, surface: DomainKind = 'app'): Promise<string> {
        const [row] = await this.db
            .select({ app: tenants.customDomain, portal: tenants.portalDomain })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const candidates = surface === 'portal' ? [row?.portal, row?.app] : [row?.app];
        for (const domain of candidates) {
            // Verificado no alcanza: el servidor web tiene que ATENDERLO (en
            // nginx cada dominio se agrega a mano). Un enlace a un dominio que
            // no responde deja al cliente afuera, así que se usa el siguiente.
            if (domain && (await this.isServing(tenantId, domain))) return `https://${domain}`;
        }
        return this.env.APP_BASE_URL;
    }

    /**
     * v0.1.245 — ¿el dominio llega a ESTA plataforma y a ESTA empresa? Se pide
     * `/api/v1/public/boot` por el propio dominio: tiene que contestar con el
     * id de la empresa. Así se descarta tanto un dominio sin certificado o sin
     * alias en el servidor web como uno que todavía apunta a otro lado.
     * Inyectable para los tests (no salen a la red).
     */
    probeServing: (tenantId: number, domain: string) => Promise<boolean> = async (tenantId, domain) => {
        try {
            const res = await safeWebhookFetch(`https://${domain}/api/v1/public/boot`, {
                method: 'GET',
                timeoutMs: 4000,
                captureBody: true,
            });
            if (res.status !== 200 || !res.body) return false;
            const parsed = JSON.parse(res.body) as { tenant?: { id?: unknown } | null };
            return parsed.tenant?.id === tenantId;
        } catch {
            return false;
        }
    };

    /** `probeServing` con caché (10 min si responde, 2 min si no). */
    async isServing(tenantId: number, domain: string): Promise<boolean> {
        const key = `domserve:${tenantId}:${domain}`;
        const cached = await this.redis?.get(key).catch(() => null);
        if (cached === '1' || cached === '0') return cached === '1';
        const ok = await this.probeServing(tenantId, domain);
        await this.redis?.set(key, ok ? '1' : '0', 'EX', ok ? 600 : 120).catch(() => undefined);
        return ok;
    }

    /** Olvida lo que se sabía de un dominio (al cambiarlo o al comprobarlo a mano). */
    async forgetServing(tenantId: number, domain: string | null | undefined): Promise<void> {
        if (domain) await this.redis?.del(`domserve:${tenantId}:${domain}`).catch(() => undefined);
    }

    /**
     * Verificación EN VIVO del apuntamiento del dominio propio: CNAME →
     * target (o A/AAAA coincidente con el de la plataforma, para apex que no
     * admiten CNAME). Fallo de red = `unknown`, nunca un falso `missing`.
     */
    async dnsReport(tenantId: number, kind: DomainKind = 'app'): Promise<DomainDnsReport | null> {
        const state = await this.getForTenant(tenantId, kind);
        const report = await this.dnsRecord(state);
        if (!report || !state.domain || state.pending) return report;
        // v0.1.245 — con el dominio ya verificado, ¿el servidor lo atiende?
        // (DNS bien apuntado no alcanza: falta el certificado o el alias en el
        // servidor web). Se comprueba en vivo, sin caché.
        await this.forgetServing(tenantId, state.domain);
        return { ...report, serving: (await this.isServing(tenantId, state.domain)) ? 'ok' : 'no' };
    }

    private async dnsRecord(state: TenantDomain): Promise<DomainDnsReport | null> {
        // Mientras está pendiente, el CNAME del dominio PEDIDO también se
        // puede revisar (el cliente arma los dos registros a la vez).
        const domain = state.pending?.domain ?? state.domain;
        const target = state.target;
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

/** Pedido pendiente: `domain_claim` (equipo) o `portal_domain_claim` (portal). */
function claimKey(kind: DomainKind): string {
    return kind === 'portal' ? 'portal_domain_claim' : 'domain_claim';
}

interface DomainClaim {
    domain: string;
    token: string;
    requested_at: string;
}

function readClaim(settings: unknown, kind: DomainKind = 'app'): DomainClaim | null {
    const raw = (settings as Record<string, unknown> | null)?.[claimKey(kind)] as Partial<DomainClaim> | undefined;
    if (!raw || typeof raw.domain !== 'string' || typeof raw.token !== 'string') return null;
    return { domain: raw.domain, token: raw.token, requested_at: String(raw.requested_at ?? '') };
}

/** Nombre del TXT de verificación (el cliente lo crea en SU DNS). */
export function txtName(domain: string): string {
    return `_imagina-verify.${domain}`;
}

export function txtValue(token: string): string {
    return `imagina-verify=${token}`;
}
