import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    effectiveCapabilities,
    MAX_RECORD_SHARES_PER_GUEST,
    readDisabledModules,
    type BillingStatus,
    type Capability,
    type GuestLevel,
    type PlanModule,
    type TenantAccess,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { accessOf, agencyAccessSql, planModuleDisabled } from '../billing/tenant-access';
import { REDIS } from '../redis/redis.module';
import { memberships, plans, recordShares, tenants } from '../db/schema';
import type { GuestShares } from '../lists/list-acl';
import { ALLOW_GUEST } from './allow-guest.decorator';
import { ALLOW_LOCKED } from './allow-locked.decorator';
import { ALLOW_TENANT_QUERY } from './allow-tenant-query.decorator';
import { ALLOW_READ_ONLY } from './allow-read-only.decorator';
import { PLAN_MODULE } from './plan-module.decorator';
import { sessionTenantScope } from '../auth/host-tenant';
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
    /** v0.1.338 (ADR-S87) — plan, acceso efectivo y módulos que el plan no incluye. */
    plan?: string;
    access?: TenantAccess;
    disabledModules?: PlanModule[];
    /**
     * v0.1.449 (ADR-S108) — la persona entra a esta empresa CLIENTE como parte
     * de su agencia (`agencyId`). Ya se revalidó que siga siendo admin de ella.
     */
    viaAgency?: boolean;
    /** v0.1.449 — la agencia de la que esta empresa es cliente (null = ninguna). */
    agencyId?: number | null;
    /** v0.1.449 — la empresa es una agencia. */
    isAgency?: boolean;
}

