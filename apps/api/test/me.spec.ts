import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

describe('MeService (Postgres real, RLS)', () => {
    let pg: TestPg;
    let me: MeService;
    let tenantId: number;
    let otherTenantId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        me = new MeService(pg.db, new TenantDb(pg.db), new MeRepository());
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    async function makeUser(name: string, opts?: { disabled?: boolean }): Promise<{ id: number; email: string }> {
        counter += 1;
        const email = `${name.toLowerCase().replace(/\s+/g, '.')}-${counter}@acme.test`;
        const [u] = await pg.db
            .insert(users)
            .values({
                email,
                passwordHash: 'x',
                name,
                disabledAt: opts?.disabled ? new Date() : null,
            })
            .returning();
        return { id: u!.id, email };
    }

    async function addMember(userId: number, toTenant: number): Promise<void> {
        await withTenant(pg.db, toTenant, (tx) =>
            tx.insert(memberships).values({ userId, tenantId: toTenant, role: 'agent' }),
        );
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
    });

    describe('users-search', () => {
        it('encuentra un miembro por substring del nombre (case-insensitive)', async () => {
            const ana = await makeUser('Ana Martínez');
            await addMember(ana.id, tenantId);

            const results = await me.searchUsers(tenantId, 'martí');
            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                id: ana.id,
                login: ana.email,
                display_name: 'Ana Martínez',
                avatar_url: '',
            });
        });

        it('encuentra un miembro por substring del email', async () => {
            const bob = await makeUser('Bob');
            await addMember(bob.id, tenantId);

            const byEmail = await me.searchUsers(tenantId, bob.email.slice(0, 8));
            expect(byEmail.map((u) => u.id)).toContain(bob.id);
        });

        it('query vacío o de espacios devuelve [] sin buscar', async () => {
            const bob = await makeUser('Bob');
            await addMember(bob.id, tenantId);

            expect(await me.searchUsers(tenantId, '')).toEqual([]);
            expect(await me.searchUsers(tenantId, '   ')).toEqual([]);
        });

        it('NO devuelve usuarios de otro tenant (aislamiento)', async () => {
            const alien = await makeUser('Zoe Ajena');
            await addMember(alien.id, otherTenantId);

            expect(await me.searchUsers(tenantId, 'zoe')).toEqual([]);
            // Y desde su propio tenant sí aparece (sanity check).
            const own = await me.searchUsers(otherTenantId, 'zoe');
            expect(own.map((u) => u.id)).toContain(alien.id);
        });

        it('excluye cuentas desactivadas', async () => {
            // "Aa" ordena primero: si la exclusión fallara, aparecería.
            const off = await makeUser('Carlos Aa Baja', { disabled: true });
            await addMember(off.id, tenantId);
            const on = await makeUser('Carlos Zz Activo');
            await addMember(on.id, tenantId);

            const results = await me.searchUsers(tenantId, 'carlos');
            expect(results.map((u) => u.id)).toEqual([on.id]);
        });

        it('clampea el límite (mín 1) y ordena por nombre asc', async () => {
            const c = await makeUser('Dup Ccc');
            const a = await makeUser('Dup Aaa');
            await addMember(c.id, tenantId);
            await addMember(a.id, tenantId);

            const results = await me.searchUsers(tenantId, 'dup', 1);
            expect(results.map((u) => u.id)).toEqual([a.id]);
        });

        it('los comodines de LIKE se tratan como literales', async () => {
            const bob = await makeUser('Bob Porcentaje');
            await addMember(bob.id, tenantId);
            // '%' escapado: no matchea todo — sólo un nombre que lo contenga.
            expect(await me.searchUsers(tenantId, '%')).toEqual([]);
            expect(await me.searchUsers(tenantId, '_')).toEqual([]);
        });
    });

    describe('users/:id', () => {
        it('devuelve el miembro del tenant activo', async () => {
            const bob = await makeUser('Bob');
            await addMember(bob.id, tenantId);

            const user = await me.getUser(tenantId, bob.id);
            expect(user).toEqual({ id: bob.id, login: bob.email, display_name: 'Bob', avatar_url: '' });
        });

        it('404 si el usuario existe pero es de OTRO tenant (aislamiento)', async () => {
            const alien = await makeUser('Zoe Ajena');
            await addMember(alien.id, otherTenantId);

            await expect(me.getUser(tenantId, alien.id)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('404 si el usuario no existe', async () => {
            await expect(me.getUser(tenantId, 999999)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('email-signature', () => {
        it("GET default: '' cuando nunca se seteó", async () => {
            const bob = await makeUser('Bob');
            expect(await me.getEmailSignature(bob.id)).toBe('');
        });

        it('PATCH persiste y el próximo GET la devuelve', async () => {
            const bob = await makeUser('Bob');
            const firma = 'Saludos,\nBob — ACME <b>S.A.</b>';
            expect(await me.updateEmailSignature(bob.id, firma)).toBe(firma);
            expect(await me.getEmailSignature(bob.id)).toBe(firma);

            // Sobrescribir con vacío también persiste (borrar la firma).
            await me.updateEmailSignature(bob.id, '');
            expect(await me.getEmailSignature(bob.id)).toBe('');
        });

        it('la firma es por usuario (no se cruza)', async () => {
            const a = await makeUser('Alice');
            const b = await makeUser('Bob');
            await me.updateEmailSignature(a.id, 'firma de alice');
            expect(await me.getEmailSignature(b.id)).toBe('');
        });
    });
});
