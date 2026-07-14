import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { tenants } from '../src/db/schema';
import { DomainsService } from '../src/domains/domains.service';
import type { FilesService } from '../src/files/files.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Stub: el service solo usa signedUrl (logo del boot público). */
const filesStub = {
    signedUrl: (tenantId: number, id: number) => `/api/v1/files/${id}/signed?tenant=${tenantId}&sig=stub`,
} as unknown as FilesService;

describe('DomainsService (Postgres real)', () => {
    let pg: TestPg;
    let domains: DomainsService;
    let tenantId: number;

    const env = loadEnv({
        PUBLIC_BASE_DOMAIN: 'app.imaginabase.com',
        APP_BASE_URL: 'https://app.imaginabase.com',
    });

    beforeAll(async () => {
        pg = await startPostgres();
        domains = new DomainsService(pg.db, env, filesStub);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    beforeEach(async () => {
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({
                slug: `dom-${counter}`,
                name: 'ACME',
                plan: 'trial',
                status: 'trialing',
                settings: { branding: { primary_color: '#16a34a', logo_file_id: null, app_name: 'Acme CRM' } },
            })
            .returning();
        tenantId = t!.id;
    });

    it('set/get/clear: registra un dominio propio y arma las instrucciones', async () => {
        const st = await domains.set(tenantId, 'CRM.Acme.com');
        expect(st.domain).toBe('crm.acme.com'); // normalizado a minúsculas
        expect(st.base_domain).toBe('app.imaginabase.com');
        expect(st.subdomain).toBe(`dom-${counter}.app.imaginabase.com`);
        expect(st.target).toBe('app.imaginabase.com');

        const cleared = await domains.clear(tenantId);
        expect(cleared.domain).toBeNull();
    });

    it('rechaza dominios reservados (la base y sus subdominios) e inválidos', async () => {
        await expect(domains.set(tenantId, 'app.imaginabase.com')).rejects.toMatchObject({ status: 400 });
        await expect(domains.set(tenantId, 'otro.app.imaginabase.com')).rejects.toMatchObject({ status: 400 });
        await expect(domains.set(tenantId, 'no_valido')).rejects.toThrow();
    });

    it('unicidad global: el dominio de otro workspace da 409', async () => {
        await domains.set(tenantId, 'unico.acme.com');
        const [other] = await pg.db
            .insert(tenants)
            .values({ slug: `dom-otro-${counter}`, name: 'Otro', plan: 'trial', status: 'trialing' })
            .returning();
        await expect(domains.set(other!.id, 'unico.acme.com')).rejects.toMatchObject({ status: 409 });
        // Re-guardar el mismo dominio en el MISMO tenant no molesta.
        await expect(domains.set(tenantId, 'unico.acme.com')).resolves.toMatchObject({ domain: 'unico.acme.com' });
    });

    it('resolveHost: dominio propio y subdominio slug.base → marca del tenant', async () => {
        await domains.set(tenantId, `crm-${counter}.acme.com`);

        const byDomain = await domains.resolveHost(`crm-${counter}.acme.com:443`);
        expect(byDomain.tenant).toMatchObject({
            id: tenantId,
            slug: `dom-${counter}`,
            app_name: 'Acme CRM',
            primary_color: '#16a34a',
        });

        const bySub = await domains.resolveHost(`dom-${counter}.app.imaginabase.com`);
        expect(bySub.tenant?.id).toBe(tenantId);

        // Plataforma / desconocidos / localhost → marca default.
        expect((await domains.resolveHost('app.imaginabase.com')).tenant).toBeNull();
        expect((await domains.resolveHost('nadie.example.com')).tenant).toBeNull();
        expect((await domains.resolveHost('localhost:5173')).tenant).toBeNull();
        expect((await domains.resolveHost(undefined)).tenant).toBeNull();
    });

    it('isServableDomain (ask de Caddy): base sí, tenant sí, desconocido no', async () => {
        await domains.set(tenantId, `crm-${counter}.acme.com`);
        expect(await domains.isServableDomain('app.imaginabase.com')).toBe(true);
        expect(await domains.isServableDomain(`crm-${counter}.acme.com`)).toBe(true);
        expect(await domains.isServableDomain(`dom-${counter}.app.imaginabase.com`)).toBe(true);
        expect(await domains.isServableDomain('malicioso.example.com')).toBe(false);
        expect(await domains.isServableDomain(undefined)).toBe(false);
    });

    it('baseUrlFor: con dominio propio → https://dominio; sin él → APP_BASE_URL', async () => {
        expect(await domains.baseUrlFor(tenantId)).toBe('https://app.imaginabase.com');
        await domains.set(tenantId, `crm-${counter}.acme.com`);
        expect(await domains.baseUrlFor(tenantId)).toBe(`https://crm-${counter}.acme.com`);
    });

    it('tenant archivado no resuelve (white-label apagado al archivar)', async () => {
        await domains.set(tenantId, `crm-${counter}.acme.com`);
        await pg.db.update(tenants).set({ archivedAt: new Date() }).where(
            (await import('drizzle-orm')).eq(tenants.id, tenantId),
        );
        expect((await domains.resolveHost(`crm-${counter}.acme.com`)).tenant).toBeNull();
        expect(await domains.isServableDomain(`crm-${counter}.acme.com`)).toBe(false);
    });
});
