import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine, DUE_FULL_SCAN_MS } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { dueScanPattern } from '../src/automations/automation-scheduler.service';
import { changedDateLike } from '../src/automations/automation-waits.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { automationRuns, automations, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RECORDS_EMIT_WINDOW_MS, RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/** Un correo que tarda en salir (un SMTP lento). */
class SlowMail implements MailTransport {
    readonly name = 'slow';
    readonly sent: MailMessage[] = [];
    constructor(private readonly ms: number) {}
    async send(m: MailMessage): Promise<void> {
        await new Promise((r) => setTimeout(r, this.ms));
        this.sent.push(m);
    }
}

/**
 * v0.1.392 — Automatizaciones a escala: los pasos que esperan a otro servicio
 * no retienen una conexión a la base, el escaneo de vencimientos mira sólo lo
 * nuevo, y lo que corre en cada cambio de registro es más barato.
 */
describe('Automatizaciones a escala (v0.1.392)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let recs: RecordsService;
    let engine: AutomationEngine;
    let mail: SlowMail;
    let tenantId: number;
    let listId: number;
    let f: Record<string, Field>;
    let admin: Actor;
    let server: Server;
    let url: string;
    let hits = 0;

    beforeAll(async () => {
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        // Un webhook que tarda 1,2 s en contestar.
        server = createServer((req, res) => {
            req.resume();
            req.on('end', () => {
                hits++;
                setTimeout(() => {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, folio: 'F-1' }));
                }, 1200);
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/erp`;

        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsService = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const dispatcher = new AutomationDispatcher();
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
        );
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        mail = new SlowMail(1200);
        const tz = new TenantTimeZones(tenantDb);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), mail),
            connectors,
            undefined,
            dispatcher,
            undefined,
            undefined,
            tz,
            undefined,
            undefined,
            { get: () => recs } as never,
            undefined,
            redis as never,
        );
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'escala', name: 'Escala', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        admin = { userId: 0, role: 'admin' };
        listId = (await lists.create(tenantId, { name: 'Facturas', slug: 'facturas' })).id;
        f = {};
        for (const d of [
            { label: 'Concepto', type: 'text', slug: 'concepto' },
            { label: 'Vence', type: 'date', slug: 'vence' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] },
            },
        ] as CreateFieldInput[]) {
            f[d.slug!] = await fieldsService.create(tenantId, 'facturas', d);
        }
    });

    afterAll(async () => {
        delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        redis?.disconnect();
        await new Promise<void>((r) => server.close(() => r()));
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    const k = (slug: string): string => `f${f[slug]!.id}`;
    const idleInTransaction = async (): Promise<number> => {
        const res = await pg.db.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state = 'idle in transaction'`);
        return Number((res.rows[0] as { n: number }).n);
    };
    const newAutomation = async (values: Partial<typeof automations.$inferInsert>): Promise<number> => {
        const [a] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({ tenantId, listId, name: 'Prueba', triggerType: 'record_updated', actions: [], ...values })
                .returning(),
        );
        return a!.id;
    };
    const runsOf = async (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));

    it('un webhook lento NO deja una transacción abierta mientras espera la respuesta', async () => {
        const autoId = await newAutomation({
            name: 'Avisar al ERP',
            actions: [{ type: 'call_webhook', config: { url, method: 'POST', response_name: 'erp' } }],
        });
        const rec = await recs.create(tenantId, admin, 'facturas', { data: { [k('concepto')]: 'Plan' } });
        const event: TriggerEvent = { tenantId, listId, recordId: rec.id, trigger: 'record_updated', after: rec.data, before: {} };
        const done = engine.process(event);
        // A mitad de la espera del webhook: ninguna conexión «en transacción, inactiva».
        await new Promise((r) => setTimeout(r, 700));
        expect(hits).toBe(1);
        expect(await idleInTransaction()).toBe(0);
        await done;
        const [run] = await runsOf(autoId);
        expect(run?.status).toBe('success');
        expect(JSON.stringify(run?.actionsLog)).toContain('→ 200');
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(eq(automations.id, autoId)));
    });

    it('un correo lento tampoco: lo que se armó queda confirmado y el envío espera afuera', async () => {
        const autoId = await newAutomation({
            name: 'Avisar por correo',
            actions: [{ type: 'send_email', config: { to: 'cobros@acme.test', subject: 'Factura {{concepto}}', body: 'Hola' } }],
        });
        const rec = await recs.create(tenantId, admin, 'facturas', { data: { [k('concepto')]: 'Soporte' } });
        const done = engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_updated', after: rec.data, before: {} });
        await new Promise((r) => setTimeout(r, 700));
        expect(await idleInTransaction()).toBe(0);
        await done;
        expect(mail.sent.map((m) => m.subject)).toContain('Factura Soporte');
        const [run] = await runsOf(autoId);
        expect(run?.status).toBe('success');
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(eq(automations.id, autoId)));
    });

    it('un webhook que falla deja la corrida fallida con el motivo (igual que antes)', async () => {
        const autoId = await newAutomation({
            name: 'ERP caído',
            actions: [{ type: 'call_webhook', config: { url: 'http://127.0.0.1:1/nada', method: 'POST' } }],
        });
        const rec = await recs.create(tenantId, admin, 'facturas', { data: { [k('concepto')]: 'Caído' } });
        await engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_updated', after: rec.data, before: {} });
        const [run] = await runsOf(autoId);
        expect(run?.status).toBe('failed');
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(eq(automations.id, autoId)));
    });

    it('vencimientos: tras una vuelta completa, sólo mira lo que venció o cambió desde la anterior', async () => {
        const autoId = await newAutomation({
            name: 'Recordar pendientes',
            triggerType: 'due_date_reached',
            triggerConfig: {
                due_field: 'vence',
                include_past: true,
                field_filters: [{ slug: 'estado', op: 'eq', value: 'pendiente' }],
            },
            actions: [{ type: 'send_email', config: { to: 'cobros@acme.test', subject: 'Vence {{concepto}}', body: 'Hola' } }],
        });
        mail.sent.length = 0;
        const old = (concepto: string, estado: string) =>
            recs.create(tenantId, admin, 'facturas', { data: { [k('concepto')]: concepto, [k('vence')]: '2026-01-10', [k('estado')]: estado } });
        const r1 = await old('Uno', 'pendiente');
        const r2 = await old('Dos', 'pagada');
        // Nadie los tocó hace rato.
        await withTenant(pg.db, tenantId, (tx) => tx.update(records).set({ updatedAt: sql`now() - interval '2 days'` }).where(eq(records.listId, listId)));

        // 1) Primera vuelta: completa. Corre la pendiente; la pagada no pasa el filtro.
        await engine.runDueDate(tenantId, autoId);
        expect((await runsOf(autoId)).map((r) => r.recordId)).toEqual([r1.id]);
        const state = JSON.parse((await redis.get(`due:scan:${autoId}`))!) as { at: number; full: number };
        expect(state.full).toBe(state.at);

        // 2) La pagada pasa a pendiente SIN que el registro cambie (como un
        // campo calculado que cambió por otro registro): la ventana no la ve.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(records).set({ data: sql`${records.data} || ${JSON.stringify({ [k('estado')]: 'pendiente' })}::jsonb` }).where(eq(records.id, r2.id)),
        );
        await engine.runDueDate(tenantId, autoId);
        expect(await runsOf(autoId)).toHaveLength(1);

        // 3) Una edición de verdad (la fila cambia): la ventana la ve y dispara.
        const r3 = await old('Tres', 'pagada');
        await recs.update(tenantId, admin, 'facturas', r3.id, { data: { [k('estado')]: 'pendiente' } });
        await engine.runDueDate(tenantId, autoId);
        expect((await runsOf(autoId)).map((r) => r.recordId).sort()).toEqual([r1.id, r3.id].sort());

        // 4) Pasadas las 6 horas, una vuelta completa recoge lo que la ventana no vio.
        const now = JSON.parse((await redis.get(`due:scan:${autoId}`))!) as { at: number; v: string; full: number };
        await redis.set(`due:scan:${autoId}`, JSON.stringify({ ...now, full: now.full - DUE_FULL_SCAN_MS - 1000 }));
        await engine.runDueDate(tenantId, autoId);
        expect((await runsOf(autoId)).map((r) => r.recordId).sort()).toEqual([r1.id, r2.id, r3.id].sort());

        // 5) Cambiar la automatización (o la zona de la empresa) vuelve a empezar por una vuelta completa.
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ updatedAt: sql`now() + interval '1 second'` }).where(eq(automations.id, autoId)));
        await redis.del(`due:scan:${autoId}`);
        await engine.runDueDate(tenantId, autoId);
        expect(await runsOf(autoId)).toHaveLength(3); // nada nuevo: ya corrieron para esas fechas
        expect(await redis.exists(`due:scan:${autoId}`)).toBe(1);
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(and(eq(automations.id, autoId))));
    });

    it('los escaneos de vencimientos se reparten en los 5 minutos', () => {
        expect(dueScanPattern(10)).toBe('0-59/5 * * * *');
        expect(dueScanPattern(7)).toBe('2-59/5 * * * *');
        expect(new Set([1, 2, 3, 4, 5].map(dueScanPattern)).size).toBe(5);
    });

    it('una espera sólo se re-mira si cambió una FECHA (antes, en cada edición)', () => {
        const fields = [
            { id: 1, type: 'text' },
            { id: 2, type: 'date' },
        ] as never;
        expect(changedDateLike({ before: { f1: 'a' }, after: { f1: 'b' }, fields })).toBe(false);
        expect(changedDateLike({ before: { f2: '2026-01-01' }, after: { f2: '2026-02-01' }, fields })).toBe(true);
        // Sin los campos a mano: cualquier cambio cuenta (como antes).
        expect(changedDateLike({ before: { f1: 'a' }, after: { f1: 'b' } })).toBe(true);
        expect(changedDateLike({ before: { f1: 'a' }, after: { f1: 'a' } })).toBe(false);
    });

    it('tiempo real: como mucho un aviso por lista por ventana; el primero sale en el acto', async () => {
        const rt = new RealtimeService();
        const sent: Array<{ room: string; payload: { listId?: number; origin?: string } }> = [];
        rt.setServer({ to: (room: string) => ({ emit: (_e: string, payload: never) => sent.push({ room, payload }) }) } as never);
        rt.records(1, 10, 'tab-a');
        expect(sent).toHaveLength(1); // en el acto
        for (let i = 0; i < 50; i++) rt.records(1, 10, i % 2 ? 'tab-a' : 'tab-b');
        rt.records(1, 11); // otra lista: su propio aviso
        expect(sent).toHaveLength(2);
        await new Promise((r) => setTimeout(r, RECORDS_EMIT_WINDOW_MS + 100));
        // Los 50 se juntaron en UNO; de pestañas distintas → nadie lo ignora.
        expect(sent.filter((s) => s.payload.listId === 10)).toHaveLength(2);
        expect(sent.at(-1)?.payload.origin).toBeUndefined();
        // Justo después del aviso agrupado, el siguiente también espera su ventana…
        rt.records(1, 10, 'tab-a');
        expect(sent.filter((s) => s.payload.listId === 10)).toHaveLength(2);
        await new Promise((r) => setTimeout(r, RECORDS_EMIT_WINDOW_MS + 100));
        expect(sent.filter((s) => s.payload.listId === 10)).toHaveLength(3);
        expect(sent.at(-1)?.payload.origin).toBe('tab-a');
        // …y con la lista quieta más de una ventana, el próximo sale en el acto.
        await new Promise((r) => setTimeout(r, RECORDS_EMIT_WINDOW_MS + 100));
        rt.records(1, 10);
        expect(sent.filter((s) => s.payload.listId === 10)).toHaveLength(4);
    });
});
