import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { AutomationAiDraftCurrent, Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiModelCatalogService, type ProviderModel } from '../src/ai/ai-model-catalog.service';
import { AiQuotaService } from '../src/ai/ai-quota.service';
import { AiSettingsService } from '../src/ai/ai-settings.service';
import type { AiClientFactory } from '../src/ai/ai-client';
import { issueWhere, mergeWarnings } from '../src/ai/automation-draft';
import { AutomationDraftController } from '../src/ai/automation-draft.controller';
import { AutomationDraftService } from '../src/ai/automation-draft.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
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

const ADAPTIVE = { thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }, effort: { supported: true } };
const MODELS: ProviderModel[] = [{ id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: ADAPTIVE }];

interface SeenCall {
    system: unknown;
    messages: MessageParam[];
    tools: Array<{ name: string; input_schema: Record<string, unknown> }>;
}

/** Lo que responde el modelo falso en cada llamada: un `submit_automation` o un error del proveedor. */
type Reply = { tool: unknown } | { text: string } | { fail: number };

/** Modelo FALSO: nunca habla con un proveedor; cada llamada devuelve lo que diga `reply`. */
function fakeModel(reply: (c: SeenCall, n: number) => Reply): { factory: AiClientFactory; calls: SeenCall[] } {
    const calls: SeenCall[] = [];
    const factory: AiClientFactory = () =>
        ({
            messages: {
                stream: (p: { messages: MessageParam[]; system: unknown; tools: SeenCall['tools'] }) => {
                    const call: SeenCall = { system: p.system, messages: JSON.parse(JSON.stringify(p.messages)) as MessageParam[], tools: p.tools };
                    calls.push(call);
                    const r = reply(call, calls.length);
                    return {
                        finalMessage: async () => {
                            if ('fail' in r) throw Object.assign(new Error('caído'), { status: r.fail });
                            const content =
                                'tool' in r
                                    ? [{ type: 'tool_use', id: `tu_${calls.length}`, name: 'submit_automation', input: r.tool }]
                                    : [{ type: 'text', text: r.text, citations: null }];
                            return {
                                id: `msg_${calls.length}`,
                                type: 'message',
                                role: 'assistant',
                                model: 'fake',
                                content,
                                stop_reason: 'tool' in r ? 'tool_use' : 'end_turn',
                                stop_sequence: null,
                                usage: { input_tokens: 300, output_tokens: 80 },
                            } as unknown as Message;
                        },
                    };
                },
            },
        }) as never;
    return { factory, calls };
}

/** El texto que vio el modelo en su primera llamada (los bloques de texto, tal cual). */
const seenText = (c: SeenCall): string => {
    const first = c.messages[0]!.content as Array<{ type: string; text?: string }>;
    return first.map((b) => b.text ?? '').join('\n');
};

/** La automatización actual que viajó al modelo (dentro de <automatizacion_actual>). */
function currentSeen(c: SeenCall): Record<string, unknown> {
    const first = c.messages[0]!.content as Array<{ type: string; text: string }>;
    const m = first[0]!.text.match(/<automatizacion_actual>\n([\s\S]*?)\n<\/automatizacion_actual>/);
    return JSON.parse(m![1]!) as Record<string, unknown>;
}

/**
 * v0.1.463 (E7) — «Describe la automatización y la armo» dentro del editor
 * (Postgres + Redis reales, modelo FALSO): el modelo entrega con
 * `submit_automation` y el servidor la pasa por el MISMO constructor que
 * `propose_create_automation` (slugs → ids). Un error vuelve al modelo una
 * vez; sin IA, el motivo; la cuota se reserva y se devuelve si el modelo no
 * contesta; las credenciales de la automatización actual nunca viajan y
 * vuelven a su paso; «pedir un cambio» conserva lo que no se pidió.
 */
