import type { Message } from '@anthropic-ai/sdk/resources/messages';
import Redis from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AiModelCatalogService, type ProviderModel } from '../src/ai/ai-model-catalog.service';
import { AiSettingsService } from '../src/ai/ai-settings.service';
import type { AiClientFactory } from '../src/ai/assistant.service';
import { ConversationsStore } from '../src/ai/conversations.store';
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
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { dashboards, fields as fieldsTable, memberships, savedViews, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListSuggestionsAiService } from '../src/list-suggestions/list-suggestions-ai.service';
import { ListSuggestionsService } from '../src/list-suggestions/list-suggestions.service';
import { ListSuggestionsStore, quotaKey } from '../src/list-suggestions/list-suggestions.store';
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

const MODELS: ProviderModel[] = [
    { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true } } },
    { id: 'claude-haiku-9-0', display_name: 'Claude Haiku 9', created_at: '2030-01-01T00:00:00Z', capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true } } },
];

type Block = { type: 'tool_use'; name: string; input: unknown } | { type: 'text'; text: string };
interface Call {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    tools: Array<{ name: string }>;
}
/** Modelo falso: cada vuelta decide qué responde mirando lo que recibió (p. ej. el proposal_id de la vuelta anterior). */
function fakeClient(script: Array<(call: Call) => Block[]>) {
    const calls: Call[] = [];
    const factory: AiClientFactory = () =>
        ({
            messages: {
                stream: (p: Call) => {
                    calls.push(JSON.parse(JSON.stringify(p)) as Call);
                    const step = script[calls.length - 1] ?? script[script.length - 1]!;
                    const blocks = step(calls[calls.length - 1]!);
                    const content = blocks.map((b, i) => (b.type === 'tool_use' ? { type: 'tool_use', id: `tu_${calls.length}_${i}`, name: b.name, input: b.input } : { type: 'text', text: b.text, citations: null }));
                    const final = {
                        id: `m${calls.length}`,
                        type: 'message',
                        role: 'assistant',
                        model: 'fake',
                        content,
                        stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
                        stop_sequence: null,
                        usage: { input_tokens: 900, output_tokens: 300 },
                    } as unknown as Message;
                    return { finalMessage: async () => final };
                },
            },
        }) as never;
    return { factory, calls };
}

/** Los `proposal_id` que devolvieron las herramientas en la última vuelta. */
function proposalIdsIn(call: Call): string[] {
    const last = call.messages[call.messages.length - 1];
    const out: string[] = [];
    if (last && Array.isArray(last.content)) {
        for (const b of last.content as Array<{ type: string; content?: string; is_error?: boolean }>) {
            if (b.type !== 'tool_result' || b.is_error || typeof b.content !== 'string') continue;
            try {
                const id = (JSON.parse(b.content) as { proposal_id?: string }).proposal_id;
                if (id) out.push(id);
            } catch {
                // no es JSON
            }
        }
    }
    return out;
}

