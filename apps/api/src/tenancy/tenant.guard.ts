import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { memberships, tenants } from '../db/schema';
import { TenantDb } from './tenant-db.service';

export interface TenantContext {
    tenantId: number;
    tenantSlug: string;
    role: (typeof memberships.$inferSelect)['role'];
}

/**
 * Resuelve el tenant activo desde el header `X-Tenant-Id` (id numérico o
 * slug) y verifica que el usuario autenticado tenga membership. Requiere
 * SessionGuard antes en la cadena. En F1+ se suma la resolución por
 * subdominio (STANDALONE.md §4).
 */
@Injectable()
export class TenantGuard implements CanActivate {
    constructor(private readonly tenantDb: TenantDb) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const userId = req.authUserId;
        if (!userId) {
            throw new ForbiddenException('Sesión requerida antes de resolver tenant');
        }

        const raw = req.headers['x-tenant-id'];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (!value) {
            throw new BadRequestException('Falta el header X-Tenant-Id');
        }

        const membership = await this.tenantDb.withUser(userId, async (tx) => {
            const numericId = /^\d+$/.test(value) ? Number(value) : null;
            const rows = await tx
                .select({
                    tenantId: memberships.tenantId,
                    role: memberships.role,
                    tenantSlug: tenants.slug,
                })
                .from(memberships)
                .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
                .where(
                    and(
                        eq(memberships.userId, userId),
                        numericId !== null ? eq(tenants.id, numericId) : eq(tenants.slug, value),
                    ),
                )
                .limit(1);
            return rows[0] ?? null;
        });

        if (!membership) {
            throw new ForbiddenException('No sos miembro de ese workspace');
        }

        req.tenant = {
            tenantId: membership.tenantId,
            tenantSlug: membership.tenantSlug,
            role: membership.role,
        };
        return true;
    }
}
