import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    effectiveCapabilities,
    isEffectivelyReadOnly,
    MAX_RECORD_SHARES_PER_GUEST,
    type BillingStatus,
    type Capability,
    type GuestLevel,
} from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { memberships, recordShares, tenants } from '../db/schema';
import type { GuestShares } from '../lists/list-acl';
import { ALLOW_GUEST } from './allow-guest.decorator';
import { ALLOW_READ_ONLY } from './allow-read-only.decorator';
import { TenantDb } from './tenant-db.service';

export interface TenantContext {
    tenantId: number;
    tenantSlug: string;
    role: (typeof memberships.$inferSelect)['role'];
    status: BillingStatus;
    /**
     * C1 — equipos de la persona en esta empresa (acceso por equipo a las
     * listas y «los asignados» por un campo «Equipo»). Se lee UNA vez por
     * request, en la misma consulta que la membresía.
     */
    teamIds: number[];
    /** C2 — rol PROPIO de la persona (null = sólo su rol base). */
    customRoleId: number | null;
    /** C2 — capacidades EFECTIVAS (las del rol propio o las del base). */
    capabilities: Capability[];
    /** C3 — sólo invitados: los registros sueltos que le compartieron. */
    shares?: GuestShares;
}

/** Los magic-link / consumo del portal no pasan por aquí; sí las mutaciones. */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Resuelve el tenant activo desde el header `X-Tenant-Id` (id numérico o
 * slug) y verifica que el usuario autenticado tenga membership. Requiere
 * SessionGuard antes en la cadena. En F1+ se suma la resolución por
 * subdominio (STANDALONE.md §4).
 */
@Injectable()
export class TenantGuard implements CanActivate {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly reflector: Reflector,
    ) {}

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
                    archivedAt: tenants.archivedAt,
                    subscriptionEndsAt: tenants.subscriptionEndsAt,
                    paidUntil: tenants.paidUntil,
                    // C1 — `team_members_self` deja leer los equipos propios
                    // sin empresa activa (mismo plano que `memberships_self`).
                    teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
                    // C2 — rol propio: `custom_roles_self` deja leerlo sin empresa activa.
                    customRoleId: memberships.customRoleId,
                    customCaps: sql<string[] | null>`(SELECT cr.capabilities FROM custom_roles cr WHERE cr.id = ${memberships.customRoleId} AND cr.tenant_id = ${memberships.tenantId})`,
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
            throw new ForbiddenException('No eres miembro de ese workspace');
        }
        // SEC-24 (v0.1.225): el rol `client` es SÓLO portal. Sus endpoints
        // (`/portal/*`) resuelven la empresa por el vínculo, nunca por este
        // header — así que un cliente no tiene nada que hacer en la API de la
        // app (antes leía listas, campos, vistas y la configuración del portal
        // con sólo mandar X-Tenant-Id).
        if (membership.role === 'client') {
            throw new ForbiddenException({
                code: 'client_role_portal_only',
                message: 'Tu acceso a esta empresa es sólo por el portal del cliente',
                data: { status: 403 },
            });
        }

        // C3 — un INVITADO sólo usa los endpoints marcados para invitados;
        // todo lo demás le responde 403 (fail-closed).
        if (
            membership.role === 'guest' &&
            this.reflector.getAllAndOverride<boolean>(ALLOW_GUEST, [context.getHandler(), context.getClass()]) !== true
        ) {
            throw new ForbiddenException({
                code: 'guest_forbidden',
                message: 'Como invitado sólo ves lo que te compartieron',
                data: { status: 403 },
            });
        }

        const status = membership.status as BillingStatus;

        // ADR-S09: impago/archivada/suscripción-vencida → solo-lectura. Se
        // bloquean las mutaciones; las lecturas y el export siguen disponibles
        // (los datos son del cliente, nunca se secuestran).
        const readOnly = isEffectivelyReadOnly({
            status,
            archived_at: membership.archivedAt,
            subscription_ends_at: membership.subscriptionEndsAt,
            paid_until: membership.paidUntil,
        });
        const allowed =
            readOnly &&
            this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY, [context.getHandler(), context.getClass()]) === true;
        if (readOnly && MUTATING_METHODS.has(req.method) && !allowed) {
            throw new ForbiddenException({
                code: 'workspace_read_only',
                message: 'El workspace está en solo-lectura por el estado de facturación',
                data: { status: 403 },
            });
        }

        const customCaps = Array.isArray(membership.customCaps) && membership.customRoleId ? membership.customCaps : null;
        req.tenant = {
            tenantId: membership.tenantId,
            tenantSlug: membership.tenantSlug,
            role: membership.role,
            status,
            teamIds: (membership.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
            customRoleId: customCaps ? membership.customRoleId : null,
            capabilities: effectiveCapabilities(membership.role, customCaps),
            ...(membership.role === 'guest' ? { shares: await this.guestShares(membership.tenantId, userId) } : {}),
        };
        return true;
    }

    /** C3 — Registros sueltos compartidos con el invitado (tope por persona). */
    private async guestShares(tenantId: number, userId: number): Promise<GuestShares> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ recordId: recordShares.recordId, listId: recordShares.listId, level: recordShares.level })
                .from(recordShares)
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, userId)))
                .limit(MAX_RECORD_SHARES_PER_GUEST),
        );
        return new Map(rows.map((r) => [r.recordId, { listId: r.listId, level: r.level as GuestLevel }]));
    }
}
