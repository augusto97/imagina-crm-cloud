import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { RecordAgentsService, previewOf, writesOf, type AgentLimits } from '../src/ai-assist/record-agents.service';
import { cleanModelText, readSummary, valueText } from '../src/ai-assist/record-ai-context';
import { RecordAiContextService } from '../src/ai-assist/record-ai-context.service';
import { RecordAiService } from '../src/ai-assist/record-ai.service';
import { AiModelCatalogService, type ProviderModel } from '../src/ai/ai-model-catalog.service';
import { AiQuotaService } from '../src/ai/ai-quota.service';
import { AiSettingsService } from '../src/ai/ai-settings.service';
import type { AiClientFactory } from '../src/ai/assistant.service';
import { AgentHub } from '../src/ai-agents/agent-hub';
import { AgentProposalsService } from '../src/ai-agents/agent-proposals.service';
import { AgentRunnerService, providerDetail } from '../src/ai-agents/agent-runner.service';
import { AiAgentsService } from '../src/ai-agents/ai-agents.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { PlansService } from '../src/billing/plans.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import {
    activity,
    aiAgentBatches,
    aiAgentProposals,
    aiAgentRuns,
    aiAgents,
    aiUsage,
    automations,
    comments as commentsTable,
    memberships,
    records as recordsTable,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class MemoryHooks implements HookCaptureStore {
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

class NullDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(e: TriggerEvent): void {
        this.events.push(e);
    }
}

interface Call {
    model: string;
    system: unknown;
    messages: MessageParam[];
}

/** Modelo FALSO: responde con el texto que devuelve `reply(call)` (nunca habla con un proveedor). */
function fakeModel(reply: (c: Call, n: number) => string): { factory: AiClientFactory; calls: Call[] } {
    const calls: Call[] = [];
    const factory: AiClientFactory = () =>
        ({
            messages: {
                stream: (p: { model: string; system: unknown; messages: MessageParam[] }) => {
                    const call = { model: p.model, system: p.system, messages: JSON.parse(JSON.stringify(p.messages)) as MessageParam[] };
                    calls.push(call);
                    const text = reply(call, calls.length);
                    const final = {
                        id: `msg_${calls.length}`,
                        type: 'message',
                        role: 'assistant',
                        model: p.model,
                        content: [{ type: 'text', text, citations: null }],
                        stop_reason: 'end_turn',
                        stop_sequence: null,
                        usage: { input_tokens: 120, output_tokens: 30 },
                    } as unknown as Message;
                    return { finalMessage: async () => final };
                },
            },
        }) as never;
    return { factory, calls };
}

const CAPS = { thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }, effort: { supported: true } };
const MODELS: ProviderModel[] = [
    { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: CAPS },
    { id: 'claude-haiku-9-0', display_name: 'Claude Haiku 9', created_at: '2030-06-01T00:00:00Z', capabilities: CAPS },
];

const SUMMARY_JSON = JSON.stringify({
    headline: 'Cliente activo con dos facturas.',
    points: ['Pidió una cotización nueva.'],
    pending: ['Responder la cotización.'],
    next: ['Factura vence el viernes.'],
});

const userText = (c: Call): string => {
    const m = c.messages[0];
    return typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content);
};

/**
 * v0.1.456 (ADR-S109) — IA en el día a día (Postgres + Redis reales, modelo
 * FALSO): el resumen del registro con lo que la persona PUEDE ver (campos
 * ocultos, registros fuera de su alcance), la cuota (reserva y cierre), la
 * caché y cuándo se invalida; escribir y reescribir; sugerir la respuesta;
 * pedirle a un agente desde la ficha (permisos y estado) y en lote (topes del
 * agente y cuota); sin IA, el motivo.
 */
