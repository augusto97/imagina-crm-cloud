import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAPABILITIES_BY_ROLE, type Field } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AiController } from '../src/ai/ai.controller';
import { PersonalTokensController } from '../src/ai/tokens.controller';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsController } from '../src/automations/automations.controller';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import {
    connectionModuleStepError,
    moduleForIntegration,
    planIncludesSql,
    planModuleOff,
    planModuleStepError,
} from '../src/billing/plan-module-gate';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsController } from '../src/connectors/connectors.controller';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { automationRuns, connections, customRoles, memberships, plans, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DomainsService } from '../src/domains/domains.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { FormsController } from '../src/forms/forms.controller';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import { PortalController } from '../src/portal/portal.controller';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { CustomRolesController } from '../src/roles/custom-roles.controller';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard, type TenantContext } from '../src/tenancy/tenant.guard';
import { WorkspacesController } from '../src/workspaces/workspaces.controller';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.338 (ADR-S87) — Módulos del plan: lo que el plan NO incluye responde
 * 403 `plan_module_disabled` por HTTP, no corre solo y no se sirve hacia
 * afuera. Lo configurado nunca se toca: al volver a incluirlo, sigue igual.
 */

class FakeHookStore implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

const rt = new RealtimeService();
const filesStub = { signedLogoUrl: () => null } as never;

