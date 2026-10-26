import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { AiChatEvent, AiProposal } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiModelCatalogService, capsFrom, type ProviderModel } from '../src/ai/ai-model-catalog.service';
import { AiQuotaExceededError, AiQuotaService } from '../src/ai/ai-quota.service';
import { AiSettingsService, AiUnavailableError } from '../src/ai/ai-settings.service';
import { AssistantService, buildSystemPrompt, type AiClientFactory } from '../src/ai/assistant.service';
import { ConversationsStore, INTERRUPTED_TURN_NOTE, prepareHistoryForNewTurn, trimHistory } from '../src/ai/conversations.store';
import { assistantModelParams } from '../src/ai/model-params';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools, toSlug } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { loadEnv } from '../src/config/env';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { aiUsage, auditLog, memberships, tenants, users } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
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

/**
 * Modelo FALSO con guion: cada turno del guion es la respuesta a UNA llamada
 * (`messages.stream`). Un turno con `tool` produce un `tool_use` (stop
 * tool_use); uno con `text` cierra (end_turn). Así se prueba el bucle real
 * — validación de input, capability, propuesta, tool_result, transcript,
 * cuota — sin hablar con la API.
 */
type Turn = ({ text: string } | { tool: string; input: unknown; text?: string }) & { think?: boolean };

type StreamParams = { model: string; messages: MessageParam[]; system: unknown; tools: unknown; thinking?: unknown; output_config?: unknown; max_tokens: number };

function fakeClient(
    script: Turn[],
    seen: MessageParam[][] = [],
): { factory: AiClientFactory; seen: MessageParam[][]; params: StreamParams[]; calls: { n: number } } {
    const calls = { n: 0 };
    const params: StreamParams[] = [];
    const factory: AiClientFactory = () =>
        ({
            messages: {
                stream: (p: StreamParams) => {
                    const turn = script[calls.n] ?? { text: '(fin del guion)' };
                    calls.n += 1;
                    seen.push(JSON.parse(JSON.stringify(p.messages)) as MessageParam[]);
                    params.push(p);
                    const content: Message['content'] = [];
                    if (turn.think) content.push({ type: 'thinking', thinking: '', signature: `firma_${calls.n}` } as never);
                    const text = 'text' in turn ? turn.text : undefined;
                    if (text) content.push({ type: 'text', text, citations: null });
                    if ('tool' in turn) content.push({ type: 'tool_use', id: `tu_${calls.n}`, name: turn.tool, input: turn.input } as never);
                    const final: Message = {
                        id: `msg_${calls.n}`,
                        type: 'message',
                        role: 'assistant',
                        model: 'fake',
                        content,
                        stop_reason: 'tool' in turn ? 'tool_use' : 'end_turn',
                        stop_sequence: null,
                        usage: { input_tokens: 100, output_tokens: 20 } as Message['usage'],
                    } as unknown as Message;
                    const events = text ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }] : [];
                    return {
                        async *[Symbol.asyncIterator]() {
                            for (const e of events) yield e;
                        },
                        finalMessage: async () => final,
                    };
                },
                create: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'fake' }),
            },
        }) as never;
    return { factory, seen, params, calls };
}

/** Catálogo que «devuelve el proveedor» en los tests (ids inventados). */
const ADAPTIVE = { thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }, effort: { supported: true } };
const BUDGET = { thinking: { supported: true, types: { adaptive: { supported: false }, enabled: { supported: true } } }, effort: { supported: false } };
const providerModels: ProviderModel[] = [];
function setProviderModels(models: ProviderModel[]): void {
    providerModels.length = 0;
    providerModels.push(...models);
}
const BASE_MODELS: ProviderModel[] = [
    { id: 'claude-opus-9', display_name: 'Claude Opus 9', created_at: '2030-01-01T00:00:00Z', capabilities: ADAPTIVE },
    { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: ADAPTIVE },
    { id: 'claude-sonnet-9-5', display_name: 'Claude Sonnet 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: ADAPTIVE },
    { id: 'claude-haiku-3-9', display_name: 'Claude Haiku 3.9', created_at: '2028-01-01T00:00:00Z', capabilities: BUDGET },
];
let listerCalls = 0;
const fakeLister = async (): Promise<ProviderModel[]> => {
    listerCalls += 1;
    if (providerModels.length === 0) throw Object.assign(new Error('caído'), { status: 503 });
    return [...providerModels];
};

describe('Herramientas del asistente (puras)', () => {
    it('toSlug: sin acentos, snake_case, arranca con letra', () => {
        expect(toSlug('Razón social')).toBe('razon_social');
        expect(toSlug('  Próximo   cobro ')).toBe('proximo_cobro');
        expect(toSlug('2024 ventas')).toBe('f_2024_ventas');
        expect(toSlug('###')).toBe('campo');
    });

    it('trimHistory nunca deja un tool_result huérfano al frente', () => {
        const msgs = [
            { role: 'user' as const, content: 'hola' },
            { role: 'assistant' as const, content: [{ type: 'tool_use' }] },
            { role: 'user' as const, content: [{ type: 'tool_result' }] },
            { role: 'assistant' as const, content: 'listo' },
            { role: 'user' as const, content: 'otra' },
        ];
        const out = trimHistory(msgs, 3);
        expect(out[0]).toEqual({ role: 'user', content: 'otra' });
    });

    it('el registro sólo ofrece al modelo las herramientas del rol y las define en JSON Schema', () => {
        const registry = new AiToolRegistry();
        registry.register({
            name: 'a', label: 'A', description: 'lee', capability: null,
            input: z.object({ q: z.string() }),
            run: async () => ({ content: {} }),
        });
        registry.register({
            name: 'b', label: 'B', description: 'escribe', capability: 'manage_lists',
            input: z.object({}),
            run: async () => ({ content: {} }),
        });
        expect(registry.toAnthropicTools('admin').map((t) => t.name)).toEqual(['a', 'b']);
        expect(registry.toAnthropicTools('viewer').map((t) => t.name)).toEqual(['a']);
        const a = registry.toAnthropicTools('admin')[0]!;
        expect(a.input_schema).toMatchObject({ type: 'object', properties: { q: { type: 'string' } } });
    });

    it('v0.1.305 — el pedido se arma por lo que el modelo DECLARA que soporta, no por su nombre', () => {
        expect(assistantModelParams(capsFrom(ADAPTIVE)!)).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
        expect(assistantModelParams(capsFrom(BUDGET)!)).toEqual({ thinking: { type: 'enabled', budget_tokens: 2048 } });
        expect(assistantModelParams(capsFrom({})!)).toEqual({});
        expect(capsFrom(null)).toBeNull();
    });

    it('v0.1.305 — un turno nuevo arranca sin el pensamiento de los anteriores y con el anterior bien cerrado', () => {
        const thinking = { type: 'thinking', thinking: '', signature: 's' };
        const history = [
            { role: 'user' as const, content: 'hola' },
            { role: 'assistant' as const, content: [thinking, { type: 'text', text: 'listo' }] },
            { role: 'user' as const, content: 'otra cosa' },
            { role: 'assistant' as const, content: [thinking, { type: 'tool_use', id: 't1', name: 'list_lists', input: {} }] },
            { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
        ];
        const out = prepareHistoryForNewTurn(history);
        expect(JSON.stringify(out)).not.toContain('"thinking"');
        // El turno que quedó en un tool_result se cierra con una nota.
        expect(out.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: INTERRUPTED_TURN_NOTE }] });
        // Un tool_use sin su resultado se quita (la API lo rechazaría).
        const dangling = prepareHistoryForNewTurn(history.slice(0, 4));
        expect(dangling.at(-1)).toEqual({ role: 'user', content: 'otra cosa' });
        // No toca el original.
        expect(JSON.stringify(history)).toContain('"thinking"');
    });

    it('el system prompt lleva las reglas, el rol y la lista abierta', () => {
        const registry = new AiToolRegistry();
        const p = buildSystemPrompt({ tenantId: 1, userId: 1, role: 'manager', listSlug: 'facturas' }, registry);
        expect(p).toContain('Rol de la persona: manager');
        expect(p).toContain('«facturas»');
        expect(p).toContain('Jamás digas "ya lo creé"');
    });
});

