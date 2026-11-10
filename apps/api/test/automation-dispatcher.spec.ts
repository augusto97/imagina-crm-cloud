import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { automations, fields, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * Cada alta/edición de un registro encolaba un job de automatizaciones aunque
 * la lista no tuviera NINGUNA (y el worker abría una transacción para
 * descubrirlo). El dispatcher ahora sabe —cacheado en Redis, invalidado al
 * guardar una automatización— si la lista escucha ese evento.
 */
describe('AutomationDispatcher: sólo encola si la lista escucha el evento', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantId: number;
    let listId: number;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const lists = new ListsService(new TenantDb(pg.db), new ListsRepository(), new RealtimeService());
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        listId = (await lists.create(tenantId, { name: 'Deals' })).id;
    });
    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    const event = (trigger: TriggerEvent['trigger']): TriggerEvent => ({ tenantId, listId, recordId: 1, trigger, after: {} });

    it('sin automatizaciones no encola; con una activa del tipo justo sí; pausada o borrada deja de encolar', async () => {
        const jobs: string[] = [];
        const dispatcher = new AutomationDispatcher(undefined, pg.db, redis as never);
        dispatcher.setQueue({ add: (_: string, data: TriggerEvent) => (jobs.push(data.trigger), Promise.resolve()) } as never);
        const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 100));

        dispatcher.dispatch(event('record_updated'));
        await flush();
        expect(jobs).toEqual([]);

        // Se crea una automatización «al cambiar un campo»: tras invalidar, escucha ediciones (y no altas).
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(automations).values({ tenantId, listId, name: 'A', triggerType: 'field_changed' }).returning(),
        );
        // Sin invalidar el caché sigue diciendo «nada» (por eso el servicio invalida al guardar).
        expect(await dispatcher.listensTo(tenantId, listId, 'record_updated')).toBe(false);
        await dispatcher.invalidate(tenantId, listId);
        dispatcher.dispatch(event('record_updated'));
        dispatcher.dispatch(event('record_created'));
        await flush();
        expect(jobs).toEqual(['record_updated']);

        // Pausada → deja de encolar.
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(eq(automations.id, auto!.id)));
        await dispatcher.invalidate(tenantId, listId);
        dispatcher.dispatch(event('record_updated'));
        await flush();
        expect(jobs).toEqual(['record_updated']);

        // Un evento que el mapa no conoce se encola siempre (ante la duda, el motor decide).
        expect(await dispatcher.listensTo(tenantId, listId, 'otro' as never)).toBe(true);
    });

    it('sin Redis o con Redis caído, encola igual (nunca pierde un evento por el caché)', async () => {
        const jobs: string[] = [];
        const broken = new IORedis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
        broken.on('error', () => undefined);
        const dispatcher = new AutomationDispatcher(undefined, pg.db, broken as never);
        dispatcher.setQueue({ add: (_: string, data: TriggerEvent) => (jobs.push(data.trigger), Promise.resolve()) } as never);
        dispatcher.dispatch(event('record_updated'));
        await new Promise((r) => setTimeout(r, 200));
        expect(jobs).toEqual(['record_updated']);
        broken.disconnect();
    });

    // v0.1.392 — una edición que no toca NINGÚN campo que esperan las
    // automatizaciones «al actualizar» no encola nada.
    it('«al actualizar» con campos elegidos: sólo encola si cambió uno de esos campos', async () => {
        const [t2] = await pg.db.insert(tenants).values({ slug: 'acme-watch', name: 'Acme watch' }).returning();
        const tid = t2!.id;
        const lists = new ListsService(new TenantDb(pg.db), new ListsRepository(), new RealtimeService());
        const lid = (await lists.create(tid, { name: 'Tickets' })).id;
        const [estado, nota] = await withTenant(pg.db, tid, (tx) =>
            tx
                .insert(fields)
                .values([
                    { tenantId: tid, listId: lid, slug: 'estado', label: 'Estado', type: 'text', position: 1 },
                    { tenantId: tid, listId: lid, slug: 'nota', label: 'Nota', type: 'text', position: 2 },
                ])
                .returning(),
        );
        const fe = `f${estado!.id}`;
        const fn = `f${nota!.id}`;
        const jobs: Array<Record<string, unknown>> = [];
        const dispatcher = new AutomationDispatcher(undefined, pg.db, redis as never);
        dispatcher.setQueue({ add: (_: string, data: TriggerEvent) => (jobs.push(data.after), Promise.resolve()) } as never);
        const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 100));
        const edit = (before: Record<string, unknown>, after: Record<string, unknown>): TriggerEvent => ({ tenantId: tid, listId: lid, recordId: 1, trigger: 'record_updated', before, after });

        const [auto] = await withTenant(pg.db, tid, (tx) =>
            tx.insert(automations).values({ tenantId: tid, listId: lid, name: 'Al cambiar el estado', triggerType: 'record_updated', triggerConfig: { changed_fields: ['estado'] } }).returning(),
        );
        await dispatcher.invalidate(tid, lid);
        dispatcher.dispatch(edit({ [fn]: 'a', [fe]: 'abierto' }, { [fn]: 'b', [fe]: 'abierto' })); // cambió la nota: nada
        await flush();
        expect(jobs).toEqual([]);
        dispatcher.dispatch(edit({ [fe]: 'abierto' }, { [fe]: 'cerrado' })); // cambió el estado: sí
        await flush();
        expect(jobs).toEqual([{ [fe]: 'cerrado' }]);

        // «Cuando cambia un campo» con `field` también cuenta como campo elegido.
        await withTenant(pg.db, tid, (tx) =>
            tx.insert(automations).values({ tenantId: tid, listId: lid, name: 'Nota', triggerType: 'field_changed', triggerConfig: { field: 'nota' } }),
        );
        await dispatcher.invalidate(tid, lid);
        dispatcher.dispatch(edit({ [fn]: 'b' }, { [fn]: 'c' }));
        await flush();
        expect(jobs).toHaveLength(2);

        // Una que espera un campo que hoy no existe: por las dudas, se encola siempre (el motor decide).
        await withTenant(pg.db, tid, (tx) => tx.update(automations).set({ triggerConfig: { changed_fields: ['ya_no_existe'] } }).where(eq(automations.id, auto!.id)));
        await dispatcher.invalidate(tid, lid);
        dispatcher.dispatch(edit({ x: 1 }, { x: 2 }));
        await flush();
        expect(jobs).toHaveLength(3);

        // Una sin campos elegidos reacciona a cualquier cambio.
        await withTenant(pg.db, tid, (tx) => tx.update(automations).set({ triggerConfig: {} }).where(eq(automations.id, auto!.id)));
        await dispatcher.invalidate(tid, lid);
        dispatcher.dispatch(edit({ y: 1 }, { y: 2 }));
        await flush();
        expect(jobs).toHaveLength(4);
    });

    // v0.1.392 — turnos justos: cada tarea entra con prioridad = cuántas de
    // SU empresa hay pendientes, así la primera de cada empresa sale antes que
    // la segunda de cualquiera (BullMQ atiende primero la prioridad más baja).
    it('turnos por empresa: la prioridad crece con lo pendiente de ESA empresa y baja al terminar', async () => {
        const added: Array<{ tenant: number; priority: number | undefined }> = [];
        const dispatcher = new AutomationDispatcher(undefined, pg.db, redis as never);
        dispatcher.setQueue({
            add: (_: string, data: { tenantId: number }, opts: { priority?: number }) => (added.push({ tenant: data.tenantId, priority: opts?.priority }), Promise.resolve()),
        } as never);
        const A = 900001;
        const B = 900002;
        for (let i = 0; i < 5; i++) dispatcher.dispatchWebhook({ tenantId: A, automationId: 1, payload: {} });
        await new Promise((r) => setTimeout(r, 100));
        dispatcher.dispatchWebhook({ tenantId: B, automationId: 2, payload: {} });
        await new Promise((r) => setTimeout(r, 100));
        expect(added.filter((a) => a.tenant === A).map((a) => a.priority).sort()).toEqual([1, 2, 3, 4, 5]);
        expect(added.find((a) => a.tenant === B)?.priority).toBe(1);

        // Terminan dos de A: la próxima de A entra con 4, no con 6.
        await dispatcher.release(A);
        await dispatcher.release(A);
        dispatcher.dispatchWebhook({ tenantId: A, automationId: 1, payload: {} });
        await new Promise((r) => setTimeout(r, 100));
        expect(added.at(-1)).toEqual({ tenant: A, priority: 4 });

        // El contador nunca queda negativo ni para siempre.
        for (let i = 0; i < 10; i++) await dispatcher.release(B);
        expect(await redis.exists(`autoq:n:${B}`)).toBe(0);
        expect(await redis.ttl(`autoq:n:${A}`)).toBeGreaterThan(0);
    });
});
