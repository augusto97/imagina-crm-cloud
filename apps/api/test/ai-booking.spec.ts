import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ConversationsStore } from '../src/ai/conversations.store';
import { McpService } from '../src/ai/mcp.service';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { BookingTools } from '../src/ai/tools/booking-tools';
import { AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { BookingAvailabilityService } from '../src/booking/booking-availability.service';
import { BookingService } from '../src/booking/booking.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { PublicListsService } from '../src/public-lists/public-lists.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { loadEnv } from '../src/config/env';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { bookingPages, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
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

function json(res: unknown): Record<string, unknown> {
    const content = (res as { content: Array<{ type: string; text: string }> }).content;
    return JSON.parse(content[0]!.text) as Record<string, unknown>;
}
const isError = (res: unknown): boolean => Boolean((res as { isError?: boolean }).isError);

/**
 * D5 — La agenda de citas por el asistente/MCP: `propose_configure_booking_page`
 * arma una página en el vocabulario de quien la pide (servicios, quién atiende
 * con su horario, reglas, qué campo guarda cada dato), valida contra la lista
 * REAL (slugs, tipos, personas que pueden atender) y aplicar pasa por
 * BookingService. get_list_schema la describe.
 */
describe('Asistente/MCP: agenda de citas', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let tenantId: number;
    let adminId: number;
    let viewerId: number;
    let client: Client;
    let readClient: Client;

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const records = new RecordsService(tenantDb, new RecordsRepository(), lists, fields, rt, activity, new AutomationDispatcher(), new RelationsRepository());
        const dashboards = new DashboardsService(tenantDb, null as never, records, fields);
        const blueprint = new BlueprintService(tenantDb, lists, fields, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        const store = new ProposalsStore(redis);
        const comments = new CommentsService(tenantDb, new CommentsRepository(), lists, records, rt);
        const publicLists = new PublicListsService(pg.db, tenantDb, lists, null as never);
        const booking = new BookingService(pg.db, tenantDb, lists, fields, new BookingAvailabilityService(tenantDb, null as never));
        const structure = new StructureTools(
            tenantDb,
            lists,
            fields,
            views,
            automations,
            dashboards,
            blueprint,
            store,
            connectors,
            comments,
            publicLists,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            booking,
        );
        const bookingTools = new BookingTools(lists, fields, booking, store);
        const registry = new AiToolRegistry();
        structure.registerInto(registry);
        bookingTools.registerInto(registry);
        const proposals = new ProposalsService(store, new ConversationsStore(redis), structure, new AuditService(tenantDb), undefined, undefined, bookingTools);
        const mcp = new McpService(registry, proposals);

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'citas', name: 'Consultorio', plan: 'pro', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        const [ua] = await pg.db.insert(users).values({ email: 'admin@citas.local', name: 'Dra. Ruiz', passwordHash: 'x' }).returning();
        const [uv] = await pg.db.insert(users).values({ email: 'viewer@citas.local', name: 'Vera', passwordHash: 'x' }).returning();
        adminId = ua!.id;
        viewerId = uv!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: viewerId, role: 'viewer' },
        ]);
        const citas = await lists.create(tenantId, { name: 'Citas' });
        await fields.create(tenantId, String(citas.id), { label: 'Paciente', type: 'text', slug: 'paciente' });
        await fields.create(tenantId, String(citas.id), { label: 'Email', type: 'email', slug: 'email' });
        await fields.create(tenantId, String(citas.id), { label: 'Fecha', type: 'datetime', slug: 'fecha' });
        await fields.create(tenantId, String(citas.id), { label: 'Doctora', type: 'user', slug: 'doctora' });
        await fields.create(tenantId, String(citas.id), { label: 'Servicio', type: 'select', slug: 'servicio', config: { options: [] } });
        await fields.create(tenantId, String(citas.id), { label: 'Estado', type: 'select', slug: 'estado', config: { options: [] } });
        await fields.create(tenantId, String(citas.id), { label: 'Motivo', type: 'long_text', slug: 'motivo' });

        const connect = async (ctx: AiToolContext, scope: 'full' | 'read'): Promise<Client> => {
            const server = mcp.buildServer(ctx, scope, '0.0.0-test');
            const [clientT, serverT] = InMemoryTransport.createLinkedPair();
            await server.connect(serverT);
            const c = new Client({ name: 'spec', version: '0' });
            await c.connect(clientT);
            return c;
        };
        client = await connect({ tenantId, userId: adminId, role: 'admin' }, 'full');
        readClient = await connect({ tenantId, userId: adminId, role: 'admin' }, 'read');
    }, 180_000);

    afterAll(async () => {
        await client?.close();
        await readClient?.close();
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    const call = (name: string, args: Record<string, unknown> = {}): Promise<unknown> => client.callTool({ name, arguments: args });
    const apply = async (proposalId: unknown): Promise<Record<string, unknown>> => json(await call('apply_proposal', { proposal_id: proposalId }));
    const weekdays = { mon: ['08:00-12:00'], tue: ['08:00-12:00'], wed: ['08:00-12:00'], thu: ['08:00-12:00'], fri: ['08:00-12:00'] };
    const spec = (over: Record<string, unknown> = {}) => ({
        list: 'citas',
        name: 'Agenda del consultorio',
        title: 'Pide tu cita',
        services: [
            { name: 'Consulta', duration_min: 30 },
            { name: 'Control', duration_min: 20 },
        ],
        staff: [{ user_id: adminId, schedule: { mon: ['08:00-12:00', '14:00-18:00'], tue: ['08:00-12:00'], sat: ['09:00-13:00'] } }, { resource: 'Consultorio 2', services: ['Control'] }],
        rules: { buffer_after_min: 10, max_per_day: 8 },
        writes: { start: 'fecha', person: 'doctora', service: 'servicio', client_name: 'paciente', client_email: 'email', status: 'estado' },
        questions: ['motivo'],
        ...over,
    });

    it('valida contra la lista real: campo inexistente, tipo equivocado, persona que no puede atender', async () => {
        const bad = await call('propose_configure_booking_page', spec({ writes: { start: 'no_existe' } }));
        expect(isError(bad)).toBe(true);
        expect(json(bad).error).toContain('no existe');
        const wrongType = await call('propose_configure_booking_page', spec({ writes: { start: 'paciente' } }));
        expect(isError(wrongType)).toBe(true);
        expect(json(wrongType).error).toContain('datetime');
        const viewer = await call('propose_configure_booking_page', spec({ staff: [{ user_id: viewerId }] }));
        expect(isError(viewer)).toBe(true);
        expect(json(viewer).error).toContain('no puede atender');
        const noService = await call('propose_configure_booking_page', spec({ staff: [{ user_id: adminId, services: ['Masaje'] }] }));
        expect(isError(noService)).toBe(true);
        // Con un recurso pero sin campo donde guardarlo no se puede publicar.
        const cantPublish = await call('propose_configure_booking_page', spec({ publish: true }));
        expect(isError(cantPublish)).toBe(true);
        expect(json(cantPublish).error).toContain('recurso');
    });

    it('propone → aplica: la página queda armada, se publica y get_list_schema la describe', async () => {
        const proposed = json(await call('propose_configure_booking_page', spec({ staff: [{ user_id: adminId, schedule: weekdays }] })));
        expect(proposed.ok).toBe(true);
        const out = await apply(proposed.proposal_id);
        expect(JSON.stringify(out)).toContain('sin publicar');
        const [page] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(bookingPages));
        const cfg = page!.config as {
            services: Array<{ name: string }>;
            staff: Array<{ staff_user_id: number; availability: { week: Array<Array<{ start: string; end: string }>> } }>;
            questions: unknown[];
        };
        expect(cfg.services.map((s) => s.name)).toEqual(['Consulta', 'Control']);
        expect(cfg.staff[0]!.staff_user_id).toBe(adminId);
        expect(cfg.staff[0]!.availability.week[1]).toEqual([{ start: '08:00', end: '12:00' }]);
        expect(cfg.staff[0]!.availability.week[6]).toEqual([]);
        expect(cfg.questions).toHaveLength(1);

        // Publicarla (la misma página, por nombre).
        const pub = json(await call('propose_configure_booking_page', { list: 'citas', page: 'Agenda del consultorio', publish: true }));
        expect(pub.ok).toBe(true);
        await apply(pub.proposal_id);
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(bookingPages));
        expect(after!.enabled).toBe(true);
        expect(after!.id).toBe(page!.id);

        const schema = json(await call('get_list_schema', { list: 'citas' }));
        const pages = schema.booking_pages as Array<Record<string, unknown>>;
        expect(pages).toHaveLength(1);
        expect(pages[0]).toMatchObject({ name: 'Agenda del consultorio', published: true, writes: { start: 'fecha', person: 'doctora' } });
        expect(pages[0]!.services).toEqual([
            expect.objectContaining({ name: 'Consulta', duration_min: 30 }),
            expect.objectContaining({ name: 'Control', duration_min: 20 }),
        ]);
    });

    it('con el alcance de sólo lectura no se ofrece la herramienta', async () => {
        const tools = await readClient.listTools();
        expect(tools.tools.map((t) => t.name)).not.toContain('propose_configure_booking_page');
        expect(tools.tools.map((t) => t.name)).toContain('get_list_schema');
    });
});
