import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { MembersRepository } from '../src/members/members.repository';
import { MembersService } from '../src/members/members.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

describe('MembersService (Postgres real, RLS)', () => {
    let pg: TestPg;
    let members: MembersService;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        members = new MembersService(new TenantDb(pg.db), new MembersRepository());
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    async function makeUser(name: string): Promise<{ id: number; email: string }> {
        counter += 1;
        const email = `${name}-${counter}@acme.test`;
        const [u] = await pg.db
            .insert(users)
            .values({ email, passwordHash: 'x', name })
            .returning();
        return { id: u!.id, email };
    }

    beforeEach(async () => {
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `acme-${counter}`, name: 'ACME', plan: 'trial', status: 'trialing' })
            .returning();
        tenantId = t!.id;
        const [o] = await pg.db
            .insert(tenants)
            .values({ slug: `other-${counter}`, name: 'Other', plan: 'trial', status: 'trialing' })
            .returning();
        otherTenantId = o!.id;

        // Un admin fundador en el tenant activo (insertado en su propio tx).
        const admin = await makeUser('admin');
        adminId = admin.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }),
        );
    });

    it('list: sólo devuelve miembros del tenant activo (RLS)', async () => {
        const bob = await makeUser('bob');
        // Miembro en OTRO tenant: no debe aparecer.
        await withTenant(pg.db, otherTenantId, (tx) =>
            tx.insert(memberships).values({ userId: bob.id, tenantId: otherTenantId, role: 'admin' }),
        );

        const list = await members.list(tenantId);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ user_id: adminId, role: 'admin' });
        expect(list.some((m) => m.user_id === bob.id)).toBe(false);
    });

    it('add: suma un usuario registrado por email', async () => {
        const bob = await makeUser('bob');
        const added = await members.add(tenantId, { email: bob.email, role: 'manager' });
        expect(added).toMatchObject({ user_id: bob.id, role: 'manager' });
        expect(await members.list(tenantId)).toHaveLength(2);
    });

    it('add: 422 si el email no está registrado', async () => {
        await expect(members.add(tenantId, { email: 'ghost@acme.test', role: 'agent' })).rejects.toBeInstanceOf(
            UnprocessableEntityException,
        );
    });

    it('add: 409 si ya es miembro', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'agent' });
        await expect(members.add(tenantId, { email: bob.email, role: 'viewer' })).rejects.toBeInstanceOf(
            ConflictException,
        );
    });

    it('updateRole: cambia el rol de un miembro', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'agent' });
        const updated = await members.updateRole(tenantId, bob.id, { role: 'manager' });
        expect(updated.role).toBe('manager');
    });

    it('updateRole: 409 si degrada al último admin', async () => {
        await expect(members.updateRole(tenantId, adminId, { role: 'viewer' })).rejects.toBeInstanceOf(
            ConflictException,
        );
    });

    it('updateRole: permite degradar un admin si queda otro', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'admin' });
        const updated = await members.updateRole(tenantId, bob.id, { role: 'viewer' });
        expect(updated.role).toBe('viewer');
    });

    it('remove: quita a un miembro', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'agent' });
        await members.remove(tenantId, adminId, bob.id);
        expect(await members.list(tenantId)).toHaveLength(1);
    });

    it('remove: 403 al quitarse a uno mismo', async () => {
        await expect(members.remove(tenantId, adminId, adminId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('remove: 409 al quitar al último admin', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'admin' });
        // bob es admin; quitar al admin fundador deja a bob → permitido.
        await members.remove(tenantId, bob.id, adminId);
        // ahora bob es el único admin: quitarlo (por otro admin ficticio) falla.
        await expect(members.remove(tenantId, 999999, bob.id)).rejects.toBeInstanceOf(ConflictException);
    });
});