/** v0.1.449 — Cada cuánto se anota en la bitácora del cliente que alguien de la agencia entró. */
const AGENCY_ACCESS_LOG_SECONDS = 60 * 60;

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
    private readonly logger = new Logger(TenantGuard.name);
    /** Respaldo sin Redis: la última vez que se anotó cada entrada de agencia. */
    private readonly agencyNoted = new Map<string, number>();

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly reflector: Reflector,
        @Optional() private readonly audit?: AuditService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const userId = req.authUserId;
        if (!userId) {
            throw new ForbiddenException('Sesión requerida antes de resolver tenant');
        }

        const raw = req.headers['x-tenant-id'];
        let value = Array.isArray(raw) ? raw[0] : raw;
        // v0.1.427 — una `<img>` de la app no puede mandar el header: en las
        // lecturas marcadas, la empresa viaja en `?t=` (id numérico).
        if (!value && req.method === 'GET' && this.reflector.getAllAndOverride<boolean>(ALLOW_TENANT_QUERY, [context.getHandler(), context.getClass()]) === true) {
            const q = (req.query as Record<string, unknown> | undefined)?.t;
            if (typeof q === 'string' && /^\d{1,12}$/.test(q)) value = q;
        }
        // v0.1.441 (G1) — un token de la API es de UNA empresa: la fija él. El
        // header es opcional y, si viene (id o slug), tiene que ser esa misma
        // (se compara después de resolverlo).
        if (req.apiToken && !value) value = String(req.apiToken.tenantId);
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
                    plan: tenants.plan,
                    status: tenants.status,
                    archivedAt: tenants.archivedAt,
                    trialEndsAt: tenants.trialEndsAt,
                    subscriptionEndsAt: tenants.subscriptionEndsAt,
                    paidUntil: tenants.paidUntil,
                    // v0.1.449 (ADR-S108) — modo agencia: el cliente sigue a su
                    // agencia, y quien entra «por la agencia» tiene que seguir
                    // siendo admin de ESA agencia (`memberships_self` deja leer
                    // la propia membresía en la agencia sin empresa activa).
                    agencyPausedAt: tenants.agencyPausedAt,
                    agency: agencyAccessSql,
                    agencyId: tenants.agencyId,
                    isAgency: tenants.isAgency,
                    viaAgency: memberships.viaAgency,
                    agencyAdmin: sql<boolean>`EXISTS (SELECT 1 FROM memberships am WHERE am.tenant_id = ${tenants.agencyId} AND am.user_id = ${memberships.userId} AND am.role = 'admin')`,
                    // v0.1.338 — los módulos que el plan no incluye (misma consulta).
                    disabledModules: plans.disabledModules,
                    // C1 — `team_members_self` deja leer los equipos propios
                    // sin empresa activa (mismo plano que `memberships_self`).
                    teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
                    // C2 — rol propio: `custom_roles_self` deja leerlo sin empresa activa.
                    customRoleId: memberships.customRoleId,
                    joinedAt: memberships.joinedAt,
                    customCaps: sql<string[] | null>`(SELECT cr.capabilities FROM custom_roles cr WHERE cr.id = ${memberships.customRoleId} AND cr.tenant_id = ${memberships.tenantId})`,
                })
                .from(memberships)
                .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
                .leftJoin(plans, eq(plans.slug, tenants.plan))
                .where(
                    and(
                        eq(memberships.userId, userId),
                        numericId !== null ? eq(tenants.id, numericId) : eq(tenants.slug, value),
                    ),
                )
                .limit(1);
            return rows[0] ?? null;
        });

        if (req.apiToken && membership?.tenantId !== req.apiToken.tenantId) {
            throw new ForbiddenException({
                code: 'api_token_tenant_mismatch',
                message: 'Este token es de otra empresa: quita el header X-Tenant-Id o usa el token de esa empresa.',
                data: { status: 403 },
            });
        }
        if (!membership) {
            throw new ForbiddenException('No eres miembro de ese workspace');
        }
        // Una sesión abierta en la dirección de UNA empresa (su dominio propio)
        // sólo sirve para esa empresa: quien maneja ese dominio no puede usarla
        // contra las otras empresas de la persona.
        if (req.boundTenantId !== undefined && membership.tenantId !== req.boundTenantId) {
            throw sessionTenantScope();
        }
        // v0.1.449 (ADR-S108) — el acceso «por la agencia» vale mientras la
        // persona siga siendo admin de la agencia de ESTA empresa (la sacaron
        // de la agencia, le bajaron el rol o el operador desvinculó al cliente
        // → se corta al instante, aunque la fila todavía exista).
        if (membership.viaAgency && (membership.agencyId === null || membership.agencyAdmin !== true)) {
            throw new ForbiddenException({
                code: 'agency_access_revoked',
                message: 'Ya no tienes acceso a esta empresa como parte de su agencia.',
                data: { status: 403 },
            });
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
        const targets = [context.getHandler(), context.getClass()];

        // ADR-S09: impago/archivada/suscripción-vencida → solo-lectura. Se
        // bloquean las mutaciones; las lecturas y el export siguen disponibles
        // (los datos son del cliente, nunca se secuestran).
        // v0.1.338 (ADR-S87) — prueba terminada o plan vencido con la política
        // "pausar" → la empresa queda PAUSADA: sólo lo marcado @AllowLocked
        // (elegir plan, pagar, descargar los datos).
        const access = accessOf(membership);
        const allowLocked = this.reflector.getAllAndOverride<boolean>(ALLOW_LOCKED, targets) === true;
        if (access.state === 'locked' && !allowLocked) {
            throw new ForbiddenException({
                code: 'workspace_locked',
                message:
                    access.reason === 'trial_ended'
                        ? 'La prueba de esta empresa terminó. Elige un plan para seguir.'
                        : 'El plan de esta empresa venció. Elige un plan para seguir.',
                data: { status: 403, reason: access.reason },
            });
        }
        const readOnly = access.state !== 'full';
        const allowed =
            readOnly &&
            (allowLocked || this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY, targets) === true);
        if (readOnly && MUTATING_METHODS.has(req.method) && !allowed) {
            throw new ForbiddenException({
                code: 'workspace_read_only',
                message: 'El workspace está en solo-lectura por el estado de facturación',
                data: { status: 403 },
            });
        }

        // v0.1.338 — el módulo del endpoint tiene que estar en el plan.
        const disabledModules = readDisabledModules(membership.disabledModules);
        const module = this.reflector.getAllAndOverride<PlanModule | undefined>(PLAN_MODULE, targets);
        if (module && disabledModules.includes(module)) throw planModuleDisabled(module);

        // C2 — un rol propio sólo vale si el plan incluye «Roles propios»: si
        // no, la persona trabaja con su rol base (lo configurado se conserva).
        const customCaps =
            Array.isArray(membership.customCaps) && membership.customRoleId && !disabledModules.includes('custom_roles')
                ? membership.customCaps
                : null;
        // La primera vez que la persona ENTRA a una empresa a la que la sumaron
        // (su cuenta ya existía): desde ahora es del equipo a todos los efectos
        // (su nombre se muestra, su firma se puede usar). Una sola escritura
        // por membresía; el operador que la impersona no la acepta por ella.
        if (membership.joinedAt === null && req.impersonatedBy === undefined) {
            await this.tenantDb
                .withTenant(membership.tenantId, (tx) =>
                    tx
                        .update(memberships)
                        .set({ joinedAt: new Date() })
                        .where(and(eq(memberships.tenantId, membership.tenantId), eq(memberships.userId, userId), isNull(memberships.joinedAt))),
                )
                .catch(() => undefined);
        }
        if (membership.viaAgency && req.impersonatedBy === undefined) {
            void this.noteAgencyAccess(membership.tenantId, userId, membership.agencyId, req);
        }
        req.tenant = {
            tenantId: membership.tenantId,
            tenantSlug: membership.tenantSlug,
            role: membership.role,
            status,
            teamIds: (membership.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
            customRoleId: customCaps ? membership.customRoleId : null,
            capabilities: effectiveCapabilities(membership.role, customCaps),
            plan: membership.plan,
            access,
            disabledModules,
            viaAgency: membership.viaAgency === true,
            agencyId: membership.agencyId ?? null,
            isAgency: membership.isAgency === true,
            ...(membership.role === 'guest' ? { shares: await this.guestShares(membership.tenantId, userId) } : {}),
        };
        return true;
    }

    /**
     * v0.1.449 (ADR-S108) — Rastro de la agencia en la bitácora del CLIENTE: a
     * lo sumo una entrada por persona y hora (Redis `SET NX EX`; sin Redis,
     * en memoria del proceso). Nunca frena el pedido.
     */
    private async noteAgencyAccess(tenantId: number, userId: number, agencyId: number | null, req: FastifyRequest): Promise<void> {
        if (!this.audit) return;
        const key = `agacc:${tenantId}:${userId}`;
        try {
            if (this.redis) {
                const ok = await this.redis.set(key, '1', 'EX', AGENCY_ACCESS_LOG_SECONDS, 'NX');
                if (ok !== 'OK') return;
            } else {
                const now = Date.now();
                const last = this.agencyNoted.get(key) ?? 0;
                if (now - last < AGENCY_ACCESS_LOG_SECONDS * 1000) return;
                if (this.agencyNoted.size > 5000) this.agencyNoted.clear();
                this.agencyNoted.set(key, now);
            }
            const path = (req.url ?? '').split('?')[0]?.slice(0, 200) ?? '';
            await this.audit.log({
                tenantId,
                userId,
                action: 'agency.access',
                targetType: 'tenant',
                targetId: tenantId,
                meta: { agency_id: agencyId, method: req.method, path, via: req.apiToken ? 'api_token' : 'app' },
            });
        } catch (err) {
            this.logger.warn(`No se pudo anotar la entrada de la agencia: ${err instanceof Error ? err.message : String(err)}`);
        }
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