describe('Módulos del plan (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let guard: TenantGuard;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let domains: DomainsService;
    let tenantId: number;
    let adminId: number;
    let agentId: number;
    let estado: Field;
    let monto: Field;
    const PLAN = 'basico';

    const env = loadEnv({
        SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea',
        PUBLIC_BASE_DOMAIN: 'app.imaginabase.com',
        APP_BASE_URL: 'https://app.imaginabase.com',
    });

    async function setDisabled(mods: string[]): Promise<void> {
        await pg.db.update(plans).set({ disabledModules: mods }).where(eq(plans.slug, PLAN));
    }

    /** Corre el guard como lo haría Nest con el handler y el controller reales. */
    async function guardFor(
        cls: abstract new (...args: never[]) => unknown,
        method: string | null,
        userId = adminId,
    ): Promise<TenantContext> {
        const handler = method ? (cls.prototype as Record<string, unknown>)[method] : function handler(): void {};
        expect(handler, `${cls.name}.${method ?? '(clase)'}`).toBeTypeOf('function');
        const req = { authUserId: userId, headers: { 'x-tenant-id': String(tenantId) }, method: 'GET' } as Record<string, unknown>;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => handler,
            getClass: () => cls,
        } as unknown as ExecutionContext;
        await guard.canActivate(ctx);
        return req.tenant as TenantContext;
    }

    async function expectModuleOff(p: Promise<unknown>, module: string): Promise<void> {
        await expect(p).rejects.toMatchObject({
            response: { code: 'plan_module_disabled', data: { status: 403, module } },
        });
    }

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        guard = new TenantGuard(tenantDb, new Reflector());
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, new AutomationDispatcher(), new RelationsRepository());
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        autos = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), { name: 'capture', send: () => Promise.resolve() }),
            connectors,
        );
        domains = new DomainsService(pg.db, env, filesStub);

        await new PlansService(pg.db).create({
            slug: PLAN,
            name: 'Básico',
            max_records: null,
            max_users: null,
            max_automations: null,
            max_storage_mb: null,
            max_emails_month: null,
            max_ai_requests_month: null,
            max_guests: null,
            price_usd: null,
            price_cop: null,
            is_active: true,
        });
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'Acme', plan: PLAN, status: 'active', customDomain: 'crm.acme.com' })
            .returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'ana@acme.test', name: 'Ana', passwordHash: 'x' }).returning();
        const [b] = await pg.db.insert(users).values({ email: 'beto@acme.test', name: 'Beto', passwordHash: 'x' }).returning();
        adminId = a!.id;
        agentId = b!.id;
        const [role] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(customRoles)
                .values({ tenantId, name: 'Exportador', baseRole: 'agent', capabilities: ['export_records'] })
                .returning(),
        );
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: adminId, role: 'admin' },
                { tenantId, userId: agentId, role: 'agent', customRoleId: role!.id },
            ]),
        );
        await lists.create(tenantId, { name: 'Deals' });
        monto = await fieldsSvc.create(tenantId, 'deals', { label: 'Monto', type: 'currency', slug: 'monto' });
        estado = await fieldsSvc.create(tenantId, 'deals', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'nueva', label: 'Nueva' }, { value: 'vip', label: 'VIP' }] },
        });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('lo puro: el módulo de cada app y el de cada conexión', () => {
        expect(moduleForIntegration('woocommerce')).toBe('woocommerce');
        expect(moduleForIntegration('wordpress')).toBe('wordpress');
        expect(moduleForIntegration('sqlserver')).toBe('sql');
        expect(moduleForIntegration('whatsapp_cloud')).toBe('integrations');
        expect(moduleForIntegration(null)).toBe('integrations');
        // El almacenamiento propio también es «Integraciones» (como dice su descripción).
        expect(moduleForIntegration('s3')).toBe('integrations');
        expect(moduleForIntegration('google_drive')).toBe('integrations');
        expect(moduleForIntegration('http')).toBe('integrations');
    });

    it('HTTP: cada módulo apagado responde 403 plan_module_disabled; lo demás sigue', async () => {
        await setDisabled(['automations', 'ai', 'integrations', 'forms', 'portal', 'custom_domain', 'api', 'custom_roles']);

        await expectModuleOff(guardFor(AutomationsController, null), 'automations');
        await expectModuleOff(guardFor(AiController, 'chat'), 'ai');
        await expectModuleOff(guardFor(ConnectorsController, 'create'), 'integrations');
        await expectModuleOff(guardFor(FormsController, null), 'forms');
        await expectModuleOff(guardFor(PortalController, 'access'), 'portal');
        await expectModuleOff(guardFor(WorkspacesController, 'getDomain'), 'custom_domain');
        await expectModuleOff(guardFor(PersonalTokensController, 'create'), 'api');
        await expectModuleOff(guardFor(CustomRolesController, null), 'custom_roles');

        // El estado del asistente, la lista de conexiones y los tokens existentes
        // se siguen leyendo (la app explica qué falta en vez de romperse).
        const ctx = await guardFor(AiController, 'status');
        expect(ctx.disabledModules).toEqual(expect.arrayContaining(['automations', 'ai']));
        await guardFor(ConnectorsController, 'all');
        await guardFor(PersonalTokensController, 'list');
    });

    it('roles propios: sin el módulo la persona usa su rol base; con el módulo, el propio', async () => {
        await setDisabled(['custom_roles']);
        const off = await guardFor(AiController, 'status', agentId);
        expect(off.customRoleId).toBeNull();
        expect([...off.capabilities].sort()).toEqual([...CAPABILITIES_BY_ROLE.agent].sort());

        await setDisabled([]);
        const on = await guardFor(AiController, 'status', agentId);
        expect(on.customRoleId).not.toBeNull();
        expect(on.capabilities).toContain('export_records');
    });

    it('al volver a incluir el módulo, el acceso vuelve', async () => {
        await setDisabled(['automations']);
        await expectModuleOff(guardFor(AutomationsController, null), 'automations');
        await setDisabled([]);
        const ctx = await guardFor(AutomationsController, null);
        expect(ctx.disabledModules).toEqual([]);
    });

    it('hacia afuera: el webhook entrante y el dominio propio responden como desconocidos sin el módulo', async () => {
        const auto = await autos.create(tenantId, 'deals', {
            name: 'Formulario externo',
            trigger_type: 'incoming_webhook',
            actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
        });
        const token = String((auto.trigger_config as Record<string, unknown>).webhook_token ?? '');
        expect(token.length).toBeGreaterThan(15);

        await setDisabled(['automations', 'custom_domain']);
        expect(await autos.resolveHookToken(token)).toBeNull();
        expect((await domains.resolveHost('crm.acme.com')).tenant).toBeNull();
        expect(await domains.baseUrlFor(tenantId)).toBe('https://app.imaginabase.com');

        await setDisabled([]);
        expect(await autos.resolveHookToken(token)).toMatchObject({ tenantId, readOnly: false });
        expect((await domains.resolveHost('crm.acme.com')).tenant).not.toBeNull();
        // Lo configurado no se tocó.
        const [row] = await pg.db.select({ d: tenants.customDomain }).from(tenants).where(eq(tenants.id, tenantId));
        expect(row?.d).toBe('crm.acme.com');
    });

    it('lo que corre solo: sin «Automatizaciones» el motor no ejecuta nada; al volver, sí', async () => {
        await autos.create(tenantId, 'deals', {
            name: 'Marcar VIP',
            trigger_type: 'record_created',
            actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
        });
        const admin: Actor = { userId: adminId, role: 'admin' };
        const runsCount = async () =>
            Number(
                (
                    await withTenant(pg.db, tenantId, (tx) =>
                        tx.select({ n: sql<number>`count(*)::int` }).from(automationRuns).where(eq(automationRuns.tenantId, tenantId)),
                    )
                )[0]?.n ?? 0,
            );
        const estadoOf = async (id: number) => {
            const [r] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, id)));
            return (r?.data as Record<string, unknown>)[`f${estado.id}`];
        };

        await setDisabled(['automations']);
        const before = await runsCount();
        const r1 = await recs.create(tenantId, admin, 'deals', { data: { [`f${monto.id}`]: 10, [`f${estado.id}`]: 'nueva' } });
        await engine.process({ tenantId, listId: r1.list_id, recordId: r1.id, trigger: 'record_created', after: r1.data });
        expect(await runsCount()).toBe(before);
        expect(await estadoOf(r1.id)).toBe('nueva');

        await setDisabled([]);
        const r2 = await recs.create(tenantId, admin, 'deals', { data: { [`f${monto.id}`]: 20, [`f${estado.id}`]: 'nueva' } });
        await engine.process({ tenantId, listId: r2.list_id, recordId: r2.id, trigger: 'record_created', after: r2.data });
        expect(await runsCount()).toBeGreaterThan(before);
        expect(await estadoOf(r2.id)).toBe('vip');
    });

    it('acciones y barridos: el paso falla con el motivo y el barrido saltea a la empresa', async () => {
        await setDisabled(['documents']);
        expect(await planModuleOff(pg.db, tenantId, 'documents')).toBe(true);
        expect(await planModuleOff(pg.db, tenantId, 'forms')).toBe(false);
        expect(await planModuleStepError(pg.db, tenantId, 'documents')).toMatch(/Tu plan no incluye «Documentos PDF»/);
        expect(await planModuleStepError(pg.db, tenantId, 'forms')).toBeNull();
        // Una empresa que no existe cuenta como apagada (falla cerrado).
        expect(await planModuleOff(pg.db, 999_999, 'forms')).toBe(true);

        const rows = await pg.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(sql`${tenants.id} = ${tenantId} AND ${planIncludesSql(tenants.id, 'documents')}`);
        expect(rows).toHaveLength(0);
        await setDisabled([]);
        const again = await pg.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(sql`${tenants.id} = ${tenantId} AND ${planIncludesSql(tenants.id, 'documents')}`);
        expect(again).toHaveLength(1);
    });

    it('una conexión usada en un paso falla con el módulo de SU app (no con el de las integraciones en general)', async () => {
        const [woo, custom, s3] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values([
                    { tenantId, provider: 'woocommerce', name: 'Tienda' },
                    { tenantId, provider: 'http', name: 'API propia' },
                    { tenantId, provider: 's3', name: 'Bucket' },
                ])
                .returning({ id: connections.id }),
        );
        await setDisabled(['woocommerce']);
        expect(await connectionModuleStepError(pg.db, tenantId, woo!.id)).toMatch(/Tu plan no incluye «Tienda WooCommerce»/);
        expect(await connectionModuleStepError(pg.db, tenantId, custom!.id)).toBeNull();
        await setDisabled(['integrations']);
        expect(await connectionModuleStepError(pg.db, tenantId, woo!.id)).toBeNull();
        expect(await connectionModuleStepError(pg.db, tenantId, custom!.id)).toMatch(/Tu plan no incluye «Integraciones»/);
        // El almacenamiento propio cuenta como «Integraciones»; una conexión que no existe no se decide aquí.
        expect(await connectionModuleStepError(pg.db, tenantId, s3!.id)).toMatch(/Tu plan no incluye «Integraciones»/);
        expect(await connectionModuleStepError(pg.db, tenantId, 999_999)).toBeNull();
        await setDisabled([]);
    });
});
