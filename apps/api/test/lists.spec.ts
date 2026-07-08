import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Role } from '@imagina-base/shared';
import { roleHasCapability } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lists, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime no-op para tests unitarios (sin servidor socket → no emite). */
const rt = new RealtimeService();

describe('ListsService (Postgres real + RLS)', () => {
    let pg: TestPg;
    let service: ListsService;
    let tenantA: number;
    let tenantB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        service = new ListsService(new TenantDb(pg.db), new ListsRepository(), rt);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        // Limpia listas de ambos tenants entre tests (dentro de su contexto RLS).
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, (tx) => tx.delete(lists).where(eq(lists.tenantId, t)));
        }
    });

    it('create genera slug del nombre y asigna posición incremental', async () => {
        const clientes = await service.create(tenantA, { name: 'Clientes Activos' });
        expect(clientes.slug).toBe('clientes_activos');
        expect(clientes.position).toBe(0);

        const proyectos = await service.create(tenantA, { name: 'Proyectos' });
        expect(proyectos.position).toBe(1);
    });

    it('create resuelve colisión de slug con sufijo _2, _3', async () => {
        const a = await service.create(tenantA, { name: 'Tareas' });
        const b = await service.create(tenantA, { name: 'Tareas' });
        const c = await service.create(tenantA, { name: 'Tareas' });
        expect([a.slug, b.slug, c.slug]).toEqual(['tareas', 'tareas_2', 'tareas_3']);
    });

    it('create con slug explícito duplicado → 409', async () => {
        await service.create(tenantA, { name: 'Uno', slug: 'compartido' });
        await expect(
            service.create(tenantA, { name: 'Dos', slug: 'compartido' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('slug generado que choca con reservado se prefija (lista "Records" → lista_records)', async () => {
        const l = await service.create(tenantA, { name: 'Records' });
        expect(l.slug).toBe('lista_records');
    });

    it('list devuelve las listas del tenant ordenadas por posición', async () => {
        await service.create(tenantA, { name: 'Primera' });
        await service.create(tenantA, { name: 'Segunda' });
        const all = await service.list(tenantA);
        expect(all.map((l) => l.name)).toEqual(['Primera', 'Segunda']);
    });

    it('get resuelve por id numérico y por slug', async () => {
        const created = await service.create(tenantA, { name: 'Contactos' });
        expect((await service.get(tenantA, String(created.id))).id).toBe(created.id);
        expect((await service.get(tenantA, 'contactos')).id).toBe(created.id);
    });

    it('get de lista inexistente → 404', async () => {
        await expect(service.get(tenantA, 'no_existe')).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.get(tenantA, '999999')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('update renombra name y slug', async () => {
        const created = await service.create(tenantA, { name: 'Viejo' });
        const updated = await service.update(tenantA, created.slug, {
            name: 'Nuevo',
            slug: 'nuevo_slug',
        });
        expect(updated).toMatchObject({ id: created.id, name: 'Nuevo', slug: 'nuevo_slug' });
        // El id es la verdad: sigue siendo resoluble por el slug nuevo.
        expect((await service.get(tenantA, 'nuevo_slug')).id).toBe(created.id);
    });

    it('update a un slug ya usado por otra lista → 409', async () => {
        await service.create(tenantA, { name: 'Ocupado', slug: 'ocupado' });
        const otra = await service.create(tenantA, { name: 'Otra' });
        await expect(
            service.update(tenantA, otra.slug, { slug: 'ocupado' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('update al MISMO slug (sin cambio real) no dispara conflicto', async () => {
        const l = await service.create(tenantA, { name: 'Estable', slug: 'estable' });
        const updated = await service.update(tenantA, l.slug, { slug: 'estable', name: 'Estable v2' });
        expect(updated.name).toBe('Estable v2');
    });

    it('remove elimina la lista', async () => {
        const l = await service.create(tenantA, { name: 'Descartable' });
        await service.remove(tenantA, l.slug);
        await expect(service.get(tenantA, l.slug)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aislamiento RLS: el mismo slug convive en dos tenants y no se filtran', async () => {
        const a = await service.create(tenantA, { name: 'Clientes' });
        const b = await service.create(tenantB, { name: 'Clientes' });
        expect(a.slug).toBe('clientes');
        expect(b.slug).toBe('clientes'); // no colisiona: unicidad es por-tenant

        expect((await service.list(tenantA)).map((l) => l.id)).toEqual([a.id]);
        expect((await service.list(tenantB)).map((l) => l.id)).toEqual([b.id]);

        // tenantA no puede resolver la lista de tenantB ni por id.
        await expect(service.get(tenantA, String(b.id))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('matriz de capabilities: manage_lists solo admin/... coherente con el contrato', () => {
        const can = (r: Role) => roleHasCapability(r, 'manage_lists');
        expect(can('admin')).toBe(true);
        expect(can('manager')).toBe(false);
        expect(can('agent')).toBe(false);
        expect(can('viewer')).toBe(false);
        expect(can('client')).toBe(false);
    });
});

describe('CapabilitiesGuard', () => {
    it('deja pasar cuando el rol tiene la capability y bloquea cuando no', async () => {
        const { CapabilitiesGuard } = await import('../src/authz/capabilities.guard');
        const { Reflector } = await import('@nestjs/core');

        const reflector = new Reflector();
        const guard = new CapabilitiesGuard(reflector);

        const ctxFor = (role: Role | undefined) =>
            ({
                switchToHttp: () => ({ getRequest: () => ({ tenant: role ? { role } : undefined }) }),
                getHandler: () => ({}),
                getClass: () => ({}),
            }) as never;

        // Sin metadata de capability → siempre pasa.
        expect(guard.canActivate(ctxFor('viewer'))).toBe(true);

        // Con metadata ['manage_lists'] (el guard acepta un array — OR).
        reflector.getAllAndOverride = (() => ['manage_lists']) as never;
        expect(guard.canActivate(ctxFor('admin'))).toBe(true);
        expect(() => guard.canActivate(ctxFor('viewer'))).toThrow(ForbiddenException);
        expect(() => guard.canActivate(ctxFor(undefined))).toThrow(ForbiddenException);

        // OR: basta con tener UNA de las capabilities aceptadas.
        reflector.getAllAndOverride = (() => ['view_records', 'view_own_records']) as never;
        expect(guard.canActivate(ctxFor('agent'))).toBe(true); // solo tiene view_own_records
        expect(guard.canActivate(ctxFor('viewer'))).toBe(true); // tiene view_records
    });
});
