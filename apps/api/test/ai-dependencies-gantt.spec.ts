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
import { memberships, recordDependencies, savedViews, tenants, users } from '../src/db/schema';
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
 * A8 + B1 desde el asistente/MCP y las plantillas: proponer una vista Gantt,
 * leer las dependencias en `get_list_schema`, crear/quitar dependencias con
 * `propose_set_dependencies` (los ciclos se rechazan al proponer) y duplicar
 * una lista con sus dependencias y la vista Gantt re-mapeadas.
 */
describe('Asistente/MCP + plantillas: dependencias y vista Gantt', () => {
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
    const f: Record<string, number> = {};
    const id: Record<string, number> = {};

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

        const [t] = await pg.db.insert(tenants).values({ slug: 'obra', name: 'Obra SA', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@obra.local', name: 'Admin', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await pg.db.insert(memberships).values([{ tenantId, userId: adminId, role: 'admin' }]);
        const admin: AiToolContext = { tenantId, userId: adminId, role: 'admin' };

        await lists.create(tenantId, { name: 'Obra' });
        const mk = async (label: string, slug: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = (await fields.create(tenantId, 'obra', { label, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('Nombre', 'nombre', 'text');
        await mk('Inicio', 'inicio', 'date');
        await mk('Fin', 'fin', 'date');
        await mk('Responsable', 'responsable', 'user');
        await mk('Estado', 'estado', 'select', {
            options: [
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'hecho', label: 'Completado' },
            ],
        });
        const mkRec = async (key: string, nombre: string, inicio: string, fin: string): Promise<void> => {
            id[key] = (
                await records.create(tenantId, { userId: adminId, role: 'admin' }, 'obra', {
                    data: { [`f${f.nombre}`]: nombre, [`f${f.inicio}`]: inicio, [`f${f.fin}`]: fin, [`f${f.estado}`]: 'pendiente' },
                })
            ).id;
        };
        await mkRec('A', 'Cimientos', '2026-03-02', '2026-03-06');
        await mkRec('B', 'Estructura', '2026-03-09', '2026-03-20');
        await mkRec('C', 'Techo', '2026-03-23', '2026-03-27');

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

    it('propose_set_dependencies: agrega la cadena, rechaza el ciclo al proponer y quita; get_list_schema y query_records lo ven', async () => {
        const ok = json(
            await call('propose_set_dependencies', {
                list: 'obra',
                add: [
                    { blocker: id.A, blocked: id.B },
                    { blocker: id.B, blocked: id.C, lag_days: 1 },
                ],
            }),
        );
        expect(ok.proposal_id).toBeTruthy();
        const applied = await apply(ok.proposal_id);
        expect(applied.applied).toBe(true);
        expect(JSON.stringify(applied.result)).toContain('2 cambios');
        const edges = await withTenant(pg.db, tenantId, (tx) => tx.select().from(recordDependencies).where(eq(recordDependencies.tenantId, tenantId)));
        expect(edges.map((e) => [e.blockerRecordId, e.blockedRecordId, e.lagDays])).toEqual(
            expect.arrayContaining([
                [id.A, id.B, 0],
                [id.B, id.C, 1],
            ]),
        );

        // C → A cerraría un círculo: se rechaza ANTES de proponer, con el camino.
        const cycle = await call('propose_set_dependencies', { list: 'obra', add: [{ blocker: id.C, blocked: id.A }] });
        expect(isError(cycle)).toBe(true);
        expect(json(cycle).error).toContain('círculo');

        // El esquema cuenta las dependencias y los registros traen sus bloqueantes abiertos.
        const schema = json(await call('get_list_schema', { list: 'obra' }));
        expect(JSON.stringify(schema.dependencies)).toContain('propose_set_dependencies');
        const rows = json(await call('query_records', { list: 'obra' })).rows as Array<Record<string, unknown>>;
        const rowB = rows.find((r) => r.id === id.B)!;
        expect(rowB.blocked_by_open).toBe(1);

        // Quitar B → C.
        const rm = json(await call('propose_set_dependencies', { list: 'obra', remove: [{ blocker: id.B, blocked: id.C }] }));
        await apply(rm.proposal_id);
        const left = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .select()
                .from(recordDependencies)
                .where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.blockedRecordId, id.C!))),
        );
        expect(left).toHaveLength(0);
    });

    it('propose_create_view gantt: valida los campos y guarda la config por id; propose_update_view la cambia', async () => {
        const bad = await call('propose_create_view', { list: 'obra', view: { name: 'Mal', type: 'gantt', start_field: 'nombre' } });
        expect(isError(bad)).toBe(true);
        const noStart = await call('propose_create_view', { list: 'obra', view: { name: 'Sin inicio', type: 'gantt' } });
        expect(isError(noStart)).toBe(true);
        expect(json(noStart).error).toContain('start_field');

        const p = json(
            await call('propose_create_view', {
                list: 'obra',
                view: {
                    name: 'Cronograma',
                    type: 'gantt',
                    start_field: 'inicio',
                    end_field: 'fin',
                    group_by: 'responsable',
                    color_field: 'estado',
                    columns: ['estado', 'responsable'],
                    zoom: 'month',
                },
            }),
        );
        await apply(p.proposal_id);
        const [view] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(savedViews).where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.name, 'Cronograma'))),
        );
        expect(view!.type).toBe('gantt');
        expect(view!.config).toMatchObject({
            gantt_start_field_id: f.inicio,
            gantt_end_field_id: f.fin,
            gantt_group_by_field_id: f.responsable,
            gantt_color_field_id: f.estado,
            gantt_columns: [{ field_id: f.estado }, { field_id: f.responsable }],
            gantt_zoom: 'month',
        });

        // El esquema describe la vista Gantt.
        const schema = json(await call('get_list_schema', { list: 'obra' }));
        expect(JSON.stringify(schema.views)).toContain('Cronograma');
    });

    it('duplicar la lista copia las dependencias (entre los registros nuevos) y re-mapea la vista Gantt', async () => {
        const bp = await blueprint.serialize(tenantId, [(await lists.get(tenantId, 'obra')).id], { views: true, automations: false, settings: true, records: true });
        const res = await blueprint.materialize(tenantId, adminId, bp, { name: 'Obra copia', includeRecords: true });
        const copy = res.lists[0]!;
        const copyFields = await fields.listByListId(tenantId, copy.id);
        const fid = (slug: string): number => copyFields.find((x) => x.slug === slug)!.id;
        const copyRecs = await records.list(tenantId, { userId: adminId, role: 'admin' }, String(copy.id), { limit: 50, sort_dir: 'asc', include_subtasks: true });
        const byName = new Map(copyRecs.data.map((r) => [String((r.data as Record<string, unknown>)[`f${fid('nombre')}`]), r.id]));
        const edges = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(recordDependencies).where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.blockerListId, copy.id))),
        );
        // A → B sigue (B → C se quitó en el test anterior), entre los registros NUEVOS.
        expect(edges.map((e) => [e.blockerRecordId, e.blockedRecordId])).toEqual([[byName.get('Cimientos'), byName.get('Estructura')]]);
        expect(byName.get('Cimientos')).not.toBe(id.A);
        const [v] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(savedViews).where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.listId, copy.id), eq(savedViews.type, 'gantt'))),
        );
        expect(v!.config).toMatchObject({ gantt_start_field_id: fid('inicio'), gantt_end_field_id: fid('fin'), gantt_group_by_field_id: fid('responsable') });
    });
});
