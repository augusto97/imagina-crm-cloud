import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { appBranding, DEFAULT_PLATFORM_APP_NAME } from '@imagina-base/shared';
import { manifestBrandToken } from '../src/agency/agency-brand';
import { AgencyService } from '../src/agency/agency.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv, type Env } from '../src/config/env';
import { auditLog, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DomainsService } from '../src/domains/domains.service';
import type { FilesService } from '../src/files/files.service';
import { HelpService, type HelpStore } from '../src/help/help.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.types';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { BrandingService } from '../src/workspaces/branding.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/** El service sólo firma URLs y partes: lo mismo que el real, sin disco. */
const filesStub = {
    signedUrl: (tenantId: number, id: number) => `/api/v1/files/${id}/signed?tenant=${tenantId}&sig=stub`,
    signParts: (scope: string, ...parts: Array<string | number>) => createHmac('sha256', 'clave-de-prueba').update([scope, ...parts].join('.')).digest('hex'),
} as unknown as FilesService;

class MemStore implements HelpStore {
    m = new Map<string, string>();
    async get(k: string) {
        return this.m.get(k) ?? null;
    }
    async set(k: string, v: string) {
        this.m.set(k, v);
        return 'OK';
    }
}

/**
 * v0.1.450 (I3, ADR-S108) — La marca de la agencia en sus empresas cliente:
 * el equipo de una empresa cliente ve la app con la marca de su agencia (nunca
 * la de la plataforma); lo que ven SUS clientes sigue con la marca propia.
 */
