import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activity, automationRuns, automations, fields, lists, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
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

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve(null),
    expire: () => Promise.resolve(null),
    lrange: () => Promise.resolve([]),
};

const rt = new RealtimeService();

/**
 * Auditoría de automatizaciones: regresiones del motor (valores que se
 * escriben, concurrencia, efectos de lo que escribe una automatización,
 * disparadores, vencimientos, webhooks, variables) y de lo que se valida al
 * guardar.
 */
describe('Automatizaciones — auditoría del motor', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let mailbox: CapturingMail;
    let jobs: Array<{ name: string; data: unknown }>;
    let tenantId: number;
    let anaId: number;
    let admin: Actor;
    let f: Record<string, Field>;
    let factF: Record<string, Field>;

    beforeAll(async () => {
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
        const connectors = new ConnectorsService(
            tenantDb,
            pg.db,
            loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }),
            memoryOAuthStore(),
            new AuditService(tenantDb),
            memoryIntegrationApps(),
        );
        const plans = new PlansService(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
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
            undefined,
            billing,
        );
        mailbox = new CapturingMail();
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
            new TenantTimeZones(tenantDb),
            undefined,
            undefined,
            // RecordsService como lo resuelve la app (ModuleRef).
            { get: () => recs } as never,
        );

        const [t] = await pg.db
            .insert(tenants)
            .values({
                slug: 'acme',
                name: 'ACME',
                plan: 'enterprise',
                settings: { format: { timezone: 'America/Bogota', number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' } },
            })
            .returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Pérez' }).returning();
        anaId = u!.id;
        admin = { userId: anaId, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: anaId, role: 'admin' }));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        jobs.length = 0;
        mailbox.sent.length = 0;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await listsService.create(tenantId, { name: 'Tickets', slug: 'tickets' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Nota', type: 'text', slug: 'nota' },
            { label: 'Monto', type: 'currency', slug: 'monto', config: { currency: 'COP', precision: 0 } },
            {
                label: 'Tags',
                type: 'multi_select',
                slug: 'tags',
                config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'promo', label: 'Promo' }] },
            },
            { label: 'Activo', type: 'checkbox', slug: 'activo' },
            { label: 'Vence', type: 'date', slug: 'vence' },
            { label: 'Cita', type: 'datetime', slug: 'cita' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'abierto', label: 'Abierto' }, { value: 'cerrado', label: 'Cerrado' }] },
            },
            { label: 'Responsable', type: 'user', slug: 'responsable' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'tickets', d);
        await listsService.create(tenantId, { name: 'Facturas', slug: 'facturas' });
        factF = {};
        for (const d of [
            { label: 'Concepto', type: 'text', slug: 'concepto' },
            { label: 'Etiquetas', type: 'multi_select', slug: 'etiquetas', config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'promo', label: 'Promo' }] } },
            { label: 'Emitida', type: 'datetime', slug: 'emitida' },
            { label: 'Aviso', type: 'text', slug: 'aviso' },
        ] as CreateFieldInput[]) {
            factF[d.slug!] = await fieldsService.create(tenantId, 'facturas', d);
        }
    });

    const k = (slug: string) => `f${f[slug]!.id}`;
    const fk = (slug: string) => `f${factF[slug]!.id}`;
    const listId = async (slug: string) => (await listsService.get(tenantId, slug)).id;
    const runsOf = (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));
    const event = async (recordId: number, trigger: TriggerEvent['trigger'], after: Record<string, unknown>, before?: Record<string, unknown>, extra: Partial<TriggerEvent> = {}): Promise<TriggerEvent> => ({
        tenantId,
        listId: await listId('tickets'),
        recordId,
        trigger,
        after,
        ...(before ? { before } : {}),
        ...extra,
    });

    it('update_field valida y convierte cada valor (número, opciones, sí/no, fechas) y saltea lo inválido con el motivo', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'T1', [k('activo')]: true, [k('vence')]: '2026-01-01' } });
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Completar',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'update_field',
                    config: {
                        values: {
                            monto: '1.250.000',
                            tags: 'vip, Promo',
                            activo: '0',
                            estado: 'Cerrado',
                            vence: 'mañana',
                            cita: '2026-10-21 14:30',
                        },
                    },
                },
            ],
        });
        await engine.process(await event(rec.id, 'record_created', rec.data));
        const got = (await recs.get(tenantId, admin, 'tickets', rec.id)).data;
        expect(got[k('monto')]).toBe(1250000);
        expect(got[k('tags')]).toEqual(['vip', 'promo']);
        expect(got[k('activo')]).toBe(false);
        expect(got[k('estado')]).toBe('cerrado');
        expect(got[k('vence')]).toBe('2026-01-01'); // «mañana» no se escribe
        expect(got[k('cita')]).toBe('2026-10-21T19:30:00.000Z'); // hora de Bogotá
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        expect(run!.actionsLog[0]!.message).toMatch(/Vence.*mañana/);
        expect((run!.actionsLog[0]!.details as { warnings?: string[] }).warnings?.length).toBe(1);
        // Ninguna fila basura: ordenar por la fecha sigue funcionando.
        await expect(recs.list(tenantId, admin, 'tickets', { limit: 10, sort_dir: 'asc', sort: `field_${f.vence!.id}:asc` })).resolves.toBeTruthy();
    });

    it('update_field con TODOS los valores inválidos falla (se ve) y no escribe nada', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'T2' } });
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Rota',
            trigger_type: 'record_created',
            actions: [{ type: 'update_field', config: { values: { vence: 'el lunes', monto: 'mucho' } } }],
        });
        await engine.process(await event(rec.id, 'record_created', rec.data));
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('failed');
        expect(run!.error).toMatch(/No se pudo escribir ningún valor/);
    });

    it('update_field escribe SÓLO lo que cambia: no pisa lo que otra persona cambió después del evento', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'T3', [k('nota')]: 'original' } });
        await autos.create(tenantId, 'tickets', {
            name: 'Cerrar',
            trigger_type: 'record_created',
            actions: [{ type: 'update_field', config: { values: { estado: 'cerrado' } } }],
        });
        const stale = rec.data; // la foto del evento
        // Mientras el evento espera en la cola, alguien cambia la nota.
        await recs.update(tenantId, admin, 'tickets', rec.id, { data: { [k('nota')]: 'cambiada por Ana' } });
        await engine.process(await event(rec.id, 'record_created', stale));
        const got = (await recs.get(tenantId, admin, 'tickets', rec.id)).data;
        expect(got[k('nota')]).toBe('cambiada por Ana');
        expect(got[k('estado')]).toBe('cerrado');
    });

    it('lo que escribe una automatización deja actividad y dispara las automatizaciones de la lista, con tope y sin auto-disparo', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'T4' } });
        const a = await autos.create(tenantId, 'tickets', {
            name: 'A: al actualizar, nota',
            trigger_type: 'record_updated',
            actions: [{ type: 'update_field', config: { values: { nota: 'tocada por A {{date.today}}' } } }],
        });
        const b = await autos.create(tenantId, 'tickets', {
            name: 'B: al actualizar, cerrar',
            trigger_type: 'record_updated',
            actions: [{ type: 'update_field', config: { values: { estado: 'cerrado' } } }],
        });
        jobs.length = 0;
        // Una persona cambia el registro (evento sin cadena).
        await engine.process(await event(rec.id, 'record_updated', rec.data, {}));
        // Actividad sin autor (lo hizo el sistema).
        const acts = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(activity).where(and(eq(activity.recordId, rec.id), eq(activity.action, 'record_updated'))),
        );
        expect(acts.length).toBeGreaterThanOrEqual(2);
        expect(acts.every((x) => x.userId === null)).toBe(true);
        // Cada escritura encoló su evento con la cadena.
        const events = jobs.filter((j) => j.name === 'event').map((j) => j.data as TriggerEvent);
        expect(events.map((e) => e.chain)).toEqual([
            { depth: 1, automation_ids: [a.id] },
            { depth: 1, automation_ids: [b.id] },
        ]);
        // Procesar el evento de A: A no se re-dispara; B sí, y su cadena lleva a los dos.
        jobs.length = 0;
        const fromA = events[0]!;
        const latest = (await recs.get(tenantId, admin, 'tickets', rec.id)).data;
        await recs.update(tenantId, admin, 'tickets', rec.id, { data: { [k('estado')]: 'abierto' } });
        jobs.length = 0;
        await engine.process({ ...fromA, after: { ...latest, [k('estado')]: 'abierto' } });
        const next = jobs.filter((j) => j.name === 'event').map((j) => j.data as TriggerEvent);
        expect(next.map((e) => e.chain)).toEqual([{ depth: 2, automation_ids: [a.id, b.id] }]);
        expect((await runsOf(a.id)).length).toBe(1);
        // Pasado el tope, el evento no corre nada.
        const before = (await runsOf(b.id)).length;
        await engine.process({ ...fromA, chain: { depth: 4, automation_ids: [] } });
        expect((await runsOf(b.id)).length).toBe(before);
    });

    it('create_record: dispara las automatizaciones de la lista destino (la receta de facturación), multi_select y fecha-hora', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'Cliente X', [k('tags')]: ['vip', 'promo'] } });
        const factId = await listId('facturas');
        const crear = await autos.create(tenantId, 'tickets', {
            name: 'Facturar',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'create_record',
                    config: {
                        target_list: factId,
                        values: { concepto: 'Mensualidad {{nombre}}', etiquetas: '{{tags}}', emitida: '{{date.now}}', aviso: 'no-es-un-campo-raro' },
                    },
                },
            ],
        });
        const avisar = await autos.create(tenantId, 'facturas', {
            name: 'Avisar factura',
            trigger_type: 'record_created',
            actions: [{ type: 'update_field', config: { values: { aviso: 'enviado' } } }],
        });
        await engine.process(await event(rec.id, 'record_created', rec.data));
        const [run] = await runsOf(crear.id);
        expect(run!.status).toBe('success');
        const factura = (await recs.list(tenantId, admin, 'facturas', { limit: 5, sort_dir: 'asc' })).data[0]!;
        expect(factura.data[fk('concepto')]).toBe('Mensualidad Cliente X');
        expect(factura.data[fk('etiquetas')]).toEqual(['vip', 'promo']);
        expect(String(factura.data[fk('emitida')])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        // El alta encoló record_created en Facturas con la cadena; al procesarlo corre «Avisar factura».
        const created = jobs.map((j) => j.data as TriggerEvent).find((e) => e.trigger === 'record_created' && e.listId === factId)!;
        expect(created.chain).toEqual({ depth: 1, automation_ids: [crear.id] });
        await engine.process(created);
        expect((await runsOf(avisar.id))[0]!.status).toBe('success');
        expect((await recs.get(tenantId, admin, 'facturas', factura.id)).data[fk('aviso')]).toBe('enviado');
    });

    it('field_changed respeta «de» y «a» (por valor o por etiqueta)', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'T5', [k('estado')]: 'cerrado' } });
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Reabierto',
            trigger_type: 'field_changed',
            trigger_config: { field: 'estado', from_value: 'Cerrado', to_value: 'abierto' },
            actions: [{ type: 'update_field', config: { values: { nota: 'reabierto' } } }],
        });
        const base = { [k('nombre')]: 'T5' };
        await engine.process(await event(rec.id, 'record_updated', { ...base, [k('estado')]: 'abierto' }, { ...base }));
        expect(await runsOf(auto.id)).toHaveLength(0); // de vacío, no de «cerrado»
        await engine.process(await event(rec.id, 'record_updated', { ...base, [k('estado')]: 'cerrado' }, { ...base, [k('estado')]: 'abierto' }));
        expect(await runsOf(auto.id)).toHaveLength(0); // al revés
        await engine.process(await event(rec.id, 'record_updated', { ...base, [k('estado')]: 'abierto' }, { ...base, [k('estado')]: 'cerrado' }));
        expect(await runsOf(auto.id)).toHaveLength(1);
    });

    it('vencimientos: no dispara por fechas anteriores al alta; una fecha reprogramada vuelve a disparar', async () => {
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Al vencer',
            trigger_type: 'due_date_reached',
            trigger_config: { due_field: 'cita' },
            actions: [{ type: 'update_field', config: { values: { nota: 'venció' } } }],
        });
        const viejo = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'Viejo', [k('cita')]: '2020-01-01T00:00:00.000Z' } });
        const nuevo = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'Nuevo', [k('cita')]: new Date(Date.now() + 2000).toISOString() } });
        await new Promise((r) => setTimeout(r, 2200));
        await engine.runDueDate(tenantId, auto.id);
        expect((await runsOf(auto.id)).map((r) => r.recordId)).toEqual([nuevo.id]);
        expect((await recs.get(tenantId, admin, 'tickets', viejo.id)).data[k('nota')]).toBeUndefined();
        // Otra vez: misma fecha → no se repite.
        await engine.runDueDate(tenantId, auto.id);
        expect(await runsOf(auto.id)).toHaveLength(1);
        // La fecha se reprograma (la corrida anterior fue hace 2 días y la fecha nueva, ayer).
        await pg.db.execute(sql`update automation_runs set created_at = now() - interval '2 days' where automation_id = ${auto.id}`);
        await pg.db.execute(sql`update automations set created_at = now() - interval '10 days' where id = ${auto.id}`);
        await recs.update(tenantId, admin, 'tickets', nuevo.id, { data: { [k('cita')]: new Date(Date.now() - 86_400_000).toISOString() } });
        await engine.runDueDate(tenantId, auto.id);
        expect((await runsOf(auto.id)).filter((r) => r.recordId === nuevo.id)).toHaveLength(2);
    });

    describe('webhooks contra un servidor real', () => {
        let server: Server;
        let url: string;
        let received: string[];
        let status: number;
        beforeAll(async () => {
            process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
            received = [];
            status = 200;
            server = createServer((req, res) => {
                let body = '';
                req.on('data', (c) => (body += c));
                req.on('end', () => {
                    received.push(body);
                    res.writeHead(status, { 'content-type': 'application/json' });
                    res.end(status >= 400 ? '{"error":"credencial inválida"}' : '{"ok":true}');
                });
            });
            await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
            url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
        });
        afterAll(async () => {
            delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
            await new Promise<void>((r) => server.close(() => r()));
        });

        it('una respuesta 4xx/5xx es una FALLA con el código y lo que contestaron', async () => {
            const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'W1' } });
            const auto = await autos.create(tenantId, 'tickets', {
                name: 'ERP',
                trigger_type: 'record_created',
                actions: [{ type: 'call_webhook', config: { url } }],
            });
            status = 401;
            await engine.process(await event(rec.id, 'record_created', rec.data));
            const [run] = await runsOf(auto.id);
            expect(run!.status).toBe('failed');
            expect(run!.error).toMatch(/respondió 401: \{"error":"credencial inválida"\}/);
            status = 200;
        });

        it('el cuerpo JSON escrito a mano escapa los valores (sin JSON roto ni claves inyectadas)', async () => {
            const rec = await recs.create(tenantId, admin, 'tickets', { data: { [k('nombre')]: 'x","admin":true,"y":"\\ "comillas"' } });
            const auto = await autos.create(tenantId, 'tickets', {
                name: 'Crudo',
                trigger_type: 'record_created',
                actions: [{ type: 'call_webhook', config: { url, content_type: 'json', body_template: '{"nombre":"{{nombre}}","monto":{{monto}}0}' } }],
            });
            received.length = 0;
            await engine.process(await event(rec.id, 'record_created', rec.data));
            expect((await runsOf(auto.id))[0]!.status).toBe('success');
            const body = JSON.parse(received[0]!) as Record<string, unknown>;
            expect(body.nombre).toBe('x","admin":true,"y":"\\ "comillas"');
            expect(body.admin).toBeUndefined();
        });
    });

    it('variables legibles: persona (.email/.nombre), |fecha, |fechahora, |moneda; el «Para» acepta un campo Persona', async () => {
        const rec = await recs.create(tenantId, admin, 'tickets', {
            data: {
                [k('nombre')]: 'T6',
                [k('responsable')]: anaId,
                [k('monto')]: 1250000,
                [k('vence')]: '2026-10-31',
                [k('cita')]: '2026-10-21T19:30:00.000Z',
            },
        });
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Avisar al responsable',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: 'responsable',
                        subject: 'Hola {{responsable.nombre}}',
                        body: 'Monto {{monto|moneda}} · vence {{vence|fecha}} · cita {{cita|fechahora}} · email {{responsable.email}} · crudo {{monto}}',
                    },
                },
            ],
        });
        await engine.process(await event(rec.id, 'record_created', rec.data));
        expect((await runsOf(auto.id))[0]!.status).toBe('success');
        const m = mailbox.sent[0]!;
        expect(m.to).toBe('ana@acme.test');
        expect(m.subject).toBe('Hola Ana Pérez');
        expect(m.text).toContain('Monto COP 1.250.000');
        expect(m.text).toContain('vence 31/10/2026');
        expect(m.text).toContain('cita 21/10/2026 14:30');
        expect(m.text).toContain('email ana@acme.test');
        expect(m.text).toContain('crudo 1250000');
    });

    it('al guardar: un «Para» vacío o un cron inválido se rechazan (activa); pausada se guarda como borrador', async () => {
        await expect(
            autos.create(tenantId, 'tickets', {
                name: 'Sin destinatario',
                trigger_type: 'record_created',
                actions: [{ type: 'send_email', config: { to: '', subject: 'x' } }],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            autos.create(tenantId, 'tickets', {
                name: 'Cron roto',
                trigger_type: 'scheduled',
                trigger_config: { cron: '99 99 * * *' },
                actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }],
            }),
        ).rejects.toThrow(/cron/);
        const draft = await autos.create(tenantId, 'tickets', {
            name: 'Borrador',
            trigger_type: 'record_created',
            is_active: false,
            actions: [{ type: 'send_email', config: { to: '', subject: 'x' } }],
        });
        expect(draft.is_active).toBe(false);
        // Activarla sin completar el «Para» tampoco.
        await expect(autos.update(tenantId, 'tickets', draft.id, { is_active: true })).rejects.toBeInstanceOf(BadRequestException);
        // Renombrarla (sigue pausada) sí.
        await expect(autos.update(tenantId, 'tickets', draft.id, { name: 'Borrador 2' })).resolves.toBeTruthy();
    });

    it('límite de automatizaciones activas del plan', async () => {
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        const mk = (name: string, is_active = true) =>
            autos.create(tenantId, 'tickets', {
                name,
                trigger_type: 'record_created',
                is_active,
                actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }],
            });
        try {
            for (let i = 0; i < 3; i++) await mk(`A${i}`);
            await expect(mk('Cuarta')).rejects.toBeInstanceOf(ForbiddenException);
            // Pausada sí se guarda; activarla rebota con el motivo.
            const paused = await mk('Pausada', false);
            await expect(autos.update(tenantId, 'tickets', paused.id, { is_active: true })).rejects.toThrow(/automatizaciones activas/);
        } finally {
            await pg.db.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantId));
        }
    });

    it('mantenimiento del historial: corridas «en curso» viejas se marcan interrumpidas y se borran las de más de 90 días', async () => {
        const auto = await autos.create(tenantId, 'tickets', {
            name: 'Historial',
            trigger_type: 'record_created',
            actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }],
        });
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(automationRuns).values([
                { tenantId, automationId: auto.id, status: 'running', createdAt: new Date(Date.now() - 2 * 3600_000) },
                { tenantId, automationId: auto.id, status: 'success', createdAt: new Date(Date.now() - 100 * 86_400_000) },
                { tenantId, automationId: auto.id, status: 'success' },
            ]),
        );
        const out = await autos.maintainRuns();
        expect(out).toMatchObject({ interrupted: 1, pruned: 1 });
        const rows = await runsOf(auto.id);
        expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'success']);
        expect(rows.find((r) => r.status === 'failed')!.error).toMatch(/interrumpió/);
    });
});
