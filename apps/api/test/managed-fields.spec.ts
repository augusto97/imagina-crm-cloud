import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHARGE_LOG_MARKER_KEY } from '@imagina-base/shared';

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, subscriptions, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkEditService } from '../src/records/bulk-edit.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.383 — Las columnas que escribe una sincronización de cobros (links de
 * pago, suscripciones con débito automático, lo que trae la importación de
 * Mercado Pago, el registro de cobros) no se editan a mano por ningún camino;
 * las columnas propias de la empresa siguen libres. Borrar un registro o una
 * lista con una suscripción viva se rechaza (el cliente seguiría pagando).
 */
const rt = new RealtimeService();

describe('Columnas protegidas de los cobros (v0.1.383)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsSvc: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let bulk: BulkEditService;
    let tenantId: number;
    let admin: Actor;
    const f: Record<string, number> = {};
    const k = (slug: string): string => `f${f[slug]}`;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsSvc,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsSvc),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        bulk = new BulkEditService(recs, rt, new BulkHistoryService(tenantDb, listsSvc, recs, rt, new AuditService(tenantDb)));
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'a@t.local', name: 'A', passwordHash: 'x' }).returning();
        admin = { userId: u!.id, role: 'admin' };
    });

    afterAll(async () => {
        await pg?.stop();
    });

    async function setSettings(listId: number, patch: Record<string, unknown>): Promise<void> {
        await withTenant(pg.db, tenantId, async (tx) => {
            const [row] = await tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId));
            await tx
                .update(lists)
                .set({ settings: { ...((row?.settings ?? {}) as Record<string, unknown>), ...patch } })
                .where(eq(lists.id, listId));
        });
    }

    let listId: number;

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        listId = (await listsSvc.create(tenantId, { name: 'Socios' })).id;
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            f[slug] = (await fieldsSvc.create(tenantId, 'socios', { label: slug, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('nombre', 'text');
        await mk('notas', 'long_text');
        await mk('estado', 'select', {
            options: [
                { value: 'active', label: 'Al día' },
                { value: 'cancelled', label: 'Cancelada' },
            ],
        });
        await mk('valor', 'currency');
        await mk('mp_id', 'text');
        await mk('link', 'url');
        await setSettings(listId, {
            subscriptions: { fields: { status: f.estado, amount: f.valor, link: f.link } },
            subscription_import_fields: { external_id_field_id: f.mp_id },
        });
    });

    it('editar a mano una columna sincronizada se rechaza con el motivo; el mismo valor y lo propio pasan', async () => {
        const rec = await recs.create(tenantId, admin, 'socios', { data: { [k('nombre')]: 'Ana' } }, { sync: true });
        // La sincronización escribe la columna (no pasa por los candados).
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(records)
                .set({ data: { [k('nombre')]: 'Ana', [k('estado')]: 'active', [k('valor')]: 150000 } })
                .where(eq(records.id, rec.id)),
        );

        await expect(recs.update(tenantId, admin, 'socios', rec.id, { data: { [k('valor')]: 1 } })).rejects.toMatchObject({
            response: { code: 'managed_field_locked', message: expect.stringMatching(/Cambiar el valor/) },
        });
        await expect(recs.update(tenantId, admin, 'socios', rec.id, { data: { [k('estado')]: 'cancelled' } })).rejects.toMatchObject({
            response: { code: 'managed_field_locked' },
        });
        await expect(recs.update(tenantId, admin, 'socios', rec.id, { data: { [k('mp_id')]: 'otro' } })).rejects.toMatchObject({
            response: { code: 'managed_field_locked' },
        });

        // Un formulario que reenvía TODO (con el valor de siempre) no falla, y la columna propia se guarda.
        const ok = await recs.update(tenantId, admin, 'socios', rec.id, {
            data: { [k('valor')]: 150000, [k('estado')]: 'active', [k('notas')]: 'Prefiere WhatsApp' },
        });
        const data = (ok as { data: Record<string, unknown> }).data;
        expect(data[k('notas')]).toBe('Prefiere WhatsApp');
        expect(data[k('valor')]).toBe(150000);
    });

    it('al crear a mano, lo que va a una columna sincronizada se descarta; la sincronización sí la escribe', async () => {
        const manual = await recs.create(tenantId, admin, 'socios', {
            data: { [k('nombre')]: 'Beto', [k('estado')]: 'active', [k('valor')]: 999, [k('notas')]: 'nuevo' },
        });
        const m = (manual as { data: Record<string, unknown> }).data;
        expect(m[k('estado')]).toBeUndefined();
        expect(m[k('valor')]).toBeUndefined();
        expect(m[k('notas')]).toBe('nuevo');

        const synced = await recs.create(tenantId, admin, 'socios', { data: { [k('nombre')]: 'Caro', [k('valor')]: 50000 } }, { sync: true });
        expect((synced as { data: Record<string, unknown> }).data[k('valor')]).toBe(50000);
    });

    it('una columna sincronizada obligatoria no frena el alta a mano', async () => {
        await withTenant(pg.db, tenantId, (tx) => tx.update(fields).set({ isRequired: true }).where(eq(fields.id, f.valor!)));
        const rec = await recs.create(tenantId, admin, 'socios', { data: { [k('nombre')]: 'Dani' } });
        expect(rec.id).toBeGreaterThan(0);
    });

    it('la edición en lote no toca una columna sincronizada y dice por qué', async () => {
        const rec = await recs.create(tenantId, admin, 'socios', { data: { [k('nombre')]: 'Eli' } });
        const preview = await bulk.preview(tenantId, admin, 'socios', { ids: [rec.id] }, [{ op: 'set', field_id: f.valor!, value: 10 }]);
        expect(preview.error_count).toBe(1);
        expect(preview.errors[0]!.message).toMatch(/Cambiar el valor/);
        const own = await bulk.preview(tenantId, admin, 'socios', { ids: [rec.id] }, [{ op: 'set', field_id: f.notas!, value: 'x' }]);
        expect(own.error_count).toBe(0);
        expect(own.ids).toEqual([rec.id]);
    });

    it('la columna se puede renombrar pero no cambiar de tipo, volverse obligatoria, perder opciones ni borrarse', async () => {
        const renamed = await fieldsSvc.update(tenantId, 'socios', f.valor!, { label: 'Valor mensual' } as never);
        expect(renamed.label).toBe('Valor mensual');

        await expect(fieldsSvc.update(tenantId, 'socios', f.valor!, { type: 'text' } as never)).rejects.toMatchObject({
            response: { code: 'managed_field_locked' },
        });
        await expect(fieldsSvc.update(tenantId, 'socios', f.valor!, { is_required: true } as never)).rejects.toMatchObject({
            response: { code: 'managed_field_locked' },
        });
        await expect(
            fieldsSvc.update(tenantId, 'socios', f.estado!, { config: { options: [{ value: 'active', label: 'Al día' }] } } as never),
        ).rejects.toMatchObject({ response: { code: 'managed_field_locked' } });
        // Cambiar la etiqueta de una opción (no su valor) sí se puede.
        const relabeled = await fieldsSvc.update(tenantId, 'socios', f.estado!, {
            config: {
                options: [
                    { value: 'active', label: 'Activa' },
                    { value: 'cancelled', label: 'Cancelada' },
                ],
            },
        } as never);
        expect((relabeled.config as { options: Array<{ label: string }> }).options[0]!.label).toBe('Activa');

        await expect(fieldsSvc.remove(tenantId, 'socios', f.valor!)).rejects.toMatchObject({
            response: { code: 'managed_field_locked', message: expect.stringMatching(/Suscripción/) },
        });
        // Lo que trae la importación sólo se escribe al crear: sí se puede borrar.
        await fieldsSvc.remove(tenantId, 'socios', f.mp_id!);
        // Y una columna propia, siempre.
        await fieldsSvc.remove(tenantId, 'socios', f.notas!);
    });

    it('un registro o una lista con una suscripción viva no se borran; cancelada, sí', async () => {
        const rec = await recs.create(tenantId, admin, 'socios', { data: { [k('nombre')]: 'Fer' } });
        const [sub] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(subscriptions)
                .values({
                    tenantId,
                    provider: 'mercadopago',
                    listId,
                    recordId: rec.id,
                    reference: 'ibs_test_1',
                    title: 'Plan',
                    amount: 150000,
                    currency: 'COP',
                    status: 'active',
                })
                .returning(),
        );

        await expect(recs.remove(tenantId, admin, 'socios', rec.id)).rejects.toMatchObject({
            response: { code: 'subscription_live', message: expect.stringMatching(/Cancélala primero/) },
        });
        await expect(listsSvc.remove(tenantId, 'socios')).rejects.toMatchObject({ response: { code: 'subscription_live' } });

        await withTenant(pg.db, tenantId, (tx) => tx.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, sub!.id)));
        await recs.remove(tenantId, admin, 'socios', rec.id);
        await listsSvc.remove(tenantId, 'socios');
    });

    it('la lista del registro de cobros protege lo que escribe y deja libres las columnas propias', async () => {
        const logList = (await listsSvc.create(tenantId, { name: 'Cobros' })).id;
        const monto = (await fieldsSvc.create(tenantId, 'cobros', { label: 'Monto', slug: 'monto', type: 'currency' } as never)).id;
        const nota = (await fieldsSvc.create(tenantId, 'cobros', { label: 'Nota', slug: 'nota', type: 'text' } as never)).id;
        await setSettings(logList, { [CHARGE_LOG_MARKER_KEY]: { list_id: listId, record_field_id: null, field_ids: [monto] } });
        const row = await recs.create(tenantId, admin, 'cobros', { data: { [`f${monto}`]: 150000 } }, { sync: true });

        await expect(recs.update(tenantId, admin, 'cobros', row.id, { data: { [`f${monto}`]: 1 } })).rejects.toMatchObject({
            response: { code: 'managed_field_locked', message: expect.stringMatching(/registro de cobros/) },
        });
        const ok = await recs.update(tenantId, admin, 'cobros', row.id, { data: { [`f${nota}`]: 'Pagó en efectivo' } });
        expect((ok as { data: Record<string, unknown> }).data[`f${nota}`]).toBe('Pagó en efectivo');
        // En el registro de cobros sí se puede borrar un cobro mal registrado.
        await recs.remove(tenantId, admin, 'cobros', row.id);
    });
});
