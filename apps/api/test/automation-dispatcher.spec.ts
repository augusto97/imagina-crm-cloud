import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { automations, tenants } from '../src/db/schema';
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
});
