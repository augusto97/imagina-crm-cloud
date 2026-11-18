import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { IntegrationCatalogService } from '../src/connectors/integration-catalog.service';
import { connections, tenants, users } from '../src/db/schema';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.438 — Qué apps se ofrecen a las empresas: lo de fábrica (beta, ocultas,
 * en retiro), lo que cambia el operador y cómo lo respeta la app al conectar.
 */
describe('Catálogo de integraciones (v0.1.438)', () => {
    let pg: TestPg;
    let store: ReturnType<typeof memoryOAuthStore>;
    let catalog: IntegrationCatalogService;
    let svc: ConnectorsService;
    let tenantId: number;
    let userId: number;
    let operatorId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ PLATFORM_SUPERADMINS: 'operador@plataforma.test', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        store = memoryOAuthStore();
        catalog = new IntegrationCatalogService(store, pg.db);
        svc = new ConnectorsService(
            tenantDb,
            pg.db,
            env,
            store,
            new AuditService(tenantDb),
            new IntegrationAppsService(store, env),
            undefined,
            undefined,
            undefined,
            catalog,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [archived] = await pg.db
            .insert(tenants)
            .values({ slug: 'vieja', name: 'Vieja', archivedAt: new Date() })
            .returning();
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        userId = u!.id;
        const [op] = await pg.db
            .insert(users)
            .values({ email: 'operador@plataforma.test', passwordHash: 'x', name: 'Operador' })
            .returning();
        operatorId = op!.id;

        await pg.db.insert(connections).values([
            { tenantId, provider: 'sms_twilio', name: 'Twilio uno' },
            { tenantId, provider: 'sms_twilio', name: 'Twilio dos' },
            { tenantId, provider: 'whatsapp', name: 'WAS de antes' },
            { tenantId: archived!.id, provider: 'sms_twilio', name: 'Twilio archivada' },
        ]);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('lista cada app con su estado de fábrica y cuántas empresas vivas la tienen', async () => {
        const list = await catalog.list();
        const twilio = list.find((i) => i.key === 'sms_twilio')!;
        expect(twilio).toMatchObject({ stage: 'beta', hidden: false, customized: false, tenants: 1, connections: 2 });
        const was = list.find((i) => i.key === 'whatsapp')!;
        expect(was).toMatchObject({ stage: 'retiring', hidden: true, replacement: 'whatsapp_web', tenants: 1, connections: 1 });
        expect(list.find((i) => i.key === 'whatsapp_web')).toMatchObject({ stage: 'stable', hidden: false });
    });

    it('la galería de la empresa trae la política de cada app', async () => {
        const overview = await svc.integrationsOverview(tenantId, userId, 'admin');
        expect(overview.catalog.sms_infobip).toEqual({ stage: 'beta', hidden: true });
        expect(overview.catalog.whatsapp_web).toEqual({ stage: 'stable', hidden: false });
    });

    it('una app oculta no se conecta nueva, salvo el operador o al reconectar una que ya existe', async () => {
        await expect(svc.assertIntegrationOffered(userId, 'sms_infobip', null)).rejects.toMatchObject({
            response: { code: 'integration_hidden', data: { status: 403 } },
        });
        await expect(svc.assertIntegrationOffered(operatorId, 'sms_infobip', null)).resolves.toBeUndefined();
        await expect(svc.assertIntegrationOffered(userId, 'sms_infobip', 42)).resolves.toBeUndefined();
        await expect(svc.assertIntegrationOffered(userId, 'sms_twilio', null)).resolves.toBeUndefined();
    });

    it('el operador la muestra, la marca probada y vuelve a lo de fábrica', async () => {
        let item = await catalog.update('sms_infobip', { hidden: false, beta: false });
        expect(item).toMatchObject({ hidden: false, stage: 'stable', customized: true });
        await expect(svc.assertIntegrationOffered(userId, 'sms_infobip', null)).resolves.toBeUndefined();

        // Lo guardado son sólo las diferencias.
        expect(JSON.parse((await store.get('platform:integration-catalog'))!)).toEqual({
            overrides: { sms_infobip: { hidden: false, beta: false } },
        });

        // Otro proceso que arranca lee lo guardado.
        const other = new IntegrationCatalogService(store, pg.db);
        expect(await other.policy('sms_infobip')).toEqual({ stage: 'stable', hidden: false });

        item = await catalog.update('sms_infobip', { hidden: null, beta: null });
        expect(item).toMatchObject({ hidden: true, stage: 'beta', customized: false });
        expect(JSON.parse((await store.get('platform:integration-catalog'))!)).toEqual({ overrides: {} });
    });

    it('un valor roto en Redis no deja la galería vacía', async () => {
        await store.set('platform:integration-catalog', '{no es json');
        const fresh = new IntegrationCatalogService(store, pg.db);
        expect(await fresh.policy('sms_twilio')).toEqual({ stage: 'beta', hidden: false });
        await store.del('platform:integration-catalog');
    });
});