describe('IA en el día a día (Postgres + Redis reales, modelo falso)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let comments: CommentsService;
    let activitySvc: ActivityService;
    let settings: AiSettingsService;
    let quota: AiQuotaService;
    let agents: AiAgentsService;
    let proposals: AgentProposalsService;
    let hub: AgentHub;
    let tz: TenantTimeZones;
    let tenantA: number;
    let ana: Actor; // admin
    let beto: Actor; // agente: «Costo» oculto en Clientes, ve sólo lo suyo
    let vera: Actor; // lectora
    let f: Record<string, Field>;
    let clientesId: number;
    let model: ReturnType<typeof fakeModel>;
    let replyFn: (c: Call, n: number) => string;
    let ai: RecordAiService;
    let recAgents: RecordAgentsService;
    let runner: AgentRunnerService;

    function build(): void {
        model = fakeModel((c, n) => replyFn(c, n));
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '', NODE_ENV: 'test' });
        runner = new AgentRunnerService(
            tenantDb,
            agents,
            proposals,
            settings,
            quota,
            lists,
            recs,
            comments,
            activitySvc,
            new RealtimeService(),
            env,
            hub,
            model.factory,
            new IncidentHub(),
            tz,
        );
        void runner.onModuleInit();
        const context = new RecordAiContextService(tenantDb, lists, fieldsSvc, recs, comments, activitySvc, tz);
        ai = new RecordAiService(context, recs, settings, quota, redis as never, model.factory);
        recAgents = new RecordAgentsService(tenantDb, lists, recs, agents, runner, settings, quota, tz, new AuditService(tenantDb));
        recAgents.onModuleInit();
    }

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activitySvc, new NullDispatcher(), new RelationsRepository());
        comments = new CommentsService(tenantDb, new CommentsRepository(), lists, recs, rt);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '', NODE_ENV: 'test' });
        settings = new AiSettingsService(redis as never, pg.db, env, new AiModelCatalogService(redis as never, async () => MODELS));
        quota = new AiQuotaService(pg.db, new PlansService(pg.db));
        tz = new TenantTimeZones(tenantDb);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        hub = new AgentHub();
        const autos = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new MemoryHooks(), connectors, tz);
        agents = new AiAgentsService(tenantDb, lists, autos, new AuditService(tenantDb), new IncidentHub(), tz);
        const notifications = { deliver: () => Promise.resolve() } as unknown as NotificationsService;
        proposals = new AgentProposalsService(tenantDb, lists, recs, comments, activitySvc, rt, agents, notifications);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantA = ta!.id;
        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        beto = { userId: await mk('beto@acme.test', 'Beto'), role: 'agent' };
        vera = { userId: await mk('vera@acme.test', 'Vera'), role: 'viewer' };
        await withTenant(pg.db, tenantA, (tx) => tx.insert(memberships).values([ana, beto, vera].map((a) => ({ tenantId: tenantA, userId: a.userId, role: a.role }))));
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        await redis.flushall();
        await pg.db.delete(aiUsage);
        await pg.db.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantA));
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.delete(aiAgentProposals).where(eq(aiAgentProposals.tenantId, tenantA));
            await tx.delete(aiAgentRuns).where(eq(aiAgentRuns.tenantId, tenantA));
            await tx.delete(aiAgentBatches).where(eq(aiAgentBatches.tenantId, tenantA));
            await tx.delete(aiAgents).where(eq(aiAgents.tenantId, tenantA));
            await tx.delete(automations).where(eq(automations.tenantId, tenantA));
            await tx.delete(commentsTable).where(eq(commentsTable.tenantId, tenantA));
            await tx.delete(activity).where(eq(activity.tenantId, tenantA));
            await tx.delete(recordsTable).where(eq(recordsTable.tenantId, tenantA));
        });
        for (const l of await lists.list(tenantA)) await lists.remove(tenantA, String(l.id), { permanent: true });
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-0000000000000000', share_platform_key: true, allow_tenant_keys: true });
        await settings.updateTenant(tenantA, { enabled: true });

        clientesId = (await lists.create(tenantA, { name: 'Clientes', slug: 'clientes' })).id;
        await lists.create(tenantA, { name: 'Facturas', slug: 'facturas' });
        f = {};
        for (const d of [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Correo', type: 'email', slug: 'correo' },
            { label: 'Costo interno', type: 'number', slug: 'costo' },
            { label: 'Estado', type: 'select', slug: 'estado', config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'perdido', label: 'Perdido' }] } },
        ] as CreateFieldInput[]) {
            f[d.slug!] = await fieldsSvc.create(tenantA, 'clientes', d);
        }
        f.numero = await fieldsSvc.create(tenantA, 'facturas', { label: 'Número', type: 'text', slug: 'numero' } as CreateFieldInput);
        f.monto = await fieldsSvc.create(tenantA, 'facturas', { label: 'Monto', type: 'currency', slug: 'monto', config: { currency: 'COP' } } as CreateFieldInput);
        f.cliente = await fieldsSvc.create(tenantA, 'facturas', { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientesId } } as CreateFieldInput);
        const c = await lists.get(tenantA, 'clientes');
        await lists.update(tenantA, 'clientes', {
            settings: { ...c.settings, permissions: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['costo'] } } } },
        });
        replyFn = () => SUMMARY_JSON;
        build();
    });

    const k = (slug: string) => `f${f[slug]!.id}`;
    const cliente = (who: Actor, data: Record<string, unknown> = {}) =>
        recs.create(tenantA, who, 'clientes', { data: { [k('nombre')]: 'Ferretería El Tornillo', [k('correo')]: 'compras@tornillo.test', [k('costo')]: 777_000, [k('estado')]: 'activo', ...data } });
    const factura = (clienteId: number, numero: string, monto: number) =>
        recs.create(tenantA, ana, 'facturas', { data: { [k('numero')]: numero, [k('monto')]: monto, [k('cliente')]: [clienteId] } });
    const used = async () => (await quota.summary(tenantA)).used;
    const newAgent = (over: Record<string, unknown> = {}) =>
        agents.create(tenantA, ana, {
            name: 'Clasificador',
            description: 'Clasifica clientes.',
            instructions: 'Revisa el cliente.',
            list_ids: [clientesId],
            tools: ['read_record', 'comment'],
            mode: 'propose',
            settings: { client_comments: false, reviewer_user_ids: [] },
            max_steps: 4,
            max_runs_per_day: 200,
            monthly_token_budget: null,
            is_active: true,
            ...over,
        } as never);

    // ── Resumen ──────────────────────────────────────────────────────────

    it('resumen: manda lo que se ve (campos, comentarios, vinculados con total y suma), gasta UN pedido y queda en caché hasta que algo cambia', async () => {
        const r = await cliente(ana);
        await factura(r.id, 'FAC-1', 100_000);
        await factura(r.id, 'FAC-2', 250_000);
        await comments.create(tenantA, ana, 'clientes', r.id, { body: 'Pidió una cotización nueva para tornillos.', kind: 'note' });

        const s1 = await ai.summary(tenantA, ana, 'clientes', r.id, { refresh: false });
        expect(s1).toMatchObject({ headline: 'Cliente activo con dos facturas.', pending: ['Responder la cotización.'], cached: false, model_name: 'Claude Opus 9.5' });
        expect(model.calls).toHaveLength(1);
        const sent = userText(model.calls[0]!);
        expect(sent).toContain('Ferretería El Tornillo');
        expect(sent).toContain('"Estado":"Activo"'); // la etiqueta, no el valor guardado
        expect(sent).toContain('Pidió una cotización nueva');
        expect(sent).toContain('"total":2');
        expect(sent).toContain('350000 COP');
        expect(String(model.calls[0]!.system)).toContain('DATOS');
        expect(await used()).toBe(1);
        const [usage] = await pg.db.select().from(aiUsage).where(eq(aiUsage.tenantId, tenantA));
        expect(usage!.inputTokens).toBe(120);

        // Sin cambios: de la caché, sin otro pedido.
        const s2 = await ai.summary(tenantA, ana, 'clientes', r.id, { refresh: false });
        expect(s2.cached).toBe(true);
        expect(model.calls).toHaveLength(1);
        expect(await used()).toBe(1);

        // Un comentario nuevo cambia lo que se resume: se pide de nuevo.
        await comments.create(tenantA, ana, 'clientes', r.id, { body: 'Ya respondí la cotización.', kind: 'note' });
        expect((await ai.summary(tenantA, ana, 'clientes', r.id, { refresh: false })).cached).toBe(false);
        expect(model.calls).toHaveLength(2);
        // «Actualizar» pide aunque no haya cambios.
        expect((await ai.summary(tenantA, ana, 'clientes', r.id, { refresh: true })).cached).toBe(false);
        expect(model.calls).toHaveLength(3);
        expect(await used()).toBe(3);
    });

    it('resumen: un campo oculto para el rol nunca viaja, y un registro fuera de su alcance da 404 sin gastar', async () => {
        const mine = await recs.create(tenantA, beto, 'clientes', { data: { [k('nombre')]: 'Cliente de Beto', [k('estado')]: 'activo' } });
        await recs.update(tenantA, ana, 'clientes', mine.id, { data: { [k('costo')]: 777_000 } });
        await ai.summary(tenantA, beto, 'clientes', mine.id, { refresh: false });
        const sent = userText(model.calls[0]!);
        expect(sent).toContain('Cliente de Beto');
        expect(sent).not.toContain('Costo interno');
        expect(sent).not.toContain('777000');
        // El mismo registro visto por Ana trae el costo: son contextos distintos (no comparten caché).
        await ai.summary(tenantA, ana, 'clientes', mine.id, { refresh: false });
        expect(userText(model.calls[1]!)).toContain('777000');

        const deAna = await cliente(ana);
        await expect(ai.summary(tenantA, beto, 'clientes', deAna.id, { refresh: false })).rejects.toBeInstanceOf(NotFoundException);
        expect(model.calls).toHaveLength(2);
        expect(await used()).toBe(2);
    });

    it('sin IA: el motivo exacto (empresa sin activarla, cuota agotada, rol sin el permiso) y ningún pedido', async () => {
        const r = await cliente(ana);
        await settings.updateTenant(tenantA, { enabled: false });
        await expect(ai.summary(tenantA, ana, 'clientes', r.id, { refresh: false })).rejects.toMatchObject({
            status: 503,
            response: { code: 'ai_unavailable', data: { reason: 'tenant_disabled' } },
        });
        await settings.updateTenant(tenantA, { enabled: true });

        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantA));
        const limit = (await quota.limitFor(tenantA))!;
        await pg.db.insert(aiUsage).values({ tenantId: tenantA, period: new Date().toISOString().slice(0, 7), requests: limit, inputTokens: 0, outputTokens: 0 });
        await expect(ai.write(tenantA, ana, 'clientes', r.id, { mode: 'rewrite', action: 'fix', text: 'ola' })).rejects.toMatchObject({
            status: 503,
            response: { code: 'ai_quota_exceeded' },
        });
        expect(await used()).toBe(limit);

        await expect(ai.summary(tenantA, { ...ana, capabilities: [] }, 'clientes', r.id, { refresh: false })).rejects.toBeInstanceOf(ForbiddenException);
        expect(model.calls).toHaveLength(0);
    });

    it('el proveedor falla: la reserva se devuelve (no se cobra un pedido que no respondió)', async () => {
        const r = await cliente(ana);
        replyFn = () => {
            throw Object.assign(new Error('boom'), { status: 529 });
        };
        await expect(ai.summary(tenantA, ana, 'clientes', r.id, { refresh: false })).rejects.toMatchObject({ status: 502, response: { code: 'ai_provider_error' } });
        expect(await used()).toBe(0);
    });

    // ── Escribir y responder ─────────────────────────────────────────────

    it('escribir: redacta con los datos del registro (modelo rápido), reescribe lo elegido y exige poder editar', async () => {
        const r = await cliente(ana);
        replyFn = () => '```\n## Próximos pasos\n- Llamar a compras\n```';
        const out = await ai.write(tenantA, ana, 'clientes', r.id, { mode: 'compose', prompt: 'Escribe los próximos pasos' });
        expect(out.text).toBe('## Próximos pasos\n- Llamar a compras');
        expect(model.calls[0]!.model).toBe('claude-haiku-9-0');
        expect(userText(model.calls[0]!)).toContain('Escribe los próximos pasos');
        expect(userText(model.calls[0]!)).toContain('Ferretería El Tornillo');

        replyFn = () => 'Hola, ¿cómo estás?';
        const fixed = await ai.write(tenantA, ana, 'clientes', r.id, { mode: 'rewrite', action: 'translate_es', text: 'Hi, how are you?' });
        expect(fixed.text).toBe('Hola, ¿cómo estás?');
        expect(String(model.calls[1]!.system)).toContain('español neutro');
        expect(userText(model.calls[1]!)).toContain('<texto>\nHi, how are you?\n</texto>');
        expect(await used()).toBe(2);

        // Vera sólo mira: no redacta en la descripción (para su rol el registro no es editable).
        await expect(ai.write(tenantA, vera, 'clientes', r.id, { mode: 'compose', prompt: 'Escribe algo' })).rejects.toBeInstanceOf(NotFoundException);
        expect(model.calls).toHaveLength(2);
    });

    it('sugerir respuesta: toma el hilo del comentario, respeta el borrador y para el cliente no manda las notas internas', async () => {
        const r = await cliente(ana);
        const root = await comments.create(tenantA, ana, 'clientes', r.id, { body: '¿Cuándo llega mi pedido?', kind: 'note', visibility: 'client' });
        await comments.create(tenantA, ana, 'clientes', r.id, { body: 'Nota interna: el proveedor se atrasó.', kind: 'note' });
        replyFn = () => '"Hola, tu pedido llega el lunes."';
        const out = await ai.reply(tenantA, ana, 'clientes', r.id, { comment_id: root.id, hint: 'llega el lunes', for_client: true });
        expect(out.text).toBe('Hola, tu pedido llega el lunes.');
        const sent = userText(model.calls[0]!);
        expect(sent).toContain('¿Cuándo llega mi pedido?');
        expect(sent).toContain('llega el lunes');
        expect(sent).not.toContain('proveedor se atrasó');
        expect(String(model.calls[0]!.system)).toContain('CLIENTE');
    });

    // ── Agente desde la ficha ────────────────────────────────────────────

    it('pedir al agente: corre con la etiqueta de quien pidió, deja la propuesta y su estado; quien no puede editar recibe 403', async () => {
        const a = await newAgent();
        const r = await cliente(ana);
        replyFn = () => 'Revisé el cliente.';
        const opts = await recAgents.forRecord(tenantA, ana, 'clientes', r.id);
        expect(opts.agents.map((x) => x.name)).toEqual(['Clasificador']);
        expect(opts.can_ask).toBe(true);

        const run = await recAgents.ask(tenantA, ana, 'clientes', r.id, { agent_id: a.id, instruction: 'mira la deuda' });
        expect(run).toMatchObject({ agent_name: 'Clasificador', status: 'success', summary: 'Revisé el cliente.', created_by_name: 'Ana' });
        const [row] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, run.id)));
        expect(row!.triggerLabel).toBe('Pedido desde la ficha por Ana');
        expect(row!.instruction).toBe('mira la deuda');
        expect(row!.createdBy).toBe(ana.userId);
        expect((await recAgents.run(tenantA, ana, 'clientes', r.id, run.id)).status).toBe('success');
        expect((await recAgents.forRecord(tenantA, ana, 'clientes', r.id)).runs.map((x) => x.id)).toEqual([run.id]);

        // Vera mira pero no edita: no puede pedir.
        await expect(recAgents.ask(tenantA, vera, 'clientes', r.id, { agent_id: a.id, instruction: '' })).rejects.toMatchObject({ status: 403, response: { code: 'agent_ask_forbidden' } });
        expect((await recAgents.forRecord(tenantA, vera, 'clientes', r.id)).can_ask).toBe(false);
        // Un agente en pausa no se ofrece ni se puede pedir.
        await agents.update(tenantA, ana, a.id, { is_active: false });
        expect((await recAgents.forRecord(tenantA, ana, 'clientes', r.id)).agents).toEqual([]);
        await expect(recAgents.ask(tenantA, ana, 'clientes', r.id, { agent_id: a.id, instruction: '' })).rejects.toMatchObject({ status: 400 });
    });

    // ── Agente en lote ───────────────────────────────────────────────────

    it('lote: la vista previa dice cuántos corren por los topes; corre por tandas y cierra con el resultado', async () => {
        const a = await newAgent({ max_runs_per_day: 3 });
        const ids: number[] = [];
        for (let i = 0; i < 5; i++) ids.push((await cliente(ana, { [k('nombre')]: `Cliente ${i}` })).id);
        replyFn = () => 'Listo.';

        const pv = await recAgents.preview(tenantA, ana, 'clientes', { agent_id: a.id, target: { include_subtasks: false } });
        expect(pv).toMatchObject({ matched: 5, eligible: 5, runs_left_today: 3, quota_left: null, will_run: 3 });
        expect(pv.notes.join(' ')).toContain('le quedan 3 corridas hoy');

        const b = await recAgents.start(tenantA, ana, 'clientes', { agent_id: a.id, target: { ids }, instruction: '' });
        // Sin cola (tests) cada corrida corre en el acto y la siguiente tanda sale al terminar.
        const done = await recAgents.batch(tenantA, ana, 'clientes', b.id);
        expect(done).toMatchObject({ status: 'done', total: 3, dispatched: 3, succeeded: 3, queued: 0, running: 0 });
        const runs = await withTenant(pg.db, tenantA, (tx) => tx.select().from(aiAgentRuns).where(eq(aiAgentRuns.batchId, b.id)));
        expect(runs).toHaveLength(3);
        expect(runs.every((x) => x.triggerLabel === 'En lote' && x.createdBy === ana.userId)).toBe(true);
        // El tope del día ya se usó: no queda capacidad.
        await expect(recAgents.start(tenantA, ana, 'clientes', { agent_id: a.id, target: { ids }, instruction: '' })).rejects.toMatchObject({
            status: 400,
            response: { code: 'agent_batch_no_capacity' },
        });
    });

    it('lote: la cuota del plan acota cuántos corren, y quien no tiene acciones masivas no lo corre', async () => {
        const a = await newAgent();
        const ids: number[] = [];
        for (let i = 0; i < 4; i++) ids.push((await cliente(ana, { [k('nombre')]: `Cliente ${i}` })).id);
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantA));
        const limit = (await quota.limitFor(tenantA))!;
        await pg.db.insert(aiUsage).values({ tenantId: tenantA, period: new Date().toISOString().slice(0, 7), requests: limit - 2, inputTokens: 0, outputTokens: 0 });
        replyFn = () => 'Listo.';
        const pv = await recAgents.preview(tenantA, ana, 'clientes', { agent_id: a.id, target: { ids } });
        expect(pv).toMatchObject({ quota_left: 2, will_run: 2 });
        expect(pv.notes.join(' ')).toContain('Quedan 2 pedidos');
        const b = await recAgents.start(tenantA, ana, 'clientes', { agent_id: a.id, target: { ids }, instruction: '' });
        expect((await recAgents.batch(tenantA, ana, 'clientes', b.id)).succeeded).toBe(2);
        expect(await used()).toBe(limit);

        // Beto (agente) no tiene acciones masivas.
        await expect(recAgents.preview(tenantA, beto, 'clientes', { agent_id: a.id, target: { ids } })).rejects.toMatchObject({ status: 403 });
    });

    it('lote: se detiene con el motivo si el agente se pausa a mitad, y «Detener» saltea lo que no arrancó', async () => {
        const a = await newAgent();
        const ids: number[] = [];
        for (let i = 0; i < 3; i++) ids.push((await cliente(ana, { [k('nombre')]: `Cliente ${i}` })).id);
        // Un lote armado a mano: una corrida en cola y el agente en pausa.
        const [b] = await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(aiAgentBatches).values({ tenantId: tenantA, agentId: a.id, listId: clientesId, createdBy: ana.userId, recordIds: ids, total: 3 }).returning(),
        );
        await agents.update(tenantA, ana, a.id, { is_active: false });
        await recAgents.pump(tenantA, b!.id);
        const stopped = await recAgents.batch(tenantA, ana, 'clientes', b!.id);
        expect(stopped).toMatchObject({ status: 'stopped', stopped_reason: 'El agente se pausó.', dispatched: 0 });

        const [b2] = await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(aiAgentBatches).values({ tenantId: tenantA, agentId: a.id, listId: clientesId, createdBy: ana.userId, recordIds: ids, total: 3, dispatched: 1 }).returning(),
        );
        const [queued] = await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(aiAgentRuns).values({ tenantId: tenantA, agentId: a.id, listId: clientesId, recordId: ids[0]!, status: 'queued', batchId: b2!.id }).returning(),
        );
        const cancelled = await recAgents.cancel(tenantA, ana, 'clientes', b2!.id);
        expect(cancelled).toMatchObject({ status: 'cancelled', skipped: 1, queued: 0 });
        const [after] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(aiAgentRuns).where(and(eq(aiAgentRuns.id, queued!.id))));
        expect(after!.status).toBe('skipped');
    });

    it('RLS: los lotes de una empresa no se ven desde otra', async () => {
        const a = await newAgent();
        const [b] = await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(aiAgentBatches).values({ tenantId: tenantA, agentId: a.id, listId: clientesId, recordIds: [], total: 0 }).returning(),
        );
        const [other] = await pg.db.insert(tenants).values({ slug: `otra-${Date.now()}`, name: 'Otra', plan: 'enterprise' }).returning();
        expect(await withTenant(pg.db, other!.id, (tx) => tx.select().from(aiAgentBatches).where(eq(aiAgentBatches.id, b!.id)))).toEqual([]);
        await expect(
            withTenant(pg.db, other!.id, (tx) => tx.insert(aiAgentBatches).values({ tenantId: tenantA, agentId: a.id, recordIds: [], total: 0 })),
        ).rejects.toThrow();
    });

    // ── Piezas puras ─────────────────────────────────────────────────────

    it('piezas puras: valores legibles, lectura tolerante del resumen, texto limpio y la vista previa del lote', () => {
        const sel = { id: 1, type: 'select', label: 'Estado', config: { options: [{ value: 'pagada', label: 'Pagada' }] } } as unknown as Field;
        const names = { users: new Map([[7, 'Ana']]), teams: new Map<number, string>() };
        expect(valueText(sel, 'pagada', names)).toBe('Pagada');
        expect(valueText({ id: 2, type: 'checkbox', label: 'Ok', config: {} } as unknown as Field, true, names)).toBe('Sí');
        expect(valueText({ id: 3, type: 'user', label: 'Resp', config: {} } as unknown as Field, 7, names)).toBe('Ana');
        expect(valueText({ id: 4, type: 'duration', label: 'Dur', config: {} } as unknown as Field, 90, names)).toBe('1h 30m');

        expect(readSummary({ headline: 'Hola', points: ['a', 3, 'b'] }, '')).toEqual({ headline: 'Hola', points: ['a', 'b'], pending: [], next: [] });
        expect(readSummary(undefined, 'texto suelto')).toEqual({ headline: 'texto suelto', points: [], pending: [], next: [] });
        expect(cleanModelText('Aquí tienes el texto:\n\nHola mundo')).toBe('Hola mundo');
        expect(cleanModelText('«Gracias»')).toBe('Gracias');

        const base: AgentLimits = {
            agent: { id: 1, name: 'X', mode: 'propose', isActive: true, maxRunsPerDay: 10, monthlyTokenBudget: 10_000, listIds: [1] },
            runsToday: 4,
            tokensMonth: 6_000,
            inflight: 1,
            quotaLeft: null,
            tokensPerRun: 1_000,
            aiUnavailable: null,
        };
        // Quedan 5 corridas hoy, pero el presupuesto alcanza para 4.
        expect(previewOf(base, 8, 8)).toMatchObject({ runs_left_today: 5, budget_left: 4_000, will_run: 4 });
        expect(previewOf({ ...base, aiUnavailable: 'Sin clave.' }, 8, 8)).toMatchObject({ will_run: 0, notes: ['Sin clave.', expect.any(String), expect.any(String)] });
        expect(writesOf([{ kind: 'write', ok: true }, { kind: 'write', ok: false }, { kind: 'read', ok: true }])).toBe(1);
        // El motivo del proveedor sin el JSON del SDK (se ve en la ficha).
        expect(providerDetail('400 {"type":"error","error":{"type":"invalid_request_error","message":"El pedido es muy largo."}}')).toBe('El pedido es muy largo.');
        expect(providerDetail('Connection error.')).toBe('Connection error.');
        expect(providerDetail('500 {no es json')).toBe('500 {no es json');
    });
});
