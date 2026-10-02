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

    /** DNS falso: TXT publicados por nombre (lo que el cliente pondría en SU DNS). */
    const txt = new Map<string, string[]>();
    /** Dominios que el servidor web "atiende" (v0.1.245: sin red en los tests). */
    const serving = new Set<string>();
    beforeAll(() => {
        domains.probeServing = async (_tid, domain) => serving.has(domain);
        domains.resolveTxt = async (name) => {
            const values = txt.get(name);
            if (!values) throw Object.assign(new Error('no data'), { code: 'ENODATA' });
            return values.map((v) => [v]);
        };
    });

    /** Pide el dominio, publica el TXT correcto y lo verifica. */
    async function activate(tid: number, domain: string): Promise<void> {
        const st = await domains.set(tid, domain);
        txt.set(st.pending!.txt_name, [st.pending!.txt_value]);
        const r = await domains.verify(tid);
        expect(r.verified).toBe(true);
    }

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

    it('set deja el dominio PENDIENTE; verify con el TXT correcto lo activa; clear lo quita', async () => {
        const st = await domains.set(tenantId, 'CRM.Acme.com');
        // SEC-32: pedir no es tener — nada activo todavía.
        expect(st.domain).toBeNull();
        expect(st.pending).toMatchObject({ domain: 'crm.acme.com', txt_name: '_imagina-verify.crm.acme.com' });
        expect(st.pending!.txt_value).toMatch(/^imagina-verify=[0-9a-f]{32}$/);
        expect(st.base_domain).toBe('app.imaginabase.com');
        expect(st.subdomain).toBe(`dom-${counter}.app.imaginabase.com`);
        expect(st.target).toBe('app.imaginabase.com');
        expect((await domains.resolveHost('crm.acme.com')).tenant).toBeNull();
        expect(await domains.isServableDomain('crm.acme.com')).toBe(false);

        // Pedir otra vez el mismo dominio conserva el código.
        expect((await domains.set(tenantId, 'crm.acme.com')).pending!.txt_value).toBe(st.pending!.txt_value);

        // Sin TXT → missing; con otro código → mismatch.
        expect(await domains.verify(tenantId)).toMatchObject({ verified: false, status: 'missing' });
        txt.set(st.pending!.txt_name, ['imagina-verify=otro-codigo']);
        expect(await domains.verify(tenantId)).toMatchObject({ verified: false, status: 'mismatch' });

        txt.set(st.pending!.txt_name, [st.pending!.txt_value]);
        const ok = await domains.verify(tenantId);
        expect(ok.verified).toBe(true);
        expect(ok.domain).toMatchObject({ domain: 'crm.acme.com', pending: null });

        const cleared = await domains.clear(tenantId);
        expect(cleared.domain).toBeNull();
        txt.clear();
    });

    it('rechaza dominios reservados (la base y sus subdominios) e inválidos', async () => {
        await expect(domains.set(tenantId, 'app.imaginabase.com')).rejects.toMatchObject({ status: 400 });
        await expect(domains.set(tenantId, 'otro.app.imaginabase.com')).rejects.toMatchObject({ status: 400 });
        await expect(domains.set(tenantId, 'no_valido')).rejects.toThrow();
    });

    it('SEC-32: nadie reserva el dominio de otra empresa — quien prueba ser dueño se lo lleva', async () => {
        const [otra] = await pg.db
            .insert(tenants)
            .values({ slug: `dom-otro-${counter}`, name: 'Otro', plan: 'trial', status: 'trialing' })
            .returning();
        // "Otra" lo pide primero, pero no puede publicar el TXT: no se activa
        // y NO bloquea al dueño real.
        await domains.set(otra!.id, 'unico.acme.com');
        await activate(tenantId, 'unico.acme.com');
        expect((await domains.resolveHost('unico.acme.com')).tenant?.id).toBe(tenantId);

        // Si el dueño del DNS cambia el TXT al código de "otra", el dominio
        // pasa a ella (y deja de estar en la primera).
        const st = await domains.getForTenant(otra!.id);
        txt.set(st.pending!.txt_name, [st.pending!.txt_value]);
        expect((await domains.verify(otra!.id)).verified).toBe(true);
        expect((await domains.getForTenant(tenantId)).domain).toBeNull();
        expect((await domains.resolveHost('unico.acme.com')).tenant?.id).toBe(otra!.id);
        txt.clear();
    });

    it('resolveHost: dominio propio y subdominio slug.base → marca del tenant', async () => {
        await activate(tenantId, `crm-${counter}.acme.com`);

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
        await activate(tenantId, `crm-${counter}.acme.com`);
        expect(await domains.isServableDomain('app.imaginabase.com')).toBe(true);
        expect(await domains.isServableDomain(`crm-${counter}.acme.com`)).toBe(true);
        expect(await domains.isServableDomain(`dom-${counter}.app.imaginabase.com`)).toBe(true);
        expect(await domains.isServableDomain('malicioso.example.com')).toBe(false);
        expect(await domains.isServableDomain(undefined)).toBe(false);
    });

    it('baseUrlFor: con dominio propio → https://dominio; sin él → APP_BASE_URL', async () => {
        const domain = `crm-${counter}.acme.com`;
        serving.add(domain);
        expect(await domains.baseUrlFor(tenantId)).toBe('https://app.imaginabase.com');
        await domains.set(tenantId, domain);
        // Pendiente todavía: los enlaces siguen saliendo por la plataforma.
        expect(await domains.baseUrlFor(tenantId)).toBe('https://app.imaginabase.com');
        await activate(tenantId, domain);
        expect(await domains.baseUrlFor(tenantId)).toBe(`https://${domain}`);
    });

    it('v0.1.245: un dominio verificado que el servidor todavía no atiende NO se usa en los enlaces', async () => {
        const domain = `noresponde-${counter}.acme.com`;
        await activate(tenantId, domain);
        // Verificado (TXT) pero sin alias/certificado en el servidor web: el
        // cliente quedaría afuera si el enlace saliera por ahí.
        expect(await domains.baseUrlFor(tenantId)).toBe('https://app.imaginabase.com');
        serving.add(domain);
        expect(await domains.baseUrlFor(tenantId)).toBe(`https://${domain}`);
    });

    it('v0.1.245: dominio del PORTAL — ciclo propio, marca con surface=portal y enlaces del portal', async () => {
        const app = `crm-p${counter}.acme.com`;
        const portal = `clientes-${counter}.acme.com`;
        await activate(tenantId, app);

        // El mismo dominio no puede ser del equipo y del portal.
        await expect(domains.set(tenantId, app, 'portal')).rejects.toMatchObject({ status: 400 });

        const st = await domains.set(tenantId, portal, 'portal');
        expect(st.domain).toBeNull();
        expect(st.pending?.domain).toBe(portal);
        // Pedirlo no toca el dominio del equipo.
        expect((await domains.getForTenant(tenantId)).domain).toBe(app);
        // Pendiente: no resuelve ni recibe certificado.
        expect((await domains.resolveHost(portal)).tenant).toBeNull();
        expect(await domains.isServableDomain(portal)).toBe(false);

        txt.set(st.pending!.txt_name, [st.pending!.txt_value]);
        expect((await domains.verify(tenantId, 'portal')).verified).toBe(true);
        expect((await domains.getForTenant(tenantId, 'portal')).domain).toBe(portal);
        expect((await domains.getForTenant(tenantId)).domain).toBe(app);

        const boot = await domains.resolveHost(portal);
        expect(boot.tenant).toMatchObject({ id: tenantId, name: 'ACME', app_name: 'Acme CRM', surface: 'portal' });
        expect((await domains.resolveHost(app)).tenant?.surface).toBe('app');
        expect(await domains.isServableDomain(portal)).toBe(true);
        expect(await domains.isCustomDomainHost(portal)).toBe(true);

        // Enlaces del portal: portal → equipo → plataforma, sólo si responde.
        expect(await domains.baseUrlFor(tenantId, 'portal')).toBe('https://app.imaginabase.com');
        serving.add(app);
        expect(await domains.baseUrlFor(tenantId, 'portal')).toBe(`https://${app}`);
        serving.add(portal);
        expect(await domains.baseUrlFor(tenantId, 'portal')).toBe(`https://${portal}`);
        // Los enlaces del EQUIPO no usan el dominio del portal.
        expect(await domains.baseUrlFor(tenantId)).toBe(`https://${app}`);

        // Quitar el del portal no toca el del equipo.
        expect((await domains.clear(tenantId, 'portal')).domain).toBeNull();
        expect((await domains.getForTenant(tenantId)).domain).toBe(app);
        expect((await domains.resolveHost(portal)).tenant).toBeNull();
        txt.clear();
    });

    it('v0.1.245: quien prueba ser dueño se lleva el dominio aunque otra empresa lo use como dominio del portal', async () => {
        const [otra] = await pg.db
            .insert(tenants)
            .values({ slug: `dom-px-${counter}`, name: 'Otra', plan: 'trial', status: 'trialing' })
            .returning();
        const domain = `compartido-${counter}.acme.com`;
        // "Otra" lo tiene como dominio de su portal…
        const a = await domains.set(otra!.id, domain, 'portal');
        txt.set(a.pending!.txt_name, [a.pending!.txt_value]);
        expect((await domains.verify(otra!.id, 'portal')).verified).toBe(true);
        // …y el dueño real del DNS lo verifica como dominio de su equipo.
        await activate(tenantId, domain);
        expect((await domains.getForTenant(otra!.id, 'portal')).domain).toBeNull();
        expect((await domains.resolveHost(domain)).tenant?.id).toBe(tenantId);
        txt.clear();
    });

    it('tenant archivado no resuelve (white-label apagado al archivar)', async () => {
        await activate(tenantId, `crm-${counter}.acme.com`);
        await pg.db.update(tenants).set({ archivedAt: new Date() }).where(
            (await import('drizzle-orm')).eq(tenants.id, tenantId),
        );
        expect((await domains.resolveHost(`crm-${counter}.acme.com`)).tenant).toBeNull();
        expect(await domains.isServableDomain(`crm-${counter}.acme.com`)).toBe(false);
    });
});
