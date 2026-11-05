import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import type { SessionService } from '../src/auth/session.service';
import { loadEnv } from '../src/config/env';
import { OAuthCallbackGuard, renderAdminConsentPage } from '../src/connectors/connectors-oauth.controller';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { MsAdminConsentService, describeError } from '../src/connectors/ms-admin-consent.service';
import { tenants, users } from '../src/db/schema';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.363 — Enlace de aprobación para el administrador de Microsoft 365.
 * Reporte del usuario: un cliente de su empresa conectaba Teams y Microsoft le
 * mostraba «Se necesita la aprobación del administrador» sin salida.
 */
describe('Aprobación del administrador de Microsoft 365 (v0.1.363)', () => {
    let pg: TestPg;
    let store: ReturnType<typeof memoryOAuthStore>;
    let apps: IntegrationAppsService;
    let consent: MsAdminConsentService;
    let connectors: ConnectorsService;
    let tenantId: number;
    let userId: number;
    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.imagina.test' });

    beforeAll(async () => {
        pg = await startPostgres();
        store = memoryOAuthStore();
        apps = new IntegrationAppsService(store, env);
        consent = new MsAdminConsentService(store, env, pg.db, apps);
        const tenantDb = new TenantDb(pg.db);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, new AuditService(tenantDb), apps);
        const [t] = await pg.db.insert(tenants).values({ slug: 'binapps', name: 'Binapps' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'cristian@binapps.test', passwordHash: 'x', name: 'Cristian' }).returning();
        userId = u!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('sólo para apps de Microsoft, y con la app de la plataforma configurada', async () => {
        await expect(consent.create(tenantId, userId, 'slack')).rejects.toThrow(/sólo aplica a las apps de Microsoft/);
        await expect(consent.create(tenantId, userId, 'teams')).rejects.toThrow(/Plataforma → Integraciones/);
    });

    it('arma el enlace de /v2.0/adminconsent con los permisos de Teams y lo reusa mientras esté vigente', async () => {
        await apps.update('microsoft', { client_id: 'ms-client', client_secret: 'ms-secreto-5555' }, new Map());
        const st = await consent.create(tenantId, userId, 'teams');
        const url = new URL(st.url!);
        expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent');
        expect(url.searchParams.get('client_id')).toBe('ms-client');
        expect(url.searchParams.get('redirect_uri')).toBe('https://app.imagina.test/api/v1/connections/oauth/callback');
        expect(url.searchParams.get('state')).toMatch(/^ac_[A-Za-z0-9_-]{30,}$/);
        expect(url.searchParams.get('scope')).toContain('https://graph.microsoft.com/ChannelMessage.Send');
        expect(st.requested_by_name).toBe('Cristian');
        expect(st.approved_at).toBeNull();
        expect(st.permissions).toContain('Publicar mensajes en canales de Teams');
        expect(Date.parse(st.expires_at!) - Date.now()).toBeGreaterThan(13 * 86_400_000);

        const again = await consent.create(tenantId, userId, 'teams');
        expect(again.url).toBe(st.url);
        // Outlook tiene su propio enlace (otros permisos).
        const outlook = await consent.create(tenantId, userId, 'outlook');
        expect(outlook.url).not.toBe(st.url);
        expect(new URL(outlook.url!).searchParams.get('scope')).toContain('https://graph.microsoft.com/Mail.Send');
    });

    it('la vuelta con admin_consent=True marca la aprobación y le habla al administrador', async () => {
        const st = await consent.status(tenantId, 'teams');
        const state = new URL(st.url!).searchParams.get('state')!;
        const out = await consent.complete({ state, adminConsent: 'True' });
        expect(out.tone).toBe('ok');
        expect(out.message).toContain('Microsoft Teams');
        expect(out.message).toContain('Cristian');

        const after = await consent.status(tenantId, 'teams');
        expect(after.approved_at).not.toBeNull();
        expect(after.url).toBeNull();
        expect(after.error).toBeNull();

        // Pedirlo de nuevo (p. ej. si el administrador lo revocó) crea otro enlace.
        const fresh = await consent.create(tenantId, userId, 'teams');
        expect(fresh.url).not.toBeNull();
        expect(new URL(fresh.url!).searchParams.get('state')).not.toBe(state);
    });

    it('v0.1.366 — una aprobación de ANTES del calendario de Teams sirve para los mensajes, no para las reuniones', async () => {
        // Un registro guardado por v0.1.363-0.1.365: sin `scopes`, aprobado.
        const legacy = {
            state: 'ac_viejo',
            url: 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?x',
            requested_by: userId,
            requested_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            approved_at: new Date().toISOString(),
            error: null,
        };
        await store.set(`msadmin:status:${tenantId}:teams`, JSON.stringify(legacy), 'EX', 3600);
        const st = await consent.status(tenantId, 'teams');
        expect(st.outdated).toBe(true);
        expect(st.missing_permissions).toEqual(['Ver, crear y cambiar eventos y reuniones en su calendario']);
        // Pedirlo de nuevo arma un enlace con TODOS los permisos de hoy, y al aprobarlo deja de estar desactualizado.
        const fresh = await consent.create(tenantId, userId, 'teams');
        expect(new URL(fresh.url!).searchParams.get('scope')).toContain('https://graph.microsoft.com/Calendars.ReadWrite');
        await consent.complete({ state: new URL(fresh.url!).searchParams.get('state')!, adminConsent: 'True' });
        const after = await consent.status(tenantId, 'teams');
        expect(after.outdated).toBe(false);
        expect(after.missing_permissions).toEqual([]);
    });

    it('si la cuenta no es administradora, queda el motivo y se explica qué rol hace falta', async () => {
        const st = await consent.status(tenantId, 'outlook');
        const state = new URL(st.url!).searchParams.get('state')!;
        const out = await consent.complete({
            state,
            error: 'access_denied',
            errorDescription: 'AADSTS90094: The grant requires admin permission.',
        });
        expect(out.tone).toBe('error');
        expect(out.message).toMatch(/administrador global/);
        expect(out.message).toContain('no es administradora');
        const after = await consent.status(tenantId, 'outlook');
        expect(after.approved_at).toBeNull();
        expect(after.error).toContain('AADSTS90094');
    });

    it('un enlace vencido o desconocido no rompe nada', async () => {
        expect((await consent.complete({ state: 'ac_desconocido' })).title).toBe('Este enlace ya no sirve');
        // Si Microsoft igual dice que se aprobó, la aprobación vale (es de Microsoft, no nuestra).
        expect((await consent.complete({ state: 'ac_desconocido', adminConsent: 'True' })).tone).toBe('ok');
        expect(describeError('invalid_request', 'AADSTS50011: The redirect URI does not match')).toMatch(/dirección de regreso/);
    });

    it('la página que ve el administrador escapa todo y no trae scripts', () => {
        const html = renderAdminConsentPage({ tone: 'error', title: 'Título <b>', message: '<script>alert(1)</script> "x"' });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot;');
        expect(html).toContain('Título &lt;b&gt;');
    });

    it('la vuelta de una aprobación pasa sin sesión; cualquier otra vuelta la exige', async () => {
        const sessions = { get: async () => null } as unknown as SessionService;
        const guard = new OAuthCallbackGuard(sessions);
        const ctx = (query: Record<string, string>): ExecutionContext =>
            ({ switchToHttp: () => ({ getRequest: () => ({ url: '/api/v1/connections/oauth/callback', query, headers: {}, cookies: {} }) }) }) as unknown as ExecutionContext;
        expect(await guard.canActivate(ctx({ state: 'ac_abc', admin_consent: 'True' }))).toBe(true);
        await expect(Promise.resolve(guard.canActivate(ctx({ state: 'otro', code: 'x' })))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('una conexión que vuelve con error dice de qué app era (sólo a quien la inició, una vez)', async () => {
        const { authorize_url } = await connectors.startIntegrationOAuth(tenantId, userId, 'admin', 'teams', { visibility: 'workspace' });
        const state = new URL(authorize_url).searchParams.get('state')!;
        expect(await connectors.abandonOAuth(userId + 999, state)).toEqual({ integration: null, purpose: null });

        const { authorize_url: url2 } = await connectors.startIntegrationOAuth(tenantId, userId, 'admin', 'teams', { visibility: 'workspace' });
        const state2 = new URL(url2).searchParams.get('state')!;
        expect(await connectors.abandonOAuth(userId, state2)).toEqual({ integration: 'teams', purpose: null });
        expect(await connectors.abandonOAuth(userId, state2)).toEqual({ integration: null, purpose: null });
    });
});
