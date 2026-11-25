import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    automationRuns,
    automations,
    comments as commentsTable,
    fields,
    lists,
    memberships,
    notifications,
    records,
    relations,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { translateFlowActions } from '../src/ai/tools/automation-flow-ai';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService, stripReservedCommentMetadata } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
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
type Job = { name: string; data: Record<string, unknown> };

/**
 * v0.1.466 — «Comprobar y detener si no se cumple» y «Agregar un comentario»,
 * con Postgres y Redis reales: el motor, el despachador de eventos, los
 * comentarios (menciones y avisos) y «Probar».
 */
describe('Automatizaciones: comprobar y detener + agregar un comentario (v0.1.466)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let commentsSvc: CommentsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let jobs: Job[];
    let pending: Array<Promise<unknown>>;
    let tenantId: number;
    let admin: Actor;
    const ids: Record<string, number> = {};
    let t: Record<string, Field>;
    let ff: Record<string, Field>;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        jobs = [];
        pending = [];
        const hub = new NotifyHub();
        // El despachador escucha los comentarios (para «Cuando se agrega un comentario»).
        const dispatcher = new AutomationDispatcher(undefined, pg.db, undefined, undefined, hub);
        dispatcher.setQueue({ add: (name: string, data: unknown) => (jobs.push({ name, data: data as Record<string, unknown> }), Promise.resolve()) } as never);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            dispatcher,
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            undefined,
            hub,
        );
        commentsSvc = new CommentsService(tenantDb, new CommentsRepository(), listsService, recs, rt, hub);
        const notificationsSvc = new NotificationsService(pg.db, tenantDb, listsService, fieldsService, recs, rt, { enqueue: () => Promise.resolve() } as never, redis as never, env);
        hub.subscribe((e) => void pending.push(notificationsSvc.onNotify(e)));
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
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
            { fileLink: (_t: number, id: number) => `https://app.test/f/${id}` } as never,
            undefined,
            {
                get: (cls: unknown) => (cls === CommentsService ? commentsSvc : cls === NotificationsService ? notificationsSvc : recs),
            } as never,
            undefined,
            redis as never,
        );
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            noHooks,
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
        const [tn] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantId = tn!.id;
        const people: Array<[string, string, 'admin' | 'manager' | 'agent' | 'viewer']> = [
            ['ana', 'Ana Ruiz', 'admin'],
            ['beto', 'Beto Gil', 'agent'],
            ['dani', 'Dani Sol', 'manager'],
            ['caro', 'Caro Paz', 'viewer'],
        ];
        for (const [key, name, role] of people) {
            const [u] = await pg.db.insert(users).values({ email: `${key}@acme.test`, passwordHash: 'x', name }).returning();
            ids[key] = u!.id;
            await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role }));
        }
        admin = { userId: ids.ana!, role: 'admin' };
    });

    afterAll(async () => {
        await redis?.quit().catch(() => undefined);
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        jobs.length = 0;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(notifications).where(eq(notifications.tenantId, tenantId));
            await tx.delete(commentsTable).where(eq(commentsTable.tenantId, tenantId));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        const tareasId = (await listsService.create(tenantId, { name: 'Tareas', slug: 'tareas' })).id;
        const estado = {
            options: [
                { value: 'normal', label: 'Normal' },
                { value: 'urgente', label: 'Urgente' },
                { value: 'hecho', label: 'Hecho' },
            ],
        };
        t = {};
        for (const d of [
            { label: 'Título', type: 'text', slug: 'titulo' },
            { label: 'Estado', type: 'select', slug: 'estado', config: estado },
            { label: 'Monto', type: 'number', slug: 'monto' },
            { label: 'Nota', type: 'long_text', slug: 'nota' },
            { label: 'Paso final', type: 'text', slug: 'final' },
        ] as CreateFieldInput[]) {
            t[d.slug!] = await fieldsService.create(tenantId, 'tareas', d);
        }
        await listsService.create(tenantId, { name: 'Pagos', slug: 'pagos' });
        ff = {};
        for (const d of [
            { label: 'Concepto', type: 'text', slug: 'concepto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagado', label: 'Pagado' }, { value: 'avisado', label: 'Avisado' }] },
            },
            { label: 'Tarea', type: 'relation', slug: 'tarea', config: { target_list_id: tareasId } },
        ] as CreateFieldInput[]) {
            ff[d.slug!] = await fieldsService.create(tenantId, 'pagos', d);
        }
    });

    const k = (slug: string) => `f${t[slug]!.id}`;
    const fk = (slug: string) => `f${ff[slug]!.id}`;
    const runsOf = async (automationId: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)))).sort((a, b) => a.id - b.id);
    const create = (data: Record<string, unknown>, by: Actor = admin) => recs.create(tenantId, by, 'tareas', { data });
    const get = async (id: number) => (await recs.get(tenantId, admin, 'tareas', id)).data;
    const commentsOf = (recordId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(commentsTable).where(and(eq(commentsTable.tenantId, tenantId), eq(commentsTable.recordId, recordId))).orderBy(commentsTable.id));
    /** Corre lo que encoló el despachador (y espera los avisos), hasta que no quede nada. */
    const drain = async (): Promise<void> => {
        for (let round = 0; round < 30; round++) {
            await new Promise((r) => setTimeout(r, 40));
            await Promise.all(pending.splice(0));
            if (jobs.length === 0) return;
            for (const j of jobs.splice(0)) {
                if (j.name === 'event') await engine.process(j.data as unknown as TriggerEvent);
            }
        }
    };
    const event = async (recordId: number, after: Record<string, unknown>): Promise<TriggerEvent> => ({
        tenantId,
        listId: (await listsService.get(tenantId, 'tareas')).id,
        recordId,
        trigger: 'record_created',
        after,
    });
    /** Una automatización ACTIVA «al crear» que se corre a mano sobre un registro. */
    const runFor = async (actions: unknown[], data: Record<string, unknown>) => {
        // Las «al crear» de antes no corren sobre este registro (sólo la nueva).
        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(automations).set({ isActive: false }).where(and(eq(automations.tenantId, tenantId), eq(automations.triggerType, 'record_created'))),
        );
        const auto = await autos.create(tenantId, 'tareas', { name: 'Prueba', trigger_type: 'record_created', actions: actions as never });
        jobs.length = 0;
        const rec = await create(data);
        jobs.length = 0;
        await engine.process(await event(rec.id, rec.data));
        await drain();
        const [run] = await runsOf(auto.id);
        return { auto, rec, run: run!, log: run!.actionsLog as LogEntry[] };
    };

    // ───────────────────────── Comprobar y detener ─────────────────────────

    it('comprobar y detener: mira el registro TAL COMO QUEDÓ; si se cumple sigue, si no termina sin falla y dice qué regla', async () => {
        const sigue = await runFor(
            [
                { type: 'update_field', config: { values: { estado: 'urgente' } } },
                { type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'urgente' }] } },
                { type: 'update_field', config: { values: { final: 'llegó' } } },
            ],
            { [k('titulo')]: 'A', [k('estado')]: 'normal' },
        );
        expect(sigue.run.status).toBe('success');
        expect(sigue.log.map((l) => [l.action, l.status])).toEqual([
            ['update_field', 'success'],
            ['stop_unless', 'success'],
            ['update_field', 'success'],
        ]);
        expect(sigue.log[1]!.message).toBe('Se cumplió: siguió con los pasos siguientes.');
        expect((await get(sigue.rec.id))[k('final')]).toBe('llegó');

        const corta = await runFor(
            [
                { type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'hecho' }, { field: 'monto', op: 'gt', value: 100 }] } },
                { type: 'update_field', config: { values: { final: 'no debería' } } },
            ],
            { [k('titulo')]: 'B', [k('estado')]: 'normal', [k('monto')]: 50 },
        );
        // Detenerse no es una falla: la corrida queda bien y sin error.
        expect(corta.run.status).toBe('success');
        expect(corta.run.error).toBeNull();
        expect(corta.log).toHaveLength(1);
        expect(corta.log[0]!.status).toBe('skipped');
        expect(corta.log[0]!.message).toBe('No se cumplía «Estado» es «Hecho» ni «Monto» es mayor que «100»: la automatización no siguió.');
        expect((await get(corta.rec.id))[k('final')]).toBeUndefined();
    });

    it('comprobar y detener dentro de una rama detiene TODO; dentro de «Repetir por cada vinculado» sólo ese vinculado', async () => {
        const enRama = await runFor(
            [
                {
                    type: 'if_else',
                    config: {
                        condition: [{ field: 'estado', op: 'eq', value: 'normal' }],
                        then_actions: [
                            { type: 'update_field', config: { values: { nota: 'rama' } } },
                            { type: 'stop_unless', config: { condition: [{ field: 'monto', op: 'is_not_null' }] } },
                        ],
                        else_actions: [],
                    },
                },
                { type: 'update_field', config: { values: { final: 'después de la rama' } } },
            ],
            { [k('titulo')]: 'C', [k('estado')]: 'normal' },
        );
        expect(enRama.run.status).toBe('success');
        const after = await get(enRama.rec.id);
        expect(after[k('nota')]).toBe('rama');
        expect(after[k('final')]).toBeUndefined();

        // En una repetición: corta sólo el vinculado que no cumple y sigue con los demás.
        const tarea = await create({ [k('titulo')]: 'Con pagos', [k('estado')]: 'normal' });
        const pago = (concepto: string, estado: string) => recs.create(tenantId, admin, 'pagos', { data: { [fk('concepto')]: concepto, [fk('estado')]: estado, [fk('tarea')]: [tarea.id] } });
        const p1 = await pago('Enero', 'pendiente');
        const p2 = await pago('Febrero', 'pagado');
        const p3 = await pago('Marzo', 'pendiente');
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Avisar pendientes',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'for_each_linked',
                    config: {
                        relation_field_id: ff.tarea!.id,
                        actions: [
                            { type: 'stop_unless', config: { condition: [{ field: 'item.estado', op: 'eq', value: 'pendiente' }] } },
                            { type: 'update_field', config: { target: 'item', values: { estado: 'avisado' } } },
                        ],
                    },
                },
                { type: 'update_field', config: { values: { final: 'repetición terminada' } } },
            ] as never,
        });
        jobs.length = 0;
        await engine.process(await event(tarea.id, tarea.data));
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const pagoEstado = async (id: number) => (await recs.get(tenantId, admin, 'pagos', id)).data[fk('estado')];
        expect(await pagoEstado(p1.id)).toBe('avisado');
        expect(await pagoEstado(p2.id)).toBe('pagado');
        expect(await pagoEstado(p3.id)).toBe('avisado');
        // El paso de DESPUÉS de la repetición corrió.
        expect((await get(tarea.id))[k('final')]).toBe('repetición terminada');
        const loop = (run!.actionsLog as LogEntry[])[0]!;
        expect(loop.message).toMatch(/3 de 3 .*: 2 bien, 1 omitido/);
    });

    it('comprobar y detener en «Probar»: dice si seguiría o se detendría, con la regla, sin escribir nada', async () => {
        const rec = await create({ [k('titulo')]: 'Prueba', [k('estado')]: 'normal' });
        const actions = [
            { type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'urgente' }] } },
            { type: 'update_field', config: { values: { final: 'x' } } },
        ];
        const sim = await autos.testRun(tenantId, 'tareas', { trigger_type: 'record_created', trigger_config: {}, actions: actions as never, record_id: rec.id, real_steps: [] });
        const s0 = sim.steps.find((s) => s.path === '0')!;
        expect(s0.status).toBe('skipped');
        expect(s0.message).toBe('No se cumplía «Estado» es «Urgente»: la automatización se detendría aquí.');
        expect((s0.details.checks as unknown[]).length).toBe(1);
        expect(sim.steps.find((s) => s.path === '1')).toBeUndefined();

        const ok = await autos.testRun(tenantId, 'tareas', {
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [{ type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'normal' }] } }, actions[1]] as never,
            record_id: rec.id,
            real_steps: [],
        });
        expect(ok.steps.find((s) => s.path === '0')!.message).toBe('Se cumple: seguiría con los pasos siguientes.');
        expect(ok.steps.find((s) => s.path === '1')!.status).toBe('would_run');
        expect((await get(rec.id))[k('final')]).toBeUndefined();
    });

    it('al guardar: «Comprobar y detener» sin reglas y un comentario sin texto no se guardan; no acepta «Si este paso falla»', async () => {
        await expect(
            autos.create(tenantId, 'tareas', { name: 'Mal', trigger_type: 'record_created', actions: [{ type: 'stop_unless', config: { condition: [] } }] as never }),
        ).rejects.toThrow(/Agrega al menos una regla/);
        await expect(
            autos.create(tenantId, 'tareas', { name: 'Mal 2', trigger_type: 'record_created', actions: [{ type: 'add_comment', config: { body: '  ' } }] as never }),
        ).rejects.toThrow(/Escribe el texto del comentario/);
        await expect(
            autos.create(tenantId, 'tareas', {
                name: 'Mal 3',
                trigger_type: 'record_created',
                actions: [{ type: 'add_comment', config: { body: 'Hola', target: 'item' } }] as never,
            }),
        ).rejects.toThrow(/sólo existe dentro de «Repetir/);
    });

    // ───────────────────────── Agregar un comentario ─────────────────────────

    it('agregar un comentario: con variables, firmado por la automatización, avisa a los mencionados y NO dispara «Cuando se agrega un comentario»', async () => {
        const escucha = await autos.create(tenantId, 'tareas', {
            name: 'Cuando comentan',
            trigger_type: 'comment_added',
            actions: [{ type: 'update_field', config: { values: { nota: 'comentaron: {{comentario.texto}}' } } }] as never,
        });
        const { auto, rec, run, log } = await runFor(
            [{ type: 'add_comment', config: { body: 'Revisar «{{titulo}}» por {{monto}}. @dani@acme.test @beto@acme.test mira esto', visibility: 'client' } }],
            { [k('titulo')]: 'Pedido 7', [k('monto')]: 300 },
        );
        expect(run.status).toBe('success');
        expect(log[0]!.status).toBe('success');
        expect(log[0]!.message).toBe('Agregó un comentario visible para el cliente al registro.');
        const rows = await commentsOf(rec.id);
        expect(rows).toHaveLength(1);
        const c = rows[0]!;
        expect(c.userId).toBe(0);
        expect(c.body).toBe('Revisar «Pedido 7» por 300. @dani@acme.test @beto@acme.test mira esto');
        expect(c.visibility).toBe('client');
        expect(c.kind).toBe('note');
        expect(c.metadata).toEqual({ automation: { id: auto.id, name: 'Prueba' } });
        expect(log[0]!.details).toMatchObject({ comment_id: c.id, visibility: 'client', record_id: rec.id });

        // El equipo lo ve firmado por la automatización.
        const dto = (await commentsSvc.list(tenantId, admin, 'tareas', rec.id))[0]!;
        expect(dto.user_name).toBe('Automatización «Prueba»');

        // La mención llega a la campana de Beto (sin una persona como «actor»).
        await drain();
        const inbox = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, ids.dani!))),
        );
        expect(inbox.map((n) => n.kind)).toContain('mention');
        expect(inbox.every((n) => n.actorId === null)).toBe(true);
        // A quien no ve el registro (el agente, que sólo ve lo suyo) no le llega nada.
        const betoInbox = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, ids.beto!))),
        );
        expect(betoInbox).toHaveLength(0);

        // No disparó «Cuando se agrega un comentario» (evita bucles)…
        expect(await runsOf(escucha.id)).toHaveLength(0);
        // …pero un comentario de una persona sí.
        await commentsSvc.create(tenantId, admin, 'tareas', rec.id, { body: 'Listo', kind: 'note' });
        await drain();
        expect(await runsOf(escucha.id)).toHaveLength(1);
    });

    it('agregar un comentario: en el vinculado de cada vuelta, vacío se omite, y «Probar» muestra el texto sin comentar', async () => {
        const tarea = await create({ [k('titulo')]: 'Con pagos' });
        const p1 = await recs.create(tenantId, admin, 'pagos', { data: { [fk('concepto')]: 'Enero', [fk('estado')]: 'pendiente', [fk('tarea')]: [tarea.id] } });
        const actions = [
            {
                type: 'for_each_linked',
                config: {
                    relation_field_id: ff.tarea!.id,
                    actions: [{ type: 'add_comment', config: { body: 'Pago de {{item.concepto}} de «{{titulo}}»', target: 'item' } }],
                },
            },
            { type: 'add_comment', config: { body: '{{nota}}' } },
        ];
        const sim = await autos.testRun(tenantId, 'tareas', { trigger_type: 'record_created', trigger_config: {}, actions: actions as never, record_id: tarea.id, real_steps: [] });
        const inner = sim.steps.find((s) => s.action === 'add_comment' && s.path !== '1')!;
        expect(inner.status).toBe('would_run');
        expect(inner.message).toBe(`Agregaría una nota interna al registro vinculado #${p1.id}: «Pago de Enero de «Con pagos»».`);
        expect(inner.details.body).toBe('Pago de Enero de «Con pagos»');
        expect(await commentsOf(p1.id)).toHaveLength(0);

        const auto = await autos.create(tenantId, 'tareas', { name: 'Comentar pagos', trigger_type: 'record_created', actions: actions as never });
        jobs.length = 0;
        await engine.process(await event(tarea.id, tarea.data));
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const onPago = await commentsOf(p1.id);
        expect(onPago.map((c) => [c.body, c.visibility])).toEqual([['Pago de Enero de «Con pagos»', 'internal']]);
        // El de la tarea quedó vacío con estos datos: se omite, sin falla.
        const last = (run!.actionsLog as LogEntry[])[1]!;
        expect(last.status).toBe('skipped');
        expect(last.message).toMatch(/quedó vacío/);
        expect(await commentsOf(tarea.id)).toHaveLength(0);
    });

    it('el comentario de una automatización: nadie lo edita; lo borra un admin o quien edita el registro; una persona no puede fabricar la marca', async () => {
        const { rec } = await runFor([{ type: 'add_comment', config: { body: 'Nota automática' } }], { [k('titulo')]: 'Del admin' });
        const [c] = await commentsOf(rec.id);
        const beto: Actor = { userId: ids.beto!, role: 'agent' };
        const caro: Actor = { userId: ids.caro!, role: 'viewer' };
        const dani: Actor = { userId: ids.dani!, role: 'manager' };
        await expect(commentsSvc.update(tenantId, admin, 'tareas', rec.id, c!.id, { body: 'cambiado' })).rejects.toThrow(/Sólo el autor/);
        // El agente ni lo ve (no es suyo); quien sólo mira, lo ve pero no lo borra.
        await expect(commentsSvc.remove(tenantId, beto, 'tareas', rec.id, c!.id)).rejects.toThrow();
        await expect(commentsSvc.remove(tenantId, caro, 'tareas', rec.id, c!.id)).rejects.toThrow(/lo borra un administrador o quien puede editar el registro/);
        // El gerente sí edita el registro: lo borra.
        await commentsSvc.remove(tenantId, dani, 'tareas', rec.id, c!.id);
        expect((await commentsOf(rec.id))[0]!.deletedAt).not.toBeNull();

        // Una persona que manda la marca no se hace pasar por una automatización:
        // el controller la quita (como las del correo y del agente) antes de crear.
        expect(stripReservedCommentMetadata({ kind: 'call', automation: { id: 1, name: 'Falsa' } })).toEqual({ kind: 'call' });
        // Y un comentario de una persona (user_id > 0) nunca se lee como de una automatización.
        const own = await commentsSvc.create(tenantId, admin, 'tareas', rec.id, { body: 'Soy una persona', kind: 'note' });
        expect(own.user_name).toBe('Ana Ruiz');
    });

    it('asistente/MCP: traduce «Comprobar y detener» (opciones por etiqueta) y valida «Agregar un comentario»', async () => {
        const ctx = { listName: 'Tareas', fields: Object.values(t), paths: [], fieldsOf: () => Promise.resolve([]) };
        const actions: Array<{ type: string; config: Record<string, unknown> }> = [
            { type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'Urgente' }] } },
            { type: 'add_comment', config: { body: 'Hola {{titulo}}', visibility: 'client' } },
        ];
        await translateFlowActions(actions, ctx);
        expect((actions[0]!.config.condition as Array<{ value: unknown }>)[0]!.value).toBe('urgente');
        await expect(translateFlowActions([{ type: 'stop_unless', config: { condition: [] } }], ctx)).rejects.toThrow(/regla/);
        await expect(translateFlowActions([{ type: 'add_comment', config: { body: 'x', target: 'item' } }], ctx)).rejects.toThrow(/for_each_linked/);
        await expect(translateFlowActions([{ type: 'add_comment', config: { body: ' ' } }], ctx)).rejects.toThrow(/body/);
    });
});
