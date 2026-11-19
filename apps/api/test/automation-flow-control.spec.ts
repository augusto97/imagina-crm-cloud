import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import type { AiClientFactory } from '../src/ai/ai-client';
import { AiModelCatalogService, type ProviderModel } from '../src/ai/ai-model-catalog.service';
import { AiQuotaService } from '../src/ai/ai-quota.service';
import { AiSettingsService } from '../src/ai/ai-settings.service';
import { AutomationAskAiService } from '../src/ai/automation-ask-ai.service';
import { AiToolError } from '../src/ai/tools/registry';
import { translateFlowActions } from '../src/ai/tools/automation-flow-ai';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationWaitsService } from '../src/automations/automation-waits.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { aiUsage, automationRuns, automations, fields, lists, memberships, plans, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class NoMail implements MailTransport {
    readonly name = 'none';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(1),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

type LogEntry = { action: string; status: string; message: string; details?: Record<string, unknown> };

/**
 * v0.1.460 — «Preguntarle a la IA», «Según el valor de…» y «Si este paso
 * falla», con Postgres y Redis reales, un modelo de IA falso y un servidor de
 * webhooks local (que falla a propósito).
 */
describe('Automatizaciones: IA, ramas por valor y «Si este paso falla» (v0.1.460)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let waits: AutomationWaitsService;
    let settings: AiSettingsService;
    let tenantId: number;
    let admin: Actor;
    let listId: number;
    let t: Record<string, Field>;
    let server: Server;
    let base: string;
    const hits: Record<string, number> = {};
    const calls: MessageCreateParamsNonStreaming[] = [];
    let replies: string[] = [];

    const fakeClient: AiClientFactory = () =>
        ({
            messages: {
                create: (params: MessageCreateParamsNonStreaming) => {
                    calls.push(params);
                    const text = replies.length > 0 ? replies.shift()! : 'Soporte';
                    return Promise.resolve({
                        content: [{ type: 'text', text }],
                        stop_reason: 'end_turn',
                        usage: { input_tokens: 90, output_tokens: 6 },
                    } as unknown as Message);
                },
            },
        }) as never;

    beforeAll(async () => {
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        // /ok → 200; /fail → 500 siempre; /flaky/<clave> → falla las DOS primeras veces y después contesta.
        server = createServer((req, res) => {
            req.resume();
            req.on('end', () => {
                const path = req.url ?? '';
                hits[path] = (hits[path] ?? 0) + 1;
                const fails = path === '/fail' || (path.startsWith('/flaky/') && hits[path]! <= 2);
                res.writeHead(fails ? 500 : 200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(fails ? { error: 'servidor caído' } : { ok: true, folio: 'F-9' }));
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const dispatcher = new AutomationDispatcher();
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            dispatcher,
            new RelationsRepository(),
        );
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const tz = new TenantTimeZones(tenantDb);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NoMail()),
            connectors,
            undefined,
            dispatcher,
            undefined,
            undefined,
            tz,
            undefined,
            undefined,
            { get: () => recs } as never,
        );
        // Los reintentos esperan 3, 10 y 30 s: en la prueba, un instante.
        engine.retryDelay = () => 5;
        // Catálogo FALSO (sin red): la calidad «rápida» elige sola el más reciente de la familia económica.
        const caps = { thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }, effort: { supported: true } };
        const models: ProviderModel[] = [
            { id: 'claude-haiku-9-5', display_name: 'Claude Haiku 9.5', created_at: '2030-01-01T00:00:00Z', capabilities: caps },
            { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-01-01T00:00:00Z', capabilities: caps },
        ];
        settings = new AiSettingsService(redis as never, pg.db, env, new AiModelCatalogService(redis as never, async () => models));
        engine.setAskAi(new AutomationAskAiService(settings, new AiQuotaService(pg.db, new PlansService(pg.db)), fakeClient));
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            noHooks,
            connectors,
            tz,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            engine,
        );
        // Sin cola: las reanudaciones corren en el acto.
        waits = new AutomationWaitsService(pg.db, tenantDb, engine, new AutomationDispatcher(), undefined, tz);

        const [tn] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'Acme', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = tn!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Ruiz' }).returning();
        admin = { userId: u!.id, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role: 'admin' }));
        await pg.db.insert(plans).values({ slug: 'mini458', name: 'Mini', maxAiRequestsMonth: 1 }).onConflictDoNothing();
    });

    afterAll(async () => {
        delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        redis?.disconnect();
        await new Promise<void>((r) => server.close(() => r()));
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        calls.length = 0;
        replies = [];
        for (const k of Object.keys(hits)) delete hits[k];
        await redis.flushall();
        await pg.db.delete(aiUsage);
        await pg.db.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantId));
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-0000000000000000', share_platform_key: true, allow_tenant_keys: true });
        await settings.updateTenant(tenantId, { enabled: true });
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        listId = (await listsService.create(tenantId, { name: 'Tickets', slug: 'tickets' })).id;
        const defs: CreateFieldInput[] = [
            { label: 'Asunto', type: 'text', slug: 'asunto' },
            { label: 'Mensaje', type: 'long_text', slug: 'mensaje' },
            {
                label: 'Tema',
                type: 'select',
                slug: 'tema',
                config: {
                    options: [
                        { value: 'ventas', label: 'Ventas' },
                        { value: 'soporte', label: 'Soporte' },
                        { value: 'facturacion', label: 'Facturación' },
                    ],
                },
            },
            { label: 'Monto', type: 'number', slug: 'monto' },
            { label: 'Urgente', type: 'checkbox', slug: 'urgente' },
            { label: 'Vence', type: 'date', slug: 'vence' },
            { label: 'NIT', type: 'text', slug: 'nit' },
            { label: 'Nota', type: 'text', slug: 'nota' },
            { label: 'Resultado', type: 'text', slug: 'resultado' },
            { label: 'Clave secreta', type: 'text', slug: 'clave_secreta' },
        ];
        t = {};
        for (const d of defs) t[d.slug!] = await fieldsService.create(tenantId, 'tickets', d);
    });

    const k = (slug: string): string => `f${t[slug]!.id}`;
    const runsOf = async (automationId: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)))).sort((a, b) => a.id - b.id);
    const dataOf = async (id: number) => (await recs.get(tenantId, admin, 'tickets', id)).data;
    const logOf = (run: { actionsLog: unknown }) => run.actionsLog as LogEntry[];
    /** Crea la automatización (validada como al guardar en el editor) y la corre para un registro nuevo. */
    const runFor = async (actions: unknown[], data: Record<string, unknown>) => {
        const auto = await autos.create(tenantId, 'tickets', { name: 'Prueba', trigger_type: 'record_created', actions: actions as never });
        const rec = await recs.create(tenantId, admin, 'tickets', { data });
        const event: TriggerEvent = { tenantId, listId, recordId: rec.id, trigger: 'record_created', after: rec.data };
        await engine.process(event);
        const [run] = await runsOf(auto.id);
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(eq(automations.id, auto.id)));
        return { auto, rec, run: run!, data: await dataOf(rec.id) };
    };

    // ─────────────────────────── Preguntarle a la IA ───────────────────────────

    it('IA: elige una opción del campo, la guarda, la deja en {{respuestas.tema.valor}} y cuenta un pedido de la cuota', async () => {
        replies = ['«Soporte».'];
        const { run, data } = await runFor(
            [
                {
                    type: 'ask_ai',
                    config: {
                        instruction: '¿De qué trata este mensaje? {{mensaje}}',
                        include_record: true,
                        output: 'choice',
                        choices_field_id: t.tema!.id,
                        save_field_id: t.tema!.id,
                        response_name: 'tema',
                    },
                },
                { type: 'update_field', config: { values: { nota: 'Tema: {{respuestas.tema.valor}} ({{respuestas.tema.texto}})' } } },
            ],
            { [k('asunto')]: 'No puedo entrar', [k('mensaje')]: 'La clave no funciona desde ayer', [k('clave_secreta')]: 'hunter2' },
        );
        expect(run.status).toBe('success');
        expect(data[k('tema')]).toBe('soporte');
        expect(data[k('nota')]).toBe('Tema: Soporte (Soporte)');
        expect(calls).toHaveLength(1);
        expect(calls[0]!.model).toBe('claude-haiku-9-5');
        const user = JSON.stringify(calls[0]!.messages);
        // La instrucción ya resuelta y los datos del registro como DATOS (sin campos que parecen secretos).
        expect(user).toContain('La clave no funciona desde ayer');
        expect(user).toContain('No puedo entrar');
        expect(user).not.toContain('hunter2');
        expect(String(calls[0]!.system)).toMatch(/datos/i);
        const [usage] = await pg.db.select().from(aiUsage).where(eq(aiUsage.tenantId, tenantId));
        expect(usage!.requests).toBe(1);
        const step = logOf(run).find((l) => l.action === 'ask_ai')!;
        expect(step.status).toBe('success');
        expect(step.message).toMatch(/La IA respondió «Soporte»\. Lo guardó en «Tema»/);
    });

    it('IA: número, sí/no, fecha, texto y varios datos con nombre se leen y se guardan con su tipo', async () => {
        replies = [
            'Aproximadamente 1.250.000',
            'Sí.',
            'Vence el 2026-12-24',
            'El cliente no puede entrar a su cuenta.',
            '```json\n{"nit": "900123456-7", "monto": "2500000"}\n```',
        ];
        const { run, data } = await runFor(
            [
                { type: 'ask_ai', config: { instruction: '¿Cuánto vale?', output: 'number', save_field_id: t.monto!.id, response_name: 'valor' } },
                { type: 'ask_ai', config: { instruction: '¿Es urgente?', output: 'boolean', save_field_id: t.urgente!.id, response_name: 'urge' } },
                { type: 'ask_ai', config: { instruction: '¿Cuándo vence?', output: 'date', save_field_id: t.vence!.id, response_name: 'fecha' } },
                { type: 'ask_ai', config: { instruction: 'Resume', output: 'text', length: 'short', save_field_id: t.nota!.id, response_name: 'resumen' } },
                {
                    type: 'ask_ai',
                    config: {
                        instruction: 'Saca el NIT y el monto',
                        output: 'fields',
                        items: [
                            { key: 'nit', label: 'NIT', type: 'text', field_id: t.nit!.id },
                            { key: 'monto', label: 'Monto', type: 'number' },
                        ],
                        response_name: 'datos',
                    },
                },
                { type: 'update_field', config: { values: { resultado: '{{respuestas.urge.valor}}|{{respuestas.datos.monto}}|{{respuestas.fecha.valor}}' } } },
            ],
            { [k('asunto')]: 'Cobro' },
        );
        expect(run.error).toBeNull();
        expect(run.status).toBe('success');
        expect(data[k('monto')]).toBe(1250000);
        expect(data[k('urgente')]).toBe(true);
        expect(data[k('vence')]).toBe('2026-12-24');
        expect(data[k('nota')]).toBe('El cliente no puede entrar a su cuenta.');
        expect(data[k('nit')]).toBe('900123456-7');
        expect(data[k('resultado')]).toBe('true|2500000|2026-12-24');
        expect(calls).toHaveLength(5);
    });

    it('IA: una respuesta que no sirve hace FALLAR el paso con el motivo y detiene la corrida (o sigue «con errores» si se eligió)', async () => {
        replies = ['Marketing'];
        const stop = await runFor(
            [
                { type: 'ask_ai', config: { instruction: 'Clasifica', output: 'choice', choices: ['Ventas', 'Soporte'], response_name: 'tema' } },
                { type: 'update_field', config: { values: { nota: 'no debería correr' } } },
            ],
            { [k('asunto')]: 'X' },
        );
        expect(stop.run.status).toBe('failed');
        expect(stop.run.error).toMatch(/«Marketing», que no es una de las opciones/);
        expect(stop.data[k('nota')]).toBeUndefined();
        expect(logOf(stop.run).map((l) => l.action)).toEqual(['ask_ai']);

        replies = ['doce y medio'];
        const go = await runFor(
            [
                { type: 'ask_ai', config: { instruction: 'Fecha', output: 'number', response_name: 'n' }, on_error: { mode: 'continue' } },
                { type: 'update_field', config: { values: { nota: 'siguió' } } },
            ],
            { [k('asunto')]: 'Y' },
        );
        expect(go.run.status).toBe('with_errors');
        expect(go.data[k('nota')]).toBe('siguió');
        expect(logOf(go.run)[0]!.details?.handled).toBe('continue');
    });

    it('IA: sin IA disponible el paso falla con el motivo (sin llamar); con la cuota agotada también', async () => {
        await settings.updatePlatform({ enabled: false });
        const off = await runFor([{ type: 'ask_ai', config: { instruction: 'Hola', output: 'text' } }], { [k('asunto')]: 'Sin IA' });
        expect(off.run.status).toBe('failed');
        expect(off.run.error).toMatch(/La IA no está disponible/);
        expect(calls).toHaveLength(0);

        await settings.updatePlatform({ enabled: true });
        await pg.db.update(tenants).set({ plan: 'mini458' }).where(eq(tenants.id, tenantId));
        replies = ['Primera'];
        const first = await runFor([{ type: 'ask_ai', config: { instruction: 'Hola', output: 'text' } }], { [k('asunto')]: 'Una' });
        expect(first.run.status).toBe('success');
        const second = await runFor([{ type: 'ask_ai', config: { instruction: 'Hola', output: 'text' } }], { [k('asunto')]: 'Dos' });
        expect(second.run.status).toBe('failed');
        expect(second.run.error).toMatch(/1/);
        expect(calls).toHaveLength(1);
    });

    it('IA en «Probar»: no llama a la IA salvo que se marque «Ejecutar de verdad» (y aun así no escribe)', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('mensaje')]: 'Quiero comprar 20 licencias' } });
        const actions = [
            { type: 'ask_ai', config: { instruction: 'Clasifica: {{mensaje}}', output: 'choice', choices_field_id: t.tema!.id, save_field_id: t.tema!.id, response_name: 'tema' } },
            { type: 'update_field', config: { values: { nota: '{{respuestas.tema.valor}}' } } },
        ];
        const sim = await autos.testRun(tenantId, 'tickets', { trigger_type: 'record_created', trigger_config: {}, actions: actions as never, record_id: rec.id, real_steps: [] });
        expect(calls).toHaveLength(0);
        const s0 = sim.steps.find((s) => s.path === '0')!;
        expect(s0.status).toBe('would_run');
        expect(s0.message).toMatch(/Le preguntaría a la IA: «Clasifica: Quiero comprar 20 licencias»/);

        replies = ['Ventas'];
        const real = await autos.testRun(tenantId, 'tickets', { trigger_type: 'record_created', trigger_config: {}, actions: actions as never, record_id: rec.id, real_steps: ['0'] });
        expect(calls).toHaveLength(1);
        expect(real.steps.find((s) => s.path === '0')!.status).toBe('ran');
        expect(real.steps.find((s) => s.path === '1')!.details.changes).toEqual([{ field: 'nota', label: 'Nota', before: null, after: 'Ventas' }]);
        // Nada se escribió.
        const after = await dataOf(rec.id);
        expect(after[k('tema')]).toBeUndefined();
        expect(after[k('nota')]).toBeUndefined();
    });

    // ─────────────────────────── Según el valor de… ───────────────────────────

    const byTopic = (extra: Record<string, unknown> = {}) => ({
        type: 'switch',
        config: {
            source_field_id: t.tema!.id,
            cases: [
                { op: 'eq', value: 'ventas', actions: [{ type: 'update_field', config: { values: { nota: 'V' } } }] },
                { op: 'eq', value: 'soporte', actions: [{ type: 'update_field', config: { values: { nota: 'S' } } }] },
            ],
            default_actions: [{ type: 'update_field', config: { values: { nota: 'Otro' } } }],
            ...extra,
        },
    });

    it('switch por opción: corre SÓLO la rama del valor; lo demás (y vacío) va a «En otro caso»', async () => {
        const soporte = await runFor([byTopic(), { type: 'update_field', config: { values: { resultado: 'fin' } } }], { [k('tema')]: 'soporte' });
        expect(soporte.run.status).toBe('success');
        expect(soporte.data[k('nota')]).toBe('S');
        expect(soporte.data[k('resultado')]).toBe('fin');
        const sw = logOf(soporte.run).find((l) => l.action === 'switch')!;
        expect(sw.message).toBe('«Tema» es «Soporte» → rama «Soporte»');
        expect(sw.details).toMatchObject({ branch: 'case1', branch_label: 'Soporte', path: '0' });
        expect(logOf(soporte.run).find((l) => l.action === 'update_field' && l.details?.path === '0.case1.0')).toBeDefined();

        const fact = await runFor([byTopic()], { [k('tema')]: 'facturacion' });
        expect(fact.data[k('nota')]).toBe('Otro');
        expect(logOf(fact.run).find((l) => l.action === 'switch')!.message).toMatch(/es «Facturación» → rama «En otro caso»/);
        const empty = await runFor([byTopic()], { [k('asunto')]: 'sin tema' });
        expect(empty.data[k('nota')]).toBe('Otro');
        expect(logOf(empty.run).find((l) => l.action === 'switch')!.message).toMatch(/está vacío → rama «En otro caso»/);
    });

    it('switch por regla: gana la PRIMERA que coincide', async () => {
        const bySize = {
            type: 'switch',
            config: {
                source_field_id: t.monto!.id,
                cases: [
                    { label: 'Grande', op: 'gt', value: 1000000, actions: [{ type: 'update_field', config: { values: { nota: 'grande' } } }] },
                    { label: 'Mediano', op: 'gt', value: 100000, actions: [{ type: 'update_field', config: { values: { nota: 'mediano' } } }] },
                ],
                default_actions: [{ type: 'update_field', config: { values: { nota: 'chico' } } }],
            },
        };
        expect((await runFor([bySize], { [k('monto')]: 2000000 })).data[k('nota')]).toBe('grande');
        expect((await runFor([bySize], { [k('monto')]: 500000 })).data[k('nota')]).toBe('mediano');
        expect((await runFor([bySize], { [k('monto')]: 50 })).data[k('nota')]).toBe('chico');
    });

    it('switch por una variable (la respuesta de la IA) y anidado dentro de otra rama', async () => {
        const flow = [
            { type: 'ask_ai', config: { instruction: '¿Prioridad?', output: 'choice', choices: ['Alta', 'Baja'], response_name: 'prio' } },
            {
                type: 'switch',
                config: {
                    source_variable: 'respuestas.prio.valor',
                    cases: [{ op: 'eq', value: 'Alta', actions: [byTopic({ default_actions: [{ type: 'update_field', config: { values: { nota: 'Alta-otro' } } }] })] }],
                    default_actions: [{ type: 'update_field', config: { values: { nota: 'Baja' } } }],
                },
            },
        ];
        replies = ['Alta'];
        const alta = await runFor(flow, { [k('tema')]: 'ventas' });
        expect(alta.run.status).toBe('success');
        expect(alta.data[k('nota')]).toBe('V');
        expect(logOf(alta.run).find((l) => l.details?.path === '1.case0.0.case0.0')).toBeDefined();
        replies = ['Alta'];
        expect((await runFor(flow, { [k('tema')]: 'facturacion' })).data[k('nota')]).toBe('Alta-otro');
        replies = ['Baja'];
        expect((await runFor(flow, { [k('tema')]: 'ventas' })).data[k('nota')]).toBe('Baja');
    });

    it('switch: «Esperar» dentro de una rama reanuda EN ESA rama (sin volver a elegir) y después sigue con lo de abajo', async () => {
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Espera en rama',
            trigger_type: 'record_created',
            actions: [
                byTopic({
                    cases: [
                        {
                            op: 'eq',
                            value: 'soporte',
                            actions: [
                                { type: 'wait', config: { mode: 'duration', amount: 1, unit: 'hours' } },
                                { type: 'update_field', config: { values: { nota: 'después de esperar' } } },
                            ],
                        },
                    ],
                }),
                { type: 'update_field', config: { values: { resultado: 'fin' } } },
            ] as never,
        });
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('tema')]: 'soporte' } });
        await engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_created', after: rec.data });
        let [run] = await runsOf(auto.id);
        expect(run!.status).toBe('waiting');
        expect((await dataOf(rec.id))[k('resultado')]).toBeUndefined();
        // Mientras espera cambia el tema: la rama ya se eligió.
        await recs.update(tenantId, admin, 'tickets', rec.id, { data: { [k('tema')]: 'ventas' } });
        await pg.db.execute(sql`update automation_runs set resume_at = now() - interval '1 second' where automation_id = ${auto.id} and status = 'waiting'`);
        expect(await waits.tick()).toBe(1);
        [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const data = await dataOf(rec.id);
        expect(data[k('nota')]).toBe('después de esperar');
        expect(data[k('resultado')]).toBe('fin');
    });

    it('switch en «Probar»: dice qué rama tomaría y por qué las otras no', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('tema')]: 'facturacion' } });
        const out = await autos.testRun(tenantId, 'tickets', { trigger_type: 'record_created', trigger_config: {}, actions: [byTopic()] as never, record_id: rec.id, real_steps: [] });
        const s = out.steps.find((x) => x.path === '0')!;
        expect(s.message).toMatch(/rama «En otro caso»/);
        expect(s.details.cases).toEqual([
            { index: 0, label: 'Ventas', ok: false },
            { index: 1, label: 'Soporte', ok: false },
        ]);
        expect(out.steps.find((x) => x.path === '0.default.0')).toBeDefined();
    });

    // ─────────────────────────── Si este paso falla ───────────────────────────

    it('si falla — detener (lo de fábrica): la corrida falla y los pasos de abajo NO corren', async () => {
        const { run, data } = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/fail`, method: 'POST' } },
                { type: 'update_field', config: { values: { nota: 'después' } } },
            ],
            { [k('asunto')]: 'A' },
        );
        expect(run.status).toBe('failed');
        expect(data[k('nota')]).toBeUndefined();
        expect(logOf(run).map((l) => l.action)).toEqual(['call_webhook']);
    });

    it('si falla — seguir con el resto: la corrida queda «con errores» y el resto corre', async () => {
        const { run, data } = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/fail`, method: 'POST' }, on_error: { mode: 'continue' } },
                { type: 'update_field', config: { values: { nota: 'después' } } },
            ],
            { [k('asunto')]: 'B' },
        );
        expect(run.status).toBe('with_errors');
        expect(run.error).toMatch(/500/);
        expect(data[k('nota')]).toBe('después');
        expect(logOf(run)[0]).toMatchObject({ action: 'call_webhook', status: 'failed', details: { handled: 'continue' } });
    });

    it('si falla — reintentar: un webhook que falla dos veces sale al tercer intento; si sigue fallando, hace lo elegido', async () => {
        const ok = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/flaky/a`, method: 'POST', response_name: 'erp' }, on_error: { mode: 'retry', retries: 2 } },
                { type: 'update_field', config: { values: { nota: 'Folio {{respuestas.erp.folio}}' } } },
            ],
            { [k('asunto')]: 'C' },
        );
        expect(hits['/flaky/a']).toBe(3);
        expect(ok.run.status).toBe('success');
        expect(ok.data[k('nota')]).toBe('Folio F-9');
        const step = logOf(ok.run)[0]!;
        expect(step.status).toBe('success');
        expect(step.message).toMatch(/\(salió al intento 3\)$/);
        expect(step.details).toMatchObject({ attempts: 3 });
        expect((step.details!.retried_errors as string[]).length).toBe(2);

        // Un solo reintento no alcanza (falla 2 veces): sigue con el resto, «con errores».
        const still = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/flaky/b`, method: 'POST' }, on_error: { mode: 'retry', retries: 1, if_still_fails: 'continue' } },
                { type: 'update_field', config: { values: { nota: 'siguió' } } },
            ],
            { [k('asunto')]: 'D' },
        );
        expect(hits['/flaky/b']).toBe(2);
        expect(still.run.status).toBe('with_errors');
        expect(still.data[k('nota')]).toBe('siguió');
        expect(logOf(still.run)[0]!.details).toMatchObject({ attempts: 2, handled: 'continue' });
    });

    it('si falla — hacer otros pasos con {{error.mensaje}} y {{error.paso}}; después termina o sigue', async () => {
        const fallback = {
            mode: 'steps',
            actions: [{ type: 'update_field', config: { values: { nota: 'Falló «{{error.paso}}»: {{error.mensaje}}' } } }],
        };
        const stop = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/fail`, method: 'POST' }, on_error: fallback },
                { type: 'update_field', config: { values: { resultado: 'fin' } } },
            ],
            { [k('asunto')]: 'E' },
        );
        expect(stop.run.status).toBe('with_errors');
        expect(String(stop.data[k('nota')])).toMatch(/^Falló «Llamar webhook»: .*500/);
        expect(stop.data[k('resultado')]).toBeUndefined();
        expect(logOf(stop.run).find((l) => l.details?.path === '0.fail.0')).toBeDefined();

        const go = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/fail`, method: 'POST' }, on_error: { ...fallback, after_steps: 'continue' } },
                { type: 'update_field', config: { values: { resultado: 'fin' } } },
            ],
            { [k('asunto')]: 'F' },
        );
        expect(go.run.status).toBe('with_errors');
        expect(go.data[k('resultado')]).toBe('fin');
        // Fuera de «Si falla» la variable queda vacía.
        const after = await runFor(
            [
                { type: 'call_webhook', config: { url: `${base}/ok`, method: 'POST' }, on_error: fallback },
                { type: 'update_field', config: { values: { resultado: '[{{error.mensaje}}]' } } },
            ],
            { [k('asunto')]: 'G' },
        );
        expect(after.run.status).toBe('success');
        expect(after.data[k('resultado')]).toBe('[]');
        expect(after.data[k('nota')]).toBeUndefined();
    });

    it('al guardar: reintentar sólo en pasos que llaman afuera, nada de esperas dentro de «Si falla», el switch necesita de qué depende', async () => {
        const save = (actions: unknown[]) => autos.create(tenantId, 'tickets', { name: 'Mal', trigger_type: 'record_created', actions: actions as never });
        await expect(save([{ type: 'update_field', config: { values: { nota: 'x' } }, on_error: { mode: 'retry', retries: 2 } }])).rejects.toThrow();
        await expect(
            save([{ type: 'call_webhook', config: { url: `${base}/ok` }, on_error: { mode: 'steps', actions: [{ type: 'wait', config: { mode: 'duration', amount: 1, unit: 'hours' } }] } }]),
        ).rejects.toThrow();
        await expect(save([{ type: 'switch', config: { cases: [{ op: 'eq', value: 'a', actions: [] }] } }])).rejects.toThrow();
        await expect(save([{ type: 'ask_ai', config: { instruction: '', output: 'text' } }])).rejects.toThrow();
        // Bien armado, sí.
        const okAuto = await save([byTopic(), { type: 'ask_ai', config: { instruction: 'Resume {{mensaje}}', output: 'text' }, on_error: { mode: 'retry', retries: 3 } }]);
        expect(okAuto.id).toBeGreaterThan(0);
    });

    // ─────────────────────────── Asistente / MCP ───────────────────────────

    it('asistente/MCP: el switch y la IA se escriben por slug y etiqueta, y quedan guardados por id', async () => {
        const all = await fieldsService.list(tenantId, 'tickets');
        const ctx = { listName: 'Tickets', fields: all, paths: [], fieldsOf: async () => [] };
        const actions: unknown[] = [
            {
                type: 'ask_ai',
                config: { instruction: 'Clasifica {{mensaje}}', output: 'choice', choices_field: 'tema', save_to: 'tema', response_name: 'tema' },
                on_error: {
                    mode: 'steps',
                    actions: [{ type: 'switch', config: { field: 'tema', cases: [{ value: 'Soporte', actions: [] }] } }],
                },
            },
            {
                type: 'switch',
                config: { field: 'Tema', cases: [{ value: 'Facturación', actions: [] }, { op: 'in', value: ['Ventas', 'Soporte'], actions: [] }], default_actions: [] },
            },
            { type: 'switch', config: { variable: '{{respuestas.tema.valor}}', cases: [{ value: 'Ventas', actions: [] }] } },
        ];
        await translateFlowActions(actions, ctx);
        const a0 = actions[0] as { config: Record<string, unknown>; on_error: { actions: Array<{ config: Record<string, unknown> }> } };
        expect(a0.config).toMatchObject({ choices_field_id: t.tema!.id, save_field_id: t.tema!.id });
        expect(a0.config.choices_field).toBeUndefined();
        // Lo de adentro de «Si falla» también se traduce.
        expect(a0.on_error.actions[0]!.config).toMatchObject({ source_field_id: t.tema!.id, cases: [{ value: 'soporte' }] });
        expect((actions[1] as { config: Record<string, unknown> }).config).toMatchObject({
            source_field_id: t.tema!.id,
            cases: [{ value: 'facturacion' }, { op: 'in', value: ['ventas', 'soporte'] }],
        });
        expect((actions[2] as { config: Record<string, unknown> }).config).toMatchObject({ source_variable: 'respuestas.tema.valor' });

        await expect(translateFlowActions([{ type: 'switch', config: { field: 'no_existe', cases: [{ value: 'x', actions: [] }] } }], ctx)).rejects.toBeInstanceOf(AiToolError);
        await expect(translateFlowActions([{ type: 'ask_ai', config: { instruction: 'x', output: 'choice', choices_field: 'nota' } }], ctx)).rejects.toThrow(/no es un campo de selección/);
    });
});
