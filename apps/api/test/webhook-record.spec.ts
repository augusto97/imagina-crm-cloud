import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { automationHooks, automationRuns, automations, fields, lists, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AutomationDispatcher, chainDepthFromEnv, MAX_AUTOMATION_CHAIN_DEPTH, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationHooksController } from '../src/automations/automation-hooks.controller';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { matchKeysFor } from '../src/automations/webhook-record-lookup';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
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
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class NoMail implements MailTransport {
    readonly name = 'none';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

/** Fake en memoria de las capturas del webhook (lo que usa «Escuchar datos de prueba»). */
class FakeHookStore implements HookCaptureStore {
    private readonly lists = new Map<string, string[]>();
    lpush(key: string, value: string): Promise<number> {
        const list = this.lists.get(key) ?? [];
        list.unshift(value);
        this.lists.set(key, list);
        return Promise.resolve(list.length);
    }
    ltrim(key: string, start: number, stop: number): Promise<unknown> {
        this.lists.set(key, (this.lists.get(key) ?? []).slice(start, stop + 1));
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(key: string, start: number, stop: number): Promise<string[]> {
        return Promise.resolve((this.lists.get(key) ?? []).slice(start, stop + 1));
    }
}

/** Redis mínimo del controlador público (tope por token): nunca frena. */
const noLimitRedis = {
    multi: () => {
        const chain = { incr: () => chain, expire: () => chain, exec: () => Promise.resolve([[null, 1]]) };
        return chain;
    },
} as never;

const rt = new RealtimeService();

/**
 * v0.1.399 — Webhook entrante con REGISTRO en contexto: crear, actualizar por
 * id o por un campo «Sin repetidos», actualizar o crear, la cadena hacia las
 * automatizaciones «Cuando cambia un campo», el tope de la cadena y el secreto.
 */
describe('Webhook entrante con registro (v0.1.399)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let dispatcher: AutomationDispatcher;
    let jobs: Array<{ name: string; data: unknown }>;
    let hookStore: FakeHookStore;
    let tenantId: number;
    let admin: Actor;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        jobs = [];
        dispatcher = new AutomationDispatcher();
        dispatcher.setQueue({ add: (name: string, data: unknown) => (jobs.push({ name, data }), Promise.resolve()) } as never);
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
        const connectors = new ConnectorsService(
            tenantDb,
            pg.db,
            loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }),
            memoryOAuthStore(),
            new AuditService(tenantDb),
            memoryIntegrationApps(),
        );
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
            undefined,
            undefined,
            undefined,
            // RecordsService como lo resuelve la app (ModuleRef).
            { get: () => recs } as never,
        );
        hookStore = new FakeHookStore();
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            hookStore,
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            dispatcher,
            undefined,
            engine,
            new AuditService(tenantDb),
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'binapps', name: 'Binapps', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@binapps.test', passwordHash: 'x', name: 'Ana' }).returning();
        admin = { userId: u!.id, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role: 'admin' }));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        jobs.length = 0;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await listsService.create(tenantId, { name: 'Oportunidades', slug: 'oportunidades' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Teléfono', type: 'phone', slug: 'telefono', is_unique: true, config: { default_country: 'CO' } },
            { label: 'Correo', type: 'email', slug: 'correo' },
            { label: 'Nota', type: 'text', slug: 'nota' },
            {
                label: 'Estado de la demo',
                type: 'select',
                slug: 'estado_demo',
                config: {
                    options: [
                        { value: 'pendiente', label: 'Pendiente' },
                        { value: 'confirmada', label: 'Confirmada' },
                        { value: 'cancelada', label: 'Cancelada' },
                    ],
                },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'oportunidades', d);
        await listsService.create(tenantId, { name: 'Otra lista', slug: 'otra' });
        await fieldsService.create(tenantId, 'otra', { label: 'Nombre', type: 'text', slug: 'nombre' });
    });

    const k = (slug: string) => `f${f[slug]!.id}`;
    const runsOf = (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));
    const all = async () => (await recs.list(tenantId, admin, 'oportunidades', { limit: 50, sort_dir: 'asc' })).data;
    const hook = (triggerConfig: Record<string, unknown>, actions: unknown[], name = 'Respuesta de la demo') =>
        autos.create(tenantId, 'oportunidades', { name, trigger_type: 'incoming_webhook', trigger_config: triggerConfig, actions: actions as never });

    it('actualiza el registro por su id: if_else sobre {{payload.respuesta}}, {{record.id}} y la corrida guarda el registro', async () => {
        const op = await recs.create(tenantId, admin, 'oportunidades', { data: { [k('nombre')]: 'Acme', [k('estado_demo')]: 'pendiente' } });
        const auto = await hook({ record_mode: 'update' }, [
            {
                type: 'if_else',
                config: {
                    condition: [{ field: 'payload.respuesta', op: 'in', value: ['2', 'cancelar'] }],
                    then_actions: [{ type: 'update_field', config: { values: { estado_demo: 'cancelada', nota: 'Registro {{record.id}}: respondió {{payload.respuesta}}' } } }],
                    else_actions: [{ type: 'update_field', config: { values: { estado_demo: 'confirmada' } } }],
                },
            },
        ]);
        // Se guarda en su forma canónica (la clave por defecto es record_id).
        expect(auto.trigger_config).toMatchObject({ record_mode: 'update', match: { by: 'record_id' }, match_key: 'record_id' });

        await engine.runWebhook(tenantId, auto.id, { record_id: op.id, respuesta: '2' });
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        expect(run!.recordId).toBe(op.id);
        const log = run!.actionsLog as Array<{ action: string; status: string; message: string }>;
        expect(log[0]).toMatchObject({ action: 'webhook_record', status: 'success' });
        expect(log[0]!.message).toContain(`#${op.id}`);
        const after = (await recs.get(tenantId, admin, 'oportunidades', op.id)).data;
        expect(after[k('estado_demo')]).toBe('cancelada');
        expect(after[k('nota')]).toBe(`Registro ${op.id}: respondió 2`);

        // La otra rama, con el id como texto y en una ruta anidada.
        const auto2 = await hook({ record_mode: 'update', match_key: 'data.id' }, [{ type: 'update_field', config: { values: { estado_demo: 'confirmada' } } }], 'Anidada');
        await engine.runWebhook(tenantId, auto2.id, { data: { id: String(op.id) } });
        expect((await recs.get(tenantId, admin, 'oportunidades', op.id)).data[k('estado_demo')]).toBe('confirmada');
    });

    it('no encontrado: la corrida queda cancelada con el motivo y no se crea nada (tampoco con un id de otra lista)', async () => {
        const otro = await recs.create(tenantId, admin, 'otra', { data: {} });
        const auto = await hook({ record_mode: 'update' }, [{ type: 'update_field', config: { values: { nota: 'x' } } }]);
        await engine.runWebhook(tenantId, auto.id, { record_id: 99999999 });
        await engine.runWebhook(tenantId, auto.id, { record_id: otro.id });
        await engine.runWebhook(tenantId, auto.id, { id: 5134 });
        await engine.runWebhook(tenantId, auto.id, { record_id: 'abc' });
        const runs = (await runsOf(auto.id)).sort((a, b) => a.id - b.id);
        expect(runs.map((r) => r.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
        expect(runs.every((r) => r.recordId === null)).toBe(true);
        expect(runs[0]!.error).toBe('No encontré el registro con record_id=99999999 en «Oportunidades».');
        expect(runs[1]!.error).toBe(`No encontré el registro con record_id=${otro.id} en «Oportunidades».`);
        expect(runs[2]!.error).toContain('no trae «record_id»');
        expect(runs[3]!.error).toContain('no es el id de un registro');
        expect(await all()).toHaveLength(0);
    });

    it('busca por un teléfono «Sin repetidos» en cualquier formato; un campo que se repite no se acepta al guardar', async () => {
        const op = await recs.create(tenantId, admin, 'oportunidades', { data: { [k('nombre')]: 'Bruno', [k('telefono')]: '+573001112233' } });
        const auto = await hook({ record_mode: 'update', match: { by: 'field', field: 'telefono' } }, [{ type: 'update_field', config: { values: { nota: 'tocado' } } }]);
        expect(auto.trigger_config).toMatchObject({ match: { by: 'field', field: 'telefono' }, match_key: 'telefono' });
        for (const tel of ['3001112233', '+57 300 111 2233', '573001112233']) {
            await recs.update(tenantId, admin, 'oportunidades', op.id, { data: { [k('nota')]: '' } });
            await engine.runWebhook(tenantId, auto.id, { telefono: tel });
            expect((await recs.get(tenantId, admin, 'oportunidades', op.id)).data[k('nota')]).toBe('tocado');
        }
        expect((await runsOf(auto.id)).every((r) => r.status === 'success' && r.recordId === op.id)).toBe(true);

        // Correo no está marcado «Sin repetidos»: no se puede buscar por él.
        await expect(hook({ record_mode: 'update', match: { by: 'field', field: 'correo' } }, [{ type: 'update_field', config: { values: { nota: 'x' } } }])).rejects.toMatchObject({
            response: { code: 'invalid_webhook_match' },
        });
        // Un tipo que no sirve para buscar, ni una ruta rara.
        await expect(hook({ record_mode: 'update', match: { by: 'field', field: 'estado_demo' } }, [])).rejects.toMatchObject({ response: { code: 'invalid_webhook_match' } });
        await expect(hook({ record_mode: 'update', match_key: 'data id' }, [])).rejects.toMatchObject({ response: { code: 'invalid_webhook_key' } });
        // Las formas comparables del teléfono.
        expect(matchKeysFor({ id: 1, type: 'phone', config: { default_country: 'CO' } }, '300 111 2233')).toEqual(['573001112233', '3001112233']);
    });

    it('si hay repetidos de antes de marcar «Sin repetidos», no adivina: la corrida falla con los ids', async () => {
        const auto = await hook({ record_mode: 'update', match: { by: 'field', field: 'telefono' } }, [{ type: 'update_field', config: { values: { nota: 'x' } } }]);
        const listId = (await listsService.get(tenantId, 'oportunidades')).id;
        // Directo en la tabla: así quedaron los datos de antes.
        const ids = await withTenant(pg.db, tenantId, async (tx) => {
            const repo = new RecordsRepository();
            const a = await repo.insert(tx, { tenantId, listId, data: { [k('telefono')]: '+573009998877' }, createdBy: admin.userId });
            const b = await repo.insert(tx, { tenantId, listId, data: { [k('telefono')]: '+573009998877' }, createdBy: admin.userId });
            return [a.id, b.id];
        });
        await engine.runWebhook(tenantId, auto.id, { telefono: '3009998877' });
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('failed');
        expect(run!.error).toContain('Hay 2 registros con «Teléfono»');
        expect(run!.error).toContain(`#${ids[1]}`);
        for (const id of ids) expect((await recs.get(tenantId, admin, 'oportunidades', id)).data[k('nota')]).toBeUndefined();
    });

    it('crear: arma el registro con las claves del JSON y dispara «Cuando se crea» con la cadena', async () => {
        const auto = await hook({ record_mode: 'create' }, [{ type: 'update_field', config: { values: { nota: 'Lead #{{record.id}}' } } }], 'Lead desde la web');
        await engine.runWebhook(tenantId, auto.id, { nombre: 'Lead web', telefono: '3005556677', estado_demo: 'pendiente', utm: 'google' });
        const rows = await all();
        expect(rows).toHaveLength(1);
        const created = rows[0]!;
        expect(created.data[k('nombre')]).toBe('Lead web');
        expect(created.data[k('telefono')]).toBe('+573005556677');
        expect(created.data[k('nota')]).toBe(`Lead #${created.id}`);
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        expect(run!.recordId).toBe(created.id);
        const ev = jobs.map((j) => j.data as TriggerEvent).find((e) => e.trigger === 'record_created');
        expect(ev?.chain).toEqual({ depth: 1, automation_ids: [auto.id] });
    });

    it('actualizar o crear: la primera vez crea, la segunda actualiza el MISMO registro (con los datos del JSON si se pide)', async () => {
        const auto = await hook(
            { record_mode: 'upsert', match: { by: 'field', field: 'telefono' }, match_key: 'contacto.cel', apply_payload_fields: true },
            [],
        );
        await engine.runWebhook(tenantId, auto.id, { contacto: { cel: '+57 311 222 3344' }, nombre: 'Carla' });
        await engine.runWebhook(tenantId, auto.id, { contacto: { cel: '3112223344' }, nombre: 'Carla Gómez', nota: '{{record.id}}' });
        const rows = await all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.data[k('telefono')]).toBe('+573112223344');
        expect(rows[0]!.data[k('nombre')]).toBe('Carla Gómez');
        // Lo que llega en el JSON se guarda tal cual: nunca se interpreta como variable.
        expect(rows[0]!.data[k('nota')]).toBe('{{record.id}}');
        const runs = await runsOf(auto.id);
        expect(runs.every((r) => r.status === 'success' && r.recordId === rows[0]!.id)).toBe(true);
    });

    it('cadena: lo que cambia el webhook corre «Cuando cambia un campo» sobre el mismo registro, sin re-dispararse y con el tope a la vista', async () => {
        const op = await recs.create(tenantId, admin, 'oportunidades', { data: { [k('nombre')]: 'Demo', [k('estado_demo')]: 'pendiente' } });
        const w = await hook({ record_mode: 'update' }, [
            {
                type: 'if_else',
                config: {
                    condition: [{ field: 'payload.respuesta', op: 'eq', value: '2' }],
                    then_actions: [{ type: 'update_field', config: { values: { estado_demo: 'cancelada' } } }],
                    else_actions: [],
                },
            },
        ]);
        const teams = await autos.create(tenantId, 'oportunidades', {
            name: 'Cancelar en Teams',
            trigger_type: 'field_changed',
            trigger_config: { field: 'estado_demo', to_value: 'cancelada' },
            actions: [{ type: 'update_field', config: { values: { nota: 'Reunión cancelada (#{{record.id}})' } } }],
        });
        jobs.length = 0;
        await engine.runWebhook(tenantId, w.id, { record_id: op.id, respuesta: '2' });
        const ev = jobs.map((j) => j.data as TriggerEvent).find((e) => e.trigger === 'record_updated' && e.recordId === op.id)!;
        expect(ev.chain).toEqual({ depth: 1, automation_ids: [w.id] });
        await engine.process(ev);
        const [tRun] = await runsOf(teams.id);
        expect(tRun!.status).toBe('success');
        expect(tRun!.recordId).toBe(op.id);
        expect((await recs.get(tenantId, admin, 'oportunidades', op.id)).data[k('nota')]).toBe(`Reunión cancelada (#${op.id})`);

        // Nunca dos veces en la misma cadena: el evento que trae a «Teams» no lo vuelve a correr.
        const before = (await runsOf(teams.id)).length;
        await engine.process({ ...ev, chain: { depth: 2, automation_ids: [w.id, teams.id] } });
        expect((await runsOf(teams.id)).length).toBe(before);

        // En el tope, el cambio se guarda igual y el historial lo dice.
        await recs.update(tenantId, admin, 'oportunidades', op.id, { data: { [k('estado_demo')]: 'pendiente', [k('nota')]: '' } });
        await engine.process({ ...ev, chain: { depth: MAX_AUTOMATION_CHAIN_DEPTH, automation_ids: [w.id] } });
        const last = (await runsOf(teams.id)).sort((a, b) => b.id - a.id)[0]!;
        const msg = (last.actionsLog as Array<{ message: string }>).map((l) => l.message).join(' ');
        expect(msg).toContain(`ya van ${MAX_AUTOMATION_CHAIN_DEPTH} encadenadas`);
        // El tope es configurable (1 a 10; lo demás vuelve a 3).
        expect([chainDepthFromEnv('5'), chainDepthFromEnv('0'), chainDepthFromEnv('abc'), chainDepthFromEnv(undefined)]).toEqual([5, 3, 3, 3]);
    });

    it('secreto: sin él (o con otro) responde 401 y no encola nada; con la cabecera o Bearer, sí', async () => {
        const auto = await hook({ record_mode: 'update' }, [{ type: 'update_field', config: { values: { nota: 'ok' } } }]);
        const ctrl = new AutomationHooksController(autos, dispatcher, noLimitRedis);
        const token = String(auto.trigger_config.webhook_token);
        // Sin secreto: pasa como siempre.
        jobs.length = 0;
        await expect(ctrl.receive(token, { record_id: 1 }, {})).resolves.toEqual({ ok: true });
        expect(jobs.filter((j) => j.name === 'webhook')).toHaveLength(1);

        const { secret, hint } = await autos.setHookSecret(tenantId, auto.id, undefined, admin.userId);
        expect(secret.length).toBeGreaterThanOrEqual(16);
        expect(hint).toBe(secret.slice(-4));
        expect(await autos.hookSecretStatus(tenantId, auto.id)).toEqual({ enabled: true, hint });
        // Sólo se guarda la huella.
        const [row] = await pg.db.select().from(automationHooks).where(eq(automationHooks.automationId, auto.id));
        expect(row!.secretHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row!.secretHash).not.toContain(secret);

        jobs.length = 0;
        await expect(ctrl.receive(token, { record_id: 1 }, {})).rejects.toMatchObject({ response: { code: 'invalid_secret' } });
        await expect(ctrl.receive(token, { record_id: 1 }, { 'x-webhook-secret': `${secret}x` })).rejects.toMatchObject({ response: { code: 'invalid_secret' } });
        expect(jobs).toHaveLength(0);
        await expect(ctrl.receive(token, { record_id: 1 }, { 'x-webhook-secret': secret })).resolves.toEqual({ ok: true });
        await expect(ctrl.receive(token, { record_id: 1 }, { authorization: `Bearer ${secret}` })).resolves.toEqual({ ok: true });
        expect(jobs.filter((j) => j.name === 'webhook')).toHaveLength(2);
        // Un token desconocido sigue siendo un 404 opaco.
        await expect(ctrl.receive('x'.repeat(32), {}, { 'x-webhook-secret': secret })).rejects.toMatchObject({ status: 404 });

        // Regenerar la URL conserva el secreto; quitarlo lo deja pasar de nuevo.
        const rotated = await autos.update(tenantId, 'oportunidades', auto.id, { trigger_config: { record_mode: 'update' } });
        const newToken = String(rotated.trigger_config.webhook_token);
        expect(newToken).not.toBe(token);
        await expect(ctrl.receive(newToken, {}, {})).rejects.toMatchObject({ response: { code: 'invalid_secret' } });
        await autos.clearHookSecret(tenantId, auto.id, admin.userId);
        await expect(ctrl.receive(newToken, {}, {})).resolves.toEqual({ ok: true });
    });

    it('«Escuchar datos de prueba» dice qué registro encontraría, y «Probar» corre sobre él', async () => {
        const op = await recs.create(tenantId, admin, 'oportunidades', { data: { [k('nombre')]: 'Delta', [k('estado_demo')]: 'pendiente' } });
        const auto = await hook({ record_mode: 'update' }, [{ type: 'update_field', config: { values: { estado_demo: 'confirmada' } } }]);
        await autos.captureHookPayload(tenantId, auto.id, { record_id: 424242 });
        await autos.captureHookPayload(tenantId, auto.id, { record_id: op.id, respuesta: '1' });
        const caps = await autos.hookCaptures(tenantId, auto.id, { record_mode: 'update', match: { by: 'record_id' } });
        expect(caps[0]!.match).toMatchObject({ kind: 'found', record_id: op.id, title: 'Delta' });
        expect(caps[1]!.match).toMatchObject({ kind: 'not_found' });
        // Con la config que se está editando (sin guardar): crear.
        const asCreate = await autos.hookCaptures(tenantId, auto.id, { record_mode: 'create' });
        expect(asCreate[0]!.match?.kind).toBe('create');

        const test = await autos.testRun(tenantId, 'oportunidades', {
            automation_id: auto.id,
            trigger_type: 'incoming_webhook',
            trigger_config: { record_mode: 'update' },
            actions: [{ type: 'update_field', config: { values: { estado_demo: 'confirmada' } } }],
        } as never);
        expect(test.record?.id).toBe(op.id);
        expect(test.trigger.matches).toBe(true);
        expect(test.steps.some((s) => s.action === 'update_field' && s.message.startsWith('Cambiaría'))).toBe(true);
        // «Probar» no escribe.
        expect((await recs.get(tenantId, admin, 'oportunidades', op.id)).data[k('estado_demo')]).toBe('pendiente');
        // La captura vieja (sin registro) no rompe nada en la tabla de hooks.
        const [h] = await pg.db.select().from(automationHooks).where(and(eq(automationHooks.automationId, auto.id), eq(automationHooks.tenantId, tenantId)));
        expect(h).toBeDefined();
    });
});
