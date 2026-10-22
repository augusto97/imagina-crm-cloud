import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { batchCreateRecordsSchema, batchDeleteRecordsSchema, batchUpdateRecordsSchema } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activity, fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime que cuenta los avisos de registros (sin servidor socket). */
class CountingRealtime extends RealtimeService {
    recordEvents = 0;
    override records(tenantId: number, listId: number, origin?: string): void {
        this.recordEvents++;
        super.records(tenantId, listId, origin);
    }
}

const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };

/**
 * v0.1.287 — `PATCH /lists/:l/records/batch`: varias filas con valores
 * distintos por fila (pegar desde Excel, rellenar hacia abajo, deshacer).
 */
describe('RecordsService.batchUpdate (Postgres real)', () => {
    let pg: TestPg;
    let rt: CountingRealtime;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let service: RecordsService;
    let tenantA: number;
    let tenantB: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        rt = new CountingRealtime();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        service = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        await pg.db.insert(users).values({ email: 'a@acme.test', passwordHash: 'x', name: 'Ana' });
        await pg.db.insert(users).values({ email: 'b@acme.test', passwordHash: 'x', name: 'Beto' });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(activity).where(eq(activity.tenantId, t));
                await tx.delete(records).where(eq(records.tenantId, t));
                await tx.delete(fields).where(eq(fields.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        await listsService.create(tenantA, { name: 'Clientes' });
        await listsService.create(tenantB, { name: 'Clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre', is_required: true },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'baja', label: 'Baja' }] },
            },
            { label: 'Vence', type: 'date', slug: 'vence' },
            { label: 'VIP', type: 'checkbox', slug: 'vip' },
        ];
        f = {};
        for (const def of defs) f[def.slug!] = await fieldsService.create(tenantA, 'clientes', def);
        rt.recordEvents = 0;
    });

    const key = (slug: string): string => `f${f[slug]!.id}`;
    const make = async (nombre: string, actor: Actor = admin): Promise<number> =>
        (await service.create(tenantA, actor, 'clientes', { data: { [key('nombre')]: nombre } })).id;

    it('escribe valores DISTINTOS por fila en una llamada, con actividad y UN aviso de realtime', async () => {
        const a = await make('Alpha');
        const b = await make('Beta');
        rt.recordEvents = 0;
        const res = await service.batchUpdate(tenantA, admin, 'clientes', [
            { id: a, data: { [key('monto')]: 1500000, [key('estado')]: 'activo', [key('vence')]: '2026-12-31' } },
            { id: b, data: { [key('monto')]: '250000', [key('estado')]: 'baja', [key('vip')]: true } },
        ]);
        expect(res.failed).toEqual([]);
        expect(res.cell_errors).toEqual([]);
        expect(res.updated.map((r) => r.id).sort()).toEqual([a, b].sort());
        const rb = res.updated.find((r) => r.id === b)!;
        expect(rb.data[key('monto')]).toBe(250000);
        expect(rb.data[key('vip')]).toBe(true);
        expect(rt.recordEvents).toBe(1);
        const log = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(activity).where(and(eq(activity.tenantId, tenantA), eq(activity.action, 'record_updated'))),
        );
        expect(log.map((l) => l.recordId).sort()).toEqual([a, b].sort());
    });

    it('una celda inválida no aborta su fila ni las demás', async () => {
        const a = await make('Alpha');
        const b = await make('Beta');
        const res = await service.batchUpdate(tenantA, admin, 'clientes', [
            { id: a, data: { [key('monto')]: 10, [key('estado')]: 'no-existe', [key('vence')]: 'mañana' } },
            { id: b, data: { [key('monto')]: 20 } },
        ]);
        expect(res.failed).toEqual([]);
        expect(res.cell_errors.map((e) => `${e.id}:${e.key}`).sort()).toEqual([`${a}:${key('estado')}`, `${a}:${key('vence')}`].sort());
        expect(res.cell_errors.every((e) => e.message.length > 0)).toBe(true);
        const ra = res.updated.find((r) => r.id === a)!;
        expect(ra.data[key('monto')]).toBe(10);
        expect(ra.data[key('estado')]).toBeUndefined();
        expect(res.updated.find((r) => r.id === b)!.data[key('monto')]).toBe(20);
    });

    it('filas que no se pueden tocar: inexistentes, de otra empresa o fuera del alcance de edición', async () => {
        const mine = await make('Del agente', agent);
        const other = await make('Del admin');
        const res = await service.batchUpdate(tenantA, agent, 'clientes', [
            { id: mine, data: { [key('monto')]: 1 } },
            { id: other, data: { [key('monto')]: 2 } },
            { id: 999_999, data: { [key('monto')]: 3 } },
        ]);
        expect(res.updated.map((r) => r.id)).toEqual([mine]);
        expect(res.failed.map((x) => x.id).sort()).toEqual([other, 999_999].sort());
        expect(res.failed.every((x) => x.code === 'record_not_found')).toBe(true);
        // Otra empresa: su lista no ve los registros de A.
        const cross = await service.batchUpdate(tenantB, admin, 'clientes', [{ id: mine, data: { [key('monto')]: 9 } }]);
        expect(cross.updated).toEqual([]);
        expect(cross.failed).toHaveLength(1);
    });

    it('deshacer con `expect`: no pisa el cambio de otra persona', async () => {
        const a = await make('Alpha');
        await service.update(tenantA, admin, 'clientes', a, { data: { [key('estado')]: 'activo', [key('vip')]: false } });
        // Otra persona cambió el estado después.
        await service.update(tenantA, admin, 'clientes', a, { data: { [key('estado')]: 'baja' } });
        const conflict = await service.batchUpdate(tenantA, admin, 'clientes', [
            { id: a, data: { [key('estado')]: null }, expect: { [key('estado')]: 'activo' } },
        ]);
        expect(conflict.updated).toEqual([]);
        expect(conflict.failed[0]?.code).toBe('record_changed');
        expect(conflict.failed[0]?.changed).toEqual([key('estado')]);
        expect(conflict.failed[0]?.message).toContain('Estado');
        // Con el valor vigente, sí (y una casilla vacía vale lo mismo que desmarcada).
        const ok = await service.batchUpdate(tenantA, admin, 'clientes', [
            { id: a, data: { [key('estado')]: 'activo' }, expect: { [key('estado')]: 'baja', [key('vip')]: null } },
        ]);
        expect(ok.failed).toEqual([]);
        expect(ok.updated[0]!.data[key('estado')]).toBe('activo');
    });

    it('un id repetido se escribe una vez, con lo último', async () => {
        const a = await make('Alpha');
        const res = await service.batchUpdate(tenantA, admin, 'clientes', [
            { id: a, data: { [key('monto')]: 1 } },
            { id: a, data: { [key('monto')]: 2, [key('estado')]: 'baja' } },
        ]);
        expect(res.updated).toHaveLength(1);
        expect(res.updated[0]!.data[key('monto')]).toBe(2);
        expect(res.updated[0]!.data[key('estado')]).toBe('baja');
    });

    it('v0.1.294 — crea varias filas en una llamada (pegar más filas de las que hay): errores por fila y UN aviso', async () => {
        rt.recordEvents = 0;
        const res = await service.batchCreate(tenantA, admin, 'clientes', [
            { data: { [key('nombre')]: 'Nueva 1', [key('monto')]: 100 } },
            // Falta el nombre (obligatorio): esa fila sola no se crea.
            { data: { [key('monto')]: 200 } },
            { data: { [key('nombre')]: 'Nueva 3', [key('estado')]: 'activo' } },
        ]);
        expect(res.created.map((c) => c.index)).toEqual([0, 2]);
        expect(res.created[0]!.record.data[key('monto')]).toBe(100);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]!.index).toBe(1);
        expect(res.failed[0]!.code).toBe('validation_failed');
        expect(rt.recordEvents).toBe(1);
        const created = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(activity).where(and(eq(activity.tenantId, tenantA), eq(activity.action, 'record_created'))),
        );
        expect(created).toHaveLength(2);
    });

    it('v0.1.294 — deshacer las filas creadas: borra las que siguen igual y NO las que alguien cambió', async () => {
        const a = await make('Alpha');
        const b = await make('Beta');
        // Otra persona cambió B después de crearla.
        await service.update(tenantA, admin, 'clientes', b, { data: { [key('monto')]: 77 } });
        const res = await service.batchRemove(tenantA, admin, 'clientes', [
            { id: a, expect: { [key('nombre')]: 'Alpha', [key('monto')]: null } },
            { id: b, expect: { [key('nombre')]: 'Beta', [key('monto')]: null } },
        ]);
        expect(res.deleted).toEqual([a]);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]!.code).toBe('record_changed');
        expect(res.failed[0]!.changed).toEqual([key('monto')]);
        const alive = await withTenant(pg.db, tenantA, (tx) =>
            tx.select({ id: records.id, deletedAt: records.deletedAt }).from(records).where(eq(records.tenantId, tenantA)),
        );
        expect(alive.find((r) => r.id === a)!.deletedAt).not.toBeNull();
        expect(alive.find((r) => r.id === b)!.deletedAt).toBeNull();
        // El agente sólo borra lo suyo (ACL de la lista), con o sin `expect`.
        const others = await service.batchRemove(tenantA, agent, 'clientes', [{ id: b }]);
        expect(others.deleted).toEqual([]);
        expect(others.failed[0]!.code).toBe('record_not_found');
    });

    it('v0.1.294 — «Sin repetidos» se verifica en el servidor: alta, edición y lote', async () => {
        const codigo = await fieldsService.create(tenantA, 'clientes', { label: 'Código', type: 'text', slug: 'codigo', is_unique: true });
        const ck = `f${codigo.id}`;
        const a = (await service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'Alpha', [ck]: 'C-1' } })).id;
        // Mismo código con otras mayúsculas y espacios: rechazado.
        await expect(
            service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'Beta', [ck]: ' c-1 ' } }),
        ).rejects.toMatchObject({ response: { code: 'validation_failed', data: { errors: { codigo: expect.stringContaining('no admite valores repetidos') } } } });
        const b = (await service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'Beta', [ck]: 'C-2' } })).id;
        // Re-guardar el propio valor no choca consigo mismo.
        await service.update(tenantA, admin, 'clientes', a, { data: { [ck]: 'C-1' } });
        // En lote: la celda repetida falla sola y el resto de la fila se escribe.
        const res = await service.batchUpdate(tenantA, admin, 'clientes', [
            { id: b, data: { [ck]: 'C-1', [key('monto')]: 5 } },
        ]);
        expect(res.cell_errors.map((e) => e.key)).toEqual([ck]);
        expect(res.updated[0]!.data[key('monto')]).toBe(5);
        expect(res.updated[0]!.data[ck]).toBe('C-2');
        // Vacío no cuenta como repetido.
        await service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'Sin código 1' } });
        await service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'Sin código 2', [ck]: '' } });
    });

    it('el schema limita el tamaño del pedido y exige claves f{id}', () => {
        expect(batchCreateRecordsSchema.safeParse({ items: Array.from({ length: 501 }, () => ({ data: {} })) }).success).toBe(false);
        expect(batchCreateRecordsSchema.safeParse({ items: [{ data: { nombre: 'x' } }] }).success).toBe(false);
        expect(batchDeleteRecordsSchema.safeParse({ items: [{ id: 1, expect: { f1: null } }] }).success).toBe(true);
        const items = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, data: { f1: 1 } }));
        expect(batchUpdateRecordsSchema.safeParse({ items }).success).toBe(false);
        expect(batchUpdateRecordsSchema.safeParse({ items: [{ id: 1, data: { nombre: 'x' } }] }).success).toBe(false);
        expect(batchUpdateRecordsSchema.safeParse({ items: [{ id: 1, data: { f1: 'x' }, expect: { f1: null } }] }).success).toBe(true);
    });
});
