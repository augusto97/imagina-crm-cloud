import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    activity,
    automationHooks,
    automationRuns,
    automations,
    automationVersions,
    fields,
    lists,
    memberships,
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
import { AutomationWaitsService } from '../src/automations/automation-waits.service';
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
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
    }
}

class MemoryHooks implements HookCaptureStore {
    readonly data = new Map<string, string[]>();
    lpush(key: string, value: string): Promise<number> {
        const l = this.data.get(key) ?? [];
        l.unshift(value);
        this.data.set(key, l);
        return Promise.resolve(l.length);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(key: string): Promise<string[]> {
        return Promise.resolve(this.data.get(key) ?? []);
    }
}

const rt = new RealtimeService();

/**
 * v0.1.289 — Automatizaciones: «Esperar» durable, «Repetir por cada registro
 * vinculado», respuestas de webhook en los pasos siguientes, «Probar» sin
 * efectos, programado por registro, duplicar e historial de versiones.
 */
describe('Automatizaciones — esperas, bucles, respuestas, simulación y versiones', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let waits: AutomationWaitsService;
    let mailbox: CapturingMail;
    let jobs: Array<{ name: string; data: unknown }>;
    let tenantId: number;
    let otherTenant: number;
    let anaId: number;
    let admin: Actor;
    let cf: Record<string, Field>;
    let ff: Record<string, Field>;
    let server: Server;
    let url: string;
    let hits: Array<{ path: string; body: string }>;

    beforeAll(async () => {
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        hits = [];
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                hits.push({ path: req.url ?? '', body });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ pedido: { id: 'PED-77', items: [{ sku: 'A1' }, { sku: 'B2' }] }, total: 1500 }));
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/erp`;

        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        jobs = [];
        const dispatcher = new AutomationDispatcher();
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
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        mailbox = new CapturingMail();
        const tz = new TenantTimeZones(tenantDb);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), mailbox),
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
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            new MemoryHooks(),
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

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'ACME', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota', number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' } } })
            .returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'enterprise' }).returning();
        otherTenant = o!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Pérez' }).returning();
        anaId = u!.id;
        admin = { userId: anaId, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: anaId, role: 'admin' }));
    });

    afterAll(async () => {
        delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        await new Promise<void>((r) => server.close(() => r()));
        await pg?.stop();
    });

    beforeEach(async () => {
        jobs.length = 0;
        mailbox.sent.length = 0;
        hits.length = 0;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationVersions).where(eq(automationVersions.tenantId, tenantId));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        cf = {};
        for (const d of [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Email', type: 'email', slug: 'email' },
            { label: 'Nota', type: 'text', slug: 'nota' },
            { label: 'Vence', type: 'date', slug: 'vence' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'baja', label: 'De baja' }] },
            },
        ] as CreateFieldInput[]) {
            cf[d.slug!] = await fieldsService.create(tenantId, 'clientes', d);
        }
        const clientes = await listsService.get(tenantId, 'clientes');
        await listsService.create(tenantId, { name: 'Facturas', slug: 'facturas' });
        ff = {};
        for (const d of [
            { label: 'Concepto', type: 'text', slug: 'concepto' },
            { label: 'Monto', type: 'number', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }, { value: 'avisada', label: 'Avisada' }] },
            },
            { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientes.id } },
        ] as CreateFieldInput[]) {
            ff[d.slug!] = await fieldsService.create(tenantId, 'facturas', d);
        }
    });

    const ck = (slug: string) => `f${cf[slug]!.id}`;
    const fk = (slug: string) => `f${ff[slug]!.id}`;
    const runsOf = (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));
    const event = async (recordId: number, after: Record<string, unknown>): Promise<TriggerEvent> => ({
        tenantId,
        listId: (await listsService.get(tenantId, 'clientes')).id,
        recordId,
        trigger: 'record_created',
        after,
    });
    /** Viaja en el tiempo: las esperas de la automatización vencen ya. */
    const expireWaits = (automationId: number) =>
        pg.db.execute(sql`update automation_runs set resume_at = now() - interval '1 second' where automation_id = ${automationId} and status = 'waiting'`);

    it('esperar → la corrida queda en espera (Postgres) → el reloj la reanuda y sigue; la condición de «continuar» decide', async () => {
        const cliente = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Ana', [ck('email')]: 'ana@cliente.test', [ck('estado')]: 'activo' } });
        const auto = await autos.create(tenantId, 'clientes', {
            name: 'Bienvenida en dos tiempos',
            trigger_type: 'record_created',
            actions: [
                { type: 'update_field', config: { values: { nota: 'paso 1' } } },
                {
                    type: 'wait',
                    config: { mode: 'duration', amount: 2, unit: 'days', resume_condition: [{ field: 'estado', op: 'eq', value: 'activo' }] },
                },
                { type: 'send_email', config: { to: '{{email}}', subject: 'Hola {{nombre}}', body: 'Nota: {{nota}}' } },
            ],
        });
        await engine.process(await event(cliente.id, cliente.data));
        let [run] = await runsOf(auto.id);
        expect(run!.status).toBe('waiting');
        expect(run!.resumeAt!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
        expect(mailbox.sent).toHaveLength(0);
        // El tick no toma lo que no venció.
        expect(await waits.tick()).toBe(0);

        await expireWaits(auto.id);
        // Mientras esperaba, alguien cambió la nota: al seguir se RELEE el registro.
        await recs.update(tenantId, admin, 'clientes', cliente.id, { data: { [ck('nota')]: 'cambiada mientras esperaba' } });
        expect(await waits.tick()).toBe(1);
        [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        expect(run!.resumeState).toBeNull();
        expect(mailbox.sent).toHaveLength(1);
        expect(mailbox.sent[0]!.to).toBe('ana@cliente.test');
        expect(mailbox.sent[0]!.text).toContain('cambiada mientras esperaba');
        expect(run!.actionsLog.map((l) => l.action)).toEqual(['update_field', 'wait', 'wait', 'send_email']);

        // Otro registro que ya NO cumple la condición al terminar la espera: no sigue.
        const otro = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Beto', [ck('email')]: 'beto@cliente.test', [ck('estado')]: 'activo' } });
        await engine.process(await event(otro.id, otro.data));
        await recs.update(tenantId, admin, 'clientes', otro.id, { data: { [ck('estado')]: 'baja' } });
        await expireWaits(auto.id);
        await waits.tick();
        const r2 = (await runsOf(auto.id)).find((r) => r.recordId === otro.id)!;
        expect(r2.status).toBe('success');
        expect(r2.actionsLog.at(-1)!.message).toMatch(/ya no cumplía la condición/);
        expect(mailbox.sent).toHaveLength(1);
    });

    it('registro borrado o automatización pausada → la espera se cancela con el motivo; el paso dentro de un si/sino sigue en su rama', async () => {
        const auto = await autos.create(tenantId, 'clientes', {
            name: 'Con rama',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'if_else',
                    config: {
                        condition: [{ field: 'estado', op: 'eq', value: 'activo' }],
                        then_actions: [
                            { type: 'wait', config: { mode: 'duration', amount: 1, unit: 'hours' } },
                            { type: 'update_field', config: { values: { nota: 'dentro de la rama' } } },
                        ],
                        else_actions: [],
                    },
                },
                { type: 'update_field', config: { values: { estado: 'baja' } } },
            ],
        });
        const a = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'A', [ck('estado')]: 'activo' } });
        const b = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'B', [ck('estado')]: 'activo' } });
        await engine.process(await event(a.id, a.data));
        await engine.process(await event(b.id, b.data));
        // Se borra B mientras espera.
        await recs.remove(tenantId, admin, 'clientes', b.id);
        await expireWaits(auto.id);
        await waits.tick();
        const runs = await runsOf(auto.id);
        const ra = runs.find((r) => r.recordId === a.id)!;
        const rb = runs.find((r) => r.recordId === b.id)!;
        expect(ra.status).toBe('success');
        const got = (await recs.get(tenantId, admin, 'clientes', a.id)).data;
        expect(got[ck('nota')]).toBe('dentro de la rama');
        expect(got[ck('estado')]).toBe('baja'); // lo que sigue al si/sino también corrió
        expect(rb.status).toBe('cancelled');
        expect(rb.error).toMatch(/se eliminó/);

        // Pausar la automatización cancela las que esperan.
        const c = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'C', [ck('estado')]: 'activo' } });
        await engine.process(await event(c.id, c.data));
        await autos.update(tenantId, 'clientes', auto.id, { is_active: false });
        const rc = (await runsOf(auto.id)).find((r) => r.recordId === c.id)!;
        expect(rc.status).toBe('cancelled');
        expect(rc.error).toMatch(/pausó/);
        // Reactivarla no las revive.
        await autos.update(tenantId, 'clientes', auto.id, { is_active: true });
        await expireWaits(auto.id);
        expect(await waits.tick()).toBe(0);
    });

    it('esperar hasta la fecha de un campo: 1 día antes a las 9:00 (Bogotá); si la fecha cambia, la espera se mueve', async () => {
        const auto = await autos.create(tenantId, 'clientes', {
            name: 'Recordar antes de vencer',
            trigger_type: 'record_created',
            actions: [
                { type: 'wait', config: { mode: 'until_field', date_field: 'vence', offset_amount: 1, offset_unit: 'days', offset_direction: 'before', at_time: '09:00' } },
                { type: 'update_field', config: { values: { nota: 'recordado' } } },
            ],
        });
        const rec = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Fecha', [ck('vence')]: '2027-01-20' } });
        await engine.process(await event(rec.id, rec.data));
        let [run] = await runsOf(auto.id);
        expect(run!.status).toBe('waiting');
        expect(run!.resumeAt!.toISOString()).toBe('2027-01-19T14:00:00.000Z');
        // Alguien corre la fecha: la espera se recalcula.
        const before = (await recs.get(tenantId, admin, 'clientes', rec.id)).data;
        const after = (await recs.update(tenantId, admin, 'clientes', rec.id, { data: { [ck('vence')]: '2027-02-10' } })).data;
        await waits.onRecordChange({ tenantId, listId: rec.list_id, recordId: rec.id, before, after, kind: 'updated' });
        [run] = await runsOf(auto.id);
        expect(run!.resumeAt!.toISOString()).toBe('2027-02-09T14:00:00.000Z');
        // Sin fecha: no hay a qué esperar → no sigue.
        const sin = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Sin fecha' } });
        await engine.process(await event(sin.id, sin.data));
        const rs = (await runsOf(auto.id)).find((r) => r.recordId === sin.id)!;
        expect(rs.status).toBe('success');
        expect(rs.actionsLog[0]!.message).toMatch(/está vacío/);
        expect((await recs.get(tenantId, admin, 'clientes', sin.id)).data[ck('nota')]).toBeUndefined();
    });

    it('repetir por cada vinculado: filtra la otra lista, actualiza el vinculado y el registro que disparó, con {{item.x}}', async () => {
        const cliente = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Cliente X' } });
        const otro = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Cliente Y' } });
        const mk = (concepto: string, monto: number, estado: string, cli: number) =>
            recs.create(tenantId, admin, 'facturas', { data: { [fk('concepto')]: concepto, [fk('monto')]: monto, [fk('estado')]: estado, [fk('cliente')]: [cli] } });
        const f1 = await mk('Enero', 100, 'pendiente', cliente.id);
        const f2 = await mk('Febrero', 250, 'pendiente', cliente.id);
        const f3 = await mk('Marzo', 300, 'pagada', cliente.id);
        const ajena = await mk('Ajena', 999, 'pendiente', otro.id);
        const auto = await autos.create(tenantId, 'clientes', {
            name: 'Avisar facturas pendientes',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'for_each_linked',
                    config: {
                        relation_field_id: ff.cliente!.id,
                        filter_tree: {
                            type: 'group',
                            logic: 'and',
                            children: [{ type: 'condition', field_id: ff.estado!.id, op: 'eq', value: 'pendiente' }],
                        },
                        actions: [
                            { type: 'update_field', config: { target: 'item', values: { estado: 'avisada', concepto: '{{item.concepto}} (avisada a {{nombre}})' } } },
                            { type: 'update_field', config: { values: { nota: 'última: {{item.concepto}} #{{item.record.id}} por {{item.monto}}' } } },
                        ],
                    },
                },
            ],
        });
        await engine.process(await event(cliente.id, cliente.data));
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const entry = run!.actionsLog[0]!;
        expect(entry.action).toBe('for_each_linked');
        expect(entry.message).toMatch(/Repitió para 2 de 2/);
        expect((entry.details as { items: unknown[] }).items).toHaveLength(2);
        const get = async (id: number) => (await recs.get(tenantId, admin, 'facturas', id)).data;
        expect((await get(f1.id))[fk('estado')]).toBe('avisada');
        expect((await get(f1.id))[fk('concepto')]).toBe('Enero (avisada a Cliente X)');
        expect((await get(f2.id))[fk('estado')]).toBe('avisada');
        expect((await get(f3.id))[fk('estado')]).toBe('pagada'); // no cumplía el filtro
        expect((await get(ajena.id))[fk('estado')]).toBe('pendiente'); // de otro cliente
        const nota = (await recs.get(tenantId, admin, 'clientes', cliente.id)).data[ck('nota')];
        // El paso siguiente ve el vinculado YA actualizado por el paso anterior.
        expect(nota).toBe(`última: Febrero (avisada a Cliente X) #${f2.id} por 250`);
        // Esperar dentro de un bucle no se guarda (activa).
        await expect(
            autos.create(tenantId, 'clientes', {
                name: 'Mal',
                trigger_type: 'record_created',
                actions: [{ type: 'for_each_linked', config: { relation_field_id: ff.cliente!.id, actions: [{ type: 'wait', config: { mode: 'duration', amount: 1, unit: 'days' } }] } }],
            }),
        ).rejects.toThrow(/No se puede esperar dentro/);
    });

    it('la respuesta de un webhook alimenta los pasos siguientes y sobrevive a una espera', async () => {
        const cliente = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Cliente R', [ck('email')]: 'r@cliente.test' } });
        const auto = await autos.create(tenantId, 'clientes', {
            name: 'ERP y luego correo',
            trigger_type: 'record_created',
            actions: [
                { type: 'call_webhook', config: { url, response_name: 'erp', body_params: [{ key: 'cliente', value: '{{nombre}}' }] } },
                { type: 'update_field', config: { values: { nota: 'Pedido {{webhook.body.pedido.id}} ({{webhook.status}}), 2.º sku {{webhook.body.pedido.items.1.sku}}' } } },
                { type: 'wait', config: { mode: 'duration', amount: 1, unit: 'minutes' } },
                { type: 'send_email', config: { to: '{{email}}', subject: 'Tu pedido {{respuestas.erp.body.pedido.id}}', body: 'Total {{respuestas.erp.body.total}}' } },
            ],
        });
        await engine.process(await event(cliente.id, cliente.data));
        expect(hits).toHaveLength(1);
        expect(JSON.parse(hits[0]!.body)).toEqual({ cliente: 'Cliente R' });
        expect((await recs.get(tenantId, admin, 'clientes', cliente.id)).data[ck('nota')]).toBe('Pedido PED-77 (200), 2.º sku B2');
        await expireWaits(auto.id);
        await waits.tick();
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        expect(mailbox.sent[0]!.subject).toBe('Tu pedido PED-77');
        expect(mailbox.sent[0]!.text).toContain('Total 1500');
    });

    it('«Probar» no escribe, no envía, no llama ni abre corridas; sólo ejecuta de verdad el paso marcado', async () => {
        const cliente = await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: 'Sim', [ck('email')]: 'sim@cliente.test', [ck('estado')]: 'activo' } });
        await recs.create(tenantId, admin, 'facturas', { data: { [fk('concepto')]: 'Única', [fk('monto')]: 10, [fk('estado')]: 'pendiente', [fk('cliente')]: [cliente.id] } });
        const actions = [
            { type: 'call_webhook', config: { url } },
            { type: 'update_field', config: { values: { nota: 'simulada {{webhook.body.pedido.id}}' } } },
            {
                type: 'if_else',
                config: {
                    condition: [{ field: 'estado', op: 'eq', value: 'baja' }],
                    then_actions: [{ type: 'send_email', config: { to: 'x@y.test', subject: 'no' } }],
                    else_actions: [{ type: 'send_email', config: { to: '{{email}}', subject: 'Hola {{nombre}}', body: 'Nota {{nota}}' } }],
                },
            },
            { type: 'wait', config: { mode: 'duration', amount: 3, unit: 'days' } },
            { type: 'create_record', config: { target_list: (await listsService.get(tenantId, 'facturas')).id, values: { concepto: 'Nueva {{nombre}}', monto: '42' } } },
            { type: 'for_each_linked', config: { relation_field_id: ff.cliente!.id, actions: [{ type: 'update_field', config: { target: 'item', values: { estado: 'pagada' } } }] } },
        ];
        const countBefore = await pg.db.execute(sql`select (select count(*) from records) as r, (select count(*) from automation_runs) as runs, (select count(*) from activity) as act`);
        const out = await autos.testRun(tenantId, 'clientes', {
            trigger_type: 'record_created',
            trigger_config: { field_filters: [{ field: 'estado', op: 'eq', value: 'activo' }] },
            actions,
            record_id: cliente.id,
            real_steps: [],
        });
        expect(out.trigger.matches).toBe(true);
        expect(out.record).toEqual({ id: cliente.id, title: 'Sim' });
        const byPath = new Map(out.steps.map((s) => [s.path, s]));
        expect(byPath.get('0')!.status).toBe('would_run');
        expect((byPath.get('0')!.details.request as { url: string }).url).toBe(url);
        expect(byPath.get('1')!.details.changes).toEqual([{ field: 'nota', label: 'Nota', before: null, after: 'simulada' }]);
        expect(byPath.get('2')!.message).toMatch(/rama «No»/);
        expect((byPath.get('2.else.0')!.details.email as { to: string; text: string }).to).toBe('sim@cliente.test');
        // El correo ve el cambio simulado del paso anterior.
        expect((byPath.get('2.else.0')!.details.email as { text: string }).text).toContain('Nota simulada');
        expect(byPath.get('3')!.message).toMatch(/Esperaría hasta/);
        expect((byPath.get('4')!.details.values as unknown[]).length).toBe(2);
        expect(byPath.get('5')!.message).toMatch(/Repetiría para 1/);
        expect(byPath.get('5.each.0')!.status).toBe('would_run');
        expect(out.trigger.notes.join(' ')).toMatch(/\{\{webhook\.body\.pedido\.id\}\}/);
        // Nada cambió.
        const countAfter = await pg.db.execute(sql`select (select count(*) from records) as r, (select count(*) from automation_runs) as runs, (select count(*) from activity) as act`);
        expect(countAfter.rows[0]).toEqual(countBefore.rows[0]);
        expect((await recs.get(tenantId, admin, 'clientes', cliente.id)).data[ck('nota')]).toBeUndefined();
        expect(mailbox.sent).toHaveLength(0);
        expect(hits).toHaveLength(0);

        // Con el webhook marcado: se llama de verdad y su respuesta alimenta el resto.
        const real = await autos.testRun(tenantId, 'clientes', { trigger_type: 'record_created', trigger_config: {}, actions, record_id: cliente.id, real_steps: ['0'] });
        expect(hits).toHaveLength(1);
        const step0 = real.steps.find((s) => s.path === '0')!;
        expect(step0.status).toBe('ran');
        expect((step0.details.response as { status: number }).status).toBe(200);
        expect(real.steps.find((s) => s.path === '1')!.details.changes).toEqual([{ field: 'nota', label: 'Nota', before: null, after: 'simulada PED-77' }]);
        expect(real.responses['0']).toMatchObject({ pedido: { id: 'PED-77' } });
        expect(mailbox.sent).toHaveLength(0);

        // Un filtro que no cumple: dice por qué.
        const no = await autos.testRun(tenantId, 'clientes', {
            trigger_type: 'record_created',
            trigger_config: { field_filters: [{ field: 'estado', op: 'eq', value: 'baja' }] },
            actions: [],
            record_id: cliente.id,
            real_steps: [],
        });
        expect(no.trigger.matches).toBe(false);
        expect(no.trigger.checks[0]).toMatchObject({ field: 'estado', label: 'Estado', ok: false, actual: 'activo' });
    });

    it('programado «para cada registro»: una corrida por registro que cumple el filtro, en tandas', async () => {
        for (const [n, estado] of [['P1', 'activo'], ['P2', 'baja'], ['P3', 'activo']] as const) {
            await recs.create(tenantId, admin, 'clientes', { data: { [ck('nombre')]: n, [ck('estado')]: estado } });
        }
        const auto = await autos.create(tenantId, 'clientes', {
            name: 'Cada noche a los activos',
            trigger_type: 'scheduled',
            trigger_config: {
                frequency: 'daily',
                hour: 2,
                for_each_record: true,
                records_filter: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: cf.estado!.id, op: 'eq', value: 'activo' }] },
            },
            actions: [{ type: 'update_field', config: { values: { nota: 'revisado {{nombre}}' } } }],
        });
        jobs.length = 0;
        await engine.runScheduled(tenantId, auto.id);
        const batches = jobs.filter((j) => j.name === 'scheduled-batch').map((j) => j.data as { recordIds: number[] });
        expect(batches).toHaveLength(1);
        expect(batches[0]!.recordIds).toHaveLength(2);
        for (const b of batches) await engine.runScheduledBatch(tenantId, auto.id, b.recordIds);
        const runs = await runsOf(auto.id);
        expect(runs).toHaveLength(2);
        expect(runs.every((r) => r.status === 'success' && r.recordId !== null)).toBe(true);
        const notes = (await recs.list(tenantId, admin, 'clientes', { limit: 10, sort_dir: 'asc' })).data.map((r) => r.data[ck('nota')] ?? null);
        expect(notes).toEqual(['revisado P1', null, 'revisado P3']);
    });

    it('duplicar: copia pausada en la misma lista con su propia URL de webhook', async () => {
        const src = await autos.create(tenantId, 'clientes', {
            name: 'Entrante',
            trigger_type: 'incoming_webhook',
            actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }],
        });
        const copy = await autos.duplicate(tenantId, 'clientes', src.id, anaId);
        expect(copy.name).toBe('Entrante (copia)');
        expect(copy.is_active).toBe(false);
        expect(copy.list_id).toBe(src.list_id);
        expect(copy.trigger_config.webhook_token).toBeTruthy();
        expect(copy.trigger_config.webhook_token).not.toBe(src.trigger_config.webhook_token);
        const hooks = await pg.db.select().from(automationHooks).where(eq(automationHooks.tenantId, tenantId));
        expect(new Set(hooks.map((h) => h.token)).size).toBe(hooks.length);
        const versions = await autos.versions(tenantId, 'clientes', copy.id);
        expect(versions[0]!.note).toBe('Duplicada de «Entrante»');
    });

    it('versiones: una por guardado con autor, sin secretos, restaurar recupera los secretos actuales; aisladas por empresa (RLS)', async () => {
        const auto = await autos.create(
            tenantId,
            'clientes',
            {
                name: 'Con secreto',
                trigger_type: 'record_created',
                actions: [{ type: 'call_webhook', config: { url, secret: 'hmac-super-secreto', headers: [{ key: 'Authorization', value: 'Bearer tok-123' }, { key: 'X-Cliente', value: '{{nombre}}' }] } }],
            },
            { actorId: anaId },
        );
        await autos.update(tenantId, 'clientes', auto.id, { name: 'Con secreto v2' }, { actorId: anaId });
        await autos.update(tenantId, 'clientes', auto.id, { name: 'Con secreto v2' }, { actorId: anaId }); // sin cambios: no suma
        let versions = await autos.versions(tenantId, 'clientes', auto.id);
        expect(versions.map((v) => v.name)).toEqual(['Con secreto v2', 'Con secreto']);
        expect(versions[1]!.note).toBe('Creó la automatización');
        expect(versions[0]!.author).toEqual({ id: anaId, name: 'Ana Pérez' });
        const json = JSON.stringify(versions);
        expect(json).not.toContain('hmac-super-secreto');
        expect(json).not.toContain('tok-123');
        expect(json).toContain('{{nombre}}');

        // Restaurar la primera: los secretos tapados toman los actuales.
        const old = versions[1]!;
        await autos.update(tenantId, 'clientes', auto.id, { name: old.name, actions: old.actions, restored_from: old.id }, { actorId: anaId });
        const now = await autos.get(tenantId, 'clientes', auto.id);
        expect(now.name).toBe('Con secreto');
        expect(now.actions[0]!.config.secret).toBe('hmac-super-secreto');
        expect((now.actions[0]!.config.headers as Array<{ value: string }>)[0]!.value).toBe('Bearer tok-123');
        versions = await autos.versions(tenantId, 'clientes', auto.id);
        expect(versions[0]!.note).toMatch(/^Restauró la versión del \d{2}\/\d{2}\/\d{4}/);

        // RLS: otra empresa no ve las versiones.
        const leaked = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(automationVersions));
        expect(leaked).toHaveLength(0);
        const own = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationVersions).where(and(eq(automationVersions.automationId, auto.id))));
        expect(own.length).toBe(3);
    });
});
