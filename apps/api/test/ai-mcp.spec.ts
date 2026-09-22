import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ConversationsStore } from '../src/ai/conversations.store';
import { McpService } from '../src/ai/mcp.service';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { PersonalTokensService, TOKEN_PREFIX, hashToken } from '../src/ai/tokens.service';
import { DataTools } from '../src/ai/tools/data-tools';
import { AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { loadEnv } from '../src/config/env';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { memberships, personalAccessTokens, tenants, users } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

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

/** Texto del primer bloque de un resultado MCP, parseado como JSON. */
function json(res: unknown): Record<string, unknown> {
    const content = (res as { content: Array<{ type: string; text: string }> }).content;
    return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe('Tokens de acceso personal + servidor MCP (ADR-S21 fase 3, Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let tokens: PersonalTokensService;
    let mcp: McpService;
    let lists: ListsService;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let viewerId: number;

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps()));
        const plans = new PlansService(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const records = new RecordsService(
            tenantDb, new RecordsRepository(), lists, fields, rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists), new AutomationDispatcher(), new RelationsRepository(),
        );
        const dashboards = new DashboardsService(tenantDb, null as never, records, fields);
        const blueprint = new BlueprintService(tenantDb, lists, fields, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        const store = new ProposalsStore(redis);
        const structure = new StructureTools(tenantDb, lists, fields, views, automations, dashboards, blueprint, store, new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps()), null as never, null as never);
        const data = new DataTools(lists, fields, records, new AggregateService(tenantDb, lists, fields), store);
        const registry = new AiToolRegistry();
        structure.registerInto(registry);
        data.registerInto(registry);
        const proposals = new ProposalsService(store, new ConversationsStore(redis), structure, new AuditService(tenantDb), data);
        mcp = new McpService(registry, proposals);
        tokens = new PersonalTokensService(pg.db);

        const [t] = await pg.db.insert(tenants).values({ slug: 'mcp', name: 'MCP SA', plan: 'pro' }).returning();
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'pro' }).returning();
        tenantId = t!.id;
        otherTenantId = o!.id;
        const [ua] = await pg.db.insert(users).values({ email: 'admin@mcp.local', name: 'Admin', passwordHash: 'x' }).returning();
        const [uv] = await pg.db.insert(users).values({ email: 'viewer@mcp.local', name: 'Viewer', passwordHash: 'x' }).returning();
        adminId = ua!.id;
        viewerId = uv!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: viewerId, role: 'viewer' },
        ]);
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    async function connect(ctx: AiToolContext, scope: 'read' | 'full'): Promise<Client> {
        const server = mcp.buildServer(ctx, scope, '0.0.0-test');
        const [clientT, serverT] = InMemoryTransport.createLinkedPair();
        await server.connect(serverT);
        const client = new Client({ name: 'spec', version: '0' });
        await client.connect(clientT);
        return client;
    }

    it('token: secreto con prefijo que sólo se ve al crear; la fila guarda el hash; el listado no lo expone', async () => {
        const created = await tokens.create(adminId, tenantId, { name: 'Claude notebook', scope: 'full', expires_in_days: 90 }, 'admin');
        expect(created.secret.startsWith(TOKEN_PREFIX)).toBe(true);
        expect(created.secret.length).toBeGreaterThan(40);
        expect(created.token).toMatchObject({ name: 'Claude notebook', scope: 'full', tenant_id: tenantId });
        expect(created.token.prefix.startsWith(TOKEN_PREFIX)).toBe(true);
        expect(created.token.expires_at).not.toBeNull();
        const [row] = await pg.db.select().from(personalAccessTokens).where(eq(personalAccessTokens.id, created.token.id));
        expect(row!.tokenHash).toBe(hashToken(created.secret));
        expect(JSON.stringify(row)).not.toContain(created.secret.slice(10));
        const listed = await tokens.list(adminId, tenantId);
        expect(listed.map((t) => t.id)).toContain(created.token.id);
        expect(JSON.stringify(listed)).not.toContain(created.secret.slice(10));
        // Otro workspace del mismo usuario no lo lista.
        expect(await tokens.list(adminId, otherTenantId)).toHaveLength(0);

        // Resolver → identidad + rol EN VIVO + scope.
        const resolved = await tokens.resolve(created.secret);
        expect(resolved).toMatchObject({ userId: adminId, tenantId, role: 'admin', scope: 'full', tokenId: created.token.id });
        expect(await tokens.resolve('ib_pat_no-existe-000000000000000000000000')).toBeNull();
        expect(await tokens.resolve('otra-cosa')).toBeNull();

        // Revocar → deja de resolver y desaparece del listado; revocar dos veces → 404.
        await tokens.revoke(adminId, tenantId, created.token.id);
        expect(await tokens.resolve(created.secret)).toBeNull();
        expect((await tokens.list(adminId, tenantId)).some((t) => t.id === created.token.id)).toBe(false);
        await expect(tokens.revoke(adminId, tenantId, created.token.id)).rejects.toMatchObject({ status: 404 });
    });

    it('token vencido, usuario desactivado o sin membresía → inválido (fail-closed)', async () => {
        const exp = await tokens.create(adminId, tenantId, { name: 'viejo', scope: 'read', expires_in_days: 7 }, 'admin');
        await pg.db.update(personalAccessTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(personalAccessTokens.id, exp.token.id));
        expect(await tokens.resolve(exp.secret)).toBeNull();

        const [u] = await pg.db.insert(users).values({ email: 'temp@mcp.local', name: 'Temp', passwordHash: 'x' }).returning();
        await pg.db.insert(memberships).values({ tenantId, userId: u!.id, role: 'manager' });
        const tk = await tokens.create(u!.id, tenantId, { name: 'temp', scope: 'read', expires_in_days: null }, 'manager');
        expect((await tokens.resolve(tk.secret))?.role).toBe('manager');
        // Cambio de rol → el token lo refleja (no queda congelado).
        await pg.db.update(memberships).set({ role: 'agent' }).where(eq(memberships.userId, u!.id));
        expect((await tokens.resolve(tk.secret))?.role).toBe('agent');
        // Cuenta desactivada → null.
        await pg.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, u!.id));
        expect(await tokens.resolve(tk.secret)).toBeNull();
        await pg.db.update(users).set({ disabledAt: null }).where(eq(users.id, u!.id));
        // Sin membresía → null aunque el token exista.
        await pg.db.delete(memberships).where(eq(memberships.userId, u!.id));
        expect(await tokens.resolve(tk.secret)).toBeNull();
    });

    it('MCP: las herramientas dependen del scope y del rol', async () => {
        const admin: AiToolContext = { tenantId, userId: adminId, role: 'admin' };
        const read = await connect(admin, 'read');
        const readNames = (await read.listTools()).tools.map((t) => t.name).sort();
        expect(readNames).toEqual([
            'aggregate_records', 'get_list_schema', 'list_automation_runs', 'list_dashboards',
            'list_lists', 'list_members', 'list_record_comments', 'query_records',
        ]);
        await read.close();

        const full = await connect(admin, 'full');
        const fullNames = (await full.listTools()).tools.map((t) => t.name);
        expect(fullNames).toContain('propose_create_list');
        expect(fullNames).toContain('propose_update_records');
        expect(fullNames).toContain('apply_proposal');
        const create = (await full.listTools()).tools.find((t) => t.name === 'propose_create_list')!;
        expect(create.description).toContain('apply_proposal');
        expect((create.inputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('lists');
        await full.close();

        // Un viewer con scope full: sólo lectura igual (su rol no propone nada).
        const viewer = await connect({ tenantId, userId: viewerId, role: 'viewer' }, 'full');
        const viewerNames = (await viewer.listTools()).tools.map((t) => t.name).sort();
        // Un viewer no tiene `manage_automations`, así que `list_automation_runs`
        // sigue afuera aunque su token sea `full`.
        expect(viewerNames).toEqual([
            'aggregate_records', 'apply_proposal', 'get_list_schema', 'list_dashboards',
            'list_lists', 'list_members', 'list_record_comments', 'query_records',
        ]);
        await viewer.close();
    });

    it('MCP end-to-end: list_lists → propose_create_list → apply_proposal crea la lista; re-aplicar y un id inválido son errores', async () => {
        const admin: AiToolContext = { tenantId, userId: adminId, role: 'admin' };
        const client = await connect(admin, 'full');
        const before = json(await client.callTool({ name: 'list_lists', arguments: {} }));
        expect(before.lists).toEqual([]);

        const proposed = await client.callTool({
            name: 'propose_create_list',
            arguments: { lists: [{ name: 'Proveedores MCP', fields: [{ label: 'Nombre', type: 'text', is_required: true }, { label: 'Activo', type: 'checkbox' }] }] },
        });
        expect((proposed as { isError?: boolean }).isError).toBeFalsy();
        const p = json(proposed);
        expect(p.ok).toBe(true);
        expect(typeof p.proposal_id).toBe('string');
        expect((p.proposal as { kind: string }).kind).toBe('create_list');
        // Nada existe todavía.
        expect(await lists.list(tenantId)).toHaveLength(0);

        const applied = json(await client.callTool({ name: 'apply_proposal', arguments: { proposal_id: p.proposal_id } }));
        expect(applied.applied).toBe(true);
        expect((applied.result as { message: string }).message).toContain('creada');
        const after = await lists.list(tenantId);
        expect(after.map((l) => l.name)).toEqual(['Proveedores MCP']);

        const again = await client.callTool({ name: 'apply_proposal', arguments: { proposal_id: p.proposal_id } });
        expect((again as { isError?: boolean }).isError).toBe(true);
        expect(json(again).error).toContain('ya se aplicó');
        const bogus = await client.callTool({ name: 'apply_proposal', arguments: { proposal_id: 'nope-nope-nope' } });
        expect((bogus as { isError?: boolean }).isError).toBe(true);

        // Un error corregible de herramienta viaja como isError, no como excepción.
        const bad = await client.callTool({ name: 'get_list_schema', arguments: { list: 'inexistente' } });
        expect((bad as { isError?: boolean }).isError).toBe(true);
        expect(json(bad).error).toContain('no existe');
        // Y una lectura normal funciona con el esquema recién creado.
        const schema = json(await client.callTool({ name: 'get_list_schema', arguments: { list: 'proveedores_mcp' } }));
        expect((schema.fields as Array<{ slug: string }>).map((f) => f.slug)).toEqual(['nombre', 'activo']);
        await client.close();
    });
});
