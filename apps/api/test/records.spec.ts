import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime no-op para tests unitarios (sin servidor socket → no emite). */
const rt = new RealtimeService();

const admin: Actor = { userId: 1, role: 'admin' };

describe('RecordsService + QueryBuilder (Postgres real + RLS)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let service: RecordsService;
    let tenantA: number;
    let tenantB: number;
    let fieldByType: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        service = new RecordsService(tenantDb, new RecordsRepository(), listsService, fieldsService, rt);

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
                await tx.delete(records).where(eq(records.tenantId, t));
                await tx.delete(fields).where(eq(fields.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        await listsService.create(tenantA, { name: 'Clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre', is_required: true },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'baja', label: 'Baja' }] },
            },
            {
                label: 'Tags',
                type: 'multi_select',
                slug: 'tags',
                config: { options: [{ value: 'web', label: 'Web' }, { value: 'hosting', label: 'Hosting' }] },
            },
            { label: 'Vence', type: 'date', slug: 'vence' },
        ];
        fieldByType = {};
        for (const def of defs) {
            const f = await fieldsService.create(tenantA, 'clientes', def);
            fieldByType[def.slug!] = f;
        }
    });

    const key = (slug: string) => `f${fieldByType[slug]!.id}`;

    it('create valida required y normaliza valores', async () => {
        await expect(service.create(tenantA, admin, 'clientes', { data: {} })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        const rec = await service.create(tenantA, admin, 'clientes', {
            data: { [key('nombre')]: 'ACME', [key('monto')]: '1000', [key('estado')]: 'activo' },
        });
        // currency se normaliza a number.
        expect(rec.data[key('monto')]).toBe(1000);
        expect(rec.created_by).toBe(admin.userId);
    });

    it('create rechaza opción de select inválida y campo desconocido', async () => {
        await expect(
            service.create(tenantA, admin, 'clientes', {
                data: { [key('nombre')]: 'X', [key('estado')]: 'inexistente' },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'X', f9999: 'y' } }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('update mergea parcialmente y null borra la clave', async () => {
        const rec = await service.create(tenantA, admin, 'clientes', {
            data: { [key('nombre')]: 'ACME', [key('monto')]: 500 },
        });
        const upd = await service.update(tenantA, admin, 'clientes', rec.id, {
            data: { [key('monto')]: null, [key('estado')]: 'baja' },
        });
        expect(upd.data[key('nombre')]).toBe('ACME'); // intacto
        expect(key('monto') in upd.data).toBe(false); // borrado
        expect(upd.data[key('estado')]).toBe('baja');
    });

    it('get y soft-delete', async () => {
        const rec = await service.create(tenantA, admin, 'clientes', { data: { [key('nombre')]: 'X' } });
        expect((await service.get(tenantA, admin, 'clientes', rec.id)).id).toBe(rec.id);
        await service.remove(tenantA, admin, 'clientes', rec.id);
        await expect(service.get(tenantA, admin, 'clientes', rec.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    async function seed(): Promise<void> {
        const rows: Array<Record<string, unknown>> = [
            { [key('nombre')]: 'Alpha', [key('monto')]: 100, [key('estado')]: 'activo', [key('tags')]: ['web'], [key('vence')]: '2026-01-10' },
            { [key('nombre')]: 'Beta', [key('monto')]: 500, [key('estado')]: 'activo', [key('tags')]: ['web', 'hosting'], [key('vence')]: '2026-06-20' },
            { [key('nombre')]: 'Gamma', [key('monto')]: 900, [key('estado')]: 'baja', [key('tags')]: ['hosting'], [key('vence')]: '2026-12-31' },
        ];
        for (const data of rows) await service.create(tenantA, admin, 'clientes', { data });
    }

    const filter = (children: unknown[], logic = 'and') => ({ type: 'group', logic, children }) as never;
    const cond = (slug: string, op: string, value?: unknown) =>
        ({ type: 'condition', field_id: fieldByType[slug]!.id, op, value });

    it('filtro: comparación numérica tipada (gte)', async () => {
        await seed();
        const page = await service.list(tenantA, admin, 'clientes', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: filter([cond('monto', 'gte', 500)]),
        });
        expect(page.data.map((r) => r.data[key('nombre')])).toEqual(['Beta', 'Gamma']);
    });

    it('filtro: select eq + text contains combinados con AND', async () => {
        await seed();
        const page = await service.list(tenantA, admin, 'clientes', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: filter([cond('estado', 'eq', 'activo'), cond('nombre', 'contains', 'lph')]),
        });
        expect(page.data.map((r) => r.data[key('nombre')])).toEqual(['Alpha']);
    });

    it('filtro: multi_select contains (pertenencia al array)', async () => {
        await seed();
        const page = await service.list(tenantA, admin, 'clientes', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: filter([cond('tags', 'contains', 'hosting')]),
        });
        expect(page.data.map((r) => r.data[key('nombre')]).sort()).toEqual(['Beta', 'Gamma']);
    });

    it('filtro: OR anidado', async () => {
        await seed();
        const page = await service.list(tenantA, admin, 'clientes', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: filter([cond('nombre', 'eq', 'Alpha'), cond('nombre', 'eq', 'Gamma')], 'or'),
        });
        expect(page.data.map((r) => r.data[key('nombre')]).sort()).toEqual(['Alpha', 'Gamma']);
    });

    it('filtro: date between_relative (this_year) se resuelve contra now', async () => {
        await seed();
        const page = await service.list(tenantA, admin, 'clientes', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: filter([cond('vence', 'between_relative', 'this_year')]),
        });
        // now real: 2026-07-08 en el entorno → todas las fechas 2026 entran.
        expect(page.data).toHaveLength(3);
    });

    it('cursor pagination keyset por id', async () => {
        await seed();
        const first = await service.list(tenantA, admin, 'clientes', { limit: 2, sort_dir: 'asc' });
        expect(first.data).toHaveLength(2);
        expect(first.meta.next_cursor).not.toBeNull();

        const second = await service.list(tenantA, admin, 'clientes', {
            limit: 2,
            sort_dir: 'asc',
            cursor: Number(first.meta.next_cursor),
        });
        expect(second.data).toHaveLength(1);
        expect(second.meta.next_cursor).toBeNull();
    });

    it('own-scoping: agent solo ve/edita/borra sus registros', async () => {
        const ana: Actor = { userId: 1, role: 'agent' };
        const beto: Actor = { userId: 2, role: 'agent' };
        const recAna = await service.create(tenantA, ana, 'clientes', { data: { [key('nombre')]: 'DeAna' } });
        await service.create(tenantA, beto, 'clientes', { data: { [key('nombre')]: 'DeBeto' } });

        const anaSees = await service.list(tenantA, ana, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(anaSees.data.map((r) => r.data[key('nombre')])).toEqual(['DeAna']);

        // admin ve todos.
        const adminSees = await service.list(tenantA, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(adminSees.data).toHaveLength(2);

        // Beto no puede tocar el registro de Ana (404, no filtra info).
        await expect(
            service.update(tenantA, beto, 'clientes', recAna.id, { data: { [key('nombre')]: 'hack' } }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aislamiento RLS: los records no cruzan de tenant', async () => {
        await seed();
        await listsService.create(tenantB, { name: 'Clientes' });
        const other = await service.list(tenantB, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(other.data).toHaveLength(0);
    });
});
