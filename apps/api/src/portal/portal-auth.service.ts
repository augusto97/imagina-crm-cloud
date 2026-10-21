import { randomBytes } from 'node:crypto';
import {
    ForbiddenException,
    HttpException,
    Inject,
    Injectable,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import type {
    PortalAuthSettings,
    PortalLoginOptions,
    PortalPasswordLoginInput,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { portalCredentials, tenants, users } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { PortalService, portalPasswordEnabled, type PortalActor } from './portal.service';

/**
 * Freno de fuerza bruta POR CUENTA (y por empresa: la contraseña del portal es
 * de esa empresa), compartido entre nodos — el mismo criterio que SEC-26 para
 * la app. Se chequea ANTES de verificar el hash.
 */
const FAIL_MAX = 10;
const FAIL_WINDOW_S = 15 * 60;
/** Intentos por IP (cualquier cuenta, cualquier empresa) en la misma ventana. */
const IP_MAX = 40;
/** Cambios de contraseña por cliente y empresa por hora. */
const SET_MAX = 6;

const failKey = (tenantId: number, email: string): string => `portalpwfail:${tenantId}:${email.toLowerCase()}`;
const ipKey = (ip: string): string => `portalpwip:${ip}`;

const BAD_CREDENTIALS = 'Correo o contraseña incorrectos.';

/**
 * v0.1.289 — Entrar al portal con contraseña.
 *
 * La contraseña del portal es POR EMPRESA y NO es la de la cuenta de la
 * persona: vive en `portal_credentials (tenant_id, user_id)`. Quien es
 * cliente de dos empresas tiene dos contraseñas independientes, y quien
 * además trabaja en el equipo de otra empresa no expone la contraseña de su
 * cuenta en el portal de un tercero (ni al revés). La sesión que se abre es
 * la MISMA sesión del portal que abre un enlace (cookie propia, atada a la
 * empresa): nada de lo que se puede hacer con ella cambia.
 */
@Injectable()
export class PortalAuthService {
    private readonly logger = new Logger(PortalAuthService.name);
    /** Hash de relleno (real, generado una vez): mismo costo con o sin cuenta. */
    private dummyHash: Promise<string> | null = null;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        private readonly tenantDb: TenantDb,
        private readonly sessions: SessionService,
        private readonly domains: DomainsService,
        private readonly portal: PortalService,
        private readonly audit: AuditService,
    ) {}

    // ─────────────── Ajuste de la empresa (Ajustes → Portal) ───────────────

    async settings(tenantId: number): Promise<PortalAuthSettings> {
        const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return {
            password_enabled: portalPasswordEnabled(t?.settings as Record<string, unknown> | undefined),
            entry_url: await this.portal.entryUrl(tenantId),
        };
    }

    async update(tenantId: number, actorId: number | null, input: { password_enabled: boolean }): Promise<PortalAuthSettings> {
        const before = await this.settings(tenantId);
        await this.db
            .update(tenants)
            .set({
                settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) || jsonb_build_object('portal_auth', jsonb_build_object('password_enabled', ${input.password_enabled}::boolean))`,
            })
            .where(eq(tenants.id, tenantId));
        if (before.password_enabled !== input.password_enabled) {
            await this.audit.log({
                tenantId,
                userId: actorId,
                action: input.password_enabled ? 'workspace.portal_password_on' : 'workspace.portal_password_off',
                targetType: 'workspace',
                targetLabel: input.password_enabled
                    ? 'Los clientes pueden entrar al portal con contraseña'
                    : 'Los clientes sólo entran al portal con un enlace por correo',
            });
        }
        return { ...before, password_enabled: input.password_enabled };
    }

    // ─────────────── Pantalla de entrar (sin sesión) ───────────────

    /**
     * La empresa de la pantalla de entrar —por el dominio o por `?empresa=`— y
     * si deja entrar con contraseña. Sin empresa: portal neutro, sólo enlace.
     */
    async loginOptions(host: string | undefined, empresa?: string | null): Promise<PortalLoginOptions> {
        const boot = await this.domains.resolvePortalTenant(host, empresa);
        if (!boot.tenant) return { tenant: null, password: false };
        const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, boot.tenant.id)).limit(1);
        return { tenant: boot.tenant, password: portalPasswordEnabled(t?.settings as Record<string, unknown> | undefined) };
    }

    /**
     * Entrar con correo + contraseña. La respuesta a un correo sin acceso, sin
     * contraseña o con la contraseña mal es IDÉNTICA (mismo mensaje, mismo
     * costo de argon2): la pantalla de entrar no sirve para averiguar quién es
     * cliente de quién. Lo que sí se dice —cuenta desactivada, sin acceso— se
     * dice sólo después de una contraseña correcta.
     */
    async login(
        input: PortalPasswordLoginInput,
        meta: { host?: string; ip?: string; userAgent?: string },
    ): Promise<{ sessionToken: string }> {
        // Freno por IP (cualquier cuenta): un barrido de correos desde un solo
        // lugar se corta sin tocar la base.
        if (meta.ip) {
            const n = await this.redis.incr(ipKey(meta.ip));
            if (n === 1) await this.redis.expire(ipKey(meta.ip), FAIL_WINDOW_S);
            if (n > IP_MAX) throw tooMany('Demasiados intentos desde esta conexión. Espera unos minutos.');
        }
        const boot = await this.domains.resolvePortalTenant(meta.host, input.empresa);
        const tenant = boot.tenant;
        if (!tenant) {
            throw new ForbiddenException({
                code: 'portal_company_required',
                message: 'Entra desde el enlace del portal que te dio la empresa (o pide un enlace por correo).',
                data: { status: 403 },
            });
        }
        const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
        if (!portalPasswordEnabled(t?.settings as Record<string, unknown> | undefined)) {
            throw new ForbiddenException({
                code: 'portal_password_disabled',
                message: 'Esta empresa no permite entrar con contraseña. Pide un enlace por correo.',
                data: { status: 403 },
            });
        }

        const fk = failKey(tenant.id, input.email);
        if (Number((await this.redis.get(fk)) ?? 0) >= FAIL_MAX) {
            throw tooMany('Demasiados intentos fallidos. Espera unos minutos o entra con un enlace por correo.');
        }

        const [user] = await this.db
            .select({ id: users.id, email: users.email, disabledAt: users.disabledAt })
            .from(users)
            .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
            .limit(1);
        const cred = user
            ? (
                  await this.tenantDb.withTenant(tenant.id, (tx) =>
                      tx
                          .select({ hash: portalCredentials.passwordHash })
                          .from(portalCredentials)
                          .where(and(eq(portalCredentials.tenantId, tenant.id), eq(portalCredentials.userId, user.id)))
                          .limit(1),
                  )
              )[0]
            : undefined;
        const hash = cred?.hash ?? (await this.fillerHash());
        const valid = await argon2.verify(hash, input.password).catch(() => false);
        // SEC-24: la cuenta de un superadmin jamás entra a un portal.
        const superadmin = user ? this.env.PLATFORM_SUPERADMINS.includes(user.email.toLowerCase()) : false;
        if (!user || !cred || !valid || superadmin) {
            const n = await this.redis.incr(fk);
            if (n === 1) await this.redis.expire(fk, FAIL_WINDOW_S);
            throw new UnauthorizedException({ code: 'invalid_credentials', message: BAD_CREDENTIALS, data: { status: 401 } });
        }
        await this.redis.del(fk);

        if (user.disabledAt !== null) {
            throw new ForbiddenException({
                code: 'account_disabled',
                message: 'Tu cuenta está desactivada. Contacta a la empresa.',
                data: { status: 403 },
            });
        }
        const linkId = await this.portal.openableLink(user.id, tenant.id);
        if (linkId === null) {
            throw new ForbiddenException({
                code: 'portal_no_access',
                message: 'Ya no tienes acceso al portal de esta empresa. Si crees que es un error, contáctala.',
                data: { status: 403 },
            });
        }
        const sessionToken = await this.sessions.create(user.id, {
            userAgent: meta.userAgent,
            ip: meta.ip,
            portalTenantId: tenant.id,
            portalLinkId: linkId,
            // Una sesión abierta con la contraseña de UNA empresa nunca ve las
            // cuentas de otras (esa contraseña es de esa empresa).
            portalAccount: false,
        });
        await this.portal.markAccess(linkId);
        return { sessionToken };
    }

    // ─────────────── Crear / cambiar (con la sesión del portal) ───────────────

    /**
     * El cliente crea o cambia SU contraseña del portal de ESTA empresa. No se
     * pide la anterior a propósito: «olvidé mi contraseña» es entrar con un
     * enlace por correo y crear una nueva desde aquí. Cambiarla cierra las
     * demás sesiones del portal de esta empresa (no las de otras empresas ni
     * la sesión de trabajo de su cuenta, si la tiene).
     */
    async setPassword(actor: PortalActor, sessionToken: string, password: string): Promise<{ ok: true }> {
        const tenantId = actor.tenantId;
        if (tenantId === null) {
            throw new ForbiddenException({
                code: 'portal_session_stale',
                message: 'Vuelve a entrar al portal con el enlace de tu correo.',
                data: { status: 403 },
            });
        }
        const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (!portalPasswordEnabled(t?.settings as Record<string, unknown> | undefined)) {
            throw new ForbiddenException({
                code: 'portal_password_disabled',
                message: 'Esta empresa no permite entrar con contraseña.',
                data: { status: 403 },
            });
        }
        if ((await this.portal.openableLink(actor.userId, tenantId)) === null) {
            throw new ForbiddenException({
                code: 'portal_no_access',
                message: 'Ya no tienes acceso al portal de esta empresa.',
                data: { status: 403 },
            });
        }
        const rl = `portalpwset:${tenantId}:${actor.userId}`;
        const n = await this.redis.incr(rl);
        if (n === 1) await this.redis.expire(rl, 3600);
        if (n > SET_MAX) throw tooMany('Cambiaste la contraseña muchas veces seguidas. Prueba en un rato.');

        const hash = await argon2.hash(password);
        const now = new Date();
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(portalCredentials)
                .values({ tenantId, userId: actor.userId, passwordHash: hash, createdAt: now, updatedAt: now })
                .onConflictDoUpdate({
                    target: [portalCredentials.tenantId, portalCredentials.userId],
                    set: { passwordHash: hash, updatedAt: now },
                }),
        );
        // Un intento fallido viejo no tiene que seguir contando contra la nueva.
        const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
        if (u) await this.redis.del(failKey(tenantId, u.email)).catch(() => undefined);
        const closed = await this.sessions.destroyPortalSessions(actor.userId, tenantId, sessionToken);
        if (closed > 0) this.logger.log(`Contraseña del portal cambiada: ${closed} sesión(es) del portal cerradas`);
        return { ok: true };
    }

    private fillerHash(): Promise<string> {
        this.dummyHash ??= argon2.hash(randomBytes(24).toString('hex'));
        return this.dummyHash;
    }
}

function tooMany(message: string): HttpException {
    return new HttpException({ code: 'too_many_attempts', message, data: { status: 429 } }, 429);
}