describe('Modo agencia — la marca de la agencia (Postgres real)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let env: Env;
    let auth: AuthService;
    let domains: DomainsService;
    let branding: BrandingService;
    let help: HelpService;
    let helpStore: MemStore;
    let agencySvc: AgencyService;
    let guard: TenantGuard;
    const sent: MailMessage[] = [];
    const serving = new Set<string>();

    let agency: number;
    let client: number;
    let solo: number;
    let anaId: number;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        env = loadEnv({
            REDIS_URL: redisBox.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            APP_BASE_URL: 'https://app.plataforma.test',
            PUBLIC_BASE_DOMAIN: 'plataforma.test',
        });
        const tenantDb = new TenantDb(pg.db);
        const mail = new MailService(env, {
            name: 'test',
            send: async (m) => {
                sent.push(m);
            },
        });
        auth = new AuthService(pg.db, redis, env, mail, new SessionService(redis, env));
        // Sin Redis a propósito: el «¿el dominio responde?» no se cachea entre pruebas.
        domains = new DomainsService(pg.db, env, filesStub, undefined, undefined, auth);
        domains.probeServing = async (_tid, domain) => serving.has(domain);
        domains.onModuleInit();
        branding = new BrandingService(tenantDb, filesStub, undefined, pg.db);
        helpStore = new MemStore();
        help = new HelpService(helpStore, pg.db);
        const audit = new AuditService(tenantDb);
        agencySvc = new AgencyService(pg.db, auth, new PlansService(pg.db), audit);
        guard = new TenantGuard(tenantDb, new Reflector(), audit, redis);

        const [a] = await pg.db
            .insert(tenants)
            .values({
                slug: 'norte',
                name: 'Agencia Norte',
                plan: 'pro',
                status: 'active',
                isAgency: true,
                settings: { branding: { app_name: 'Norte Suite', primary_color: '#2563eb', sidebar_color: '#111827', logo_file_id: 77 } },
            })
            .returning();
        agency = a!.id;
        const [c] = await pg.db
            .insert(tenants)
            .values({
                slug: 'cafe',
                name: 'Café Luna',
                plan: 'pro',
                status: 'active',
                agencyId: agency,
                settings: { branding: { app_name: 'Café Luna App', primary_color: '#16a34a', logo_file_id: 5 } },
            })
            .returning();
        client = c!.id;
        const [s] = await pg.db.insert(tenants).values({ slug: 'solo', name: 'Solo SAS', plan: 'pro', status: 'active' }).returning();
        solo = s!.id;

        // Ana: admin de la agencia, entró a Café Luna «por la agencia», y además
        // es miembro de otra empresa que no tiene nada que ver.
        const [ana] = await pg.db.insert(users).values({ email: 'ana@norte.test', passwordHash: 'x', name: 'Ana', emailVerifiedAt: new Date() }).returning();
        anaId = ana!.id;
        await withTenant(pg.db, agency, (tx) => tx.insert(memberships).values({ tenantId: agency, userId: anaId, role: 'admin' }));
        await withTenant(pg.db, client, (tx) => tx.insert(memberships).values({ tenantId: client, userId: anaId, role: 'admin', viaAgency: true }));
        await withTenant(pg.db, solo, (tx) => tx.insert(memberships).values({ tenantId: solo, userId: anaId, role: 'manager' }));
        await redis.set('pwreset:ana-token', String(anaId), 'EX', 60);
        await auth.resetPassword('ana-token', 'clave-de-ana-123');
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('Marca: la empresa cliente hereda la marca de su agencia (con la llave del manifiesto); las demás no', async () => {
        const res = await branding.get(client);
        // Lo propio de la empresa sigue ahí: es lo que ven SUS clientes.
        expect(res.app_name).toBe('Café Luna App');
        expect(res.primary_color).toBe('#16a34a');
        expect(res.inherited).toMatchObject({
            source: 'agency',
            name: 'Agencia Norte',
            app_name: 'Norte Suite',
            primary_color: '#2563eb',
            sidebar_color: '#111827',
        });
        // El logo es un archivo de la AGENCIA: se firma con su id.
        expect(res.inherited!.logo_url).toContain(`/files/77/`);
        expect(res.inherited!.logo_url).toContain(`tenant=${agency}`);
        expect(res.manifest_brand).toMatch(new RegExp(`^${client}\\.[0-9a-f]{32}$`));
        // La app usa la de la agencia y se marca white-label.
        expect(appBranding(res)).toMatchObject({ app_name: 'Norte Suite', primary_color: '#2563eb', white_label: true, agency_name: 'Agencia Norte' });

        for (const tid of [agency, solo]) {
            const own = await branding.get(tid);
            expect(own.inherited).toBeNull();
            expect(own.manifest_brand).toBeNull();
            expect(appBranding(own).white_label).toBe(false);
        }
    });

    it('pantalla de entrar: el subdominio del cliente sale con la marca de la agencia; su portal, con la propia', async () => {
        const boot = await domains.resolveHost('cafe.plataforma.test');
        expect(boot.tenant).toMatchObject({ id: client, app_name: 'Norte Suite', primary_color: '#2563eb', white_label: true, is_agency: false, surface: 'app' });
        expect(boot.tenant!.logo_url).toContain(`tenant=${agency}`);

        const own = await domains.resolveHost('norte.plataforma.test');
        expect(own.tenant).toMatchObject({ id: agency, app_name: 'Norte Suite', is_agency: true, white_label: false });

        // El portal lo ven los clientes de la empresa: con su marca, nunca la de la agencia.
        await pg.db.update(tenants).set({ portalDomain: 'clientes.cafe.test' }).where(eq(tenants.id, client));
        const portal = await domains.resolveHost('clientes.cafe.test');
        expect(portal.tenant).toMatchObject({ id: client, app_name: 'Café Luna App', primary_color: '#16a34a', surface: 'portal', white_label: false });
        expect(portal.tenant!.logo_url).toContain(`tenant=${client}`);
        await pg.db.update(tenants).set({ portalDomain: null }).where(eq(tenants.id, client));
    });

    it('manifiesto de la app instalable: la llave firmada da el nombre de la agencia; alterada u otra empresa, nada', async () => {
        const token = (await branding.get(client)).manifest_brand!;
        expect(await domains.agencyManifestBrand(token)).toEqual({ name: 'Agencia Norte', app_name: 'Norte Suite', primary_color: '#2563eb', app_bar_color: null });

        const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
        expect(await domains.agencyManifestBrand(tampered)).toBeNull();
        expect(await domains.agencyManifestBrand(`${solo}.${'0'.repeat(32)}`)).toBeNull();
        // Bien firmada, pero de una empresa que no es cliente de nadie.
        expect(await domains.agencyManifestBrand(manifestBrandToken(filesStub, solo))).toBeNull();
        expect(await domains.agencyManifestBrand('<script>')).toBeNull();
        expect(await domains.agencyManifestBrand(undefined)).toBeNull();
    });

    it('enlaces de la app: salen por el dominio de la agencia si responde; el portal no; el dominio propio del cliente gana', async () => {
        expect(await domains.baseUrlFor(client, 'app')).toBe('https://app.plataforma.test');

        await pg.db.update(tenants).set({ customDomain: 'app.norte.test' }).where(eq(tenants.id, agency));
        // Verificado pero sin atender todavía: no se usa.
        expect(await domains.baseUrlFor(client, 'app')).toBe('https://app.plataforma.test');
        serving.add('app.norte.test');
        expect(await domains.baseUrlFor(client, 'app')).toBe('https://app.norte.test');
        expect(await domains.baseUrlFor(client, 'portal')).toBe('https://app.plataforma.test');
        // Otra empresa no hereda nada.
        expect(await domains.baseUrlFor(solo, 'app')).toBe('https://app.plataforma.test');

        await pg.db.update(tenants).set({ customDomain: 'crm.cafe.test' }).where(eq(tenants.id, client));
        serving.add('crm.cafe.test');
        expect(await domains.baseUrlFor(client, 'app')).toBe('https://crm.cafe.test');
        await pg.db.update(tenants).set({ customDomain: null }).where(eq(tenants.id, client));
    });

    it('correos de la cuenta: con la marca y el dominio de la agencia, nunca el nombre de la plataforma', async () => {
        expect(await domains.accountBrand({ tenantId: client })).toEqual({ name: 'Norte Suite', base: 'https://app.norte.test' });
        expect(await domains.accountBrand({ host: 'cafe.plataforma.test' })).toEqual({ name: 'Norte Suite', base: 'https://cafe.plataforma.test' });
        expect(await domains.accountBrand({ tenantId: solo })).toEqual({ name: DEFAULT_PLATFORM_APP_NAME, base: 'https://app.plataforma.test' });

        // Alguien que sólo trabaja en la empresa cliente.
        const [luis] = await pg.db.insert(users).values({ email: 'luis@cafe.test', passwordHash: 'x', name: 'Luis' }).returning();
        await withTenant(pg.db, client, (tx) => tx.insert(memberships).values({ tenantId: client, userId: luis!.id, role: 'manager' }));
        sent.length = 0;
        await auth.requestPasswordReset('luis@cafe.test');
        await new Promise((r) => setTimeout(r, 50));
        const msg = sent.find((m) => m.to === 'luis@cafe.test');
        expect(msg?.subject).toBe('Restablecer tu contraseña — Norte Suite');
        expect(msg?.html).toContain('https://app.norte.test/reset?token=');
        expect(`${msg?.subject} ${msg?.html} ${msg?.text}`).not.toContain(DEFAULT_PLATFORM_APP_NAME);
    });

    it('sesión abierta en el dominio de la agencia: sirve para sus empresas cliente y para nada más', async () => {
        const session = await auth.login({ email: 'ana@norte.test', password: 'clave-de-ana-123' }, { host: 'norte.plataforma.test' });
        if (!('memberships' in session)) throw new Error('sin sesión');
        expect(session.memberships.map((m) => m.tenant_id).sort()).toEqual([agency, client].sort());

        const asUser = async (tenantId: number): Promise<FastifyRequest> => {
            const req = {
                url: '/api/v1/lists',
                method: 'GET',
                headers: { 'x-tenant-id': String(tenantId) },
                cookies: {},
                authUserId: anaId,
                boundTenantId: agency,
            } as unknown as FastifyRequest;
            const ctx = {
                switchToHttp: () => ({ getRequest: () => req }),
                getHandler: () => () => undefined,
                getClass: () => class {},
            } as unknown as ExecutionContext;
            await guard.canActivate(ctx);
            return req;
        };
        expect((await asUser(agency)).tenant?.tenantId).toBe(agency);
        expect((await asUser(client)).tenant?.tenantId).toBe(client);
        await expect(asUser(solo)).rejects.toMatchObject({ response: { code: 'session_tenant_scope' } });
    });

    it('ayuda: el equipo del cliente ve el contacto de su agencia; las demás empresas, el de la plataforma', async () => {
        await help.update({ support: { email: 'soporte@plataforma.test', whatsapp: null, url: null, note: null } });
        const saved = await agencySvc.setSupport(agency, anaId, { email: 'ayuda@norte.test', whatsapp: '+57 300 555 1234', url: null, note: 'Lunes a viernes' });
        expect(saved).toMatchObject({ email: 'ayuda@norte.test', whatsapp: '+57 300 555 1234' });
        expect(await agencySvc.support(agency)).toEqual(saved);
        const rows = await pg.db.select().from(auditLog).where(and(eq(auditLog.tenantId, agency), eq(auditLog.action, 'agency.support')));
        expect(rows).toHaveLength(1);

        const forClient = await help.forMember('manager', client);
        expect(forClient.support.email).toBe('ayuda@norte.test');
        expect(forClient.support_name).toBe('Agencia Norte');
        expect(forClient.videos).toEqual({});
        expect(forClient.custom).toEqual([]);

        const forSolo = await help.forMember('manager', solo);
        expect(forSolo.support.email).toBe('soporte@plataforma.test');
        expect(forSolo.support_name).toBeNull();
    });
});
