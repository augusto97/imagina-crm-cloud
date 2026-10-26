import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Redis from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ConversationsStore } from '../src/ai/conversations.store';
import { McpService } from '../src/ai/mcp.service';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
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
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { memberships, savedViews, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { PublicListsService } from '../src/public-lists/public-lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { DependenciesRepository } from '../src/records/dependencies.repository';
import { DependenciesService } from '../src/records/dependencies.service';
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
 * B2 desde el asistente/MCP y las plantillas: proponer y cambiar una vista
 * «Carga de trabajo» (persona, fechas, qué se mide, zoom, personas visibles),
 * leerla en `get_list_schema` y duplicar la lista con la vista re-mapeada.
 */
describe('Asistente/MCP + plantillas: vista «Carga de trabajo»', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let client: Client;
    let lists: ListsService;
    let fields: FieldsService;
    let records: RecordsService;
    let blueprint: BlueprintService;
    let tenantId: number;
    let adminId: number;
    let anaId: number;
    let outsiderId: number;
    const f: Record<string, number> = {};

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const recRepo = new RecordsRepository();
        records = new RecordsService(tenantDb, recRepo, lists, fields, rt, act, new AutomationDispatcher(), new RelationsRepository());
        const dashboards = new DashboardsService(tenantDb, null as never, records, fields);
        blueprint = new BlueprintService(tenantDb, lists, fields, views, automations, recRepo, new RelationsRepository(), billing, rt, dashboards);
        const deps = new DependenciesService(tenantDb, lists, fields, records, recRepo, new DependenciesRepository(), act, rt, new AuditService(tenantDb));
        const store = new ProposalsStore(redis);
        const comments = new CommentsService(tenantDb, new CommentsRepository(), lists, records, rt);
        const publicLists = new PublicListsService(pg.db, tenantDb, lists, null as never);
        const structure = new StructureTools(tenantDb, lists, fields, views, automations, dashboards, blueprint, store, connectors, comments, publicLists);
        const data = new DataTools(lists, fields, records, new AggregateService(tenantDb, lists, fields), store, undefined, deps);
        const registry = new AiToolRegistry();
        structure.registerInto(registry);
        data.registerInto(registry);
        const proposals = new ProposalsService(store, new ConversationsStore(redis), structure, new AuditService(tenantDb), data);
        const mcp = new McpService(registry, proposals);
        const [t] = await pg.db.insert(tenants).values({ slug: 'agencia', name: 'Agencia SA', plan: 'pro' }).returning();
        tenantId = t!.id;
        const mkUser = async (email: string, name: string): Promise<number> =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        adminId = await mkUser('admin@agencia.local', 'Admin');
        anaId = await mkUser('ana@agencia.local', 'Ana');
        outsiderId = await mkUser('otro@otra.local', 'Otro');
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: anaId, role: 'agent' },
        ]);
        const admin: AiToolContext = { tenantId, userId: adminId, role: 'admin' };

        await lists.create(tenantId, { name: 'Tareas' });
        const mk = async (label: string, slug: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = (await fields.create(tenantId, 'tareas', { label, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('Nombre', 'nombre', 'text');
        await mk('Inicio', 'inicio', 'date');
        await mk('Entrega', 'entrega', 'date');
        await mk('Responsable', 'responsable', 'user');
        await mk('Horas', 'horas', 'number');
        await mk('Duración', 'duracion', 'duration');

        const server = mcp.buildServer(admin, 'full', '0.0.0-test');
        const [clientT, serverT] = InMemoryTransport.createLinkedPair();
        await server.connect(serverT);
        client = new Client({ name: 'spec', version: '0' });
        await client.connect(clientT);
    }, 180_000);

    afterAll(async () => {
        await client?.close();
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    const call = (name: string, args: Record<string, unknown> = {}): Promise<unknown> => client.callTool({ name, arguments: args });
    const apply = async (proposalId: unknown): Promise<Record<string, unknown>> => json(await call('apply_proposal', { proposal_id: proposalId }));
    const viewNamed = async (name: string, listId?: number) => {
        const [v] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .select()
                .from(savedViews)
                .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.name, name), ...(listId ? [eq(savedViews.listId, listId)] : []))),
        );
        return v!;
    };

    it('propose_create_view workload: valida persona, fechas, estimación, zoom y personas; guarda por id', async () => {
        const errorOf = async (view: Record<string, unknown>): Promise<string> => {
            const res = await call('propose_create_view', { list: 'tareas', view: { name: 'X', type: 'workload', ...view } });
            expect(isError(res)).toBe(true);
            return String(json(res).error);
        };
        expect(await errorOf({ start_field: 'inicio' })).toContain('person_field');
        expect(await errorOf({ person_field: 'nombre', start_field: 'inicio' })).toContain('Persona');
        expect(await errorOf({ person_field: 'responsable' })).toContain('start_field');
        expect(await errorOf({ person_field: 'responsable', start_field: 'inicio', measure: 'estimate' })).toContain('estimate_field');
        expect(await errorOf({ person_field: 'responsable', start_field: 'inicio', measure: 'estimate', estimate_field: 'nombre' })).toContain('number o duration');
        expect(await errorOf({ person_field: 'responsable', start_field: 'inicio', zoom: 'quarter' })).toContain('day, week o month');
        expect(await errorOf({ person_field: 'responsable', start_field: 'inicio', people: [anaId, outsiderId] })).toContain(`#${outsiderId}`);
        // Las opciones de la carga no valen en otro tipo de vista.
        const table = await call('propose_create_view', { list: 'tareas', view: { name: 'T', type: 'table', measure: 'count' } });
        expect(isError(table)).toBe(true);
        expect(json(table).error).toContain('carga de trabajo');

        const p = json(
            await call('propose_create_view', {
                list: 'tareas',
                view: {
                    name: 'Carga del equipo',
                    type: 'workload',
                    person_field: 'responsable',
                    start_field: 'inicio',
                    end_field: 'entrega',
                    measure: 'estimate',
                    estimate_field: 'horas',
                    zoom: 'day',
                    people: [anaId],
                    show_unassigned: false,
                },
            }),
        );
        expect(JSON.stringify(p)).toContain('carga de trabajo');
        await apply(p.proposal_id);
        const view = await viewNamed('Carga del equipo');
        expect(view.type).toBe('workload');
        expect(view.config).toMatchObject({
            workload_person_field_id: f.responsable,
            workload_start_field_id: f.inicio,
            workload_end_field_id: f.entrega,
            workload_metric: 'estimate',
            workload_estimate_field_id: f.horas,
            workload_zoom: 'day',
            workload_user_ids: [anaId],
            workload_show_unassigned: false,
        });

        // El esquema la describe en el mismo vocabulario.
        const schema = json(await call('get_list_schema', { list: 'tareas' }));
        const described = (schema.views as Array<Record<string, unknown>>).find((v) => v.name === 'Carga del equipo')!;
        expect(described).toMatchObject({
            type: 'workload',
            person_field: 'responsable',
            start_field: 'inicio',
            end_field: 'entrega',
            measure: 'estimate',
            estimate_field: 'horas',
            estimate_unit: 'hours',
            zoom: 'day',
            people: [anaId],
            show_unassigned: false,
            hide_done: true,
        });
    });

    it('propose_update_view workload: cambiar sólo el zoom o la métrica conserva persona y fechas', async () => {
        const p = json(await call('propose_update_view', { list: 'tareas', view: 'Carga del equipo', config: { zoom: 'month' } }));
        expect(isError(p)).toBe(false);
        await apply(p.proposal_id);
        const view = await viewNamed('Carga del equipo');
        expect(view.config).toMatchObject({
            workload_person_field_id: f.responsable,
            workload_start_field_id: f.inicio,
            workload_end_field_id: f.entrega,
            workload_metric: 'estimate',
            workload_estimate_field_id: f.horas,
            workload_zoom: 'month',
        });
        const time = json(await call('propose_update_view', { list: 'tareas', view: 'Carga del equipo', config: { measure: 'time' } }));
        await apply(time.proposal_id);
        const v2 = await viewNamed('Carga del equipo');
        expect(v2.config.workload_metric).toBe('time');
        expect(v2.config.workload_estimate_field_id).toBeUndefined();
        expect(v2.config.workload_person_field_id).toBe(f.responsable);
        // Lo que no se nombra se conserva: el zoom, las personas y la fila «Sin asignar».
        expect(v2.config).toMatchObject({ workload_zoom: 'month', workload_user_ids: [anaId], workload_show_unassigned: false });
    });

    it('duplicar la lista re-mapea los campos de la vista de carga (las personas son del mismo equipo)', async () => {
        const bp = await blueprint.serialize(tenantId, [(await lists.get(tenantId, 'tareas')).id], { views: true, automations: false, settings: true, records: false });
        const res = await blueprint.materialize(tenantId, adminId, bp, { name: 'Tareas copia', includeRecords: false });
        const copy = res.lists[0]!;
        const copyFields = await fields.listByListId(tenantId, copy.id);
        const fid = (slug: string): number => copyFields.find((x) => x.slug === slug)!.id;
        const v = await viewNamed('Carga del equipo', copy.id);
        expect(fid('responsable')).not.toBe(f.responsable);
        expect(v.config).toMatchObject({
            workload_person_field_id: fid('responsable'),
            workload_start_field_id: fid('inicio'),
            workload_end_field_id: fid('entrega'),
            workload_user_ids: [anaId],
        });
    });
});
