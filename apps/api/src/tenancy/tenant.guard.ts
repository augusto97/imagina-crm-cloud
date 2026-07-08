import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { isReadOnly, type BillingStatus } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { memberships, tenants } from '../db/schema';
import { TenantDb } from './tenant-db.service';

export interface TenantContext {
    tenantId: number;
    tenantSlug: string;
    role: (typeof memberships.$inferSelect)['role'];
    status: BillingStatus;
}

/** Los magic-link / consumo del portal no pasan por acá; sí las mutaciones. */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

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
                    status: tenants.status,
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

        const status = membership.status as BillingStatus;

        // ADR-S09: impago → solo-lectura. Se bloquean las mutaciones; las
        // lecturas y el export siguen disponibles (los datos son del cliente).
        if (isReadOnly(status) && MUTATING_METHODS.has(req.method)) {
            throw new ForbiddenException({
                code: 'workspace_read_only',
                message: 'El workspace está en solo-lectura por el estado de facturación',
                data: { status: 403 },
            });
        }

        req.tenant = {
            tenantId: membership.tenantId,
            tenantSlug: membership.tenantSlug,
            role: membership.role,
            status,
        };
        return true;
    }
}
