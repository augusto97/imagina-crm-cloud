import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
    slugifyTenant,
    type AuthSession,
    type BackupCodes,
    type LoginInput,
    type MembershipSummary,
    type MfaChallenge,
    type RegisterInput,
    type SessionUser,
    type TotpSetup,
    type VerifyTwoFactorInput,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { impersonationLog, memberships, tenants, users } from '../db/schema';
import { withUser } from '../db/tenant-tx';
import { MailService } from '../mail/mail.service';
import { REDIS } from '../redis/redis.module';
import { SessionService, type ActiveSession } from './session.service';
import {
    generateBackupCodes,
    generateTotpSecret,
    normalizeBackupCode,
    otpauthUri,
    verifyTotp,
} from './totp';

/** TTL del token de reset (30 min) + prefijo en Redis. */
const RESET_TTL_SECONDS = 30 * 60;

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

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Compara dos hashes hex en tiempo constante (longitudes distintas → false). */
function safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

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
        const [user] = await this.db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
            .limit(1);
        if (!user) return;

        const token = randomBytes(32).toString('base64url');
        await this.redis.set(resetKey(token), String(user.id), 'EX', RESET_TTL_SECONDS);

        const link = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/reset?token=${token}`;
        await this.mail.enqueue({
            to: user.email,
            subject: 'Restablecer tu contraseña — Imagina Base',
            html: `<p>Hola ${escapeHtml(user.name)},</p><p>Recibimos un pedido para restablecer tu contraseña. El enlace vence en 30 minutos:</p><p><a href="${link}">Restablecer contraseña</a></p><p>Si no lo pediste, ignorá este correo.</p>`,
            text: `Restablecé tu contraseña (vence en 30 min): ${link}`,
        });
        this.logger.log(`Reset de contraseña solicitado para userId=${user.id}`);
    }

    /** Consume el token y setea la nueva contraseña. Token de un solo uso. */
    async resetPassword(token: string, password: string): Promise<void> {
        const userId = await this.redis.get(resetKey(token));
        if (!userId) {
            throw new BadRequestException({
                code: 'invalid_reset_token',
                message: 'El enlace es inválido o expiró. Pedí uno nuevo.',
                data: { status: 400 },
            });
        }
        const passwordHash = await argon2.hash(password);
        await this.db.update(users).set({ passwordHash }).where(eq(users.id, Number(userId)));
        await this.redis.del(resetKey(token));
        // SEC-22 (v0.1.113): cambiar la contraseña REVOCA todas las sesiones
        // abiertas. Sin esto, quien hubiera robado una sesión seguía dentro
        // después de que la víctima "recuperaba" la cuenta (el TTL de sesión
        // es de 30 días deslizantes → acceso persistente).
        await this.sessions.destroyAllForUser(Number(userId));
        this.logger.log(`Contraseña restablecida para userId=${userId} (sesiones revocadas)`);
    }

    // ─────────── Gestión de usuarios por el operador (ADR-S15 F2) ───────────

    /**
     * El operador crea una cuenta (sin workspace) y le envía un email de
     * invitación con un link para DEFINIR su contraseña. Reusa el mismo token
     * de reset (un solo uso, 30 min). El usuario se suma a workspaces por el
     * panel de miembros del admin de cada empresa.
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
        const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
        const [user] = await this.db
            .insert(users)
            .values({ email: normEmail, passwordHash, name: name.trim() })
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
    async adminCreateTenant(input: {
        workspace_name: string;
        admin_email: string;
        admin_name: string;
        plan: string;
    }): Promise<{ tenantId: number; invited: boolean }> {
        const email = input.admin_email.trim().toLowerCase();
        if (this.env.PLATFORM_SUPERADMINS.includes(email)) {
            throw new ConflictException('Ese email está reservado');
        }
        const result = await this.db.transaction(async (tx) => {
            const [existing] = await tx
                .select({ id: users.id, email: users.email, name: users.name })
                .from(users)
                .where(sql`lower(${users.email}) = ${email}`)
                .limit(1);
            let userId: number;
            let invited = false;
            let name: string;
            if (existing) {
                userId = existing.id;
                name = existing.name;
            } else {
                const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
                const [u] = await tx.insert(users).values({ email, passwordHash, name: input.admin_name.trim() }).returning();
                if (!u) throw new Error('Insert de usuario no devolvió fila');
                userId = u.id;
                name = u.name;
                invited = true;
            }

            const slug = await this.availableTenantSlug(tx, slugifyTenant(input.workspace_name));
            const [tenant] = await tx.insert(tenants).values({ slug, name: input.workspace_name, plan: input.plan }).returning();
            if (!tenant) throw new Error('Insert de tenant no devolvió fila');

            // Membership admin bajo el rol de app + contexto RLS (WITH CHECK real).
            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenant.id)}, true)`);
            await tx.insert(memberships).values({ userId, tenantId: tenant.id, role: 'admin' });

            return { tenantId: tenant.id, userId, invited, email, name };
        });

        if (result.invited) {
            await this.issueSetupLink(result.userId, result.email, result.name, 'invite');
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
        // superadmin de plataforma desde acá.
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
        if (disabled) await this.sessions.destroyAllForUser(userId);
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
            throw new BadRequestException({ code: 'self_impersonation', message: 'No tiene sentido impersonarte a vos mismo', data: { status: 400 } });
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
    ): Promise<void> {
        const token = randomBytes(32).toString('base64url');
        await this.redis.set(resetKey(token), String(userId), 'EX', RESET_TTL_SECONDS);
        const link = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/reset?token=${token}`;
        const invite = kind === 'invite';
        const subject = invite ? 'Te crearon una cuenta en Imagina Base' : 'Restablecer tu contraseña — Imagina Base';
        const intro = invite
            ? 'Se creó una cuenta para vos en Imagina Base. Definí tu contraseña para entrar'
            : 'Se solicitó restablecer tu contraseña';
        const cta = invite ? 'Definir contraseña' : 'Restablecer contraseña';
        await this.mail.enqueue({
            to: email,
            subject,
            html: `<p>Hola ${escapeHtml(name)},</p><p>${intro} — el enlace vence en 30 minutos:</p><p><a href="${link}">${cta}</a></p>`,
            text: `${cta} (vence en 30 min): ${link}`,
        });
    }

    /**
     * Alta de usuario + su primer workspace + membership admin, en UNA
     * transacción. La membership exige `app.tenant_id`/`app.user_id` en el
     * contexto (WITH CHECK de las policies RLS).
     */
    async register(input: RegisterInput): Promise<AuthSession> {
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

        // v0.1.118 — se manda la verificación del email, pero el alta entra
        // igual: bloquear el primer uso mata la activación. La interfaz avisa
        // que falta confirmar. Best-effort: un fallo de correo no rompe el
        // registro (se puede reenviar desde Ajustes).
        void this.sendEmailVerification(result.user.id).catch(() => undefined);

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

    async login(
        input: LoginInput,
        meta: { userAgent?: string; ip?: string } = {},
    ): Promise<AuthSession | MfaChallenge> {
        // Freno por cuenta: se chequea ANTES de tocar la DB o verificar el hash
        // (argon2 es caro a propósito; no queremos gastarlo con el atacante).
        const failKey = loginFailKey(input.email);
        const fails = Number((await this.redis.get(failKey)) ?? 0);
        if (fails >= LOGIN_FAIL_MAX) {
            throw new HttpException(
                {
                    code: 'too_many_attempts',
                    message:
                        'Demasiados intentos fallidos para esta cuenta. Esperá unos minutos o restablecé tu contraseña.',
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
            // Se cuenta el fallo (ventana deslizante de 15 min).
            const n = await this.redis.incr(failKey);
            if (n === 1) await this.redis.expire(failKey, LOGIN_FAIL_WINDOW_SECONDS);
            throw new UnauthorizedException('Credenciales inválidas');
        }

        // Cuenta desactivada por el operador (ADR-S15 F2): credenciales válidas
        // pero el acceso está bloqueado. Se revela sólo tras autenticar bien.
        if (user.disabledAt) {
            throw new ForbiddenException({
                code: 'account_disabled',
                message: 'Tu cuenta está desactivada. Contactá al administrador.',
                data: { status: 403 },
            });
        }

        // Login bueno → se limpia el contador de fallos de la cuenta.
        await this.redis.del(failKey);

        // v0.1.120 — con segundo factor activo NO se abre sesión todavía: se
        // devuelve un desafío de un solo uso que hay que canjear con el código.
        if (user.totpEnabledAt !== null) {
            const challenge = randomBytes(32).toString('base64url');
            await this.redis.set(
                mfaKey(challenge),
                JSON.stringify({ userId: user.id, ...meta }),
                'EX',
                MFA_CHALLENGE_TTL_SECONDS,
            );
            return { mfa_required: true, challenge };
        }

        const token = await this.sessions.create(user.id, meta);
        return {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id),
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
    async verifyTwoFactorLogin(input: VerifyTwoFactorInput): Promise<AuthSession> {
        const raw = await this.redis.get(mfaKey(input.challenge));
        if (raw === null) {
            throw new UnauthorizedException({
                code: 'mfa_challenge_expired',
                message: 'El desafío venció. Volvé a ingresar tu contraseña.',
                data: { status: 401 },
            });
        }
        const parsed = JSON.parse(raw) as { userId: number; userAgent?: string; ip?: string };
        const tries = await this.redis.incr(mfaTriesKey(input.challenge));
        if (tries === 1) await this.redis.expire(mfaTriesKey(input.challenge), MFA_CHALLENGE_TTL_SECONDS);
        if (tries > MFA_MAX_TRIES) {
            await this.redis.del(mfaKey(input.challenge));
            throw new UnauthorizedException({
                code: 'mfa_too_many_attempts',
                message: 'Demasiados códigos incorrectos. Volvé a ingresar tu contraseña.',
                data: { status: 401 },
            });
        }

        const [user] = await this.db.select().from(users).where(eq(users.id, parsed.userId)).limit(1);
        if (!user || user.totpEnabledAt === null || user.totpSecret === null) {
            throw new UnauthorizedException('Código inválido');
        }

        const secret = decryptSecret(user.totpSecret, this.env.SECRETS_KEY);
        let ok = verifyTotp(secret, input.code);
        if (!ok) ok = await this.consumeBackupCode(user.id, user.totpBackupCodes ?? [], input.code);
        if (!ok) throw new UnauthorizedException('Código inválido');

        await this.redis.del(mfaKey(input.challenge), mfaTriesKey(input.challenge));
        const token = await this.sessions.create(user.id, {
            userAgent: parsed.userAgent,
            ip: parsed.ip,
        });
        return {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id),
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
        await this.db.update(users).set({ totpBackupCodes: rest }).where(eq(users.id, userId));
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
                message: 'El alta venció. Volvé a empezar la configuración.',
                data: { status: 400 },
            });
        }
        if (!verifyTotp(secret, code)) {
            throw new BadRequestException({
                code: 'invalid_code',
                message: 'El código no coincide. Revisá la hora de tu teléfono e intentá de nuevo.',
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
        const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
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

        const valid = await argon2.verify(user.passwordHash, input.current_password).catch(() => false);
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

    /**
     * v0.1.118 — Manda (o remanda) el correo de verificación del alta.
     * Silencioso si el email ya está verificado: no filtra estado ni molesta.
     */
    async sendEmailVerification(userId: number): Promise<void> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user || user.emailVerifiedAt !== null) return;

        const token = randomBytes(32).toString('base64url');
        await this.redis.set(verifyKey(token), String(user.id), 'EX', VERIFY_TTL_SECONDS);
        const link = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/verify?token=${token}`;
        await this.mail.enqueue({
            to: user.email,
            subject: 'Confirmá tu email — Imagina Base',
            html: `<p>Hola ${escapeHtml(user.name)},</p><p>Confirmá tu dirección de correo para activar del todo tu cuenta. El enlace vence en 48 horas:</p><p><a href="${link}">Confirmar mi email</a></p><p>Si no creaste esta cuenta, ignorá este mensaje.</p>`,
            text: `Confirmá tu email (vence en 48 h): ${link}`,
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
                message: 'El enlace es inválido o expiró. Pedí uno nuevo desde Ajustes.',
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

    async me(userId: number, impersonatedBy?: number): Promise<AuthSession> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) {
            throw new UnauthorizedException('Usuario inexistente');
        }
        const session: AuthSession = {
            user: this.toSessionUser(user),
            memberships: await this.membershipsOf(user.id),
        };
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
