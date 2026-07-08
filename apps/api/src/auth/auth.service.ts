import {
    ConflictException,
    Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import {
    slugifyTenant,
    type AuthSession,
    type LoginInput,
    type MembershipSummary,
    type RegisterInput,
    type SessionUser,
} from '@imagina-crm/shared';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { memberships, tenants, users } from '../db/schema';
import { withUser } from '../db/tenant-tx';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly sessions: SessionService,
    ) {}

    /**
     * Alta de usuario + su primer workspace + membership admin, en UNA
     * transacción. La membership exige `app.tenant_id`/`app.user_id` en el
     * contexto (WITH CHECK de las policies RLS).
     */
    async register(input: RegisterInput): Promise<AuthSession> {
        const passwordHash = await argon2.hash(input.password);

        const result = await this.db.transaction(async (tx) => {
            const existing = await tx
                .select({ id: users.id })
                .from(users)
                .where(sql`lower(${users.email}) = ${input.email}`)
                .limit(1);
            if (existing.length > 0) {
                throw new ConflictException('Ya existe una cuenta con ese email');
            }

            const [user] = await tx
                .insert(users)
                .values({ email: input.email, passwordHash, name: input.name })
                .returning();
            if (!user) {
                throw new Error('Insert de usuario no devolvió fila');
            }

            const slug = await this.availableTenantSlug(tx, slugifyTenant(input.workspace_name));
            const [tenant] = await tx
                .insert(tenants)
                .values({ slug, name: input.workspace_name })
                .returning();
            if (!tenant) {
                throw new Error('Insert de tenant no devolvió fila');
            }

            // La membership se inserta bajo el rol de app + contexto RLS
            // completo: el WITH CHECK de las policies aplica de verdad.
            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.user_id', ${String(user.id)}, true)`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenant.id)}, true)`);
            await tx
                .insert(memberships)
                .values({ userId: user.id, tenantId: tenant.id, role: 'admin' });

            return { user, tenant };
        });

        const token = await this.sessions.create(result.user.id);
        return {
            user: this.toSessionUser(result.user),
            memberships: [
                {
                    tenant_id: result.tenant.id,
                    tenant_slug: result.tenant.slug,
                    tenant_name: result.tenant.name,
                    role: 'admin',
                },
            ],
            token,
        };
    }

    async login(input: LoginInput): Promise<AuthSession> {
        const [user] = await this.db
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = ${input.email}`)
            .limit(1);

        // argon2.verify corre igual con hash dummy: mismo timing con o sin usuario.
        const hash =
            user?.passwordHash ??
            '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const valid = await argon2.verify(hash, input.password).catch(() => false);
        if (!user || !valid) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const token = await this.sessions.create(user.id);
        return {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id),
            token,
        };
    }

    async me(userId: number): Promise<AuthSession> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) {
            throw new UnauthorizedException('Usuario inexistente');
        }
        return {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id),
        };
    }

    async logout(token: string): Promise<void> {
        await this.sessions.destroy(token);
    }

    async membershipsOf(userId: number): Promise<MembershipSummary[]> {
        return withUser(this.db, userId, async (tx) => {
            const rows = await tx
                .select({
                    tenantId: memberships.tenantId,
                    role: memberships.role,
                    tenantSlug: tenants.slug,
                    tenantName: tenants.name,
                })
                .from(memberships)
                .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
                .where(eq(memberships.userId, userId));
            return rows.map((r) => ({
                tenant_id: r.tenantId,
                tenant_slug: r.tenantSlug,
                tenant_name: r.tenantName,
                role: r.role,
            }));
        });
    }

    private toSessionUser(user: typeof users.$inferSelect): SessionUser {
        return { id: user.id, email: user.email, name: user.name, locale: user.locale };
    }

    /** Colisión de slug de workspace → sufijo `-2`, `-3`, … (CONTRACT.md §2). */
    private async availableTenantSlug(tx: Tx, base: string): Promise<string> {
        for (let i = 0; i < 100; i++) {
            const candidate = i === 0 ? base : `${base.slice(0, 60)}-${i + 1}`;
            const [existing] = await tx
                .select({ id: tenants.id })
                .from(tenants)
                .where(eq(tenants.slug, candidate))
                .limit(1);
            if (!existing) {
                return candidate;
            }
        }
        throw new ConflictException('No se pudo generar un slug de workspace disponible');
    }
}