describe('v0.1.341 — sugerencias por lista (Postgres + Redis reales, modelo falso)', () => {
    let pg: TestPg;
    let rc: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fields: FieldsService;
    let records: RecordsService;
    let settings: AiSettingsService;
    let registry: AiToolRegistry;
    let proposals: ProposalsService;
    let audit: AuditService;
    let store: ListSuggestionsStore;
    let svc: ListSuggestionsService;
    let tenantId: number;
    let adminId: number;
    let managerId: number;
    let agentId: number;
    let admin: AiToolContext;
    let manager: AiToolContext;
    let agent: AiToolContext;
    const f: Record<string, number> = {};

    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '' });

    function aiService(script: Array<(call: Call) => Block[]>) {
        const fake = fakeClient(script);
        return { ai: new ListSuggestionsAiService(svc, store, settings, registry, audit, fake.factory), calls: fake.calls };
    }

    beforeAll(async () => {
        [pg, rc] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(rc.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        audit = new AuditService(tenantDb);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const autos = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const recRepo = new RecordsRepository();
        records = new RecordsService(tenantDb, recRepo, lists, fields, rt, act, new AutomationDispatcher(), new RelationsRepository());
        const dash = new DashboardsService(tenantDb, null as never, records, fields);
        const blueprint = new BlueprintService(tenantDb, lists, fields, views, autos, recRepo, new RelationsRepository(), billing, rt, dash);
        const pstore = new ProposalsStore(redis);
        const structure = new StructureTools(tenantDb, lists, fields, views, autos, dash, blueprint, pstore, connectors, null as never, null as never);
        const data = new DataTools(lists, fields, records, new AggregateService(tenantDb, lists, fields), pstore);
        registry = new AiToolRegistry();
        structure.registerInto(registry);
        data.registerInto(registry);
        proposals = new ProposalsService(pstore, new ConversationsStore(redis), structure, audit, data);
        const catalogs = new AiModelCatalogService(redis, async () => [...MODELS]);
        catalogs.memoMs = 0;
        settings = new AiSettingsService(redis, pg.db, env, catalogs);
        store = new ListSuggestionsStore(redis);
        svc = new ListSuggestionsService(tenantDb, pg.db, records, fields, store, settings, registry, proposals, audit);
        const mkUser = async (email: string, name: string): Promise<number> => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        adminId = await mkUser('ana@sugerencias.test', 'Ana');
        managerId = await mkUser('gabo@sugerencias.test', 'Gabo');
        agentId = await mkUser('lu@sugerencias.test', 'Lu');
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), rc?.stop()]);
    });

    let n = 0;
    beforeEach(async () => {
        n += 1;
        await redis.flushdb();
        const [t] = await pg.db.insert(tenants).values({ slug: `sug-${n}`, name: `Sugerencias ${n}`, plan: 'pro', status: 'active' }).returning();
        tenantId = t!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: managerId, role: 'manager' },
            { tenantId, userId: agentId, role: 'agent' },
        ]);
        admin = { tenantId, userId: adminId, role: 'admin' };
        manager = { tenantId, userId: managerId, role: 'manager' };
        agent = { tenantId, userId: agentId, role: 'agent' };
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-0000000000000000', share_platform_key: true, allow_tenant_keys: true, list_suggest_ai_monthly: 2 });

        await lists.create(tenantId, { name: 'Facturas' });
        const mk = async (label: string, slug: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = (await fields.create(tenantId, 'facturas', { label, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('Cliente', 'cliente', 'text');
        await mk('Estado', 'estado', 'select', {
            options: [
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'pagada', label: 'Pagada' },
                { value: 'vencida', label: 'Vencida' },
            ],
        });
        await mk('Vencimiento', 'vencimiento', 'date');
        await mk('Monto', 'monto', 'currency');
        await mk('Ciudad', 'ciudad', 'text');
        await mk('Email', 'email', 'email');
        const cities = ['Bogotá', 'Medellín', 'Cali'];
        for (let i = 0; i < 30; i++) {
            await records.create(tenantId, admin, 'facturas', {
                data: {
                    [`f${f.cliente}`]: `Cliente ${i}`,
                    [`f${f.estado}`]: i % 3 === 0 ? 'pagada' : 'pendiente',
                    [`f${f.vencimiento}`]: i < 10 ? '2020-03-01' : '2099-01-15',
                    [`f${f.monto}`]: 100000 * (i + 1),
                    [`f${f.ciudad}`]: cities[i % 3],
                    [`f${f.email}`]: i < 4 ? 'repetido@acme.co' : `c${i}@acme.co`,
                },
            } as never);
        }
    });

    it('las reglas salen de los datos de la lista, con la evidencia, y respetan lo que puede cada rol', async () => {
        const res = await svc.get(admin, 'facturas');
        expect(res.enabled).toBe(true);
        expect(res.sample).toEqual({ total: 30, sampled: 30 });
        const keys = res.suggestions.map((s) => s.key);
        expect(keys).toEqual(
            expect.arrayContaining([`view.kanban.f${f.estado}`, `view.calendar.f${f.vencimiento}`, `view.overdue.f${f.vencimiento}`, 'dashboard.summary', `field.select.f${f.ciudad}`, `quality.dupes.f${f.email}`, 'share.form']),
        );
        expect(res.new_count).toBe(res.suggestions.length);
        // 10 vencidas: las i%3==0 están pagadas (0, 3, 6, 9) → 6 sin cerrar.
        expect(res.suggestions.find((s) => s.key === `view.overdue.f${f.vencimiento}`)!.why).toContain('6 registros');
        // Un gerente no administra campos ni formularios; un agente no ve sugerencias.
        const mkeys = (await svc.get(manager, 'facturas')).suggestions.map((s) => s.key);
        expect(mkeys).toContain(`view.kanban.f${f.estado}`);
        expect(mkeys).toContain('dashboard.summary');
        expect(mkeys).not.toContain(`field.select.f${f.ciudad}`);
        expect(mkeys).not.toContain('share.form');
        const ag = await svc.get(agent, 'facturas');
        expect(ag.enabled).toBe(false);
        expect(ag.suggestions).toEqual([]);
        await expect(svc.apply(agent, 'facturas', `view.kanban.f${f.estado}`)).rejects.toMatchObject({ status: 403 });
    });

    it('aplicar crea con la herramienta validada; no se aplica dos veces; descartar y restaurar', async () => {
        const kanban = await svc.apply(admin, 'facturas', `view.kanban.f${f.estado}`);
        expect(kanban.suggestion).toMatchObject({ status: 'applied' });
        const [v] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.type, 'kanban'))));
        expect(v!.config).toMatchObject({ group_by_field_id: f.estado });
        // Ya existe: deja de ser «nueva», queda listada como aplicada (con su
        // enlace, para la sección «Aplicadas») y volver a aplicarla rebota.
        const after = await svc.get(admin, 'facturas');
        const applied = after.suggestions.filter((s) => s.key === `view.kanban.f${f.estado}`);
        expect(applied).toHaveLength(1);
        expect(applied[0]).toMatchObject({ status: 'applied' });
        expect(applied[0]!.applied?.links.length).toBeGreaterThan(0);
        expect(after.marks[`view.kanban.f${f.estado}`]).toBe('applied');
        await expect(svc.apply(admin, 'facturas', `view.kanban.f${f.estado}`)).rejects.toMatchObject({ status: 409 });

        // «Vencidos»: vista con el filtro relativo y sin lo pagado.
        await svc.apply(admin, 'facturas', `view.overdue.f${f.vencimiento}`);
        const [over] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.name, 'Vencidos'))));
        expect(JSON.stringify(over!.config)).toContain('before_today');
        const page = await records.list(tenantId, admin, 'facturas', { filter_tree: (over!.config as { filter_tree: unknown }).filter_tree, limit: 50 } as never);
        expect(page.data).toHaveLength(6);

        // Texto con pocos valores → selección con sus opciones.
        const conv = await svc.apply(admin, 'facturas', `field.select.f${f.ciudad}`);
        expect(conv.suggestion.applied?.message).toContain('3 opciones');
        const [ciudad] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.id, f.ciudad!)));
        expect(ciudad!.type).toBe('select');

        // Tablero de resumen.
        await svc.apply(admin, 'facturas', 'dashboard.summary');
        const dashes = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboards).where(eq(dashboards.tenantId, tenantId)));
        expect(dashes).toHaveLength(1);
        expect((dashes[0]!.widgets as unknown[]).length).toBeGreaterThanOrEqual(4);

        // Descartar y restaurar.
        await svc.dismiss(admin, 'facturas', 'share.form', 'Recibe registros con un formulario');
        let res = await svc.get(admin, 'facturas');
        expect(res.suggestions.find((s) => s.key === 'share.form')!.status).toBe('dismissed');
        expect(res.marks['share.form']).toBe('dismissed');
        await svc.restore(admin, 'facturas', 'share.form');
        res = await svc.get(admin, 'facturas');
        expect(res.suggestions.find((s) => s.key === 'share.form')!.status).toBe('new');
        // Una idea del catálogo (la arma la pantalla) también se recuerda.
        await svc.dismiss(admin, 'facturas', 'idea.recordatorio-vencimiento', 'Recordatorio');
        expect((await svc.get(admin, 'facturas')).marks['idea.recordatorio-vencimiento']).toBe('dismissed');
    });

    it('modo de la empresa y aviso oculto por persona', async () => {
        await expect(svc.updateSettings(manager, { mode: 'off' })).rejects.toMatchObject({ status: 403 });
        await svc.updateSettings(admin, { mode: 'rules' });
        const rules = await svc.get(admin, 'facturas');
        expect(rules.enabled).toBe(true);
        expect(rules.ai.available).toBe(false);
        expect(rules.ai.reason).toContain('sin IA');
        await svc.updateSettings(admin, { mode: 'off' });
        expect((await svc.get(admin, 'facturas')).enabled).toBe(false);
        await svc.updateSettings(admin, { mode: 'all' });
        const s = await svc.updateSettings(manager, { hidden_for_me: true });
        expect(s.hidden_for_me).toBe(true);
        expect((await svc.get(manager, 'facturas')).hidden_for_me).toBe(true);
        expect((await svc.get(admin, 'facturas')).hidden_for_me).toBe(false);
    });

    it('IA: resumen sin datos personales, propuestas validadas, cupo de 2 por mes, no repite sin cambios', async () => {
        const script = (viewName = 'Facturas grandes'): Array<(call: Call) => Block[]> => [
            () => [
                {
                    type: 'tool_use',
                    name: 'propose_create_view',
                    input: { list: 'facturas', view: { name: viewName, type: 'table', filters: [{ field: 'monto', op: 'gt', value: 2000000 }], sort: [{ field: 'monto', dir: 'desc' }] } },
                },
                // Un webhook en una sugerencia se rechaza antes de validar.
                {
                    type: 'tool_use',
                    name: 'propose_create_automation',
                    input: { list: 'facturas', name: 'Avisar', trigger_type: 'record_created', actions: [{ type: 'call_webhook', config: { url: 'https://x.test' } }] },
                },
            ],
            (call) => [
                {
                    type: 'tool_use',
                    name: 'submit_suggestions',
                    input: { suggestions: proposalIdsIn(call).map((id) => ({ proposal_id: id, title: 'Las facturas más grandes primero', why: 'Hay 10 facturas por encima de 2 millones: conviene revisarlas primero.' })) },
                },
            ],
        ];
        const { ai, calls } = aiService(script());
        const started = await ai.start(admin, 'facturas', { consent: true });
        expect(started.ai.state).toBe('running');
        const listId = started.suggestions.length ? (await svc.profile(admin, 'facturas')).list.id : 0;
        await ai.settle(tenantId, listId);

        // Lo que viajó: estructura y números, nunca valores de los registros.
        const sent = JSON.stringify(calls[0]!.messages);
        expect(sent).not.toContain('repetido@acme.co');
        expect(sent).not.toContain('Bogotá');
        expect(sent).not.toContain('Cliente 3');
        expect(sent).toContain('Pagada');
        expect(calls[0]!.tools.map((t) => t.name).sort()).toEqual(['propose_add_fields', 'propose_create_automation', 'propose_create_dashboard', 'propose_create_view', 'propose_update_field', 'submit_suggestions']);
        expect(JSON.stringify(calls[1]!.messages)).toContain('call_webhook');

        const res = await svc.get(admin, 'facturas');
        const aiSugs = res.suggestions.filter((s) => s.source === 'ai');
        expect(aiSugs).toHaveLength(1);
        expect(aiSugs[0]).toMatchObject({ title: 'Las facturas más grandes primero', category: 'view', status: 'new' });
        expect(res.ai).toMatchObject({ state: 'done', remaining: 1, limit: 2, can_reanalyze: false });
        expect(Number(await redis.get(quotaKey(tenantId)))).toBe(1);

        // Sin cambios: no se repite (no gasta).
        await expect(ai.start(admin, 'facturas', { consent: true })).rejects.toMatchObject({ status: 409 });

        // Aplicar la de la IA crea la vista con la herramienta, como las reglas.
        await svc.apply(admin, 'facturas', aiSugs[0]!.key);
        const [big] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.name, 'Facturas grandes'))));
        expect(big).toBeTruthy();
        // La lista cambió (una vista más): ahora sí se puede volver a analizar.
        expect((await svc.get(admin, 'facturas')).ai.can_reanalyze).toBe(true);

        // Con un propósito, sí corre.
        const second = aiService(script('Facturas por cobrar grandes'));
        await second.ai.start(admin, 'facturas', { consent: true, purpose: 'Cobrar a tiempo a mis clientes' });
        await second.ai.settle(tenantId, listId);
        expect((await svc.get(admin, 'facturas')).ai.purpose).toBe('Cobrar a tiempo a mis clientes');
        expect(Number(await redis.get(quotaKey(tenantId)))).toBe(2);
        // El tercero del mes: sin cupo.
        await expect(second.ai.start(admin, 'facturas', { consent: true, purpose: 'Otra cosa distinta' })).rejects.toMatchObject({ status: 503 });
        expect((await svc.get(admin, 'facturas')).ai).toMatchObject({ available: false, remaining: 0 });
    });

    it('IA: si falla, devuelve el cupo; un gerente sólo recibe herramientas de vistas y tableros', async () => {
        const fail = aiService([() => [{ type: 'text', text: 'No sé qué proponer.' }]]);
        await fail.ai.start(manager, 'facturas', { consent: true });
        const listId = (await svc.profile(manager, 'facturas')).list.id;
        await fail.ai.settle(tenantId, listId);
        expect(fail.calls[0]!.tools.map((t) => t.name).sort()).toEqual(['propose_create_dashboard', 'propose_create_view', 'submit_suggestions']);
        const res = await svc.get(manager, 'facturas');
        expect(res.ai.state).toBe('error');
        expect(res.ai.error).toContain('no logró');
        expect(Number((await redis.get(quotaKey(tenantId))) ?? 0)).toBe(0);
        // Un agente no puede pedir sugerencias.
        await expect(fail.ai.start(agent, 'facturas', { consent: true })).rejects.toMatchObject({ status: 403 });
    });
});