describe('Asistente IA (Postgres + Redis reales, modelo falso)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fields: FieldsService;
    let views: ViewsService;
    let automations: AutomationsService;
    let dashboards: DashboardsService;
    let settings: AiSettingsService;
    let catalogs: AiModelCatalogService;
    let quota: AiQuotaService;
    let registry: AiToolRegistry;
    let proposals: ProposalsService;
    let conversations: ConversationsStore;
    let plans: PlansService;
    let tenantId: number;
    let otherTenantId: number;
    let userId: number;
    let ctx: AiToolContext;

    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '' });

    function assistantWith(script: Turn[]): { svc: AssistantService; fake: ReturnType<typeof fakeClient> } {
        const fake = fakeClient(script);
        return { svc: new AssistantService(settings, quota, conversations, registry, fake.factory), fake };
    }

    async function run(svc: AssistantService, c: AiToolContext, message: string, conversationId?: string): Promise<AiChatEvent[]> {
        const events: AiChatEvent[] = [];
        await svc.chat(c, { message, conversation_id: conversationId }, (e) => events.push(e));
        return events;
    }

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps()));
        plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        dashboards = new DashboardsService(tenantDb, null as never, null as never, null as never);
        const blueprint = new BlueprintService(
            tenantDb, lists, fields, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards,
        );
        catalogs = new AiModelCatalogService(redis, fakeLister);
        catalogs.memoMs = 0;
        catalogs.manualRefreshMinMs = 0;
        settings = new AiSettingsService(redis, pg.db, env, catalogs);
        quota = new AiQuotaService(pg.db, plans);
        const store = new ProposalsStore(redis);
        conversations = new ConversationsStore(redis);
        const structure = new StructureTools(tenantDb, lists, fields, views, automations, dashboards, blueprint, store, new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps()), null as never, null as never);
        registry = new AiToolRegistry();
        structure.registerInto(registry);
        proposals = new ProposalsService(store, conversations, structure, new AuditService(tenantDb));

        const [u] = await pg.db.insert(users).values({ email: 'ai@test.local', name: 'Ana', passwordHash: 'x' }).returning();
        userId = u!.id;
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    let n = 0;
    beforeEach(async () => {
        n += 1;
        const [t] = await pg.db.insert(tenants).values({ slug: `ai-${n}`, name: `Empresa ${n}`, plan: 'trial', status: 'trialing' }).returning();
        const [o] = await pg.db.insert(tenants).values({ slug: `ai-otra-${n}`, name: `Otra ${n}`, plan: 'trial', status: 'trialing' }).returning();
        tenantId = t!.id;
        otherTenantId = o!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId, role: 'admin' },
            { tenantId: otherTenantId, userId, role: 'admin' },
        ]);
        ctx = { tenantId, userId, role: 'admin' };
        await redis.flushdb();
        setProviderModels(BASE_MODELS);
        // Plataforma encendida con clave compartida; la empresa opt-in.
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-0000000000000000', share_platform_key: true, allow_tenant_keys: true });
        await settings.updateTenant(tenantId, { enabled: true });
    });

    // ── Configuración y resolución de la clave ─────────────────────────

    it('claves cifradas en reposo, nunca expuestas en el GET, y la resolución sigue la política', async () => {
        const plat = await settings.getPlatform();
        expect(plat).toMatchObject({ enabled: true, has_key: true, key_hint: '…0000', key_unreadable: false });
        expect(JSON.stringify(plat)).not.toContain('sk-ant-plataforma');
        const raw = await redis.get('platform:ai');
        expect(raw).not.toContain('sk-ant-plataforma');

        // Sin clave propia → plataforma.
        expect((await settings.resolve(tenantId)).source).toBe('platform');

        // Con clave propia → tenant, cifrada en la fila.
        await settings.updateTenant(tenantId, { api_key: 'sk-ant-empresa-1111111111111111111' });
        const [row] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
        expect(JSON.stringify(row!.settings)).not.toContain('sk-ant-empresa');
        const own = await settings.resolve(tenantId);
        expect(own).toMatchObject({ source: 'tenant', apiKey: 'sk-ant-empresa-1111111111111111111' });
        expect((await settings.getTenant(tenantId)).key_hint).toBe('…1111');

        // La plataforma prohíbe claves propias → se ignora y se usa la de plataforma.
        await settings.updatePlatform({ allow_tenant_keys: false });
        expect((await settings.resolve(tenantId)).source).toBe('platform');
        expect(await settings.tenantHasOwnKey(tenantId)).toBe(false);

        // La plataforma no comparte su clave y la empresa no puede usar la suya → sin acceso, con motivo.
        await settings.updatePlatform({ share_platform_key: false });
        await expect(settings.resolve(tenantId)).rejects.toMatchObject({ reason: 'own_key_required' });

        // Empresa sin opt-in.
        await settings.updatePlatform({ share_platform_key: true, allow_tenant_keys: true });
        await settings.updateTenant(otherTenantId, { enabled: false });
        await expect(settings.resolve(otherTenantId)).rejects.toMatchObject({ reason: 'tenant_disabled' });

        // Interruptor general apagado.
        await settings.updatePlatform({ enabled: false });
        await expect(settings.resolve(tenantId)).rejects.toBeInstanceOf(AiUnavailableError);
    });

    it('una clave guardada con OTRA SECRETS_KEY se informa como ilegible (no se finge que anda)', async () => {
        await settings.updateTenant(tenantId, { api_key: 'sk-ant-empresa-1111111111111111111' });
        const otra = new AiSettingsService(redis, pg.db, loadEnv({ SECRETS_KEY: 'otra-clave-distinta-totalmente' }), catalogs);
        expect((await otra.getTenant(tenantId)).key_unreadable).toBe(true);
        await expect(otra.resolve(tenantId)).rejects.toMatchObject({ reason: 'tenant_key_unreadable' });
    });

    // ── Bucle de chat ──────────────────────────────────────────────────

    it('lee el esquema, propone una lista y la persona la aplica: la lista existe y queda en la bitácora', async () => {
        const { svc, fake } = assistantWith([
            { tool: 'list_lists', input: {} },
            {
                tool: 'propose_create_list',
                text: 'Te armo la lista.',
                input: {
                    lists: [
                        {
                            name: 'Proveedores',
                            icon: 'truck',
                            fields: [
                                { label: 'Nombre', type: 'text', is_required: true },
                                { label: 'Estado', type: 'select', options: [{ label: 'Activo', color: 'emerald' }, { label: 'Inactivo', color: 'slate' }] },
                                { label: 'Saldo', type: 'currency', currency: 'cop', precision: 0 },
                                { label: 'Próximo pago', type: 'date', highlight_overdue: true },
                            ],
                            title_field: 'nombre',
                            views: [{ name: 'Por estado', type: 'kanban', group_by: 'estado' }],
                        },
                    ],
                },
            },
            { text: 'Listo: la propuesta tiene 4 campos y un kanban. Revísala y aplícala cuando quieras.' },
        ]);
        const events = await run(svc, ctx, 'Ármame una lista de proveedores con estado, saldo y próximo pago');

        expect(events[0]).toMatchObject({ type: 'start' });
        expect(events.filter((e) => e.type === 'tool_start').map((e) => (e as { name: string }).name)).toEqual(['list_lists', 'propose_create_list']);
        const proposalEv = events.find((e) => e.type === 'proposal') as { proposal: AiProposal };
        expect(proposalEv.proposal).toMatchObject({ kind: 'create_list', applied: false, destructive: false });
        expect(proposalEv.proposal.preview.lists[0]).toMatchObject({
            name: 'Proveedores',
            fields: [
                { label: 'Nombre', type: 'text' },
                { label: 'Estado', type: 'select' },
                { label: 'Saldo', type: 'currency' },
                { label: 'Próximo pago', type: 'date' },
            ],
            views: [{ name: 'Por estado', type: 'kanban' }],
        });
        const done = events.at(-1) as { type: 'done'; conversation_id: string; usage: { input_tokens: number } };
        expect(done.type).toBe('done');
        expect(done.usage.input_tokens).toBe(300);
        expect(fake.calls.n).toBe(3);
        // El segundo turno recibió el tool_result del primero.
        const second = fake.seen[1]!;
        expect(second.at(-1)!.role).toBe('user');
        expect(JSON.stringify(second.at(-1)!.content)).toContain('tool_result');

        // Todavía no existe nada.
        expect(await lists.list(tenantId)).toHaveLength(0);

        // Aplicar → existe, con campos, kanban agrupado por el select y título.
        const applied = await proposals.apply(ctx, proposalEv.proposal.id);
        expect(applied.applied).toBe(true);
        expect(applied.result?.links[0]?.href).toBe('/lists/proveedores/records');
        const [created] = await lists.list(tenantId);
        expect(created!.name).toBe('Proveedores');
        const fs = await fields.listByListId(tenantId, created!.id);
        expect(fs.map((f) => f.slug)).toEqual(['nombre', 'estado', 'saldo', 'proximo_pago']);
        expect(fs[1]!.config).toMatchObject({ options: [{ value: 'activo', label: 'Activo', color: 'emerald' }, { value: 'inactivo', label: 'Inactivo' }] });
        expect(fs[2]!.config).toMatchObject({ currency: 'COP', precision: 0 });
        expect(fs[3]!.config).toMatchObject({ highlight_overdue: true });
        // El título se guardó como id real (el blueprint resolvió `{$field}`).
        expect((created!.settings as { title_field_id?: number }).title_field_id).toBe(fs[0]!.id);
        expect((await fields.list(tenantId, String(created!.id)))[0]!.is_primary).toBe(true);
        const vs = await views.list(tenantId, String(created!.id));
        const kanban = vs.find((v) => v.type === 'kanban')!;
        expect(kanban.config.group_by_field_id).toBe(fs[1]!.id);

        // Aplicar dos veces → 409. Otro tenant no la ve → 404.
        await expect(proposals.apply(ctx, proposalEv.proposal.id)).rejects.toMatchObject({ status: 409 });
        await expect(proposals.apply({ ...ctx, tenantId: otherTenantId }, proposalEv.proposal.id)).rejects.toMatchObject({ status: 404 });

        // Bitácora + cuota (3 llamadas al modelo = 1 pedido).
        const audits = await tenantDb.withTenant(tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)));
        expect(audits.some((a) => a.action === 'ai.apply')).toBe(true);
        expect(await quota.usedThisMonth(tenantId)).toBe(1);
        const [usage] = await pg.db.select().from(aiUsage).where(and(eq(aiUsage.tenantId, tenantId)));
        expect(usage).toMatchObject({ requests: 1, inputTokens: 300, outputTokens: 60 });

        // La conversación quedó con el transcript y la tarjeta marcada como aplicada.
        const conv = await svc.conversation(ctx, done.conversation_id);
        expect(conv!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
        expect(conv!.messages[1]!.proposals[0]).toMatchObject({ id: proposalEv.proposal.id, applied: true });
        expect(conv!.messages[1]!.text).toContain('Revísala');
    });

    it('un input inválido vuelve al modelo como error corregible y NO crea propuesta', async () => {
        const { svc, fake } = assistantWith([
            { tool: 'propose_create_view', input: { list: 'no-existe', view: { name: 'X', type: 'kanban' } } },
            { text: 'Esa lista no existe.' },
        ]);
        const events = await run(svc, ctx, 'Haz un kanban');
        const end = events.find((e) => e.type === 'tool_end') as { ok: boolean; summary: string };
        expect(end.ok).toBe(false);
        expect(end.summary).toContain('no existe');
        expect(events.some((e) => e.type === 'proposal')).toBe(false);
        const result = JSON.stringify(fake.seen[1]!.at(-1)!.content);
        expect(result).toContain('"is_error":true');
    });

    it('agregar campos, cambiar opciones, crear vista con filtros y automatización sobre una lista existente', async () => {
        const list = await lists.create(tenantId, { name: 'Facturas' });
        const numero = await fields.create(tenantId, String(list.id), { label: 'Número', type: 'text' });
        const estado = await fields.create(tenantId, String(list.id), {
            label: 'Estado', type: 'select', config: { options: [{ value: 'pendiente', label: 'Pendiente' }] },
        });
        const monto = await fields.create(tenantId, String(list.id), { label: 'Monto', type: 'currency', config: { currency: 'USD' } });
        const venc = await fields.create(tenantId, String(list.id), { label: 'Vencimiento', type: 'date' });

        const { svc } = assistantWith([
            { tool: 'get_list_schema', input: { list: 'facturas' } },
            { tool: 'propose_add_fields', input: { list: 'facturas', fields: [{ label: 'Email del cliente', type: 'email' }, { label: 'Estado', type: 'text' }] } },
            { tool: 'propose_add_fields', input: { list: 'facturas', fields: [{ label: 'Email del cliente', type: 'email' }] } },
            { tool: 'propose_update_field', input: { list: 'facturas', field: 'estado', add_options: [{ label: 'Pagada', color: 'emerald' }] } },
            {
                tool: 'propose_create_view',
                input: {
                    list: 'facturas',
                    view: { name: 'Pendientes', type: 'table', filters: [{ field: 'estado', op: 'eq', value: 'pendiente' }], sort: [{ field: 'vencimiento', dir: 'asc' }] },
                },
            },
            {
                tool: 'propose_create_automation',
                input: {
                    list: 'facturas',
                    name: 'Recordatorio',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vencimiento', offset_minutes: -1440, field_filters: [{ field: 'estado', op: 'eq', value: 'pendiente' }] },
                    // OJO: `email_del_cliente` todavía NO existe (es del add_fields
                    // pendiente) — referenciarlo rebotaría hasta aplicar aquél.
                    actions: [{ type: 'send_email', config: { to: 'cobranzas@acme.com', subject: 'Vence {{numero}}', body: 'Hola' } }],
                },
            },
            { text: 'Listo.' },
        ]);
        const events = await run(svc, ctx, 'Mejora facturas');
        const ends = events.filter((e) => e.type === 'tool_end') as Array<{ name: string; ok: boolean; summary: string }>;
        // El esquema se leyó; el 1er add_fields rebotó por slug duplicado; el resto OK.
        expect(ends.map((e) => [e.name, e.ok])).toEqual([
            ['get_list_schema', true],
            ['propose_add_fields', false],
            ['propose_add_fields', true],
            ['propose_update_field', true],
            ['propose_create_view', true],
            ['propose_create_automation', true],
        ]);
        expect(ends[1]!.summary).toContain('ya tiene un campo «estado»');
        const props = events.filter((e) => e.type === 'proposal').map((e) => (e as { proposal: AiProposal }).proposal);
        expect(props.map((p) => p.kind)).toEqual(['add_fields', 'update_field', 'create_view', 'create_automation']);
        expect(props[1]!.preview.changes[0]).toMatchObject({ label: 'Opciones', from: 'Pendiente', to: 'Pendiente, Pagada' });
        expect(props[3]!.preview.automation).toMatchObject({ trigger: '1 día antes de «Vencimiento»', actions: ['Enviar correo a cobranzas@acme.com'] });

        for (const p of props) await proposals.apply(ctx, p.id);

        const fs = await fields.listByListId(tenantId, list.id);
        expect(fs.map((f) => f.slug)).toContain('email_del_cliente');
        const estado2 = fs.find((f) => f.id === estado.id)!;
        expect((estado2.config as { options: Array<{ value: string }> }).options.map((o) => o.value)).toEqual(['pendiente', 'pagada']);
        const vs = await views.list(tenantId, String(list.id));
        const pend = vs.find((v) => v.name === 'Pendientes')!;
        expect(pend.config.filter_tree).toEqual({ type: 'group', logic: 'and', children: [{ type: 'condition', field_id: estado.id, op: 'eq', value: 'pendiente' }] });
        expect(pend.config.sort).toEqual([{ field_id: venc.id, dir: 'asc' }]);
        const autos = await automations.list(tenantId, String(list.id));
        expect(autos[0]).toMatchObject({ name: 'Recordatorio', trigger_type: 'due_date_reached', is_active: true });
        void numero;
        void monto;
    });

    it('v0.1.291 — crea «Tiempo registrado» (sin config) y el esquema lo describe como de sólo lectura', async () => {
        const list = await lists.create(tenantId, { name: 'Proyectos IA' });
        await fields.create(tenantId, String(list.id), { label: 'Nombre', type: 'text' });
        const res = await registry.execute(ctx, 'propose_add_fields', { list: list.slug, fields: [{ label: 'Horas', type: 'time_tracked' }] });
        expect(res.isError).toBeFalsy();
        const proposalId = JSON.stringify(res.content).match(/"proposal_id\\?":\\?"([^"\\]+)/)?.[1];
        expect(proposalId).toBeDefined();
        await proposals.apply(ctx, proposalId!);
        const fs = await fields.listByListId(tenantId, list.id);
        expect(fs.find((f) => f.slug === 'horas')).toMatchObject({ type: 'time_tracked' });
        const schema = await registry.execute(ctx, 'get_list_schema', { list: list.slug });
        expect(JSON.stringify(schema.content)).toContain('time_tracked');
        expect(JSON.stringify(schema.content)).toContain('minutos registrados');
    });

    it('fórmulas (A1): se proponen por NOMBRE, se guardan por id y el esquema las muestra por nombre', async () => {
        const list = await lists.create(tenantId, { name: 'Pedidos IA' });
        await fields.create(tenantId, String(list.id), { label: 'Precio', type: 'currency', config: { currency: 'COP' } });
        await fields.create(tenantId, String(list.id), { label: 'Cantidad', type: 'number' });
        // Un campo que no existe vuelve al modelo como error corregible.
        const bad = await registry.execute(ctx, 'propose_add_fields', {
            list: list.slug,
            fields: [{ label: 'Total', type: 'formula', formula: { expression: '{Precio} * {Unidades}' } }],
        });
        expect(bad.isError).toBe(true);
        expect(JSON.stringify(bad.content)).toContain('No hay ningún campo «Unidades»');
        const res = await registry.execute(ctx, 'propose_add_fields', {
            list: list.slug,
            fields: [
                { label: 'Total', type: 'formula', formula: { expression: '{Precio} * {Cantidad}' } },
                { label: 'Con IVA', type: 'formula', formula: { expression: 'REDONDEAR({Total} * 1.19)' } },
            ],
        });
        expect(res.isError).toBeFalsy();
        const proposalId = JSON.stringify(res.content).match(/"proposal_id\\?":\\?"([^"\\]+)/)?.[1];
        await proposals.apply(ctx, proposalId!);
        const fs = await fields.listByListId(tenantId, list.id);
        const precio = fs.find((f) => f.slug === 'precio')!;
        const total = fs.find((f) => f.slug === 'total')!;
        expect(total.config.formula).toBe(`{#${precio.id}} * {#${fs.find((f) => f.slug === 'cantidad')!.id}}`);
        expect(fs.find((f) => f.slug === 'con_iva')!.config.formula).toBe(`REDONDEAR({#${total.id}} * 1.19)`);
        const schema = JSON.stringify((await registry.execute(ctx, 'get_list_schema', { list: list.slug })).content);
        expect(schema).toContain('{Precio} * {Cantidad}');
        expect(schema).toContain('REDONDEAR({Total} * 1.19)');

        // Cambiarla también es por nombre; un ciclo vuelve como error corregible.
        const cyc = await registry.execute(ctx, 'propose_update_field', {
            list: list.slug,
            field: 'total',
            formula: { expression: '{Con IVA} / 1.19' },
        });
        expect(cyc.isError).toBe(true);
        expect(JSON.stringify(cyc.content)).toMatch(/círculo/);
        const upd = await registry.execute(ctx, 'propose_update_field', {
            list: list.slug,
            field: 'total',
            formula: { expression: '{Precio} * {Cantidad} * 2' },
        });
        expect(upd.isError).toBeFalsy();
        await proposals.apply(ctx, JSON.stringify(upd.content).match(/"proposal_id\\?":\\?"([^"\\]+)/)![1]!);
        const after = (await fields.listByListId(tenantId, list.id)).find((f) => f.slug === 'total')!;
        expect(after.config.formula).toBe(`{#${precio.id}} * {#${fs.find((f) => f.slug === 'cantidad')!.id}} * 2`);
    });

    it('la automatización con un slug inexistente se rechaza con la lista de slugs válidos', async () => {
        const list = await lists.create(tenantId, { name: 'Tareas' });
        await fields.create(tenantId, String(list.id), { label: 'Título', type: 'text' });
        const res = await registry.execute(ctx, 'propose_create_automation', {
            list: 'tareas',
            name: 'X',
            trigger_type: 'record_updated',
            trigger_config: { changed_fields: ['estado'] },
            actions: [{ type: 'update_field', config: { values: { prioridad: 'alta' } } }],
        });
        expect(res.isError).toBe(true);
        expect(JSON.stringify(res.content)).toContain('estado, prioridad');
        expect(JSON.stringify(res.content)).toContain('Campos válidos: titulo');
    });

    it('tablero: resuelve slugs a ids, valida métricas y arma el layout solo', async () => {
        const list = await lists.create(tenantId, { name: 'Ventas' });
        const estado = await fields.create(tenantId, String(list.id), { label: 'Etapa', type: 'select', config: { options: [{ value: 'a', label: 'A' }] } });
        const monto = await fields.create(tenantId, String(list.id), { label: 'Monto', type: 'currency', config: { currency: 'USD' } });
        const fecha = await fields.create(tenantId, String(list.id), { label: 'Cierre', type: 'date' });

        const bad = await registry.execute(ctx, 'propose_create_dashboard', {
            name: 'Malo',
            widgets: [{ type: 'kpi', list: 'ventas', title: 'Suma', metric: 'sum', metric_field: 'etapa' }],
        });
        expect(bad.isError).toBe(true);
        expect(JSON.stringify(bad.content)).toContain('sólo aplica a campos numéricos');

        const ok = await registry.execute(ctx, 'propose_create_dashboard', {
            name: 'Pipeline',
            widgets: [
                { type: 'kpi', list: 'ventas', title: 'Oportunidades' },
                { type: 'kpi', list: 'ventas', title: 'Total', metric: 'sum', metric_field: 'monto', prefix: '$' },
                { type: 'chart_pie', list: 'ventas', title: 'Por etapa', group_by: 'etapa', filters: [{ field: 'monto', op: 'gt', value: 0 }] },
                { type: 'chart_line', list: 'ventas', title: 'Cierres', date_field: 'cierre', metric: 'sum', metric_field: 'monto' },
                { type: 'table', list: 'ventas', title: 'Próximos', sort_field: 'cierre', limit: 5 },
            ],
        });
        expect(ok.isError).toBeFalsy();
        expect(ok.proposal!.preview.widgets).toHaveLength(5);
        const applied = await proposals.apply(ctx, ok.proposal!.id);
        expect(applied.result?.links[0]?.href).toMatch(/^\/dashboards\/\d+$/);
        const [dash] = await dashboards.list(tenantId, { userId, role: 'admin' });
        const w = dash!.widgets;
        expect(w.map((x) => x.layout)).toEqual([
            { x: 0, y: 0, w: 3, h: 2 },
            { x: 3, y: 0, w: 3, h: 2 },
            { x: 6, y: 0, w: 6, h: 4 },
            { x: 0, y: 4, w: 6, h: 4 },
            { x: 0, y: 8, w: 12, h: 4 },
        ]);
        expect(w[1]!.config).toMatchObject({ metric: 'sum', metric_field_id: monto.id, prefix: '$' });
        expect(w[2]!.config).toMatchObject({ group_by_field_id: estado.id, filter_tree: { children: [{ field_id: monto.id, op: 'gt', value: 0 }] } });
        expect(w[3]!.config).toMatchObject({ date_field_id: fecha.id, time_bucket: 'month' });
        expect(w[4]!.config).toMatchObject({ limit: 5, sort_field_id: fecha.id, sort_dir: 'asc' });
    });

    it('v0.1.292 — tablero con barras desglosadas y tabla dinámica (y sus errores corregibles)', async () => {
        const list = await lists.create(tenantId, { name: 'Pedidos' });
        const etapa = await fields.create(tenantId, String(list.id), { label: 'Etapa', type: 'select', config: { options: [{ value: 'a', label: 'A' }] } });
        const zona = await fields.create(tenantId, String(list.id), { label: 'Zona', type: 'select', config: { options: [{ value: 'n', label: 'Norte' }] } });
        await fields.create(tenantId, String(list.id), { label: 'Valor', type: 'currency' });
        const mal = await registry.execute(ctx, 'propose_create_dashboard', {
            name: 'Mal',
            widgets: [{ type: 'chart_bar', list: 'pedidos', group_by: 'etapa', breakdown_by: 'zona', metric: 'avg', metric_field: 'valor', stack: 'stacked' }],
        });
        expect(mal.isError).toBe(true);
        expect(JSON.stringify(mal.content)).toContain('stack=');
        const sinCols = await registry.execute(ctx, 'propose_create_dashboard', { name: 'Mal', widgets: [{ type: 'pivot', list: 'pedidos', group_by: 'etapa' }] });
        expect(JSON.stringify(sinCols.content)).toContain('breakdown_by');
        const mismo = await registry.execute(ctx, 'propose_create_dashboard', { name: 'Mal', widgets: [{ type: 'chart_bar', list: 'pedidos', group_by: 'etapa', breakdown_by: 'etapa' }] });
        expect(JSON.stringify(mismo.content)).toContain('distinto del eje principal');

        const ok = await registry.execute(ctx, 'propose_create_dashboard', {
            name: 'Pedidos por zona',
            widgets: [
                { type: 'chart_bar', list: 'pedidos', title: 'Etapas por zona', group_by: 'etapa', breakdown_by: 'zona', percent: true, orientation: 'vertical' },
                { type: 'pivot', list: 'pedidos', title: 'Valor', group_by: 'etapa', breakdown_by: 'zona', metric: 'sum', metric_field: 'valor', heatmap: true, columns_limit: 6 },
            ],
        });
        expect(ok.isError).toBeFalsy();
        await proposals.apply(ctx, ok.proposal!.id);
        const all = await dashboards.list(tenantId, { userId, role: 'admin' });
        const dash = all.find((d) => d.name === 'Pedidos por zona')!;
        expect(dash.widgets[0]!.config).toMatchObject({
            group_by_field_id: etapa.id,
            sub_group_by_field_id: zona.id,
            stack_mode: 'stacked',
            stack_percent: true,
            bar_orientation: 'vertical',
        });
        expect(dash.widgets[1]).toMatchObject({ type: 'pivot', layout: { w: 8, h: 5 } });
        expect(dash.widgets[1]!.config).toMatchObject({ group_by_field_id: etapa.id, sub_group_by_field_id: zona.id, heatmap: true, col_top_n: 6 });
        const listed = await registry.execute(ctx, 'list_dashboards', {});
        expect(JSON.stringify(listed.content)).toContain('"breakdown_by":"zona"');
    });

    it('el rol manda: un manager no ve las herramientas de estructura y no puede aplicar una propuesta ajena a su rol', async () => {
        const manager: AiToolContext = { ...ctx, role: 'manager' };
        const names = registry.toAnthropicTools('manager').map((t) => t.name);
        expect(names).toContain('propose_create_view');
        expect(names).toContain('propose_create_dashboard');
        expect(names).not.toContain('propose_create_list');
        expect(names).not.toContain('propose_add_fields');
        const denied = await registry.execute(manager, 'propose_create_list', { lists: [{ name: 'X', fields: [{ label: 'A', type: 'text' }] }] });
        expect(denied.isError).toBe(true);
        expect(JSON.stringify(denied.content)).toContain('manage_lists');

        // Propuesta creada como admin; el rol baja antes de aplicar → 403.
        const created = await registry.execute(ctx, 'propose_create_list', { lists: [{ name: 'Y', fields: [{ label: 'A', type: 'text' }] }] });
        await expect(proposals.apply(manager, created.proposal!.id)).rejects.toMatchObject({ status: 403 });
    });

    it('borrar un campo es destructivo y se marca así; al aplicar desaparece', async () => {
        const list = await lists.create(tenantId, { name: 'Clientes' });
        const f = await fields.create(tenantId, String(list.id), { label: 'Fax', type: 'text' });
        const res = await registry.execute(ctx, 'propose_delete_field', { list: 'clientes', field: 'fax' });
        expect(res.proposal).toMatchObject({ kind: 'delete_field', destructive: true });
        await proposals.apply(ctx, res.proposal!.id);
        expect((await fields.listByListId(tenantId, list.id)).some((x) => x.id === f.id)).toBe(false);
    });

    it('cuota por plan: con clave de plataforma se corta al llegar al límite; con clave propia no cuenta', async () => {
        await plans.update('trial', { max_ai_requests_month: 2 });
        const { svc } = assistantWith([{ text: 'hola' }, { text: 'hola' }, { text: 'hola' }]);
        await run(svc, ctx, 'uno');
        await run(svc, ctx, 'dos');
        expect((await svc.status(ctx))).toMatchObject({ available: false, usage: { used: 2, limit: 2 } });
        await expect(run(svc, ctx, 'tres')).rejects.toBeInstanceOf(AiQuotaExceededError);
        expect(await quota.usedThisMonth(tenantId)).toBe(2);

        // Clave propia → habla igual y el contador no se mueve.
        await settings.updateTenant(tenantId, { api_key: 'sk-ant-empresa-1111111111111111111' });
        const own = assistantWith([{ text: 'hola' }]);
        const events = await run(own.svc, ctx, 'cuatro');
        expect(events.at(-1)!.type).toBe('done');
        expect(await quota.usedThisMonth(tenantId)).toBe(2);
        expect(await own.svc.status(ctx)).toMatchObject({ available: true, source: 'tenant', usage: { limit: null } });
        await plans.update('trial', { max_ai_requests_month: 20 });
    });

    // ── Modelos detectados solos (v0.1.305) ───────────────────────────

    it('«el más reciente» se resuelve contra lo que devuelve el proveedor y se actualiza solo', async () => {
        expect((await settings.getPlatform()).model).toBe('auto:opus');
        const { svc, fake } = assistantWith([{ text: 'hola' }]);
        await run(svc, ctx, 'hola');
        expect(fake.params[0]).toMatchObject({ model: 'claude-opus-9-5', thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
        expect(await svc.status(ctx)).toMatchObject({ available: true, model: 'claude-opus-9-5', model_name: 'Claude Opus 9.5', model_fallback_from: null });

        // El proveedor publica uno nuevo: al refrescar el catálogo se usa solo, sin tocar código ni configuración.
        setProviderModels([...BASE_MODELS, { id: 'claude-opus-10', display_name: 'Claude Opus 10', created_at: '2031-01-01T00:00:00Z', capabilities: ADAPTIVE }]);
        const cat = await settings.platformCatalog(true);
        expect(cat.families.find((f) => f.family === 'opus')).toMatchObject({ label: 'Opus', latest_id: 'claude-opus-10', latest_name: 'Claude Opus 10' });
        expect((await settings.resolve(tenantId)).model).toBe('claude-opus-10');
    });

    it('una versión fija se respeta; si el proveedor la retira se usa la más reciente de su familia y se avisa', async () => {
        await settings.updateTenant(tenantId, { model: 'claude-opus-9' });
        expect(await settings.resolve(tenantId)).toMatchObject({ model: 'claude-opus-9', choice: 'claude-opus-9', fallbackFrom: null });
        setProviderModels(BASE_MODELS.filter((m) => m.id !== 'claude-opus-9'));
        await settings.platformCatalog(true);
        expect(await settings.resolve(tenantId)).toMatchObject({ model: 'claude-opus-9-5', fallbackFrom: 'claude-opus-9' });
        const { svc } = assistantWith([]);
        expect(await svc.status(ctx)).toMatchObject({ model: 'claude-opus-9-5', model_fallback_from: 'claude-opus-9' });
    });

    it('un modelo que sólo acepta presupuesto fijo recibe ese pedido (y no uno que le daría 400)', async () => {
        await settings.updateTenant(tenantId, { model: 'auto:haiku' });
        const { svc, fake } = assistantWith([{ text: 'hola' }]);
        await run(svc, ctx, 'hola');
        expect(fake.params[0]).toMatchObject({ model: 'claude-haiku-3-9', thinking: { type: 'enabled', budget_tokens: 2048 } });
        expect(fake.params[0]!.output_config).toBeUndefined();
        expect(fake.params[0]!.max_tokens).toBeGreaterThan(2048);
    });

    it('lo que guardaban las versiones anteriores sigue andando y pasa a «el más reciente» de su familia', async () => {
        await redis.set('platform:ai', JSON.stringify({ ...JSON.parse((await redis.get('platform:ai'))!), model: 'claude-sonnet-1', model_choice: undefined }));
        expect((await settings.getPlatform()).model).toBe('auto:sonnet');
        expect((await settings.resolve(tenantId)).model).toBe('claude-sonnet-9-5');
        // Un valor ilegible NO borra la clave ni los interruptores (antes, sí).
        await redis.set('platform:ai', JSON.stringify({ ...JSON.parse((await redis.get('platform:ai'))!), model: 42, model_choice: 'cualquier-cosa' }));
        expect(await settings.getPlatform()).toMatchObject({ enabled: true, has_key: true, model: 'auto:opus' });
    });

    it('si el proveedor no responde se sigue con lo último que se supo; sin nada sabido, el motivo es claro', async () => {
        await settings.platformCatalog(true);
        setProviderModels([]);
        const cat = await settings.platformCatalog(true);
        expect(cat.error).toContain('503');
        expect(cat.models.length).toBeGreaterThan(0);
        expect((await settings.resolve(tenantId)).model).toBe('claude-opus-9-5');

        await redis.flushdb();
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-otra-000000000000', share_platform_key: true });
        await settings.updateTenant(tenantId, { enabled: true });
        await expect(settings.resolve(tenantId)).rejects.toMatchObject({ reason: 'models_unavailable' });
        const { svc } = assistantWith([]);
        expect((await svc.status(ctx)).reason).toContain('No se pudo consultar qué modelos ofrece el proveedor');
    });

    it('el catálogo se guarda por clave (hash, nunca la clave) y no se consulta en cada mensaje', async () => {
        listerCalls = 0;
        const { svc } = assistantWith([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
        await run(svc, ctx, 'uno');
        await run(svc, ctx, 'dos');
        await run(svc, ctx, 'tres');
        expect(listerCalls).toBeLessThanOrEqual(1);
        const keys = await redis.keys('ai:models:*');
        expect(keys.length).toBe(1);
        expect(await redis.get(keys[0]!)).not.toContain('sk-ant-');
        // La empresa con clave propia ve SU catálogo.
        await settings.updateTenant(tenantId, { api_key: 'sk-ant-empresa-1111111111111111111' });
        setProviderModels([{ id: 'claude-sonnet-9-5', display_name: 'Claude Sonnet 9.5', created_at: null, capabilities: ADAPTIVE }]);
        const own = await settings.tenantCatalog(tenantId);
        expect(own.families.map((f) => f.family)).toEqual(['sonnet']);
        // Su elección «Opus» no existe para su clave → cae a la primera familia que sí ve, avisando.
        expect(await settings.resolve(tenantId)).toMatchObject({ source: 'tenant', model: 'claude-sonnet-9-5', fallbackFrom: 'auto:opus' });
    });

    it('cada turno nuevo manda la conversación sin el pensamiento de los anteriores; dentro del turno, intacto', async () => {
        const { svc, fake } = assistantWith([
            { tool: 'list_lists', input: {}, think: true },
            { text: 'Tienes 0 listas.', think: true },
            { text: 'De nada.' },
        ]);
        const first = await run(svc, ctx, '¿cuántas listas tengo?');
        const id = (first.at(-1) as { conversation_id: string }).conversation_id;
        // Segunda llamada del MISMO turno: el pensamiento del tool_use viaja intacto.
        expect(JSON.stringify(fake.seen[1])).toContain('firma_1');
        await run(svc, ctx, 'gracias', id);
        // Primera llamada del turno siguiente: ningún pensamiento de antes.
        expect(JSON.stringify(fake.seen[2])).not.toContain('"thinking"');
        expect(JSON.stringify(fake.seen[2])).toContain('Tienes 0 listas.');
    });

    it('status explica por qué no está disponible', async () => {
        await settings.updateTenant(tenantId, { enabled: false });
        const { svc } = assistantWith([]);
        const st = await svc.status(ctx);
        expect(st.available).toBe(false);
        expect(st.reason).toContain('Ajustes → Asistente IA');
        expect(st.can_configure).toBe(true);
        expect((await svc.status({ ...ctx, role: 'agent' })).can_configure).toBe(false);
    });
});
