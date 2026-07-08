import { Injectable, UnauthorizedException } from '@nestjs/common';
import { capabilitiesMap, type Bootstrap, type FieldType, type ViewType } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { tenants, users } from '../db/schema';
import { FieldsRepository } from '../fields/fields.repository';
import { ListsRepository } from '../lists/lists.repository';
import type { TenantContext } from '../tenancy/tenant.guard';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ViewsRepository } from '../views/views.repository';

/**
 * Arma el payload de bootstrap en UNA transacción (sin N+1): workspace + user
 * + lists + fields + views + capabilities. Primer paint con 1 round-trip
 * (STANDALONE §6 / HANDOFF §2.2).
 */
@Injectable()
export class BootstrapService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsRepository,
        private readonly fields: FieldsRepository,
        private readonly views: ViewsRepository,
    ) {}

    async build(userId: number, ctx: TenantContext): Promise<Bootstrap> {
        return this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
            if (!user) throw new UnauthorizedException('Usuario inexistente');
            const [tenant] = await tx
                .select()
                .from(tenants)
                .where(eq(tenants.id, ctx.tenantId))
                .limit(1);
            if (!tenant) throw new UnauthorizedException('Workspace inexistente');

            // Secuencial a propósito: una transacción es una sola conexión;
            // queries concurrentes sobre el mismo tx no son seguras.
            const listRows = await this.lists.listAll(tx, ctx.tenantId);
            const fieldRows = await this.fields.listByTenant(tx, ctx.tenantId);
            const viewRows = await this.views.listByTenant(tx, ctx.tenantId);

            return {
                user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
                tenant: {
                    id: tenant.id,
                    slug: tenant.slug,
                    name: tenant.name,
                    plan: tenant.plan,
                    settings: tenant.settings,
                    role: ctx.role,
                },
                capabilities: capabilitiesMap(ctx.role),
                lists: listRows.map((l) => ({
                    id: l.id,
                    slug: l.slug,
                    name: l.name,
                    icon: l.icon,
                    color: l.color,
                    settings: l.settings,
                    position: l.position,
                })),
                fields: fieldRows.map((f) => ({
                    id: f.id,
                    list_id: f.listId,
                    slug: f.slug,
                    label: f.label,
                    type: f.type as FieldType,
                    config: f.config,
                    is_required: f.isRequired,
                    is_unique: f.isUnique,
                    is_indexed: f.isIndexed,
                    position: f.position,
                })),
                views: viewRows.map((v) => ({
                    id: v.id,
                    list_id: v.listId,
                    name: v.name,
                    type: v.type as ViewType,
                    config: v.config,
                    is_default: v.isDefault,
                    position: v.position,
                })),
            };
        });
    }
}