describe('«Describir con IA» en el editor de automatizaciones (Postgres + Redis reales, modelo falso)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let automations: AutomationsService;
    let settings: AiSettingsService;
    let quota: AiQuotaService;
    let structure: StructureTools;
    let registry: AiToolRegistry;
    let userId: number;
    let otherUserId: number;
    let tenantId: number;
    let ctx: AiToolContext;
    let f: Record<string, Field>;
    let listSlug: string;
    let listId: number;
    let replyFn: (c: SeenCall, n: number) => Reply;
    let model: ReturnType<typeof fakeModel>;
    let svc: AutomationDraftService;
    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '' });

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        const connectors = (): ConnectorsService =>
            new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors());
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const dashboards = new DashboardsService(tenantDb, null as never, null as never, null as never);
        const blueprint = new BlueprintService(tenantDb, lists, fieldsSvc, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        const catalogs = new AiModelCatalogService(redis, async () => [...MODELS]);
        catalogs.memoMs = 0;
        catalogs.manualRefreshMinMs = 0;
        settings = new AiSettingsService(redis, pg.db, env, catalogs);
        quota = new AiQuotaService(pg.db, plans);
        structure = new StructureTools(tenantDb, lists, fieldsSvc, views, automations, dashboards, blueprint, new ProposalsStore(redis), connectors(), null as never, null as never);
        registry = new AiToolRegistry();
        structure.registerInto(registry);
        const [u] = await pg.db.insert(users).values({ email: 'draft@test.local', name: 'Ana', passwordHash: 'x' }).returning();
        const [o] = await pg.db.insert(users).values({ email: 'draft-otra@test.local', name: 'Beto', passwordHash: 'x' }).returning();
        userId = u!.id;
        otherUserId = o!.id;
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    let n = 0;
    beforeEach(async () => {
        n += 1;
        const [t] = await pg.db.insert(tenants).values({ slug: `draft-${n}`, name: `Empresa ${n}`, plan: 'trial', status: 'trialing' }).returning();
        tenantId = t!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId, role: 'admin' },
            { tenantId, userId: otherUserId, role: 'agent' },
        ]);
        ctx = { tenantId, userId, role: 'admin' };
        await redis.flushdb();
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-0000000000000000', share_platform_key: true, allow_tenant_keys: true });
        await settings.updateTenant(tenantId, { enabled: true });
        const list = await lists.create(tenantId, { name: 'Facturas' });
        listSlug = list.slug;
        listId = list.id;
        f = {};
        f.titulo = await fieldsSvc.create(tenantId, String(list.id), { label: 'Título', type: 'text', is_required: true });
        f.estado = await fieldsSvc.create(tenantId, String(list.id), {
            label: 'Estado',
            type: 'select',
            config: {
                options: [
                    { value: 'pendiente', label: 'Pendiente' },
                    { value: 'pagada', label: 'Pagada' },
                    { value: 'vencida', label: 'Vencida' },
                ],
            },
        });
        f.monto = await fieldsSvc.create(tenantId, String(list.id), { label: 'Monto', type: 'currency', config: { currency: 'COP' } });
        f.vence = await fieldsSvc.create(tenantId, String(list.id), { label: 'Vence', type: 'date' });
        f.correo = await fieldsSvc.create(tenantId, String(list.id), { label: 'Correo', type: 'email' });
        replyFn = () => ({ text: 'sin guion' });
        model = fakeModel((c, k) => replyFn(c, k));
        svc = new AutomationDraftService(settings, quota, structure, registry, lists, fieldsSvc, new AuditService(tenantDb), redis as never, model.factory);
    });

    async function draft(input: { description: string; current?: AutomationAiDraftCurrent }, who: AiToolContext = ctx) {
        const { id } = await svc.start(who, listSlug, input);
        await svc.settle(id);
        return (await svc.get(tenantId, who.userId, listId, id))!;
    }

    async function usage(): Promise<{ requests: number; input: number }> {
        const [row] = await pg.db.select().from(aiUsage).where(eq(aiUsage.tenantId, tenantId));
        return { requests: row?.requests ?? 0, input: row?.inputTokens ?? 0 };
    }

    const SPEC = {
        name: 'Avisar cuando una factura se vence',
        trigger_type: 'record_updated',
        trigger_config: { changed_fields: ['estado'] },
        actions: [
            {
                type: 'switch',
                config: {
                    field: 'estado',
                    cases: [
                        { label: 'Vencida', value: 'Vencida', actions: [{ type: 'send_email', config: { to: '{{correo}}', subject: 'Tu factura {{titulo}} venció', body: 'Hola, tu factura venció.' } }] },
                        { label: 'Pagada', value: 'pagada', actions: [{ type: 'update_field', config: { values: { titulo: '{{titulo}} (pagada)' } } }] },
                    ],
                },
            },
            { type: 'wait', config: { mode: 'duration', amount: 2, unit: 'days' } },
        ],
    };

    it('arma una automatización válida con los ids reales, cuenta UN pedido y queda en la bitácora sin el texto', async () => {
        replyFn = () => ({ tool: SPEC });
        const job = await draft({ description: 'Cuando una factura pase a vencida, mándale un correo al cliente y espera 2 días.' });
        expect(job.state).toBe('done');
        const r = job.result!;
        expect(r.mode).toBe('create');
        expect(r.automation).toMatchObject({ name: SPEC.name, trigger_type: 'record_updated', is_active: true });
        // El campo del switch pasa a su id y la rama de selección a su VALOR.
        const sw = r.automation.actions[0] as { type: string; config: { source_field_id: number; cases: Array<{ value: unknown }> } };
        expect(sw.config.source_field_id).toBe(f.estado!.id);
        expect(sw.config.cases.map((c) => c.value)).toEqual(['vencida', 'pagada']);
        expect(r.summary).toMatch(/→/);
        expect(r.warnings).toEqual([]);
        expect(r.model_name).toBe('Claude Opus 9.5');

        // El modelo recibió el esquema de la lista como DATOS y el pedido aparte.
        const seen = seenText(model.calls[0]!);
        expect(seen).toContain('<esquema_de_la_lista>');
        expect(seen).toContain('"slug":"estado"');
        expect(seen).toContain(`"${f.estado!.id}":"estado"`);
        expect(seen).toContain('<pedido>');
        expect(model.calls[0]!.tools.map((t) => t.name)).toEqual(['submit_automation']);
        expect(JSON.stringify(model.calls[0]!.system)).toMatch(/español neutro/);

        // UN pedido de la cuota con los tokens reales.
        expect(await usage()).toMatchObject({ requests: 1, input: 300 });

        // Nada se guardó: es un borrador para el editor.
        expect(await automations.list(tenantId, String(listId))).toHaveLength(0);

        // La bitácora dice quién y en qué lista, nunca lo que escribió.
        let audits: Array<typeof auditLog.$inferSelect> = [];
        for (let i = 0; i < 20 && audits.length === 0; i++) {
            audits = await tenantDb.withTenant(tenantId, (tx) =>
                tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'automation.ai_draft'))),
            );
            if (audits.length === 0) await new Promise((res) => setTimeout(res, 25));
        }
        expect(audits).toHaveLength(1);
        expect(audits[0]!.targetLabel).toBe('Facturas');
        expect(JSON.stringify(audits[0]!.meta)).not.toContain('vencida');
        expect(audits[0]!.meta).toMatchObject({ mode: 'create', key: 'platform' });
    });

    it('un error de validación vuelve al modelo UNA vez con el motivo; si sigue mal, falla sin guardar nada', async () => {
        const bad = { ...SPEC, trigger_config: { changed_fields: ['estado_inventado'] } };
        replyFn = (_c, k) => ({ tool: k === 1 ? bad : SPEC });
        const ok = await draft({ description: 'Avísame cuando cambie el estado.' });
        expect(ok.state).toBe('done');
        expect(model.calls).toHaveLength(2);
        const retry = model.calls[1]!.messages;
        const toolResult = JSON.stringify(retry[retry.length - 1]);
        expect(toolResult).toContain('"is_error":true');
        expect(toolResult).toContain('estado_inventado');
        // Los dos intentos cuentan como UN pedido.
        expect((await usage()).requests).toBe(1);

        model.calls.length = 0;
        replyFn = () => ({ tool: bad });
        const fail = await draft({ description: 'Avísame cuando cambie el estado.' });
        expect(model.calls).toHaveLength(2);
        expect(fail.state).toBe('error');
        expect(fail.error).toMatchObject({ code: 'invalid_automation' });
        expect(fail.error!.message).toMatch(/no logró armar/);
        expect((await usage()).requests).toBe(2);
    });

    it('sin IA, el motivo (sin reservar nada); un rol sin «usar la IA» o sin la lista entera, 403', async () => {
        await settings.updatePlatform({ enabled: false });
        expect(await svc.status(ctx)).toEqual({ available: false, reason: 'La IA no está activada en este servidor.', source: null });
        await expect(svc.start(ctx, listSlug, { description: 'Avísame algo' })).rejects.toBeInstanceOf(ServiceUnavailableException);

        await settings.updatePlatform({ enabled: true });
        await settings.updateTenant(tenantId, { enabled: false });
        const st = await svc.status(ctx);
        expect(st.available).toBe(false);
        expect(st.reason).toMatch(/no está activado para esta empresa/);
        expect((await usage()).requests).toBe(0);
        expect(model.calls).toHaveLength(0);
        await settings.updateTenant(tenantId, { enabled: true });

        // Sin la capacidad «usar el asistente».
        const sinIa: AiToolContext = { ...ctx, role: 'manager', capabilities: ['manage_automations'] };
        expect((await svc.status(sinIa)).available).toBe(false);
        await expect(svc.start(sinIa, listSlug, { description: 'Avísame algo' })).rejects.toBeInstanceOf(ForbiddenException);

        // Un agente (ve sólo lo suyo): el controlador lo frena antes de gastar.
        const ctrl = new AutomationDraftController(svc, automations, lists);
        const req = {
            authUserId: otherUserId,
            tenant: { tenantId, role: 'agent', teamIds: [], customRoleId: null, capabilities: undefined, shares: undefined },
        } as unknown as FastifyRequest;
        await expect(ctrl.start(req, listSlug, { description: 'Avísame algo' })).rejects.toMatchObject({ response: { code: 'automation_list_forbidden' } });
        expect((await usage()).requests).toBe(0);
    });

    it('si el proveedor no contesta, el pedido reservado se devuelve y el error dice qué pasó', async () => {
        replyFn = () => ({ fail: 529 });
        const job = await draft({ description: 'Avísame cuando una factura venza.' });
        expect(job.state).toBe('error');
        expect(job.error).toMatchObject({ code: 'provider_error' });
        expect(job.error!.message).toMatch(/saturado/);
        expect((await usage()).requests).toBe(0);
    });

    it('«pedir un cambio»: las credenciales no viajan y vuelven a su paso; lo que no se pidió queda igual', async () => {
        const current: AutomationAiDraftCurrent = {
            id: 77,
            name: 'Avisar al ERP',
            description: 'Manda la factura al ERP',
            trigger_type: 'record_updated',
            trigger_config: { changed_fields: ['estado'] },
            actions: [
                {
                    type: 'switch',
                    config: { source_field_id: f.estado!.id, cases: [{ label: 'Vencida', op: 'eq', value: 'vencida', actions: [] }], default_actions: [] },
                },
                {
                    type: 'call_webhook',
                    config: {
                        url: 'https://erp.example.com/api/facturas?api_key=sk_live_SECRETO_url_123',
                        method: 'POST',
                        headers: [{ key: 'Authorization', value: 'Bearer sk_live_SECRETO_cabecera_123456' }],
                        secret: 'hmac-SECRETO-firma-123',
                        body_template: '{"id": "{{record.id}}"}',
                    },
                },
            ],
            is_active: true,
        };
        // El modelo devuelve la actual con UN paso más al final (lo que se pidió).
        replyFn = (c) => {
            const cur = currentSeen(c);
            return {
                tool: {
                    name: cur.name,
                    description: cur.description,
                    trigger_type: cur.trigger_type,
                    trigger_config: cur.trigger_config,
                    actions: [...(cur.actions as unknown[]), { type: 'update_field', config: { values: { titulo: '{{titulo}} (enviada al ERP)' } } }],
                },
            };
        };
        const job = await draft({ description: 'Al final, marca el título como enviada al ERP.', current });
        expect(job.state).toBe('done');

        // Ninguna credencial salió hacia el modelo.
        const seen = seenText(model.calls[0]!);
        for (const secret of ['SECRETO_url_123', 'SECRETO_cabecera', 'SECRETO-firma']) expect(seen).not.toContain(secret);
        expect(seen).toContain('[oculto]');
        // La automatización actual viaja como DATOS, aparte del pedido.
        expect(seen).toContain('<automatizacion_actual>');

        const r = job.result!;
        expect(r.mode).toBe('change');
        expect(r.automation.name).toBe('Avisar al ERP');
        expect(r.automation.is_active).toBe(true);
        expect(r.automation.actions).toHaveLength(3);
        // Lo que no se pidió, igual (el switch por id, sin traducciones raras).
        expect((r.automation.actions[0] as { config: Record<string, unknown> }).config.source_field_id).toBe(f.estado!.id);
        // Las credenciales volvieron a su paso.
        const hook = (r.automation.actions[1] as { config: Record<string, unknown> }).config;
        expect(hook.url).toBe('https://erp.example.com/api/facturas?api_key=sk_live_SECRETO_url_123');
        expect(hook.headers).toEqual([{ key: 'Authorization', value: 'Bearer sk_live_SECRETO_cabecera_123456' }]);
        expect(hook.secret).toBe('hmac-SECRETO-firma-123');
        expect(r.automation.actions[2]).toMatchObject({ type: 'update_field', config: { values: { titulo: '{{titulo}} (enviada al ERP)' } } });
        expect(JSON.stringify(r.automation)).not.toContain('[oculto]');
    });

    it('lo que falta para correr se avisa, queda pausada y los avisos del modelo llegan a la persona', async () => {
        replyFn = () => ({
            tool: {
                name: 'Avisar al cliente por correo',
                trigger_type: 'record_created',
                actions: [{ type: 'send_email', config: { to: '', subject: 'Nueva factura {{titulo}}', body: 'Hola' } }],
                warnings: ['No encontré a quién avisar: completa el destinatario del correo.'],
            },
        });
        const job = await draft({ description: 'Cuando entre una factura, avísale al cliente.' });
        expect(job.state).toBe('done');
        const r = job.result!;
        expect(r.automation.is_active).toBe(false);
        expect(r.warnings[0]).toBe('No encontré a quién avisar: completa el destinatario del correo.');
        expect(r.warnings.some((w) => /^Paso 1: .*destinatario/.test(w))).toBe(true);
        expect(r.warnings).toContain('La dejé pausada: actívala cuando completes lo que falta.');
    });

    it('el resultado es de quien lo pidió y de esa lista', async () => {
        replyFn = () => ({ tool: SPEC });
        const { id } = await svc.start(ctx, listSlug, { description: 'Avísame cuando una factura venza.' });
        await svc.settle(id);
        expect(await svc.get(tenantId, userId, listId, id)).not.toBeNull();
        expect(await svc.get(tenantId, otherUserId, listId, id)).toBeNull();
        expect(await svc.get(tenantId, userId, listId + 999, id)).toBeNull();
    });

    it('piezas puras: dónde está cada aviso y avisos sin repetir', () => {
        expect(issueWhere('actions.1.config.to')).toBe('2');
        expect(issueWhere('actions.0.config.then_actions.2.config.to')).toBe('1 › sí › 3');
        expect(issueWhere('actions.0.config.cases.1.actions.0.config.url')).toBe('1 › rama 2 › 1');
        expect(issueWhere('trigger_config.cron')).toBeNull();
        expect(mergeWarnings(['a', ' a '], ['b'], ['c', 'd', 'e', 'f', 'g', 'h', 'i'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    });
});
