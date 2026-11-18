import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { automationRuns, automations, comments, fields, lists, memberships, records, relations, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotifyHub } from '../src/notifications/notify-hub';
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

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(1),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

const rt = new RealtimeService();

type LogEntry = { action: string; status: string; message: string; details?: Record<string, unknown> };

/**
 * v0.1.444 — «Buscar registros», «Crear o actualizar un registro» y «Cuando se
 * agrega un comentario», con Postgres real.
 */
describe('Automatizaciones: buscar, crear o actualizar y comentarios (v0.1.444)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let notify: NotifyHub;
    let commentsService: CommentsService;
    let jobs: TriggerEvent[];
    let tenantId: number;
    let admin: Actor;
    let c: Record<string, Field>;
    let o: Record<string, Field>;
    let clientesId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        jobs = [];
        notify = new NotifyHub();
        // La conexión base del dispatcher lee el registro y el autor del comentario.
        const dispatcher = new AutomationDispatcher(undefined, pg.db, undefined, undefined, notify);
        dispatcher.setQueue({ add: (_name: string, data: unknown) => (jobs.push(data as TriggerEvent), Promise.resolve()) } as never);
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
            { get: () => recs } as never,
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
        commentsService = new CommentsService(tenantDb, new CommentsRepository(), listsService, recs, rt, notify);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Ruiz' }).returning();
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
            await tx.delete(comments).where(eq(comments.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        clientesId = (await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' })).id;
        const cDefs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Correo', type: 'email', slug: 'correo', is_unique: true },
            { label: 'Teléfono', type: 'phone', slug: 'telefono', config: { default_country: 'CO' } },
            { label: 'Monto', type: 'number', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }] },
            },
        ];
        c = {};
        for (const d of cDefs) c[d.slug!] = await fieldsService.create(tenantId, 'clientes', d);
        await listsService.create(tenantId, { name: 'Oportunidades', slug: 'oportunidades' });
        const oDefs: CreateFieldInput[] = [
            { label: 'Título', type: 'text', slug: 'titulo' },
            { label: 'Nota', type: 'long_text', slug: 'nota' },
            { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientesId } },
        ];
        o = {};
        for (const d of oDefs) o[d.slug!] = await fieldsService.create(tenantId, 'oportunidades', d);
    });

    const ck = (slug: string) => `f${c[slug]!.id}`;
    const ok = (slug: string) => `f${o[slug]!.id}`;
    const runsOf = (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));
    const listAll = async (list: string) => (await recs.list(tenantId, admin, list, { limit: 50, sort_dir: 'asc', include_subtasks: true })).data;
    const hook = (actions: unknown[], name = 'Prueba', list = 'oportunidades') =>
        autos.create(tenantId, list, { name, trigger_type: 'incoming_webhook', trigger_config: {}, actions: actions as never });
    const seedClientes = async () => {
        const a = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Acme', [ck('correo')]: 'ana@acme.co', [ck('estado')]: 'activo', [ck('monto')]: 100, [ck('telefono')]: '+573001112233' } });
        const b = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Beta', [ck('correo')]: 'b@beta.co', [ck('estado')]: 'inactivo', [ck('monto')]: 50 } });
        const g = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Gamma', [ck('correo')]: 'c@gamma.co', [ck('estado')]: 'activo', [ck('monto')]: 300 } });
        return { a, b, g };
    };

    it('busca en otra lista con variables: correo sin mayúsculas, opción por su etiqueta, orden y cuántos hay', async () => {
        const { a, g } = await seedClientes();
        const auto = await hook([
            { type: 'find_records', config: { list_id: clientesId, conditions: [{ field: 'correo', op: 'eq', value: '{{payload.correo}}' }], response_name: 'cliente' } },
            { type: 'find_records', config: { list_id: clientesId, conditions: [{ field: 'estado', op: 'eq', value: 'Activo' }], sort_field: 'monto', sort_dir: 'desc', limit: 1, response_name: 'top' } },
            {
                type: 'create_record',
                config: {
                    target_list: 'oportunidades',
                    values: {
                        titulo: '{{respuestas.cliente.primero.nombre}} · mejor: {{respuestas.top.primero.titulo}}',
                        nota: '{{respuestas.cliente.cantidad}}/{{respuestas.top.cantidad}} de {{respuestas.top.total}}',
                        cliente: '{{respuestas.cliente.ids}}',
                    },
                },
            },
        ]);
        await engine.runWebhook(tenantId, auto.id, { correo: '  ANA@Acme.co ' });
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const log = run!.actionsLog as LogEntry[];
        expect(log[0]).toMatchObject({ action: 'find_records', status: 'success' });
        expect(log[0]!.message).toContain(`#${a.id} «Acme»`);
        expect(log[1]!.message).toContain('hay 2');
        const [created] = await listAll('oportunidades');
        expect(created!.data[ok('titulo')]).toBe('Acme · mejor: Gamma');
        expect(created!.data[ok('nota')]).toBe('1/1 de 2');
        expect(created!.relations?.[ok('cliente')]).toEqual([a.id]);
        expect(g.id).toBeGreaterThan(0);
    });

    it('una variable vacía no busca «todo»; si no encuentra nada puede detener la automatización', async () => {
        await seedClientes();
        const auto = await hook([
            { type: 'find_records', config: { list_id: clientesId, conditions: [{ field: 'correo', op: 'eq', value: '{{payload.correo}}' }], if_none: 'stop' } },
            { type: 'create_record', config: { target_list: 'oportunidades', values: { titulo: 'No debería existir' } } },
        ]);
        await engine.runWebhook(tenantId, auto.id, {});
        await engine.runWebhook(tenantId, auto.id, { correo: 'nadie@x.co' });
        const runs = (await runsOf(auto.id)).sort((x, y) => x.id - y.id);
        expect(runs).toHaveLength(2);
        for (const r of runs) {
            const log = r.actionsLog as LogEntry[];
            expect(log).toHaveLength(1);
            expect(log[0]).toMatchObject({ action: 'find_records', status: 'skipped' });
            expect(log[0]!.message).toContain('La automatización no siguió');
        }
        expect((runs[0]!.actionsLog as LogEntry[])[0]!.message).toContain('«Correo» quedó vacío');
        expect(await listAll('oportunidades')).toHaveLength(0);

        // Con «alguna», la condición vacía no cuenta y la otra sí; teléfono por dígitos.
        const any = await hook(
            [
                {
                    type: 'find_records',
                    config: {
                        list_id: clientesId,
                        logic: 'or',
                        conditions: [
                            { field: 'correo', op: 'eq', value: '{{payload.correo}}' },
                            { field: 'telefono', op: 'eq', value: '{{payload.cel}}' },
                        ],
                    },
                },
                { type: 'create_record', config: { target_list: 'oportunidades', values: { titulo: 'Halló {{respuestas.busqueda.primero.nombre}}' } } },
            ],
            'Alguna',
        );
        await engine.runWebhook(tenantId, any.id, { cel: '300 111 2233' });
        const [made] = await listAll('oportunidades');
        expect(made!.data[ok('titulo')]).toBe('Halló Acme');
    });

    it('busca por un vínculo (id del registro) y en la misma lista no cuenta al que disparó; un campo inexistente falla', async () => {
        const { a, b } = await seedClientes();
        const op1 = await recs.create(tenantId, admin, 'oportunidades', { data: { [ok('titulo')]: 'Op 1', [ok('cliente')]: [a.id] } });
        await recs.create(tenantId, admin, 'oportunidades', { data: { [ok('titulo')]: 'Op 2', [ok('cliente')]: [a.id] } });
        await recs.create(tenantId, admin, 'oportunidades', { data: { [ok('titulo')]: 'Op 3', [ok('cliente')]: [b.id] } });
        const auto = await autos.create(tenantId, 'oportunidades', {
            name: 'Otras del cliente',
            trigger_type: 'incoming_webhook',
            trigger_config: { record_mode: 'update' },
            actions: [
                { type: 'find_records', config: { conditions: [{ field: 'cliente', op: 'eq', value: '{{payload.cliente_id}}' }], response_name: 'otras' } },
                { type: 'update_field', config: { values: { nota: 'Otras: {{respuestas.otras.cantidad}} ({{respuestas.otras.primero.titulo}})' } } },
            ] as never,
        });
        await engine.runWebhook(tenantId, auto.id, { record_id: op1.id, cliente_id: a.id });
        expect((await recs.get(tenantId, admin, 'oportunidades', op1.id)).data[ok('nota')]).toBe('Otras: 1 (Op 2)');

        const broken = await hook([{ type: 'find_records', config: { conditions: [{ field: 'no_existe', op: 'eq', value: 'x' }] } }], 'Rota');
        await engine.runWebhook(tenantId, broken.id, {});
        const [run] = await runsOf(broken.id);
        expect(run!.status).toBe('failed');
        expect((run!.actionsLog as LogEntry[])[0]!.message).toContain('«no_existe» ya no existe');
    });

    it('crear o actualizar por un campo «Sin repetidos»: crea, actualiza el mismo, no repite y respeta los modos', async () => {
        const upsert = (extra: Record<string, unknown> = {}) =>
            hook(
                [
                    {
                        type: 'upsert_record',
                        config: {
                            list_id: clientesId,
                            match_by: 'field',
                            match_field: 'correo',
                            match_value: '{{payload.correo}}',
                            values: { nombre: '{{payload.nombre}}', monto: '{{payload.monto}}' },
                            ...extra,
                        },
                    },
                    { type: 'create_record', config: { target_list: 'oportunidades', values: { titulo: '{{respuestas.registro.accion}} #{{respuestas.registro.id}} {{respuestas.registro.titulo}}' } } },
                ],
                `Upsert ${JSON.stringify(extra)}`,
            );
        const auto = await upsert();
        await engine.runWebhook(tenantId, auto.id, { correo: 'nuevo@x.co', nombre: 'Nuevo', monto: '1500' });
        let clientes = await listAll('clientes');
        expect(clientes).toHaveLength(1);
        const id = clientes[0]!.id;
        expect(clientes[0]!.data[ck('correo')]).toBe('nuevo@x.co'); // el dato con que se buscó queda guardado
        expect(clientes[0]!.data[ck('monto')]).toBe(1500);

        await engine.runWebhook(tenantId, auto.id, { correo: ' NUEVO@x.co', nombre: 'Nuevo SAS', monto: '1500' });
        await engine.runWebhook(tenantId, auto.id, { correo: 'nuevo@x.co', nombre: 'Nuevo SAS', monto: '1500' });
        // Un valor vacío no borra lo que ya tenía.
        await engine.runWebhook(tenantId, auto.id, { correo: 'nuevo@x.co', nombre: '', monto: '1500' });
        clientes = await listAll('clientes');
        expect(clientes).toHaveLength(1);
        expect(clientes[0]!.data[ck('nombre')]).toBe('Nuevo SAS');
        const titles = (await listAll('oportunidades')).map((r) => r.data[ok('titulo')]);
        expect(titles).toEqual([`creado #${id} Nuevo`, `actualizado #${id} Nuevo SAS`, `sin_cambios #${id} Nuevo SAS`, `sin_cambios #${id} Nuevo SAS`]);

        const onlyUpdate = await upsert({ mode: 'update_only' });
        await engine.runWebhook(tenantId, onlyUpdate.id, { correo: 'otro@x.co', nombre: 'Otro' });
        const [skipRun] = await runsOf(onlyUpdate.id);
        expect((skipRun!.actionsLog as LogEntry[])[0]).toMatchObject({ status: 'skipped' });
        expect((skipRun!.actionsLog as LogEntry[])[0]!.message).toContain('no se actualizó nada');
        const onlyCreate = await upsert({ mode: 'create_only' });
        await engine.runWebhook(tenantId, onlyCreate.id, { correo: 'nuevo@x.co', nombre: 'Pisaría' });
        clientes = await listAll('clientes');
        expect(clientes).toHaveLength(1);
        expect(clientes[0]!.data[ck('nombre')]).toBe('Nuevo SAS');
        const last = (await listAll('oportunidades')).at(-1)!;
        expect(last.data[ok('titulo')]).toBe(`ya_existia #${id} Nuevo SAS`);
    });

    it('crear o actualizar por el id del registro; un campo que se repite o datos repetidos no se adivinan', async () => {
        const { a } = await seedClientes();
        const byId = await hook([{ type: 'upsert_record', config: { list_id: clientesId, mode: 'update_only', match_value: '{{payload.id}}', values: { estado: 'Inactivo' } } }], 'Por id');
        await engine.runWebhook(tenantId, byId.id, { id: String(a.id) });
        expect((await recs.get(tenantId, admin, 'clientes', a.id)).data[ck('estado')]).toBe('inactivo');

        const byPhone = await hook(
            [{ type: 'upsert_record', config: { list_id: clientesId, match_by: 'field', match_field: 'telefono', match_value: '{{payload.cel}}', values: { monto: 1 } } }],
            'Por teléfono',
        );
        await engine.runWebhook(tenantId, byPhone.id, { cel: '3001112233' });
        const [phoneRun] = await runsOf(byPhone.id);
        expect(phoneRun!.status).toBe('failed');
        expect((phoneRun!.actionsLog as LogEntry[])[0]!.message).toContain('«Sin repetidos»');

        // Repetidos de antes de marcar «Sin repetidos»: falla sin tocar ninguno.
        const dupes = await withTenant(pg.db, tenantId, async (tx) => {
            const repo = new RecordsRepository();
            const x = await repo.insert(tx, { tenantId, listId: clientesId, data: { [ck('correo')]: 'dup@x.co' }, createdBy: admin.userId });
            const y = await repo.insert(tx, { tenantId, listId: clientesId, data: { [ck('correo')]: 'dup@x.co' }, createdBy: admin.userId });
            return [x.id, y.id];
        });
        const byMail = await hook([{ type: 'upsert_record', config: { list_id: clientesId, match_by: 'field', match_field: 'correo', match_value: 'dup@x.co', values: { nombre: 'X' } } }], 'Dup');
        await engine.runWebhook(tenantId, byMail.id, {});
        const [dupRun] = await runsOf(byMail.id);
        expect(dupRun!.status).toBe('failed');
        expect((dupRun!.actionsLog as LogEntry[])[0]!.message).toContain('Hay 2 registros');
        for (const d of dupes) expect((await recs.get(tenantId, admin, 'clientes', d)).data[ck('nombre')]).toBeUndefined();
    });

    it('«Probar» busca de verdad pero no escribe nada', async () => {
        const { a } = await seedClientes();
        const auto = await hook([
            { type: 'find_records', config: { list_id: clientesId, conditions: [{ field: 'nombre', op: 'contains', value: 'acm' }] } },
            { type: 'upsert_record', config: { list_id: clientesId, match_value: '{{respuestas.busqueda.primero.id}}', values: { nombre: 'Cambiado' } } },
        ]);
        const op = await recs.create(tenantId, admin, 'oportunidades', { data: { [ok('titulo')]: 'x' } });
        const res = await autos.testRun(
            tenantId,
            'oportunidades',
            { trigger_type: 'record_created', trigger_config: {}, actions: auto.actions as never, record_id: op.id, real_steps: [] },
            admin,
        );
        const steps = res.steps as unknown as LogEntry[];
        expect(steps.find((s) => s.action === 'find_records')!.message).toContain(`#${a.id} «Acme»`);
        expect(steps.find((s) => s.action === 'upsert_record')!.message).toContain('Actualizaría 1 campo(s)');
        // Lo encontrado vuelve como muestra: el editor sugiere los campos del primero.
        const sample = Object.values(res.responses ?? {})[0] as { cantidad: number; primero: { id: number; titulo: string } };
        expect(sample.cantidad).toBe(1);
        expect(sample.primero).toMatchObject({ id: a.id, titulo: 'Acme' });
        expect((await recs.get(tenantId, admin, 'clientes', a.id)).data[ck('nombre')]).toBe('Acme');
    });

    it('«Cuando se agrega un comentario»: del equipo con palabras, del cliente desde el portal, sin bucles con el agente', async () => {
        const op = await recs.create(tenantId, admin, 'oportunidades', { data: { [ok('titulo')]: 'Pedido grande' } });
        const team = await autos.create(tenantId, 'oportunidades', {
            name: 'Comentario del equipo',
            trigger_type: 'comment_added',
            trigger_config: { comment_from: 'team', comment_contains: 'factura, cotización' },
            actions: [{ type: 'update_field', config: { values: { nota: '{{comentario.autor}} ({{comentario.de}}, {{comentario.origen}}): {{comentario.texto}}' } } }] as never,
        });
        const client = await autos.create(tenantId, 'oportunidades', {
            name: 'Comentario del cliente',
            trigger_type: 'comment_added',
            trigger_config: { comment_from: 'client' },
            actions: [{ type: 'create_record', config: { target_list: 'oportunidades', values: { titulo: 'Respuesta a {{comentario.autor}}' } } }] as never,
        });
        // Espera el aviso del comentario (corre en segundo plano); lo que encolan
        // las acciones (p. ej. «registro actualizado») no cuenta.
        const settle = async () => {
            const has = () => jobs.some((j) => j.trigger === 'comment_added');
            for (let i = 0; i < 50 && !has(); i++) await new Promise((r) => setTimeout(r, 20));
            const batch = jobs.splice(0);
            for (const ev of batch) if (ev.trigger === 'comment_added') await engine.process(ev);
            return batch.filter((e) => e.trigger === 'comment_added');
        };
        await settle();

        await commentsService.create(tenantId, admin, 'oportunidades', op.id, { body: 'Ya mandé la cotización', kind: 'note' });
        const evs = await settle();
        expect(evs).toHaveLength(1);
        expect(evs[0]!.comment).toMatchObject({ from: 'team', source: 'app', author_name: 'Ana Ruiz', visibility: 'internal' });
        expect((await recs.get(tenantId, admin, 'oportunidades', op.id)).data[ok('nota')]).toBe('Ana Ruiz (equipo, app): Ya mandé la cotización');
        expect(await runsOf(client.id)).toHaveLength(0);

        // Sin las palabras: no corre.
        await commentsService.create(tenantId, admin, 'oportunidades', op.id, { body: 'Llamé al cliente', kind: 'note' });
        await settle();
        expect(await runsOf(team.id)).toHaveLength(1);

        // Un comentario de un agente de IA no dispara nada.
        await commentsService.create(tenantId, admin, 'oportunidades', op.id, { body: 'La factura está lista', kind: 'note', metadata: { agent: { id: 1 } } });
        await new Promise((r) => setTimeout(r, 100));
        expect(jobs.filter((j) => j.trigger === 'comment_added')).toHaveLength(0);

        // El cliente desde su portal.
        notify.emit({
            type: 'comment',
            tenantId,
            listId: op.list_id,
            recordId: op.id,
            actorId: 999,
            body: '¿Cuándo llega?',
            mentioned: [],
            commentId: 77,
            visibility: 'client',
            fromClient: true,
            clientName: 'Carla Cliente',
            source: 'portal',
        });
        await settle();
        const [run] = await runsOf(client.id);
        expect(run!.status).toBe('success');
        expect((await listAll('oportunidades')).some((r) => r.data[ok('titulo')] === 'Respuesta a Carla Cliente')).toBe(true);
    });
});
