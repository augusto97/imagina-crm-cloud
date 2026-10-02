import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

export interface SessionData {
    userId: number;
    createdAt: string;
    /** Impersonación (ADR-S15 F5): userId del operador que impersona. */
    impersonatedBy?: number;
    /** Token de la sesión original del operador (para volver al salir). */
    origToken?: string;
    /** Tope duro de la impersonación (ISO); pasada esta fecha la sesión muere. */
    expiresAt?: string;
    /** Fila de `impersonation_log` para marcar el cierre. */
    auditId?: number;
    /** v0.1.116 — contexto del dispositivo, para el panel de sesiones activas. */
    userAgent?: string;
    ip?: string;
    /**
     * SEC-24 (v0.1.225) — la sesión se abrió canjeando un enlace del PORTAL de
     * esta empresa. No es una sesión de cuenta: SessionGuard la limita a
     * `/portal/*`, así que no sirve para la app, la consola de plataforma ni
     * para cambiar contraseña/tokens de esa cuenta.
     */
    portalTenantId?: number;
    /**
     * v0.1.241 — el acceso (vínculo) con el que se abrió: el portal arranca
     * mostrando ESE registro si la persona tiene varios en la empresa.
     */
    portalLinkId?: number;
    /**
     * v0.1.241 — la sesión puede LISTAR y abrir las cuentas de la persona en
     * otras empresas. Sólo la tienen las sesiones abiertas con un enlace que
     * llegó a su correo (nunca uno que la empresa pudo copiar) y en un host de
     * la plataforma (un dominio propio lo controla una empresa).
     */
    portalAccount?: boolean;
    /**
     * SEC-24 — cómo se abrió la sesión. `password` = login con contraseña (y
     * 2FA si la cuenta lo tiene). La consola de plataforma exige `password`:
     * así las sesiones abiertas ANTES de v0.1.225 (sin marca, entre ellas las
     * que pudo haber acuñado el enlace del portal) tienen que volver a entrar.
     */
    via?: 'password' | 'portal';
}

/** Sesión activa tal como la ve el dueño de la cuenta (nunca expone el token). */
export interface ActiveSession {
    /** Id PÚBLICO: hash del token. El token es la credencial y no sale nunca. */
    id: string;
    created_at: string;
    /** Aproximado a partir del TTL restante (el TTL es deslizante). */
    last_seen_at: string;
    user_agent: string;
    ip: string;
    current: boolean;
    impersonated: boolean;
}

/**
 * Sesiones opacas en Redis (STANDALONE.md §5): revocación instantánea,
 * sin JWT stateless. TTL deslizante — cada lectura renueva la expiración.
 */
@Injectable()
export class SessionService {
    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    private key(token: string): string {
        return `sess:${token}`;
    }

    /** Índice inverso userId → tokens, para revocar TODAS sus sesiones (desactivación). */
    private userKey(userId: number): string {
        return `usess:${userId}`;
    }

    /** Id público de una sesión (para listarla/revocarla sin exponer el token). */
    private publicId(token: string): string {
        return createHash('sha256').update(token).digest('hex').slice(0, 16);
    }

