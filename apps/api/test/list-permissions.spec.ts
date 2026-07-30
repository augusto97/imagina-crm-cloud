import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, memberships, records, tenants, users } from '../src/db/schema';
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

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };
const viewer: Actor = { userId: 3, role: 'viewer' };

describe('ACL por lista (permisos por rol)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let tenantId: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            { label: 'Responsable', type: 'user', slug: 'responsable' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields_.create(tenantId, 'clientes', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;
    const seed = async () => {
        await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'A', [key('monto')]: 100 } });
        await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'B', [key('monto')]: 200 } });
        await recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'C', [key('monto')]: 300 } });
    };

    it('defaults: agent ve solo lo suyo, viewer ve todo, admin ve todo', async () => {
        await seed();
        const asAgent = await recs.list(tenantId, agent, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asAgent.data.map((r) => r.data[key('nombre')])).toEqual(['C']);
        const asViewer = await recs.list(tenantId, viewer, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asViewer.data).toHaveLength(3);
        const asAdmin = await recs.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asAdmin.data).toHaveLength(3);
    });

    it('view=none deniega la lectura al rol', async () => {
        await seed();
        await lists_.updatePermissions(tenantId, 'clientes', {
            permissions: { viewer: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });
        const asViewer = await recs.list(tenantId, viewer, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asViewer.data).toHaveLength(0);
    });

    it('view=all deja al agent ver todos', async () => {
        await seed();
        await lists_.updatePermissions(tenantId, 'clientes', {
            permissions: { agent: { view: 'all', create: true, edit: 'own', delete: 'own', fields_hidden: [] } },
        });
        const asAgent = await recs.list(tenantId, agent, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asAgent.data).toHaveLength(3);
    });

    it('create=false bloquea la creación (403)', async () => {
        // viewer.create default = false.
        await expect(
            recs.create(tenantId, viewer, 'clientes', { data: { [key('nombre')]: 'X' } }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fields_hidden oculta el campo en las respuestas', async () => {
        await seed();
        await lists_.updatePermissions(tenantId, 'clientes', {
            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['monto'] } },
        });
        const asViewer = await recs.list(tenantId, viewer, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asViewer.data).toHaveLength(3);
        for (const r of asViewer.data) {
            expect(r.data[key('monto')]).toBeUndefined();
            expect(r.data[key('nombre')]).toBeDefined();
        }
    });

    it('scope=assigned: el agent ve los registros donde es responsable', async () => {
        // Registros con responsable = agent.userId (2) vs admin (1).
        await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'mío', [key('responsable')]: agent.userId } });
        await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'ajeno', [key('responsable')]: admin.userId } });
        await lists_.updatePermissions(tenantId, 'clientes', {
            assignment_field_id: f.responsable!.id,
            permissions: { agent: { view: 'assigned', create: true, edit: 'assigned', delete: 'none', fields_hidden: [] } },
        });
        const asAgent = await recs.list(tenantId, agent, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(asAgent.data.map((r) => r.data[key('nombre')])).toEqual(['mío']);
    });

    it('getPermissions devuelve el doc con roles configurables', async () => {
        const doc = await lists_.getPermissions(tenantId, 'clientes');
        expect(doc.roles.map((r) => r.slug).sort()).toEqual(['agent', 'manager', 'viewer']);
        expect(doc.permissions.agent!.view).toBe('own'); // default
    });

    describe('compartir con una persona puntual (v0.1.138)', () => {
        // El acceso por persona vive en el ACL de la lista y sólo admite
        // MIEMBROS de la empresa (si no, cualquier id quedaría con acceso).
        let socia: Actor;

        beforeAll(async () => {
            // Los ids de `users` son identity: se insertan primero unos
            // rellenos para que el id de la socia NO choque con los actores
            // del spec (admin=1, agent=2, viewer=3), que no existen como
            // filas y arrancarían la secuencia en 1.
            await pg.db.insert(users).values([
                { email: 'filler1@acme.test', name: 'F1', passwordHash: 'x' },
                { email: 'filler2@acme.test', name: 'F2', passwordHash: 'x' },
                { email: 'filler3@acme.test', name: 'F3', passwordHash: 'x' },
            ]);
            const [u] = await pg.db
                .insert(users)
                .values({ email: 'socia@acme.test', name: 'Socia', passwordHash: 'x' })
                .returning();
            socia = { userId: u!.id, role: 'agent' };
            await pg.db.insert(memberships).values({ tenantId, userId: u!.id, role: 'agent' });
        });

        it('el acceso por persona pisa el de su rol en ESTA lista', async () => {
            await seed();
            // Por rol, un agent sólo ve lo que creó — y ella no creó nada.
            const antes = await recs.list(tenantId, socia, 'clientes', { limit: 50, sort_dir: 'asc' });
            expect(antes.data).toHaveLength(0);

            await lists_.updatePermissions(tenantId, 'clientes', {
                users: {
                    [String(socia.userId)]: {
                        view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [],
                    },
                },
            });

            const despues = await recs.list(tenantId, socia, 'clientes', { limit: 50, sort_dir: 'asc' });
            expect(despues.data).toHaveLength(3);
            // El rol quedó intacto: es un acceso de esta lista, no del workspace.
            const doc = await lists_.getPermissions(tenantId, 'clientes');
            expect(doc.permissions.agent!.view).toBe('own');
            expect(doc.users).toEqual([
                expect.objectContaining({ user_id: socia.userId, name: 'Socia', email: 'socia@acme.test' }),
            ]);
            // Y otro agent sin acceso propio sigue viendo sólo lo suyo.
            const otro = await recs.list(tenantId, agent, 'clientes', { limit: 50, sort_dir: 'asc' });
            expect(otro.data).toHaveLength(1);
        });

        it('quitar a la persona la devuelve al acceso de su rol', async () => {
            await seed();
            await lists_.updatePermissions(tenantId, 'clientes', {
                users: {
                    [String(socia.userId)]: {
                        view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [],
                    },
                },
            });
            await lists_.updatePermissions(tenantId, 'clientes', { users: {} });

            const despues = await recs.list(tenantId, socia, 'clientes', { limit: 50, sort_dir: 'asc' });
            expect(despues.data).toHaveLength(0);
            expect((await lists_.getPermissions(tenantId, 'clientes')).users).toEqual([]);
        });

        it('no se puede compartir con alguien que no es de la empresa', async () => {
            await expect(
                lists_.updatePermissions(tenantId, 'clientes', {
                    users: {
                        '99999': { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] },
                    },
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('el acceso por persona también puede RESTRINGIR (y ocultar campos)', async () => {
            await seed();
            await lists_.updatePermissions(tenantId, 'clientes', {
                permissions: {
                    agent: { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] },
                },
                users: {
                    [String(socia.userId)]: {
                        view: 'all', create: false, edit: 'none', delete: 'none',
                        fields_hidden: ['monto'],
                    },
                },
            });

            const page = await recs.list(tenantId, socia, 'clientes', { limit: 50, sort_dir: 'asc' });
            expect(page.data).toHaveLength(3);
            for (const r of page.data) expect(r.data[key('monto')]).toBeUndefined();
            await expect(
                recs.create(tenantId, socia, 'clientes', { data: { [key('nombre')]: 'X' } }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });
});
