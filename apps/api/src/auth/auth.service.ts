import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { incrWithTtl } from '../redis/redis.util';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
    UnauthorizedException,
} from '@nestjs/common';
import {
    effectiveCapabilities,
    slugifyTenant,
    type AuthSession,
    type BackupCodes,
    type LoginInput,
    type MembershipSummary,
    type MfaChallenge,
    type RegisterInput,
    parseSignupAttribution,
    type SessionUser,
    type TotpSetup,
    type VerifyTwoFactorInput,
    readDisabledModules,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { accessOf, newTrialEndsAt } from '../billing/tenant-access';
import { customRoles, impersonationLog, memberships, personalAccessTokens, plans, tenants, users } from '../db/schema';
import { withUser } from '../db/tenant-tx';
import { MailService } from '../mail/mail.service';
import { REDIS } from '../redis/redis.module';
import { tenantBoundToHost } from './host-tenant';
import { passwordCheckFailKey, verifyAccountPassword } from './password-check';
import { deletePushForSessionId, deletePushForUser } from '../pwa/push-cleanup';
import { sessionPublicId, SessionService, type ActiveSession } from './session.service';
import {
    generateBackupCodes,
    generateTotpSecret,
    matchTotp,
    normalizeBackupCode,
    otpauthUri,
    verifyTotp,
} from './totp';

/** TTL del token de reset (30 min) + prefijo en Redis. */
const RESET_TTL_SECONDS = 30 * 60;
/**
 * v0.1.240 — el enlace de una INVITACIÓN usa el mismo token de un solo uso que
 * el reset, pero dura 7 días: 30 minutos es razonable para quien pidió
 * recuperar su contraseña y está frente a la pantalla, no para alguien que
 * recibe una invitación y la abre al día siguiente.
 */
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Reenvíos de una misma invitación por hora (freno por usuario, en Redis). */
const INVITE_RESEND_MAX = 3;

/**
 * v0.1.116 — Freno de fuerza bruta POR CUENTA (además del rate limit por IP).
 *
 * El limitador de `main.ts` es por IP y en MEMORIA de cada nodo: mil IPs
 * distintas probando contra el mismo email pasaban limpio, y con dos nodos el
 * cupo efectivo se duplicaba. Este contador vive en Redis (compartido entre
 * nodos) y es por email: tras N fallos seguidos la cuenta queda bloqueada un
 * rato, aunque el atacante rote de IP. Un login exitoso lo limpia.
 */
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60;
const loginFailKey = (email: string): string => `loginfail:${email.toLowerCase()}`;

/** v0.1.118 — token de verificación de email (48 h, un solo uso). */
const VERIFY_TTL_SECONDS = 48 * 60 * 60;
const verifyKey = (token: string): string => `emailverify:${token}`;
const resetKey = (token: string): string => `pwreset:${token}`;

/**
 * v0.1.120 — Segundo factor (TOTP).
 *
 * El alta guarda el secreto PROPUESTO en Redis (10 min): recién se persiste
 * cuando el usuario confirma un código, así un alta abandonada no deja la
 * cuenta con un factor que nadie puede usar. El desafío del login vive 5 min y
 * tolera pocos intentos.
 */
const TOTP_PENDING_TTL_SECONDS = 10 * 60;
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_MAX_TRIES = 5;
const totpPendingKey = (userId: number): string => `totpsetup:${userId}`;
const mfaKey = (challenge: string): string => `mfa:${challenge}`;
const mfaTriesKey = (challenge: string): string => `mfatries:${challenge}`;
/** SEC-26 — fallos de segundo factor por USUARIO (no por desafío). */
const mfaUserFailKey = (userId: number): string => `mfafail:${userId}`;
/** SEC-26 — última ventana TOTP aceptada (anti-reutilización). */
const totpLastKey = (userId: number): string => `totplast:${userId}`;
const MFA_USER_MAX_FAILS = 10;
const MFA_USER_LOCK_SECONDS = 15 * 60;

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Compara dos hashes hex en tiempo constante (longitudes distintas → false). */
function safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Un nombre de empresa en un asunto: sin saltos de línea (cabecera de correo). */
function oneLine(s: string): string {
    return s.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Texto libre que escribe una empresa (su nombre, el de quien invita, lo que
 * comparte) dentro de un correo que sale por la cuenta de la PLATAFORMA: una
 * línea y con tope, para que no sirva de vehículo de un mensaje largo.
 */
function mailLabel(s: string, max = 80): string {
    const flat = oneLine(s);
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Correos de invitación/aviso a UNA dirección: por hora y por día. */
const INVITE_TO_MAX_HOUR = 3;
const INVITE_TO_MAX_DAY = 8;

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
}

@Injectable()
export class AuthService implements OnModuleInit {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        private readonly mail: MailService,
        private readonly sessions: SessionService,
    ) {}

    /**
     * SEC-04: pre-provisiona en el arranque una cuenta por cada email de
     * `PLATFORM_SUPERADMINS` que aún no exista. Así el email de superadmin no
     * puede ser "reclamado" por un atacante vía el registro público, y el
     * superadmin legítimo activa su cuenta con "olvidé mi contraseña" (el link
     * de reset va a SU casilla). Best-effort: no bloquea el boot si la DB no
     * está lista todavía.
     */
    async onModuleInit(): Promise<void> {
        try {
            await this.ensureSuperadminAccounts();
        } catch (err) {
            this.logger.warn(
                `No se pudieron pre-provisionar superadmins: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private async ensureSuperadminAccounts(): Promise<void> {
        const emails = this.env.PLATFORM_SUPERADMINS;
        if (emails.length === 0) return;
        for (const email of emails) {
            const [existing] = await this.db
                .select({ id: users.id })
                .from(users)
                .where(sql`lower(${users.email}) = ${email}`)
                .limit(1);
            if (existing) continue;
            const hash = await argon2.hash(randomBytes(32).toString('hex'));
            await this.db
                .insert(users)
                .values({ email, passwordHash: hash, name: email })
                .onConflictDoNothing();
            this.logger.log(
                `Cuenta de superadmin pre-provisionada: ${email} (activar con "olvidé mi contraseña")`,
            );
        }
    }

    /**
     * Solicita recuperación de contraseña: genera un token de un solo uso en
     * Redis (TTL 30 min) y manda el link por email. Responde igual exista o no
     * el usuario (no filtra qué emails están registrados).
     */
    async requestPasswordReset(email: string): Promise<void> {
        // v0.1.238 — sin un correo de plataforma configurado el enlace no
        // tiene por dónde salir: se dice ANTES de buscar la cuenta (así no
        // revela si el email existe) en vez de responder "listo" y no mandar
        // nada. Es un dato del servidor, no de la persona.
        await this.mail.assertAccountMailAvailable();
        const [user] = await this.db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
            .limit(1);
        if (!user) return;
        // SEC-26 (v0.1.226): freno POR DIRECCIÓN (compartido entre nodos). El
        // rate limit por IP no alcanza: con IPs rotativas se inundaba la casilla
        // de alguien con correos de reset de la plataforma. Silencioso, como
        // el resto del endpoint (no revela si la cuenta existe).
        if (!(await this.withinMailBudget(`pwreset-rl:${user.id}`, 3, 3600))) return;

        const token = randomBytes(32).toString('base64url');
        await this.redis.set(resetKey(token), String(user.id), 'EX', RESET_TTL_SECONDS);

        const link = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/reset?token=${token}`;
        await this.mail.enqueue({
            to: user.email,
            subject: 'Restablecer tu contraseña — Imagina Base',
            html: `<p>Hola ${escapeHtml(user.name)},</p><p>Recibimos un pedido para restablecer tu contraseña. El enlace vence en 30 minutos:</p><p><a href="${link}">Restablecer contraseña</a></p><p>Si no lo pediste, ignora este correo.</p>`,
            text: `Restablece tu contraseña (vence en 30 min): ${link}`,
        });
        this.logger.log(`Reset de contraseña solicitado para userId=${user.id}`);
    }

    /** Cupo de correos de cuenta por clave en una ventana (Redis, entre nodos). */
    private async withinMailBudget(key: string, max: number, windowSeconds: number): Promise<boolean> {
        const n = await incrWithTtl(this.redis, key, windowSeconds);
        if (n > max) {
            this.logger.warn(`Correos de cuenta frenados (${key})`);
            return false;
        }
        return true;
    }

    /**
     * Cupo de los correos de cuenta que dispara una EMPRESA (invitación, «te
     * sumaron», «compartieron contigo»). Salen por el correo de la plataforma
     * y fuera de la cuota del plan, así que sin esto servían para inundar la
     * casilla de un tercero (sumar y quitar a la misma persona en bucle) con
     * texto elegido por la empresa. Dos topes en Redis: por DESTINATARIO (3
     * por hora, 8 por día, sin importar qué empresa) y por EMPRESA por día,
     * según el tamaño de su plan.
     */
    private async inviteMailAllowed(tenantId: number, email: string): Promise<boolean> {
        const to = sha256Hex(email.trim().toLowerCase());
        if (!(await this.withinMailBudget(`invite-to:h:${to}`, INVITE_TO_MAX_HOUR, 3600))) return false;
        if (!(await this.withinMailBudget(`invite-to:d:${to}`, INVITE_TO_MAX_DAY, 86_400))) return false;
        return this.withinMailBudget(`invite-by:d:${tenantId}`, await this.tenantInviteDailyCap(tenantId), 86_400);
    }

    /** Correos de invitación por día de una empresa: 2 × (usuarios + invitados del plan), entre 20 y 500. */
    private async tenantInviteDailyCap(tenantId: number): Promise<number> {
        const [row] = await this.db
            .select({ maxUsers: plans.maxUsers, maxGuests: plans.maxGuests })
            .from(tenants)
            .leftJoin(plans, eq(plans.slug, tenants.plan))
            .where(eq(tenants.id, tenantId))
            .limit(1);
        // Sin tope de usuarios en el plan (o sin plan conocido): el máximo.
        if (!row || row.maxUsers === null) return 500;
        return Math.min(500, Math.max(20, 2 * (row.maxUsers + (row.maxGuests ?? 0))));
    }

    private inviteBudgetExceeded(): HttpException {
        return new HttpException(
            {
                code: 'too_many_requests',
                message: 'Se enviaron demasiadas invitaciones en poco tiempo. Prueba más tarde.',
                data: { status: 429 },
            },
            429,
        );
    }

    /**
     * Cierra todo lo que daba acceso a una cuenta: sesiones, tokens de acceso
     * y avisos push. La contraseña la cambia quien llama.
     */
    private async revokeAccess(userId: number): Promise<void> {
        await this.sessions.destroyAllForUser(userId);
        await this.db
            .update(personalAccessTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(personalAccessTokens.userId, userId), isNull(personalAccessTokens.revokedAt)));
        await deletePushForUser(this.db, userId).catch(() => undefined);
        await this.redis.del(totpPendingKey(userId)).catch(() => undefined);
    }

    /**
     * Una cuenta que alguien REGISTRÓ por su cuenta y nunca confirmó el correo
     * no prueba que sea de la persona dueña de esa casilla: cualquiera pudo
     * registrarla antes con un correo ajeno y quedarse esperando a que una
     * empresa la invite. Cuando una empresa le da acceso por correo, la cuenta
     * pasa a ser una INVITACIÓN: contraseña nueva que nadie conoce, sin
     * segundo factor, y (después del commit, `revokeAccess`) sin sesiones ni
     * tokens. Entra quien abre el enlace que llega a la casilla.
     */
    private async turnIntoInvitation(tx: Tx, userId: number): Promise<void> {
        const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
        await tx
            .update(users)
            .set({ passwordHash, invitedAt: new Date(), totpSecret: null, totpEnabledAt: null, totpBackupCodes: null })
            .where(eq(users.id, userId));
    }

    /** ¿Cuenta registrada por su cuenta que nunca confirmó el correo? (los superadmins no entran aquí) */
    private isUnprovenAccount(u: { email: string; emailVerifiedAt: Date | null; invitedAt: Date | null }): boolean {
        return (
            u.emailVerifiedAt === null &&
            u.invitedAt === null &&
            !this.env.PLATFORM_SUPERADMINS.includes(u.email.toLowerCase())
        );
    }

    /** Consume el token y setea la nueva contraseña. Token de un solo uso. */
    async resetPassword(token: string, password: string): Promise<void> {
        // SEC-26: un solo uso ATÓMICO (GETDEL), como el magic link y la
        // verificación de email — get+del dejaba una carrera.
        const userId = await this.redis.getdel(resetKey(token));
        if (!userId) {
            throw new BadRequestException({
                code: 'invalid_reset_token',
                message: 'El enlace es inválido o expiró. Pide uno nuevo.',
                data: { status: 400 },
            });
        }
        const passwordHash = await argon2.hash(password);
        // v0.1.240: el enlace llegó a la casilla de la persona, así que abrirlo
        // prueba que el email es suyo (cuenta verificada) y cierra una
        // invitación pendiente.
        const [updated] = await this.db
            .update(users)
            .set({
                passwordHash,
                invitedAt: null,
                emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
                // Un segundo factor puesto ANTES de probar que el correo es de la
                // persona no es de ella: lo pudo activar quien registró la cuenta
                // con un correo ajeno, y dejaría afuera al dueño aun con el
                // enlace de su casilla. (Las expresiones leen la fila de antes.)
                totpSecret: sql`case when ${users.emailVerifiedAt} is null then null else ${users.totpSecret} end`,
                totpEnabledAt: sql`case when ${users.emailVerifiedAt} is null then null else ${users.totpEnabledAt} end`,
                totpBackupCodes: sql`case when ${users.emailVerifiedAt} is null then null else ${users.totpBackupCodes} end`,
            })
            .where(eq(users.id, Number(userId)))
            .returning({ email: users.email });
        // v0.1.254 — el aviso de "demasiados intentos" ofrece restablecer la
        // contraseña como salida, pero el contador seguía ahí y el login nuevo
        // rebotaba igual hasta que vencían los 15 minutos. Quien canjeó el
        // enlace probó que el correo es suyo: se le levanta el freno.
        if (updated?.email) await this.redis.del(loginFailKey(updated.email)).catch(() => undefined);
        await this.redis.del(passwordCheckFailKey(Number(userId))).catch(() => undefined);
        // SEC-22 (v0.1.113): cambiar la contraseña REVOCA todas las sesiones
        // abiertas. Sin esto, quien hubiera robado una sesión seguía dentro
        // después de que la víctima "recuperaba" la cuenta (el TTL de sesión
        // es de 30 días deslizantes → acceso persistente).
        await this.sessions.destroyAllForUser(Number(userId));
        // SEC-26 (v0.1.226): y los TOKENS de acceso (MCP pegados y conexiones
        // OAuth). Quien robó una sesión podía crear uno sin vencimiento y
        // seguir entrando por el MCP después de que la víctima recuperara la
        // cuenta. Recuperar la cuenta = asumir que alguien más la tuvo.
        await this.db
            .update(personalAccessTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(personalAccessTokens.userId, Number(userId)), isNull(personalAccessTokens.revokedAt)));
        this.logger.log(`Contraseña restablecida para userId=${userId} (sesiones y tokens revocados)`);
    }

    // ─────────── Gestión de usuarios por el operador (ADR-S15 F2) ───────────

    /**
     * El operador crea una cuenta (sin workspace) y le envía un email de
     * invitación con un link para DEFINIR su contraseña. Reusa el mismo token
     * de reset (un solo uso; 7 días para una invitación). El usuario se suma a
     * empresas desde Miembros (admin de la empresa) o desde la consola.
     */
    async adminCreateUser(email: string, name: string): Promise<typeof users.$inferSelect> {
        const normEmail = email.trim().toLowerCase();
        if (this.env.PLATFORM_SUPERADMINS.includes(normEmail)) {
            throw new ConflictException('Ese email está reservado');
        }
        const [existing] = await this.db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = ${normEmail}`)
            .limit(1);
        if (existing) {
            throw new ConflictException('Ya existe una cuenta con ese email');
        }
        // Sin correo de cuenta la invitación no llega y la cuenta nacería sin
        // que nadie pueda entrar: se corta ANTES de crearla (v0.1.240).
        await this.mail.assertAccountMailAvailable();
        const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
        const [user] = await this.db
            .insert(users)
            .values({ email: normEmail, passwordHash, name: name.trim(), invitedAt: new Date() })
            .returning();
        if (!user) throw new Error('Insert de usuario no devolvió fila');
        await this.issueSetupLink(user.id, user.email, user.name, 'invite');
        this.logger.log(`Usuario ${user.id} creado por operador (invitación enviada)`);
        return user;
    }

    /**
     * El operador da de alta una EMPRESA nueva + su admin en un paso. Si el email
     * ya tiene cuenta, lo suma como admin del nuevo workspace; si no, la crea y le
     * manda la invitación. Reusa el patrón RLS de `register`.
     */
    async adminCreateTenant(
        input: {
            workspace_name: string;
            admin_email: string;
            admin_name: string;
            plan: string;
        },
        opts: { allowReserved?: boolean } = {},
    ): Promise<{ tenantId: number; invited: boolean }> {
        const email = input.admin_email.trim().toLowerCase();
        // v0.1.293 — la consola de plataforma (sólo superadmins) SÍ puede crearle
        // una empresa a un superadmin: si no, uno que se quedó sin empresas no
        // tenía forma de volver a tener una (ni de abrir la app).
        if (!opts.allowReserved && this.env.PLATFORM_SUPERADMINS.includes(email)) {
            throw new ConflictException('Ese email está reservado');
        }
        const [known] = await this.db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1);
        const [knownProof] = known
            ? await this.db
                  .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, invitedAt: users.invitedAt })
                  .from(users)
                  .where(eq(users.id, known.id))
                  .limit(1)
            : [];
        if (!known || (knownProof && this.isUnprovenAccount(knownProof))) await this.mail.assertAccountMailAvailable();
        const result = await this.db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    emailVerifiedAt: users.emailVerifiedAt,
                    invitedAt: users.invitedAt,
                })
                .from(users)
                .where(sql`lower(${users.email}) = ${email}`)
                .limit(1);
            let userId: number;
            let invited = false;
            let reclaimed = false;
            let name: string;
            if (existing) {
                userId = existing.id;
                name = existing.name;
                // Cuenta registrada sin confirmar el correo: pasa a invitación.
                if (this.isUnprovenAccount(existing)) {
                    await this.turnIntoInvitation(tx, existing.id);
                    invited = true;
                    reclaimed = true;
                }
            } else {
                const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
                const [u] = await tx
                    .insert(users)
                    .values({ email, passwordHash, name: input.admin_name.trim(), invitedAt: new Date() })
                    .returning();
                if (!u) throw new Error('Insert de usuario no devolvió fila');
                userId = u.id;
                name = u.name;
                invited = true;
            }

            const slug = await this.availableTenantSlug(tx, slugifyTenant(input.workspace_name));
            // v0.1.338 — una empresa en prueba que da de alta el operador también
            // tiene fecha de fin; la de un superadmin no (es la del operador).
            const trialEndsAt =
                input.plan === 'trial' && !this.env.PLATFORM_SUPERADMINS.includes(email) ? newTrialEndsAt() : null;
            const [tenant] = await tx.insert(tenants).values({ slug, name: input.workspace_name, plan: input.plan, trialEndsAt }).returning();
            if (!tenant) throw new Error('Insert de tenant no devolvió fila');

            // Membership admin bajo el rol de app + contexto RLS (WITH CHECK real).
            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenant.id)}, true)`);
            await tx.insert(memberships).values({ userId, tenantId: tenant.id, role: 'admin' });

            return { tenantId: tenant.id, userId, invited, reclaimed, email, name };
        });

        if (result.reclaimed) await this.revokeAccess(result.userId);
        if (result.invited) {
            await this.issueSetupLink(result.userId, result.email, result.name, 'invite', {
                tenantName: input.workspace_name,
            });
        }
        this.logger.log(
            `Empresa ${result.tenantId} creada por operador (admin ${result.email}${result.invited ? ', invitado' : ''})`,
        );
        return { tenantId: result.tenantId, invited: result.invited };
    }

    /** Reset de contraseña disparado por el operador (envía el email). */
    async adminResetPassword(userId: number): Promise<void> {
        const [user] = await this.db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!user) throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${userId} no existe`, data: { status: 404 } });
        await this.mail.assertAccountMailAvailable();
        await this.issueSetupLink(user.id, user.email, user.name, 'reset');
    }

    /** Desactiva/reactiva una cuenta. Al desactivar, revoca todas sus sesiones. */
    async setUserDisabled(userId: number, disabled: boolean): Promise<void> {
        const [user] = await this.db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!user) throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${userId} no existe`, data: { status: 404 } });
        // Guard rail: no dejar que el operador se bloquee a sí mismo ni a otro
        // superadmin de plataforma desde aquí.
        if (disabled && this.env.PLATFORM_SUPERADMINS.includes(user.email.toLowerCase())) {
            throw new ForbiddenException({
                code: 'cannot_disable_superadmin',
                message: 'No se puede desactivar una cuenta de superadmin de plataforma',
                data: { status: 403 },
            });
        }
        await this.db
            .update(users)
            .set({ disabledAt: disabled ? sql`now()` : null })
            .where(eq(users.id, userId));
        if (disabled) {
            await this.sessions.destroyAllForUser(userId);
            await deletePushForUser(this.db, userId);
        }
        this.logger.log(`Usuario ${userId} ${disabled ? 'desactivado' : 'reactivado'} por operador`);
    }

    // ─────────────── Impersonación de soporte (ADR-S15 F5) ───────────────

    private readonly IMPERSONATION_TTL_SECONDS = 60 * 60; // 1 h, tope duro.

    /**
     * El operador abre una sesión de IMPERSONACIÓN como `targetUserId` (soporte).
     * Registra la fila de auditoría y crea una sesión de vida corta que recuerda
     * el token original del operador. No se puede impersonar a un superadmin ni a
     * una cuenta desactivada.
     */
    async impersonate(
        operatorId: number,
        operatorToken: string,
        targetUserId: number,
    ): Promise<{ token: string; target: { id: number; name: string; email: string } }> {
        if (operatorId === targetUserId) {
            throw new BadRequestException({ code: 'self_impersonation', message: 'No tiene sentido impersonarte a ti mismo', data: { status: 400 } });
        }
        const [target] = await this.db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
        if (!target) {
            throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${targetUserId} no existe`, data: { status: 404 } });
        }
        if (target.disabledAt) {
            throw new ForbiddenException({ code: 'account_disabled', message: 'No se puede impersonar una cuenta desactivada', data: { status: 403 } });
        }
        if (this.env.PLATFORM_SUPERADMINS.includes(target.email.toLowerCase())) {
            throw new ForbiddenException({ code: 'cannot_impersonate_superadmin', message: 'No se puede impersonar a un superadmin de plataforma', data: { status: 403 } });
        }

        const expiresAt = new Date(Date.now() + this.IMPERSONATION_TTL_SECONDS * 1000);
        const [audit] = await this.db
            .insert(impersonationLog)
            .values({ actorUserId: operatorId, targetUserId, expiresAt })
            .returning({ id: impersonationLog.id });
        const token = await this.sessions.createImpersonation({
            targetUserId,
            operatorId,
            origToken: operatorToken,
            auditId: audit!.id,
            ttlSeconds: this.IMPERSONATION_TTL_SECONDS,
        });
        this.logger.warn(`IMPERSONACIÓN: operador ${operatorId} → usuario ${targetUserId} (audit ${audit!.id})`);
        return { token, target: { id: target.id, name: target.name, email: target.email } };
    }

    /** Sale de la impersonación: cierra la auditoría y devuelve el token original. */
    async stopImpersonation(currentToken: string): Promise<{ origToken: string | null }> {
        const data = await this.sessions.get(currentToken);
        if (!data?.impersonatedBy) {
            throw new BadRequestException({ code: 'not_impersonating', message: 'La sesión no es de impersonación', data: { status: 400 } });
        }
        if (data.auditId) {
            await this.db.update(impersonationLog).set({ endedAt: sql`now()` }).where(eq(impersonationLog.id, data.auditId));
        }
        await this.sessions.destroy(currentToken);
        this.logger.warn(`IMPERSONACIÓN cerrada: operador ${data.impersonatedBy} → usuario ${data.userId}`);
        return { origToken: data.origToken ?? null };
    }

    /** Token de un solo uso + email para invitar o resetear (link a /reset). */
    private async issueSetupLink(
        userId: number,
        email: string,
        name: string,
        kind: 'invite' | 'reset',
        opts: { tenantName?: string; invitedBy?: string | null; shared?: { label: string } | null } = {},
    ): Promise<void> {
        const token = randomBytes(32).toString('base64url');
        const invite = kind === 'invite';
        name = mailLabel(name);
        opts = {
            ...opts,
            ...(opts.tenantName !== undefined ? { tenantName: mailLabel(opts.tenantName) } : {}),
            ...(opts.invitedBy ? { invitedBy: mailLabel(opts.invitedBy) } : {}),
            ...(opts.shared ? { shared: { label: mailLabel(opts.shared.label, 120) } } : {}),
        };
        await this.redis.set(resetKey(token), String(userId), 'EX', invite ? INVITE_TTL_SECONDS : RESET_TTL_SECONDS);
        // `invite=1` sólo cambia los textos de la pantalla ("Define tu
        // contraseña" en vez de "Nueva contraseña"); el token es el mismo.
        const link = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/reset?token=${token}${invite ? '&invite=1' : ''}`;
        const expires = invite ? '7 días' : '30 minutos';
        let subject: string;
        let intro: string;
        if (invite && opts.tenantName && opts.shared) {
            // C3 — invitado externo: el correo dice QUÉ le compartieron.
            const who = opts.invitedBy ? `${escapeHtml(opts.invitedBy)} compartió contigo` : 'Compartieron contigo';
            subject = `${opts.invitedBy ? `${oneLine(opts.invitedBy)} compartió contigo` : 'Compartieron contigo'} «${oneLine(opts.shared.label)}»`;
            intro = `${who} «${escapeHtml(opts.shared.label)}» de «${escapeHtml(opts.tenantName)}» en Imagina Base. Define tu contraseña para entrar`;
        } else if (invite && opts.tenantName) {
            const who = opts.invitedBy ? `${escapeHtml(opts.invitedBy)} te invitó` : 'Te invitaron';
            subject = `Te invitaron a «${oneLine(opts.tenantName)}» en Imagina Base`;
            intro = `${who} a sumarte a «${escapeHtml(opts.tenantName)}» en Imagina Base. Define tu contraseña para entrar`;
        } else if (invite) {
            subject = 'Te crearon una cuenta en Imagina Base';
            intro = 'Se creó una cuenta para ti en Imagina Base. Define tu contraseña para entrar';
        } else {
            subject = 'Restablecer tu contraseña — Imagina Base';
            intro = 'Se solicitó restablecer tu contraseña';
        }
        const cta = invite ? 'Definir contraseña' : 'Restablecer contraseña';
        await this.mail.enqueue({
            to: email,
            subject,
            html: `<p>Hola ${escapeHtml(name)},</p><p>${intro} — el enlace vence en ${expires}:</p><p><a href="${link}">${cta}</a></p>`,
            text: `${cta} (vence en ${expires}): ${link}`,
        });
    }

    // ─────────── Invitaciones a una empresa (v0.1.240) ───────────

    /**
     * Suma a una persona a una empresa por EMAIL. Si ya tiene cuenta, la suma
     * con el rol pedido y le avisa por correo (best-effort). Si no, crea la
     * cuenta por INVITACIÓN: contraseña aleatoria que nadie conoce +
     * `invited_at` + correo con el enlace para definir la suya (7 días).
     *
     * Así ya no hace falta que la persona se registre primero — que además le
     * creaba una empresa propia vacía. Lo usan el panel de Miembros (admin de
     * la empresa, con el límite de usuarios del plan chequeado antes) y la
     * consola de plataforma. La membresía se escribe bajo el rol de app con el
     * contexto RLS de esa empresa (mismo patrón que `adminCreateTenant`).
     */
    async addToTenant(
        tenantId: number,
        input: {
            email: string;
            name?: string;
            role: 'admin' | 'manager' | 'agent' | 'viewer' | 'guest';
            /** C2 — rol propio (ya validado contra la empresa; su base es `role`). */
            customRoleId?: number | null;
        },
        opts: {
            invitedById?: number | null;
            allowReserved?: boolean;
            /** C3 — lo que se le compartió a un invitado (para el correo). */
            shared?: { label: string } | null;
            /** La consola de plataforma (el operador) no gasta el cupo de invitaciones. */
            skipMailBudget?: boolean;
        } = {},
    ): Promise<{
        user: { id: number; name: string; email: string };
        role: 'admin' | 'manager' | 'agent' | 'viewer' | 'guest';
        invited: boolean;
        pending: boolean;
        notified: boolean;
        /** C3 — ya era invitado de esta empresa: no se creó membresía nueva. */
        alreadyGuest: boolean;
    }> {
        const email = input.email.trim().toLowerCase();
        // Un admin de una empresa NO puede sumar a un superadmin: sumar una
        // cuenta existente no le pide permiso a nadie, y la cuenta del operador
        // no puede quedar en manos de un cliente (menciones, asignaciones,
        // cambiarle el rol). La consola de plataforma sí (`allowReserved`,
        // v0.1.293): ahí quien decide es otro superadmin, o él mismo.
        if (!opts.allowReserved && this.env.PLATFORM_SUPERADMINS.includes(email)) {
            throw new ConflictException({
                code: 'email_reserved',
                message:
                    'Ese email es de un superadmin de la plataforma: sólo se suma a una empresa desde la consola de Plataforma (Usuarios → Agregar a una empresa).',
                data: { status: 409, errors: { email: 'Superadmin de la plataforma' } },
            });
        }
        const [tenant] = await this.db
            .select({ id: tenants.id, name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        if (!tenant) {
            throw new NotFoundException({ code: 'tenant_not_found', message: `Empresa ${tenantId} no encontrada`, data: { status: 404 } });
        }
        const [known] = await this.db
            .select({
                id: users.id,
                email: users.email,
                disabledAt: users.disabledAt,
                emailVerifiedAt: users.emailVerifiedAt,
                invitedAt: users.invitedAt,
            })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1);
        if (known?.disabledAt) {
            throw new ConflictException({
                code: 'account_disabled',
                message: `La cuenta de ${email} está desactivada en la plataforma`,
                data: { status: 409, errors: { email: 'Cuenta desactivada' } },
            });
        }
        // Una cuenta nueva sólo sirve si le llega el correo: sin SMTP de cuenta
        // se corta aquí, antes de crear nada. Lo mismo una cuenta registrada que
        // nunca confirmó su correo: va a entrar por el enlace de la invitación.
        if (!known || this.isUnprovenAccount(known)) await this.mail.assertAccountMailAvailable();
        // Quién invita, para el correo ("Ana te invitó…").
        let invitedBy: string | null = null;
        if (opts.invitedById) {
            const [inviter] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, opts.invitedById)).limit(1);
            invitedBy = inviter?.name ?? null;
        }

        const result = await this.db.transaction(async (tx) => {
            let user: { id: number; name: string; email: string; invitedAt: Date | null };
            let invited = false;
            // Cuenta registrada por su cuenta y sin correo confirmado: el acceso
            // lo recibe quien abra el enlace de la casilla (ver `turnIntoInvitation`).
            let reclaim = false;
            let unjoined = false;
            const [existing] = await tx
                .select({
                    id: users.id,
                    name: users.name,
                    email: users.email,
                    invitedAt: users.invitedAt,
                    emailVerifiedAt: users.emailVerifiedAt,
                })
                .from(users)
                .where(sql`lower(${users.email}) = ${email}`)
                .limit(1);
            if (existing) {
                user = { id: existing.id, name: existing.name, email: existing.email, invitedAt: existing.invitedAt };
                reclaim = this.isUnprovenAccount(existing);
            } else {
                const fallbackName = email.split('@')[0] ?? email;
                const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
                const [u] = await tx
                    .insert(users)
                    .values({ email, passwordHash, name: input.name?.trim() || fallbackName, invitedAt: new Date() })
                    .returning({ id: users.id, name: users.name, email: users.email, invitedAt: users.invitedAt });
                if (!u) throw new Error('Insert de usuario no devolvió fila');
                user = u;
                invited = true;
            }

            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.user_id', ${String(user.id)}, true)`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);
            const [membership] = await tx
                .select({ role: memberships.role })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, user.id)))
                .limit(1);
            if (membership?.role === 'client') {
                throw new ConflictException({
                    code: 'portal_client',
                    message: `${email} es cliente del portal de esta empresa. Su acceso se maneja desde la ficha del registro.`,
                    data: { status: 409, errors: { email: 'Cliente del portal' } },
                });
            }
            // C3 — compartir con alguien que YA es invitado: se reusa su membresía.
            if (membership?.role === 'guest' && input.role === 'guest') {
                return { user, invited, alreadyGuest: true, reclaimed: false, unjoined: false };
            }
            // C3 — alguien del equipo no se invita como persona de afuera: ya
            // ve lo que su rol le deja ver (se le comparte desde los permisos).
            if (membership && input.role === 'guest') {
                throw new ConflictException({
                    code: 'already_team_member',
                    message: `${email} ya es del equipo de esta empresa: compártele la lista desde «Personas con acceso».`,
                    data: { status: 409, errors: { email: 'Ya es del equipo' } },
                });
            }
            // C3 — un invitado se pasa a miembro desde Miembros → Invitados.
            if (membership?.role === 'guest') {
                throw new ConflictException({
                    code: 'already_guest',
                    message: `${email} ya es invitado de esta empresa: pásalo a miembro desde Miembros → Invitados.`,
                    data: { status: 409, errors: { email: 'Ya es invitado' } },
                });
            }
            if (membership) {
                throw new ConflictException({
                    code: 'already_member',
                    message: `${email} ya es miembro de esta empresa`,
                    data: { status: 409, errors: { email: 'Ya es miembro' } },
                });
            }
            // Una cuenta nueva, una invitación sin abrir o una cuenta sin probar
            // sólo sirven si les llega el correo: si el cupo de invitaciones se
            // agotó, se rechaza ANTES de escribir nada (la transacción se deshace).
            if ((invited || reclaim || user.invitedAt !== null) && !opts.skipMailBudget) {
                if (!(await this.inviteMailAllowed(tenantId, email))) throw this.inviteBudgetExceeded();
            }
            // Una cuenta que YA existía y que suma el admin de una empresa (no
            // el operador): nadie le pidió permiso a esa persona. Queda sumada,
            // pero hasta que ENTRE a la empresa (`joined_at`) no se muestra su
            // nombre ni se usa su firma de correo: sumar un correo ajeno no
            // sirve para leer los datos de esa cuenta.
            unjoined = !invited && !reclaim && user.invitedAt === null && !opts.skipMailBudget && !opts.allowReserved;
            await tx.insert(memberships).values({
                userId: user.id,
                tenantId,
                role: input.role,
                customRoleId: input.role === 'guest' || input.role === 'admin' ? null : input.customRoleId ?? null,
                ...(unjoined ? { joinedAt: null } : {}),
            });
            if (reclaim) {
                // `users` se escribe con la conexión base, no con el rol de la app.
                await tx.execute(sql`reset role`);
                await this.turnIntoInvitation(tx, user.id);
                user = { ...user, invitedAt: new Date() };
                invited = true;
            }
            return { user, invited, alreadyGuest: false, reclaimed: reclaim, unjoined };
        });

        const { user, invited, alreadyGuest, reclaimed } = result;
        // Fuera de la transacción: las sesiones viven en Redis.
        if (reclaimed) await this.revokeAccess(user.id);
        const shared = input.role === 'guest' ? opts.shared ?? null : null;
        let notified = false;
        if (alreadyGuest) {
            // Nada nuevo que avisar aquí: quien comparte manda su propio aviso.
        } else if (invited) {
            await this.issueSetupLink(user.id, user.email, user.name, 'invite', {
                tenantName: tenant.name,
                invitedBy,
                shared,
            });
            notified = true;
        } else if (user.invitedAt) {
            // Tenía una invitación sin abrir (de otra empresa o del operador):
            // un enlace nuevo, así no queda con uno vencido.
            await this.issueSetupLink(user.id, user.email, user.name, 'invite', {
                tenantName: tenant.name,
                invitedBy,
                shared,
            }).catch(() => undefined);
            notified = true;
        } else if (opts.skipMailBudget || (await this.inviteMailAllowed(tenantId, email))) {
            notified = await this.notifyAddedToTenant(user, tenant.name, invitedBy, shared);
        }
        // (Sin cupo, una cuenta que ya existía queda sumada igual y sin correo:
        // el aviso es una cortesía, `notified` lo dice.)
        this.logger.log(`Usuario ${user.id} sumado a la empresa ${tenantId} (${reclaimed ? 'cuenta sin confirmar → invitación' : invited ? 'invitado' : 'cuenta existente'})`);
        return {
            // El nombre real de una cuenta ajena no vuelve a quien la sumó por
            // su correo: hasta que la persona entra, sólo lo que ya se sabía.
            user: { id: user.id, name: result.unjoined ? (user.email.split('@')[0] ?? user.email) : user.name, email: user.email },
            role: input.role,
            invited,
            pending: invited || user.invitedAt !== null,
            notified,
            alreadyGuest,
        };
    }

    /**
     * Reenvía la invitación de alguien que todavía no definió su contraseña.
     * Con `tenantId`, la persona tiene que ser miembro de esa empresa (el admin
     * de una empresa no reenvía invitaciones a cuentas ajenas). Freno de 3 por
     * hora por persona: cada reenvío es un correo a una casilla de un tercero.
     */
    async resendInvite(tenantId: number | null, userId: number): Promise<{ email: string }> {
        const [user] = await this.db
            .select({ id: users.id, name: users.name, email: users.email, invitedAt: users.invitedAt, disabledAt: users.disabledAt })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        let tenantName: string | undefined;
        if (tenantId !== null) {
            const [m] = await this.db
                .select({ name: tenants.name })
                .from(memberships)
                .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), ne(memberships.role, 'client')))
                .limit(1);
            if (!m) {
                throw new NotFoundException({ code: 'not_member', message: 'Esa persona no es miembro de esta empresa', data: { status: 404 } });
            }
            tenantName = m.name;
        }
        if (!user) {
            throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${userId} no existe`, data: { status: 404 } });
        }
        if (user.disabledAt) {
            throw new ConflictException({ code: 'account_disabled', message: 'La cuenta está desactivada', data: { status: 409 } });
        }
        if (!user.invitedAt) {
            throw new ConflictException({
                code: 'not_pending',
                message: 'Esta persona ya definió su contraseña: no hay invitación pendiente',
                data: { status: 409 },
            });
        }
        await this.mail.assertAccountMailAvailable();
        if (!(await this.withinMailBudget(`inviteresend:${userId}`, INVITE_RESEND_MAX, 60 * 60))) {
            throw new HttpException(
                { code: 'too_many_requests', message: 'Ya se reenvió varias veces en la última hora. Prueba más tarde.', data: { status: 429 } },
                429,
            );
        }
        await this.issueSetupLink(user.id, user.email, user.name, 'invite', { tenantName });
        return { email: user.email };
    }

    /**
     * Aviso a una cuenta EXISTENTE de que la sumaron a una empresa. Best-effort:
     * si el correo no sale, el alta igual vale (la persona la ve al entrar).
     */
    private async notifyAddedToTenant(
        user: { email: string; name: string },
        tenantName: string,
        invitedBy: string | null,
        shared: { label: string } | null = null,
    ): Promise<boolean> {
        try {
            const status = await this.mail.accountMailStatus();
            if (!status.available) return false;
            tenantName = mailLabel(tenantName);
            invitedBy = invitedBy ? mailLabel(invitedBy) : null;
            user = { ...user, name: mailLabel(user.name) };
            const base = this.env.APP_BASE_URL.replace(/\/$/, '');
            if (shared) return await this.sendSharedMail(user, tenantName, invitedBy, shared.label, base);
            const who = invitedBy ? `${escapeHtml(invitedBy)} te sumó` : 'Te sumaron';
            await this.mail.enqueue({
                to: user.email,
                subject: `Te sumaron a «${oneLine(tenantName)}» en Imagina Base`,
                html: `<p>Hola ${escapeHtml(user.name)},</p><p>${who} a «${escapeHtml(tenantName)}» en Imagina Base. Entra con tu cuenta de siempre y elige la empresa en el selector de arriba.</p><p><a href="${base}/">Entrar</a></p>`,
                text: `${invitedBy ? `${invitedBy} te sumó` : 'Te sumaron'} a «${tenantName}» en Imagina Base. Entra: ${base}/`,
            });
            return true;
        } catch (err) {
            this.logger.warn(`No se pudo avisar a ${user.email} del alta en «${tenantName}»: ${(err as Error).message}`);
            return false;
        }
    }

    /**
     * C3 — avisa a un invitado (con cuenta) que le compartieron algo más.
     * Best-effort, como el alta: si el correo no sale, el acceso igual vale.
     */
    async notifyGuestShared(
        user: { email: string; name: string },
        tenantName: string,
        invitedBy: string | null,
        label: string,
        /** Con la empresa, el aviso gasta el cupo de invitaciones (sin cupo no sale). */
        tenantId?: number,
    ): Promise<boolean> {
        try {
            const status = await this.mail.accountMailStatus();
            if (!status.available) return false;
            if (tenantId !== undefined && !(await this.inviteMailAllowed(tenantId, user.email))) return false;
            return await this.sendSharedMail(user, tenantName, invitedBy, label, this.env.APP_BASE_URL.replace(/\/$/, ''));
        } catch (err) {
            this.logger.warn(`No se pudo avisar a ${user.email} de lo compartido en «${tenantName}»: ${(err as Error).message}`);
            return false;
        }
    }

    private async sendSharedMail(
        user: { email: string; name: string },
        tenantName: string,
        invitedBy: string | null,
        label: string,
        base: string,
    ): Promise<boolean> {
        tenantName = mailLabel(tenantName);
        label = mailLabel(label, 120);
        user = { ...user, name: mailLabel(user.name) };
        const who = invitedBy ? `${mailLabel(invitedBy)} compartió contigo` : 'Compartieron contigo';
        await this.mail.enqueue({
            to: user.email,
            subject: `${who} «${oneLine(label)}»`,
            html: `<p>Hola ${escapeHtml(user.name)},</p><p>${escapeHtml(who)} «${escapeHtml(label)}» de «${escapeHtml(tenantName)}» en Imagina Base. Entra con tu cuenta y elige «${escapeHtml(tenantName)}» en el selector de arriba.</p><p><a href="${base}/">Entrar</a></p>`,
            text: `${who} «${label}» de «${tenantName}» en Imagina Base. Entra: ${base}/`,
        });
        return true;
    }

    /**
     * Alta de usuario + su primer workspace + membership admin, en UNA
     * transacción. La membership exige `app.tenant_id`/`app.user_id` en el
     * contexto (WITH CHECK de las policies RLS).
     */
    async register(input: RegisterInput, meta: { host?: string } = {}): Promise<AuthSession> {
        // SEC-04: el registro público nunca puede crear una cuenta con un email
        // de superadmin (evita reclamar el privilegio de plataforma). Se
        // responde con el mismo mensaje que un email ya tomado para no revelar
        // qué emails son superadmin (anti-enumeración).
        if (this.env.PLATFORM_SUPERADMINS.includes(input.email.trim().toLowerCase())) {
            throw new ConflictException('Ya existe una cuenta con ese email');
        }

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
            // v0.1.331 — de dónde vino el alta (la consola lo muestra por empresa
            // y cuenta las altas por origen). Sólo el registro público lo trae.
            const attribution = parseSignupAttribution(input.attribution);
            const [tenant] = await tx
                .insert(tenants)
                .values({
                    slug,
                    name: input.workspace_name,
                    // v0.1.338 (ADR-S87) — la prueba arranca con fecha de fin.
                    trialEndsAt: newTrialEndsAt(),
                    ...(attribution ? { settings: { signup: { ...attribution, at: new Date().toISOString() } } } : {}),
                })
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

        // v0.1.118 — se manda la verificación del email, pero el alta entra
        // igual: bloquear el primer uso mata la activación. La interfaz avisa
        // que falta confirmar. Best-effort: un fallo de correo no rompe el
        // registro (se puede reenviar desde Ajustes).
        void this.sendEmailVerification(result.user.id).catch(() => undefined);

        // Registrarse desde la dirección de una empresa: la sesión queda atada a
        // la empresa recién creada (no vale para las que se sumen después).
        const onTenantHost = (await tenantBoundToHost(this.db, this.env, meta.host)) !== null;
        const token = await this.sessions.create(result.user.id, {
            via: 'password',
            boundTenantId: onTenantHost ? result.tenant.id : null,
        });
        return {
            user: this.toSessionUser(result.user),
            memberships: [
                {
                    tenant_id: result.tenant.id,
                    tenant_slug: result.tenant.slug,
                    tenant_name: result.tenant.name,
                    role: 'admin',
                    capabilities: effectiveCapabilities('admin'),
                },
            ],
            token,
        };
    }

    async login(
        input: LoginInput,
        meta: { userAgent?: string; ip?: string; host?: string } = {},
    ): Promise<AuthSession | MfaChallenge> {
        // Freno por cuenta: se chequea ANTES de tocar la DB o verificar el hash
        // (argon2 es caro a propósito; no queremos gastarlo con el atacante).
        // El intento se CUENTA antes de verificar y se borra si la contraseña
        // era buena: leer, verificar y después sumar dejaba que una ráfaga en
        // paralelo probara muchas más contraseñas que el tope (todos los
        // pedidos en vuelo leían el mismo número).
        const failKey = loginFailKey(input.email);
        const attempts = await incrWithTtl(this.redis, failKey, LOGIN_FAIL_WINDOW_SECONDS);
        if (attempts > LOGIN_FAIL_MAX) {
            throw new HttpException(
                {
                    code: 'too_many_attempts',
                    message:
                        'Demasiados intentos fallidos para esta cuenta. Espera unos minutos o restablece tu contraseña.',
                    data: { status: 429 },
                },
                429,
            );
        }

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
            // El fallo ya quedó contado arriba (ventana de 15 min).
            throw new UnauthorizedException('Credenciales inválidas');
        }
        // Contraseña buena → se limpia el contador de la cuenta (también si
        // está desactivada: no fue un intento fallido).
        await this.redis.del(failKey);

        // Cuenta desactivada por el operador (ADR-S15 F2): credenciales válidas
        // pero el acceso está bloqueado. Se revela sólo tras autenticar bien.
        if (user.disabledAt) {
            throw new ForbiddenException({
                code: 'account_disabled',
                message: 'Tu cuenta está desactivada. Contacta al administrador.',
                data: { status: 403 },
            });
        }

        // v0.1.120 — con segundo factor activo NO se abre sesión todavía: se
        // devuelve un desafío de un solo uso que hay que canjear con el código.
        // La sesión que se abre en la dirección de una empresa es sólo de ESA
        // empresa (ver `host-tenant.ts`).
        const boundTenantId = await tenantBoundToHost(this.db, this.env, meta.host);
        if (user.totpEnabledAt !== null) {
            const challenge = randomBytes(32).toString('base64url');
            await this.redis.set(
                mfaKey(challenge),
                JSON.stringify({ userId: user.id, userAgent: meta.userAgent, ip: meta.ip, boundTenantId }),
                'EX',
                MFA_CHALLENGE_TTL_SECONDS,
            );
            return { mfa_required: true, challenge };
        }

        const token = await this.sessions.create(user.id, {
            userAgent: meta.userAgent,
            ip: meta.ip,
            via: 'password',
            boundTenantId,
        });
        return {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id, boundTenantId),
            token,
        };
    }

    /**
     * Segundo paso del login: canjea el desafío con el código de la app (o con
     * un código de respaldo, que se consume).
     *
     * El desafío se lee con `GETDEL` sólo cuando el código es BUENO: si se
     * borrara antes, un dedazo obligaría a reingresar la contraseña. Los
     * intentos fallidos se cuentan igual (freno de fuerza bruta sobre el
     * desafío) y agotarlo lo invalida.
     */
    async verifyTwoFactorLogin(input: VerifyTwoFactorInput, meta: { host?: string } = {}): Promise<AuthSession> {
        const raw = await this.redis.get(mfaKey(input.challenge));
        if (raw === null) {
            throw new UnauthorizedException({
                code: 'mfa_challenge_expired',
                message: 'El desafío venció. Vuelve a ingresar tu contraseña.',
                data: { status: 401 },
            });
        }
        const parsed = JSON.parse(raw) as { userId: number; userAgent?: string; ip?: string; boundTenantId?: number | null };
        const tries = await incrWithTtl(this.redis, mfaTriesKey(input.challenge), MFA_CHALLENGE_TTL_SECONDS);
        if (tries > MFA_MAX_TRIES) {
            await this.redis.del(mfaKey(input.challenge));
            throw new UnauthorizedException({
                code: 'mfa_too_many_attempts',
                message: 'Demasiados códigos incorrectos. Vuelve a ingresar tu contraseña.',
                data: { status: 401 },
            });
        }

        const [user] = await this.db.select().from(users).where(eq(users.id, parsed.userId)).limit(1);
        if (!user || user.totpEnabledAt === null || user.totpSecret === null) {
            throw new UnauthorizedException('Código inválido');
        }

        // SEC-26 (v0.1.226): tope de fallos POR USUARIO. El de arriba es por
        // desafío, y cada login con la contraseña correcta emite uno nuevo:
        // quien ya tiene la contraseña probaba códigos sin límite.
        // Se cuenta ANTES de verificar (una ráfaga en paralelo no pasa el tope).
        const failKey = mfaUserFailKey(user.id);
        if ((await incrWithTtl(this.redis, failKey, MFA_USER_LOCK_SECONDS)) > MFA_USER_MAX_FAILS) {
            throw new UnauthorizedException({
                code: 'mfa_locked',
                message: 'Demasiados códigos incorrectos. Espera 15 minutos y vuelve a intentar.',
                data: { status: 401 },
            });
        }

        const secret = decryptSecret(user.totpSecret, this.env.SECRETS_KEY);
        let ok = false;
        const step = matchTotp(secret, input.code);
        if (step !== null) {
            // Un código vale UNA vez: se guarda la última ventana usada y no se
            // acepta ninguna igual o anterior (`SET … GET` atómico).
            const prev = await this.redis.set(totpLastKey(user.id), String(step), 'EX', 300, 'GET');
            ok = prev === null || Number(prev) < step;
            if (!ok && prev !== null) await this.redis.set(totpLastKey(user.id), prev, 'EX', 300);
        }
        if (!ok) ok = await this.consumeBackupCode(user.id, user.totpBackupCodes ?? [], input.code);
        if (!ok) throw new UnauthorizedException('Código inválido');
        await this.redis.del(failKey);

        await this.redis.del(mfaKey(input.challenge), mfaTriesKey(input.challenge));
        // Atada a la empresa de la dirección donde se puso la contraseña o donde
        // se completó el código (la que haya).
        const boundTenantId =
            (await tenantBoundToHost(this.db, this.env, meta.host)) ?? parsed.boundTenantId ?? null;
        const token = await this.sessions.create(user.id, {
            userAgent: parsed.userAgent,
            ip: parsed.ip,
            via: 'password',
            boundTenantId,
        });
        return {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id, boundTenantId),
            token,
        };
    }

    /**
     * Un código de respaldo vale UNA vez: si coincide, se borra de la lista en
     * el mismo update (comparación en tiempo constante sobre el hash).
     */
    private async consumeBackupCode(
        userId: number,
        hashes: string[],
        given: string,
    ): Promise<boolean> {
        const norm = normalizeBackupCode(given);
        if (norm.length < 8) return false;
        const digest = sha256Hex(norm);
        const idx = hashes.findIndex((h) => safeEqualHex(h, digest));
        if (idx === -1) return false;
        const rest = hashes.filter((_, i) => i !== idx);
        // SEC-26: UPDATE condicional — sólo consume si el código SIGUE en la
        // lista. Dos requests en paralelo con el mismo código: gana una.
        const updated = await this.db
            .update(users)
            .set({ totpBackupCodes: rest })
            .where(and(eq(users.id, userId), sql`${users.totpBackupCodes} @> ${JSON.stringify([hashes[idx]])}::jsonb`))
            .returning({ id: users.id });
        if (updated.length === 0) return false;
        this.logger.warn(`Código de respaldo consumido por el usuario ${userId} (quedan ${rest.length})`);
        return true;
    }

    /**
     * Paso 1 del alta del 2FA: propone un secreto. NO se persiste hasta que el
     * usuario confirme un código — así un alta abandonada no deja la cuenta con
     * un factor que nadie puede usar.
     */
    async setupTwoFactor(userId: number): Promise<TotpSetup> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new NotFoundException('Usuario no encontrado');
        if (user.totpEnabledAt !== null) {
            throw new BadRequestException({
                code: 'two_factor_already_enabled',
                message: 'La verificación en dos pasos ya está activa.',
                data: { status: 400 },
            });
        }
        const secret = generateTotpSecret();
        await this.redis.set(totpPendingKey(userId), secret, 'EX', TOTP_PENDING_TTL_SECONDS);
        return {
            secret,
            otpauth_uri: otpauthUri('Imagina Base', user.email, secret),
        };
    }

    /** Paso 2: confirma el código, activa el factor y entrega los respaldos. */
    async enableTwoFactor(userId: number, code: string): Promise<BackupCodes> {
        const secret = await this.redis.get(totpPendingKey(userId));
        if (secret === null) {
            throw new BadRequestException({
                code: 'two_factor_setup_expired',
                message: 'El alta venció. Vuelve a empezar la configuración.',
                data: { status: 400 },
            });
        }
        if (!verifyTotp(secret, code)) {
            throw new BadRequestException({
                code: 'invalid_code',
                message: 'El código no coincide. Revisa la hora de tu teléfono e intenta de nuevo.',
                data: { status: 400 },
            });
        }
        const codes = generateBackupCodes();
        await this.db
            .update(users)
            .set({
                totpSecret: encryptSecret(secret, this.env.SECRETS_KEY),
                totpEnabledAt: new Date(),
                totpBackupCodes: codes.map((c) => sha256Hex(normalizeBackupCode(c))),
            })
            .where(eq(users.id, userId));
        await this.redis.del(totpPendingKey(userId));
        this.logger.log(`2FA activado por el usuario ${userId}`);
        return { backup_codes: codes };
    }

    /** Regenera los códigos de respaldo (invalida los anteriores). */
    async regenerateBackupCodes(userId: number): Promise<BackupCodes> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user || user.totpEnabledAt === null) {
            throw new BadRequestException({
                code: 'two_factor_not_enabled',
                message: 'La verificación en dos pasos no está activa.',
                data: { status: 400 },
            });
        }
        const codes = generateBackupCodes();
        await this.db
            .update(users)
            .set({ totpBackupCodes: codes.map((c) => sha256Hex(normalizeBackupCode(c))) })
            .where(eq(users.id, userId));
        return { backup_codes: codes };
    }

    /**
     * Desactiva el segundo factor. Exige la CONTRASEÑA: con la sesión abierta
     * sola alcanzaría para que quien roba un equipo desarmado el 2FA.
     */
    async disableTwoFactor(userId: number, password: string): Promise<void> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new NotFoundException('Usuario no encontrado');
        const valid = await verifyAccountPassword(this.redis, userId, user.passwordHash, password);
        if (!valid) throw new UnauthorizedException('La contraseña no coincide');
        await this.db
            .update(users)
            .set({ totpSecret: null, totpEnabledAt: null, totpBackupCodes: null })
            .where(eq(users.id, userId));
        this.logger.log(`2FA desactivado por el usuario ${userId}`);
    }

    /** Estado del segundo factor para el panel de Ajustes. */
    async twoFactorStatus(userId: number): Promise<{ enabled: boolean; backup_codes_left: number }> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        return {
            enabled: user?.totpEnabledAt != null,
            backup_codes_left: user?.totpBackupCodes?.length ?? 0,
        };
    }

    /**
     * v0.1.116 — Cambio de contraseña CON sesión iniciada. Antes sólo existía
     * el flujo de "olvidé mi contraseña" (había que pasar por el email para
     * cambiarla estando adentro).
     *
     * Verifica la contraseña actual, y al cambiarla cierra las sesiones de los
     * OTROS dispositivos (la actual sigue viva: quien cambia la clave no tiene
     * por qué quedar afuera).
     */
    async changePassword(
        userId: number,
        currentToken: string,
        input: { current_password: string; new_password: string },
    ): Promise<{ revoked_sessions: number }> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new UnauthorizedException('Usuario inexistente');

        const valid = await verifyAccountPassword(this.redis, userId, user.passwordHash, input.current_password);
        if (!valid) {
            throw new BadRequestException({
                code: 'invalid_password',
                message: 'La contraseña actual no es correcta',
                data: { status: 400, errors: { current_password: 'No coincide' } },
            });
        }

        const passwordHash = await argon2.hash(input.new_password);
        await this.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
        const revoked = await this.sessions.destroyOthersForUser(userId, currentToken);
        this.logger.log(`Contraseña cambiada por el usuario ${userId} (${revoked} sesiones cerradas)`);
        return { revoked_sessions: revoked };
    }

    /** v0.1.238 — "Reenviar": igual que el alta, pero dice si no hay correo. */
    async resendEmailVerification(userId: number): Promise<void> {
        await this.mail.assertAccountMailAvailable();
        await this.sendEmailVerification(userId);
    }

    /**
     * v0.1.118 — Manda (o remanda) el correo de verificación del alta.
     * Silencioso si el email ya está verificado: no filtra estado ni molesta.
     */
    async sendEmailVerification(userId: number): Promise<void> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user || user.emailVerifiedAt !== null) return;
        // SEC-26: registrarse con la dirección de otra persona y apretar
        // "Reenviar" en loop la inundaba. Tope por cuenta.
        if (!(await this.withinMailBudget(`verify-rl:${user.id}`, 5, 3600))) return;

        const token = randomBytes(32).toString('base64url');
        await this.redis.set(verifyKey(token), String(user.id), 'EX', VERIFY_TTL_SECONDS);
        const link = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/verify?token=${token}`;
        await this.mail.enqueue({
            to: user.email,
            subject: 'Confirma tu email — Imagina Base',
            html: `<p>Hola ${escapeHtml(user.name)},</p><p>Confirma tu dirección de correo para activar del todo tu cuenta. El enlace vence en 48 horas:</p><p><a href="${link}">Confirmar mi email</a></p><p>Si no creaste esta cuenta, ignora este mensaje.</p>`,
            text: `Confirma tu email (vence en 48 h): ${link}`,
        });
        this.logger.log(`Verificación de email enviada a userId=${user.id}`);
    }

    /**
     * Consume el token de verificación. Un solo uso: `GETDEL` lee y borra en una
     * sola operación (mismo criterio que el magic link del portal, SEC-15), así
     * dos clicks simultáneos no lo canjean dos veces.
     */
    async verifyEmail(token: string): Promise<void> {
        const userId = await this.redis.getdel(verifyKey(token));
        if (!userId) {
            throw new BadRequestException({
                code: 'invalid_verify_token',
                message: 'El enlace es inválido o expiró. Pide uno nuevo desde Ajustes.',
                data: { status: 400 },
            });
        }
        await this.db
            .update(users)
            .set({ emailVerifiedAt: new Date() })
            .where(eq(users.id, Number(userId)));
        this.logger.log(`Email verificado para userId=${userId}`);
    }

    /** v0.1.116 — Sesiones activas de la cuenta (sin exponer tokens). */
    listSessions(userId: number, currentToken: string): Promise<ActiveSession[]> {
        return this.sessions.listForUser(userId, currentToken);
    }

    /** Cierra una sesión concreta del usuario. 404 si no le pertenece. */
    async revokeSession(userId: number, publicId: string): Promise<void> {
        const ok = await this.sessions.destroyOneForUser(userId, publicId);
        if (ok) await deletePushForSessionId(this.db, publicId);
        if (!ok) {
            throw new NotFoundException({
                code: 'session_not_found',
                message: 'Esa sesión ya no existe',
                data: { status: 404 },
            });
        }
    }

    /** Cierra todas las sesiones menos la actual. */
    async revokeOtherSessions(
        userId: number,
        currentToken: string,
    ): Promise<{ revoked_sessions: number }> {
        const revoked = await this.sessions.destroyOthersForUser(userId, currentToken);
        return { revoked_sessions: revoked };
    }

    async me(
        userId: number,
        impersonatedBy?: number,
        /**
         * Cómo se abrió la sesión (`req.sessionVia`). Sólo `GET /auth/me` lo
         * pasa: con él se calcula `is_superadmin` con el MISMO criterio del
         * `SuperadminGuard` (email en la lista + sin impersonar + contraseña).
         */
        sessionVia?: 'password' | 'portal' | null,
        /** La sesión es sólo de esta empresa (se abrió en su dirección). */
        boundTenantId?: number,
    ): Promise<AuthSession> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) {
            throw new UnauthorizedException('Usuario inexistente');
        }
        const session: AuthSession = {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id, boundTenantId),
        };
        if (sessionVia !== undefined) {
            const operator =
                impersonatedBy === undefined &&
                // Desde la dirección de una empresa no hay consola de plataforma
                // (ni se pide volver a entrar: no serviría).
                boundTenantId === undefined &&
                sessionVia !== 'portal' &&
                this.env.PLATFORM_SUPERADMINS.includes(user.email.toLowerCase());
            session.is_superadmin = operator && sessionVia === 'password';
            session.platform_reauth = operator && sessionVia !== 'password';
        }
        if (impersonatedBy) {
            const [op] = await this.db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(eq(users.id, impersonatedBy))
                .limit(1);
            if (op) session.impersonating = { operator_id: op.id, operator_name: op.name };
        }
        return session;
    }

    async logout(token: string): Promise<void> {
        await this.sessions.destroy(token);
        // H1 — el dispositivo deja de recibir notificaciones push de inmediato.
        await deletePushForSessionId(this.db, sessionPublicId(token));
    }

    async membershipsOf(userId: number, onlyTenantId?: number | null): Promise<MembershipSummary[]> {
        return withUser(this.db, userId, async (tx) => {
            const rows = await tx
                .select({
                    tenantId: memberships.tenantId,
                    role: memberships.role,
                    tenantSlug: tenants.slug,
                    tenantName: tenants.name,
                    // C2 — rol propio: nombre y capacidades (`custom_roles_self`).
                    customRoleId: memberships.customRoleId,
                    customRoleName: customRoles.name,
                    customCaps: customRoles.capabilities,
                    // v0.1.338 (ADR-S87) — acceso y módulos del plan: la app decide
                    // si monta o muestra «cuenta pausada» sin otro pedido.
                    plan: tenants.plan,
                    status: tenants.status,
                    archivedAt: tenants.archivedAt,
                    trialEndsAt: tenants.trialEndsAt,
                    subscriptionEndsAt: tenants.subscriptionEndsAt,
                    paidUntil: tenants.paidUntil,
                    disabledModules: plans.disabledModules,
                })
                .from(memberships)
                .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
                .leftJoin(plans, eq(plans.slug, tenants.plan))
                .leftJoin(customRoles, and(eq(customRoles.id, memberships.customRoleId), eq(customRoles.tenantId, memberships.tenantId)))
                // v0.1.227 — el acceso de PORTAL (rol client) no es un workspace
                // de la app de equipo: el TenantGuard lo rechaza (SEC-24), así
                // que listarlo sólo hacía que la app abriera una empresa donde
                // todo responde 403. El portal tiene su propia entrada.
                .where(
                    and(
                        eq(memberships.userId, userId),
                        ne(memberships.role, 'client'),
                        // Sesión atada a una empresa: sólo esa.
                        typeof onlyTenantId === 'number' ? eq(memberships.tenantId, onlyTenantId) : undefined,
                    ),
                );
            return rows.map((r) => {
                const disabled = readDisabledModules(r.disabledModules);
                // C2 — sin «Roles propios» en el plan, la persona usa su rol base.
                const custom =
                    r.customRoleName !== null && Array.isArray(r.customCaps) && !disabled.includes('custom_roles') ? r.customCaps : null;
                return {
                    tenant_id: r.tenantId,
                    tenant_slug: r.tenantSlug,
                    tenant_name: r.tenantName,
                    role: r.role,
                    custom_role_id: custom ? r.customRoleId : null,
                    custom_role_name: custom ? r.customRoleName : null,
                    capabilities: effectiveCapabilities(r.role, custom),
                    access: accessOf(r),
                    disabled_modules: disabled,
                };
            });
        });
    }

    private toSessionUser(user: typeof users.$inferSelect): SessionUser {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            locale: user.locale,
            email_verified: user.emailVerifiedAt !== null,
            two_factor_enabled: user.totpEnabledAt !== null,
        };
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
