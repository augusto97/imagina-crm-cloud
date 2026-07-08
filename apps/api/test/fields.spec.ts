import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime no-op para tests unitarios (sin servidor socket → no emite). */
const rt = new RealtimeService();

describe('FieldsService (Postgres real + RLS)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let service: FieldsService;
    let tenantA: number;
    let tenantB: number;
    let listA: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        service = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(fields).where(eq(fields.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        const l = await listsService.create(tenantA, { name: 'Clientes' });
        listA = l.id;
    });

    it('create genera slug del label, asigna tipo y posición incremental', async () => {
        const nombre = await service.create(tenantA, 'clientes', { label: 'Nombre', type: 'text' });
        expect(nombre).toMatchObject({ slug: 'nombre', type: 'text', position: 0, list_id: listA });

        const monto = await service.create(tenantA, 'clientes', { label: 'Monto', type: 'currency' });
        expect(monto.position).toBe(1);
    });

    it('config se valida contra el schema del tipo y se normaliza', async () => {
        const estado = await service.create(tenantA, 'clientes', {
            label: 'Estado',
            type: 'select',
            config: { options: [{ value: 'activo', label: 'Activo', color: 'green' }] },
        });
        expect(estado.config).toEqual({
            options: [{ value: 'activo', label: 'Activo', color: 'green' }],
        });

        // currency inyecta el default de moneda.
        const precio = await service.create(tenantA, 'clientes', { label: 'Precio', type: 'currency' });
        expect(precio.config).toMatchObject({ currency: 'USD' });
    });

    it('config inválida para el tipo → 400', async () => {
        await expect(
            service.create(tenantA, 'clientes', {
                label: 'Malo',
                type: 'select',
                config: { options: 'no-es-array' },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('slug de campo único POR LISTA (no global): colisión → sufijo _2', async () => {
        const a = await service.create(tenantA, 'clientes', { label: 'Tel', type: 'text' });
        const b = await service.create(tenantA, 'clientes', { label: 'Tel', type: 'text' });
        expect([a.slug, b.slug]).toEqual(['tel', 'tel_2']);

        // El mismo slug convive en OTRA lista del mismo tenant.
        const otra = await listsService.create(tenantA, { name: 'Proveedores' });
        const c = await service.create(tenantA, String(otra.id), { label: 'Tel', type: 'text' });
        expect(c.slug).toBe('tel');
    });

    it('slug explícito duplicado en la lista → 409', async () => {
        await service.create(tenantA, 'clientes', { label: 'A', type: 'text', slug: 'compartido' });
        await expect(
            service.create(tenantA, 'clientes', { label: 'B', type: 'text', slug: 'compartido' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('list, get por id y por slug', async () => {
        const f = await service.create(tenantA, 'clientes', { label: 'Email', type: 'email' });
        expect((await service.list(tenantA, 'clientes')).map((x) => x.slug)).toEqual(['email']);
        expect((await service.get(tenantA, 'clientes', String(f.id))).id).toBe(f.id);
        expect((await service.get(tenantA, 'clientes', 'email')).id).toBe(f.id);
    });

    it('update renombra, cambia config y togglea is_indexed (el tipo es inmutable)', async () => {
        await service.create(tenantA, 'clientes', { label: 'Score', type: 'number' });
        const updated = await service.update(tenantA, 'clientes', 'score', {
            label: 'Puntaje',
            slug: 'puntaje',
            config: { min: 0, max: 100 },
            is_indexed: true,
        });
        expect(updated).toMatchObject({
            label: 'Puntaje',
            slug: 'puntaje',
            type: 'number',
            is_indexed: true,
        });
        expect(updated.config).toEqual({ min: 0, max: 100 });
    });

    it('reorder reordena por posición y valida ids', async () => {
        const a = await service.create(tenantA, 'clientes', { label: 'A', type: 'text' });
        const b = await service.create(tenantA, 'clientes', { label: 'B', type: 'text' });
        const c = await service.create(tenantA, 'clientes', { label: 'C', type: 'text' });

        const reordered = await service.reorder(tenantA, 'clientes', [c.id, a.id, b.id]);
        expect(reordered.map((f) => f.slug)).toEqual(['c', 'a', 'b']);
        expect(reordered.map((f) => f.position)).toEqual([0, 1, 2]);

        // ids ajenos o duplicados → 400.
        await expect(service.reorder(tenantA, 'clientes', [a.id, a.id, b.id])).rejects.toBeInstanceOf(
            BadRequestException,
        );
        await expect(service.reorder(tenantA, 'clientes', [a.id, 999999])).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    it('remove elimina el campo', async () => {
        await service.create(tenantA, 'clientes', { label: 'Temp', type: 'text' });
        await service.remove(tenantA, 'clientes', 'temp');
        await expect(service.get(tenantA, 'clientes', 'temp')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aislamiento RLS: no se pueden ver/tocar campos de otra lista/tenant', async () => {
        await service.create(tenantA, 'clientes', { label: 'Secreto', type: 'text' });
        // tenantB tiene su propia lista 'clientes' (vacía): no ve la de tenantA.
        const listB = await listsService.create(tenantB, { name: 'Clientes' });
        expect(await service.list(tenantB, String(listB.id))).toHaveLength(0);

        // tenantB no puede resolver la lista de tenantA por su id → 404.
        await expect(service.list(tenantB, String(listA))).rejects.toBeInstanceOf(NotFoundException);
        // …ni pedir un campo de esa lista.
        await expect(service.get(tenantB, String(listA), 'secreto')).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });
});
