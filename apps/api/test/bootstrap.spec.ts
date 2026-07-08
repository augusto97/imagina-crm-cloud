import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '@imagina-base/shared';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { BootstrapService } from '../src/bootstrap/bootstrap.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { SlugsService } from '../src/slugs/slugs.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime no-op para tests unitarios (sin servidor socket → no emite). */
const rt = new RealtimeService();

describe('Bootstrap + Slugs (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let viewsService: ViewsService;
    let bootstrap: BootstrapService;
    let slugs: SlugsService;
    let tenantId: number;
    let userId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        viewsService = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);
        bootstrap = new BootstrapService(
            tenantDb,
            new ListsRepository(),
            new FieldsRepository(),
            new ViewsRepository(),
        );
        slugs = new SlugsService(tenantDb, new ListsRepository(), new FieldsRepository());

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db
            .insert(users)
            .values({ email: 'a@acme.test', passwordHash: 'x', name: 'Ana' })
            .returning();
        userId = u!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId, tenantId, role: 'admin' }),
        );

        // Semilla: 2 listas, campos y una vista default.
        await listsService.create(tenantId, { name: 'Clientes' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Monto', type: 'currency' });
        await viewsService.create(tenantId, 'clientes', {
            name: 'Tabla',
            type: 'table',
            is_default: true,
        });
        await listsService.create(tenantId, { name: 'Proyectos' });
        await fieldsService.create(tenantId, 'proyectos', { label: 'Título', type: 'text' });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('bootstrap devuelve workspace+user+lists+fields+views+capabilities y valida el schema', async () => {
        const payload = await bootstrap.build(userId, {
            tenantId,
            tenantSlug: 'acme',
            role: 'admin',
        });

        // El shape completo cumple el schema compartido (contrato front↔back).
        expect(bootstrapSchema.parse(payload)).toBeTruthy();

        expect(payload.user.email).toBe('a@acme.test');
        expect(payload.tenant).toMatchObject({ slug: 'acme', role: 'admin' });
        expect(payload.capabilities.manage_lists).toBe(true);
        expect(payload.lists.map((l) => l.slug).sort()).toEqual(['clientes', 'proyectos']);
        expect(payload.fields).toHaveLength(3);
        expect(payload.views).toHaveLength(1);
        expect(payload.views[0]!.is_default).toBe(true);
    });

    it('slugs/check: formato, reservado, disponible y tomado', async () => {
        expect(await slugs.check(tenantId, { type: 'list', slug: 'Mal Formato' })).toEqual({
            available: false,
            reason: 'format',
        });
        expect(await slugs.check(tenantId, { type: 'list', slug: 'records' })).toEqual({
            available: false,
            reason: 'reserved',
        });
        expect(await slugs.check(tenantId, { type: 'list', slug: 'clientes' })).toEqual({
            available: false,
            reason: 'taken',
        });
        expect(await slugs.check(tenantId, { type: 'list', slug: 'nuevo' })).toEqual({
            available: true,
        });
    });

    it('slugs/check de campo: unicidad por lista', async () => {
        const list = await listsService.get(tenantId, 'clientes');
        expect(
            await slugs.check(tenantId, { type: 'field', slug: 'nombre', list_id: list.id }),
        ).toEqual({ available: false, reason: 'taken' });
        // El mismo slug está libre en otra lista.
        const proyectos = await listsService.get(tenantId, 'proyectos');
        expect(
            await slugs.check(tenantId, { type: 'field', slug: 'nombre', list_id: proyectos.id }),
        ).toEqual({ available: true });
    });
});