    async create(
        userId: number,
        meta: {
            userAgent?: string;
            ip?: string;
            portalTenantId?: number;
            portalLinkId?: number;
            portalAccount?: boolean;
            via?: 'password' | 'portal';
        } = {},
    ): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const data: SessionData = {
            userId,
            createdAt: new Date().toISOString(),
            userAgent: (meta.userAgent ?? '').slice(0, 200),
            ip: (meta.ip ?? '').slice(0, 60),
            ...(meta.portalTenantId !== undefined
                ? {
                      portalTenantId: meta.portalTenantId,
                      via: 'portal' as const,
                      ...(meta.portalLinkId !== undefined ? { portalLinkId: meta.portalLinkId } : {}),
                      ...(meta.portalAccount === true ? { portalAccount: true } : {}),
                  }
                : {}),
            ...(meta.via === 'password' ? { via: 'password' as const } : {}),
        };
        await this.redis.set(this.key(token), JSON.stringify(data), 'EX', this.env.SESSION_TTL_SECONDS);
        // Registrar el token en el set del usuario (para revocación masiva). El
        // set vive un poco más que la sesión; los tokens ya expirados se limpian
        // solos al revocar (del es no-op).
        await this.redis.sadd(this.userKey(userId), token);
        await this.extendIndex(userId, this.env.SESSION_TTL_SECONDS * 2);
        return token;
    }

    /**
     * El índice inverso vive AL MENOS `ttl` segundos más: nunca se acorta (un
     * `EXPIRE` pelado pisa el TTL aunque sea menor). NX para el índice recién
     * creado (sin TTL), GT para no bajar uno más largo.
     */
    private async extendIndex(userId: number, ttl: number): Promise<void> {
        await this.redis
            .pipeline()
            .expire(this.userKey(userId), ttl, 'NX')
            .expire(this.userKey(userId), ttl, 'GT')
            .exec();
    }

    /** Revoca TODAS las sesiones de un usuario (al desactivar la cuenta). */
    async destroyAllForUser(userId: number): Promise<void> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        if (tokens.length > 0) {
            await this.redis.del(...tokens.map((t) => this.key(t)));
        }
        await this.redis.del(this.userKey(userId));
    }

    /** SEC-24 — revoca sólo las sesiones del portal de UNA empresa. */
    async destroyPortalSessions(userId: number, tenantId: number): Promise<number> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        if (tokens.length === 0) return 0;
        const raws = await this.redis.mget(...tokens.map((t) => this.key(t)));
        const doomed = tokens.filter((_, i) => {
            const raw = raws[i];
            if (!raw) return false;
            return (JSON.parse(raw) as SessionData).portalTenantId === tenantId;
        });
        if (doomed.length > 0) {
            await this.redis.del(...doomed.map((t) => this.key(t)));
            await this.redis.srem(this.userKey(userId), ...doomed);
        }
        return doomed.length;
    }

    /**
     * SEC-35 (v0.1.239): lee la sesión SIN deslizar su TTL. Para el re-chequeo
     * periódico de los sockets: una pestaña abierta y olvidada no tiene que
     * mantener viva la sesión para siempre.
     */
    async peek(token: string): Promise<SessionData | null> {
        const raw = await this.redis.get(this.key(token));
        if (!raw) return null;
        const data = JSON.parse(raw) as SessionData;
        if (data.expiresAt && Date.parse(data.expiresAt) < Date.now()) return null;
        return data;
    }

    async get(token: string): Promise<SessionData | null> {
        const raw = await this.redis.getex(this.key(token), 'EX', this.env.SESSION_TTL_SECONDS);
        if (!raw) {
            return null;
        }
        const data = JSON.parse(raw) as SessionData;
        // SEC-26: el TTL de la sesión se desliza con el uso; el del índice
        // también (si no, una sesión usada a diario sobrevivía al índice a los
        // 60 días y quedaba fuera de toda revocación masiva).
        void this.extendIndex(data.userId, this.env.SESSION_TTL_SECONDS * 2).catch(() => undefined);
        // Tope duro de impersonación: aunque getex renueve el TTL de Redis, una
        // sesión impersonada muere pasada su `expiresAt`.
        if (data.expiresAt && Date.parse(data.expiresAt) < Date.now()) {
            await this.destroy(token);
            return null;
        }
        return data;
    }

    /**
     * Crea una sesión de IMPERSONACIÓN (operador → usuario objetivo). TTL corto
     * y tope duro `expiresAt`. Guarda el token original del operador para poder
     * volver, y el id de la fila de auditoría para cerrarla al salir.
     */
    async createImpersonation(params: {
        targetUserId: number;
        operatorId: number;
        origToken: string;
        auditId: number;
        ttlSeconds: number;
    }): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const data: SessionData = {
            userId: params.targetUserId,
            createdAt: new Date().toISOString(),
            impersonatedBy: params.operatorId,
            origToken: params.origToken,
            expiresAt: new Date(Date.now() + params.ttlSeconds * 1000).toISOString(),
            auditId: params.auditId,
        };
        await this.redis.set(this.key(token), JSON.stringify(data), 'EX', params.ttlSeconds);
        // Bajo el índice del OBJETIVO: si lo desactivan, también cae la impersonación.
        await this.redis.sadd(this.userKey(params.targetUserId), token);
        // SEC-26 (v0.1.226): antes esto ACORTABA el índice del objetivo a la
        // hora de la impersonación → sus sesiones normales salían del índice y
        // "cerrar todas" / reset / desactivar ya no las alcanzaba.
        await this.extendIndex(params.targetUserId, params.ttlSeconds);
        return token;
    }

    /**
     * v0.1.116 — Sesiones activas del usuario (panel "Dispositivos").
     *
     * El `last_seen` se DERIVA del TTL restante: como el TTL es deslizante (se
     * renueva en cada request autenticada), `ttl` dice cuánto hace que no se
     * usa, sin tener que escribir en Redis en cada request.
     */
    async listForUser(userId: number, currentToken: string): Promise<ActiveSession[]> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        if (tokens.length === 0) return [];
        // UN pipeline en vez de 2 round-trips por sesión: una cuenta con
        // muchas sesiones abiertas (el índice inverso las acumula hasta que
        // expiran) hacía cientos de idas y vueltas a Redis por request.
        const pipeline = this.redis.pipeline();
        for (const token of tokens) {
            pipeline.get(this.key(token));
            pipeline.ttl(this.key(token));
        }
        const replies = (await pipeline.exec()) ?? [];

        const out: ActiveSession[] = [];
        const stale: string[] = [];
        for (const [i, token] of tokens.entries()) {
            const raw = replies[i * 2]?.[1] as string | null | undefined;
            const ttl = Number(replies[i * 2 + 1]?.[1] ?? -1);
            if (!raw) {
                stale.push(token);
                continue;
            }
            const data = JSON.parse(raw) as SessionData;
            const idleSeconds = Math.max(0, this.env.SESSION_TTL_SECONDS - Math.max(ttl, 0));
            out.push({
                id: this.publicId(token),
                created_at: data.createdAt,
                last_seen_at: new Date(Date.now() - idleSeconds * 1000).toISOString(),
                user_agent: data.userAgent ?? '',
                ip: data.ip ?? '',
                current: token === currentToken,
                impersonated: data.impersonatedBy !== undefined,
            });
        }
        // Limpieza oportunista del índice inverso (tokens ya expirados).
        if (stale.length > 0) await this.redis.srem(this.userKey(userId), ...stale);
        return out.sort((a, b) => (a.current ? -1 : b.current ? 1 : b.last_seen_at.localeCompare(a.last_seen_at)));
    }

    /** Revoca UNA sesión del usuario por su id público. `false` si no existe. */
    async destroyOneForUser(userId: number, publicId: string): Promise<boolean> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        const match = tokens.find((t) => this.publicId(t) === publicId);
        if (!match) return false;
        await this.redis.del(this.key(match));
        await this.redis.srem(this.userKey(userId), match);
        return true;
    }

    /** Cierra todas MENOS la actual ("cerrar sesión en los otros dispositivos"). */
    async destroyOthersForUser(userId: number, keepToken: string): Promise<number> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        const others = tokens.filter((t) => t !== keepToken);
        if (others.length === 0) return 0;
        await this.redis.del(...others.map((t) => this.key(t)));
        await this.redis.srem(this.userKey(userId), ...others);
        return others.length;
    }

    async destroy(token: string): Promise<void> {
        await this.redis.del(this.key(token));
    }
}
