import type { Field, RtInvalidate } from '@imagina-base/shared';
import { RT_ORIGIN_HEADER, RT_ORIGIN_REQUEST, RT_ORIGIN_SYSTEM, rtJobOrigin } from '@imagina-base/shared';
import { Queue, type Worker } from 'bullmq';
import IORedis from 'ioredis';
import { defer, lastValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { ChecklistsRepository } from '../src/checklists/checklists.repository';
import { ChecklistsService } from '../src/checklists/checklists.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RECORDS_EMIT_WINDOW_MS, RealtimeService } from '../src/realtime/realtime.service';
import { RtOriginInterceptor, currentRtOrigin, rtOriginOfHeader, withRtOrigin } from '../src/realtime/rt-origin';
import { createWorker } from '../src/redis/queue-runtime';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const TAB = 'a1b2c3d4e5f6a7b8c9d0e1f2';

/** Corre `fn` como lo hace Nest con un pedido: dentro del interceptor del origen. */
function asRequest<T>(headers: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const ctx = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as never;
    // Como `next.handle()` de Nest: el controlador corre al suscribirse.
    return lastValueFrom(new RtOriginInterceptor().intercept(ctx, { handle: () => defer(() => fn()) })) as Promise<T>;
}

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class NoMail implements MailTransport {
    readonly name = 'none';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve(null),
    expire: () => Promise.resolve(null),
    lrange: () => Promise.resolve([]),
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * v0.1.461 — El servidor marca cada aviso del realtime con QUIÉN originó el
 * cambio: la pestaña del pedido (`tab:<id>`), un pedido sin pestaña
 * (`request`), un trabajo de una cola (`job:<cola>`) o el sistema. Así la
 * pestaña ignora SÓLO el eco de su edición y no se come lo que una
 * automatización disparada por esa edición cambia un instante después.
 */
describe('origen de los avisos del realtime', () => {
    it('la cabecera de la pestaña: id bien formado → tab:<id>; ausente o rara → request', () => {
        expect(rtOriginOfHeader(TAB)).toBe(`tab:${TAB}`);
        expect(rtOriginOfHeader([TAB, 'otro'])).toBe(`tab:${TAB}`);
        expect(rtOriginOfHeader(undefined)).toBe(RT_ORIGIN_REQUEST);
        expect(rtOriginOfHeader('corto')).toBe(RT_ORIGIN_REQUEST);
        expect(rtOriginOfHeader('tab:con:dos-puntos')).toBe(RT_ORIGIN_REQUEST);
        expect(rtOriginOfHeader('x'.repeat(65))).toBe(RT_ORIGIN_REQUEST);
    });

    it('fuera de un pedido o trabajo es «system»; un trabajo lleva su cola', () => {
        expect(currentRtOrigin()).toBe(RT_ORIGIN_SYSTEM);
        expect(withRtOrigin(rtJobOrigin('automations'), () => currentRtOrigin())).toBe('job:automations');
        expect(currentRtOrigin()).toBe(RT_ORIGIN_SYSTEM);
    });

    it('el interceptor: el controlador (y lo que espera) corre con el origen del pedido; lo que sigue DESPUÉS de responder, no', async () => {
        let inside = '';
        let afterAwait = '';
        let late = '';
        let release!: () => void;
        const gate = new Promise<void>((r) => {
            release = r;
        });
        let lateDone!: Promise<void>;
        await asRequest({ [RT_ORIGIN_HEADER]: TAB }, async () => {
            inside = currentRtOrigin();
            await sleep(5);
            afterAwait = currentRtOrigin();
            // Una tarea que sigue corriendo cuando el controlador ya respondió.
            lateDone = (async () => {
                await gate;
                late = currentRtOrigin();
            })();
            return 1;
        });
        release();
        await lateDone;
        expect(inside).toBe(`tab:${TAB}`);
        expect(afterAwait).toBe(`tab:${TAB}`);
        expect(late).toBe(RT_ORIGIN_SYSTEM);
        expect(await asRequest({}, () => Promise.resolve(currentRtOrigin()))).toBe(RT_ORIGIN_REQUEST);
        // Dos pedidos a la vez no se mezclan.
        const [a, b] = await Promise.all([
            asRequest({ [RT_ORIGIN_HEADER]: 'aaaaaaaaaaaa' }, async () => {
                await sleep(10);
                return currentRtOrigin();
            }),
            asRequest({ [RT_ORIGIN_HEADER]: 'bbbbbbbbbbbb' }, async () => {
                await sleep(1);
                return currentRtOrigin();
            }),
        ]);
        expect([a, b]).toEqual(['tab:aaaaaaaaaaaa', 'tab:bbbbbbbbbbbb']);
    });

    it('el aviso toma el origen del contexto; dentro de la ventana, la automatización sale con el suyo y una mezcla con ninguno', async () => {
        const rt = new RealtimeService();
        const sent: RtInvalidate[] = [];
        rt.setServer({ to: () => ({ emit: (_e: string, payload: RtInvalidate) => sent.push(payload) }) } as never);
        await asRequest({ [RT_ORIGIN_HEADER]: TAB }, () => {
            rt.records(1, 10);
            rt.lists(1);
            return Promise.resolve();
        });
        expect(sent.map((s) => s.origin)).toEqual([`tab:${TAB}`, `tab:${TAB}`]);
        // Dentro de la ventana: la automatización que disparó la edición…
        withRtOrigin(rtJobOrigin('automations'), () => rt.records(1, 10));
        await sleep(RECORDS_EMIT_WINDOW_MS + 100);
        // …sale con SU origen: la pestaña no lo confunde con su eco.
        expect(sent.at(-1)).toEqual({ topic: 'records', listId: 10, origin: 'job:automations' });
        // La pestaña y la automatización juntadas en un aviso: sin origen (nadie lo ignora).
        await asRequest({ [RT_ORIGIN_HEADER]: TAB }, () => Promise.resolve(rt.records(1, 10)));
        withRtOrigin(rtJobOrigin('automations'), () => rt.records(1, 10));
        await sleep(RECORDS_EMIT_WINDOW_MS + 100);
        expect(sent.at(-1)).toEqual({ topic: 'records', listId: 10 });
    });

    describe('con Redis real: los trabajos de una cola', () => {
        let rd: TestRedis;
        const conns: IORedis[] = [];
        let worker: Worker | null = null;
        let queue: Queue;

        beforeAll(async () => {
            rd = await startRedis();
        });

        afterAll(async () => {
            await worker?.close();
            await queue?.close();
            for (const c of conns) c.disconnect();
            await rd?.stop();
        });

        it('`createWorker` corre cada trabajo como job:<cola>', async () => {
            const conn = (): IORedis => {
                const c = new IORedis(rd.url, { maxRetriesPerRequest: null });
                conns.push(c);
                return c;
            };
            queue = new Queue('rt-origen', { connection: conn() });
            const seen = new Promise<string>((resolve) => {
                worker = createWorker(
                    'rt-origen',
                    async () => {
                        await sleep(1);
                        resolve(currentRtOrigin());
                    },
                    { connection: conn() },
                );
            });
            // Encolado DESDE un pedido: el trabajo igual corre como la cola, no como la pestaña.
            await asRequest({ [RT_ORIGIN_HEADER]: TAB }, () => queue.add('x', {}));
            expect(await seen).toBe('job:rt-origen');
        });
    });

    describe('Postgres real: completar un checklist dispara una automatización que cambia otro campo', () => {
        let pg: TestPg;
        let lists: ListsService;
        let fieldsSvc: FieldsService;
        let recs: RecordsService;
        let checklists: ChecklistsService;
        let autos: AutomationsService;
        let engine: AutomationEngine;
        const dispatcher = new CapturingDispatcher();
        const rt = new RealtimeService();
        const sent: RtInvalidate[] = [];
        let tenantId: number;
        let ana: Actor;
        const f: Record<string, Field> = {};

        beforeAll(async () => {
            pg = await startPostgres();
            const tenantDb = new TenantDb(pg.db);
            rt.setServer({ to: () => ({ emit: (_e: string, payload: RtInvalidate) => sent.push(payload) }) } as never);
            lists = new ListsService(tenantDb, new ListsRepository(), rt);
            fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
            const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
            const plans = new PlansService(pg.db);
            const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
            const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
            const zones = new TenantTimeZones(tenantDb);
            const hub = new NotifyHub();
            recs = new RecordsService(
                tenantDb,
                new RecordsRepository(),
                lists,
                fieldsSvc,
                rt,
                activitySvc,
                dispatcher,
                new RelationsRepository(),
                undefined,
                undefined,
                billing,
                zones,
                hub,
            );
            checklists = new ChecklistsService(tenantDb, lists, fieldsSvc, recs, new RecordsRepository(), new ChecklistsRepository(), activitySvc, rt, dispatcher, hub, zones);
            const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
            autos = new AutomationsService(
                pg.db,
                tenantDb,
                new AutomationsRepository(),
                lists,
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
                billing,
                undefined,
                zones,
                undefined,
                undefined,
                { get: () => recs } as never,
            );
            const [t] = await pg.db.insert(tenants).values({ slug: 'eco', name: 'Eco', plan: 'enterprise' }).returning();
            tenantId = t!.id;
            const [u] = await pg.db.insert(users).values({ email: 'ana@eco.test', name: 'Ana', passwordHash: 'x' }).returning();
            ana = { userId: u!.id, role: 'admin' };
            await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: ana.userId, role: 'admin' }));
            await lists.create(tenantId, { name: 'Proyectos', slug: 'proyectos' });
            f.nombre = await fieldsSvc.create(tenantId, 'proyectos', { label: 'Nombre', type: 'text', slug: 'nombre' });
            f.estado = await fieldsSvc.create(tenantId, 'proyectos', {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'curso', label: 'En curso' }, { value: 'listo', label: 'Listo' }] },
            });
        });

        afterAll(async () => {
            await pg?.stop();
        });

        it('la edición avisa como la pestaña; lo que cambia la automatización, como la cola de automatizaciones', async () => {
            const listId = (await lists.get(tenantId, 'proyectos')).id;
            await autos.create(tenantId, 'proyectos', {
                name: 'Al terminar el checklist',
                trigger_type: 'checklist_completed',
                trigger_config: {},
                actions: [{ type: 'update_field', config: { values: { estado: 'listo' } } }],
            });
            const rec = await recs.create(tenantId, ana, 'proyectos', { data: { [`f${f.nombre!.id}`]: 'Web', [`f${f.estado!.id}`]: 'curso' } });
            const cl = (await checklists.create(tenantId, ana, 'proyectos', rec.id, { name: 'QA', items: [{ text: 'Probar' }] })).checklists[0]!;
            // Que lo de la preparación quede fuera de la ventana.
            await sleep(2 * RECORDS_EMIT_WINDOW_MS + 200);
            sent.length = 0;
            dispatcher.events.length = 0;

            // 1. La persona marca el ítem desde su pestaña.
            await asRequest({ [RT_ORIGIN_HEADER]: TAB }, () => checklists.updateItem(tenantId, ana, 'proyectos', rec.id, cl.items[0]!.id, { done: true }));
            const mine = sent.filter((s) => s.topic === 'records' && s.listId === listId);
            expect(mine).toEqual([{ topic: 'records', listId, origin: `tab:${TAB}` }]);

            // 2. El checklist completo dispara la automatización; corre en la cola.
            const ev = dispatcher.events.find((e) => e.trigger === 'checklist_completed');
            expect(ev).toBeDefined();
            await withRtOrigin(rtJobOrigin('automations'), () => engine.process(ev!));
            await sleep(RECORDS_EMIT_WINDOW_MS + 150);
            const all = sent.filter((s) => s.topic === 'records' && s.listId === listId);
            // El cambio de la automatización llega con SU origen (no el de la pestaña).
            expect(all.at(-1)).toEqual({ topic: 'records', listId, origin: 'job:automations' });
            expect(all.slice(1).every((s) => s.origin !== `tab:${TAB}`)).toBe(true);
            const after = await recs.get(tenantId, ana, 'proyectos', rec.id);
            expect(after.data[`f${f.estado!.id}`]).toBe('listo');
        });
    });
});
