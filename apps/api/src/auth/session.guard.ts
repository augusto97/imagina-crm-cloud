import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    HttpException,
    Inject,
    Injectable,
    Optional,
    UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { PersonalTokensService, TOKEN_PREFIX } from '../ai/tokens.service';
import { routePath, type RoutePathSource } from '../common/route-path';
import { REDIS } from '../redis/redis.module';
import { apiTokenRouteAllowed, checkApiBudget } from './api-token';
import { SessionService } from './session.service';

export const SESSION_COOKIE = 'imbase_session';
/**
 * v0.1.241 — cookie PROPIA de la sesión del portal del cliente. Antes el portal
 * y la app compartían `imbase_session`: abrir un enlace del portal en el mismo
 * navegador cerraba la sesión de trabajo (y la de una persona que es del equipo
 * de una empresa y cliente de otra, justamente el caso que ahora se permite).
 */
export const PORTAL_SESSION_COOKIE = 'imbase_portal';

/** Rutas del portal autenticado (las que leen la cookie del portal). */
/**
 * Se decide sobre la RUTA que resolvió el router (`routePath`), no sobre el
 * texto de la dirección: `/api/v1/%70ortal/me` llega al mismo controlador que
 * `/api/v1/portal/me` y antes entraba por la rama general, con una sesión de
 * trabajo.
 */
export function isPortalApiPath(req: RoutePathSource): boolean {
    return routePath(req).startsWith('/api/v1/portal/');
}

/** Rutas que una sesión del portal puede usar: el portal y cerrar sesión. */
export function isPortalPath(req: RoutePathSource): boolean {
    const path = routePath(req);
    return path.startsWith('/api/v1/portal/') || path === '/api/v1/auth/logout';
}

/**
 * Autenticación por sesión opaca: cookie httpOnly (SPA) o `Authorization:
 * Bearer` (API). Deja `authUserId` y `sessionToken` en el request.
 */
@Injectable()
export class SessionGuard implements CanActivate {
    constructor(
        private readonly sessions: SessionService,
        // v0.1.441 (G1) — tokens de la API REST. Opcionales: el guard se arma
        // a mano en algunos lugares (callback OAuth, tests) sin ellos, y ahí
        // un token simplemente no sirve.
        @Optional() private readonly apiTokens?: PersonalTokensService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        if (isPortalApiPath(req)) return this.activatePortal(req);
        const token = this.extractToken(req);
        if (!token) {
            throw new UnauthorizedException('Sesión requerida');
        }
        if (token.startsWith(TOKEN_PREFIX)) {
            return this.activateApiToken(req, context.switchToHttp().getResponse<FastifyReply>(), token);
        }
        const session = await this.sessions.get(token);
        if (!session) {
            throw new UnauthorizedException('Sesión inválida o expirada');
        }
        req.authUserId = session.userId;
        req.sessionToken = token;
        req.impersonatedBy = session.impersonatedBy;
        req.sessionVia = session.via;
        if (session.boundTenantId !== undefined) req.boundTenantId = session.boundTenantId;
        // SEC-24 (v0.1.225): una sesión abierta con un enlace del portal sólo
        // sirve para el portal. Sin este corte, el enlace de una cuenta que no
        // era cliente (el caso del superadmin) daba acceso a TODO lo que esa
        // cuenta podía hacer.
        if (session.portalTenantId !== undefined) {
            req.portalTenantId = session.portalTenantId;
            if (!isPortalPath(req)) {
                throw new ForbiddenException({
                    code: 'portal_session_scope',
                    message: 'Esta sesión es del portal del cliente',
                    data: { status: 403 },
                });
            }
        }
        return true;
    }

    /**
     * v0.1.241 — `/portal/*` sólo acepta una sesión DEL PORTAL: la de su cookie
     * propia o, para las abiertas antes de esta versión, la que quedó en la
     * cookie general. Una sesión de trabajo (contraseña, impersonación) nunca
     * ve un portal: el portal de una persona se abre con SU enlace.
     */
    private async activatePortal(req: FastifyRequest): Promise<boolean> {
        const candidates = [req.cookies?.[PORTAL_SESSION_COOKIE], req.cookies?.[SESSION_COOKIE]].filter(
            (t): t is string => typeof t === 'string' && t !== '',
        );
        if (candidates.length === 0) throw new UnauthorizedException('Sesión requerida');
        for (const token of candidates) {
            const session = await this.sessions.peek(token);
            if (!session || session.portalTenantId === undefined || session.impersonatedBy !== undefined) continue;
            // Desliza el TTL sólo de la sesión que se usa.
            const live = await this.sessions.get(token);
            if (!live || live.portalTenantId === undefined) continue;
            req.authUserId = live.userId;
            req.sessionToken = token;
            req.sessionVia = live.via;
            req.portalTenantId = live.portalTenantId;
            req.portalLinkId = live.portalLinkId;
            req.portalAccount = live.portalAccount === true;
            return true;
        }
        throw new UnauthorizedException({
            code: 'portal_session_required',
            message: 'Entra al portal con tu enlace de acceso',
            data: { status: 401 },
        });
    }

    /**
     * v0.1.441 (G1) — `Authorization: Bearer ib_pat_…` de un token creado «para
     * la API». Actúa como la persona que lo creó, en SU empresa (TenantGuard
     * la fija), sólo en las rutas de `API_TOKEN_ROUTES` y con un freno por
     * token y por empresa. Un token del MCP, vencido, revocado, de alguien que
     * ya no está o de una empresa pausada da 401 sin decir por qué.
     */
    private async activateApiToken(req: FastifyRequest, reply: FastifyReply | undefined, secret: string): Promise<boolean> {
        if (!this.apiTokens) throw new UnauthorizedException('Sesión requerida');
        const resolved = await this.apiTokens.resolveForApi(secret);
        if (!resolved) {
            throw new UnauthorizedException({ code: 'api_token_invalid', message: 'El token no es válido, venció o fue revocado.', data: { status: 401 } });
        }
        const verdict = apiTokenRouteAllowed(req.method, routePath(req), resolved.scope);
        if (!verdict.ok) throw new ForbiddenException({ code: verdict.code, message: verdict.message, data: { status: 403 } });
        if (this.redis) {
            const budget = await checkApiBudget(this.redis, { tokenId: resolved.tokenId, tenantId: resolved.tenantId });
            if (budget.limit !== undefined && reply && typeof reply.header === 'function') {
                // Pisan las del límite general por IP (que corre antes): con
                // un token, lo que cuenta es el cupo del token.
                reply.header('X-RateLimit-Limit', String(budget.limit));
                reply.header('X-RateLimit-Remaining', String(budget.remaining ?? 0));
                reply.header('X-RateLimit-Reset', String(budget.retryAfter ?? 60));
            }
            if (!budget.ok) {
                if (reply && typeof reply.header === 'function') reply.header('Retry-After', String(budget.retryAfter ?? 60));
                throw new HttpException(
                    { code: 'api_rate_limited', message: 'Demasiados pedidos con este token: espera un minuto.', data: { status: 429, retry_after: budget.retryAfter ?? 60 } },
                    429,
                );
            }
        }
        req.authUserId = resolved.userId;
        req.apiToken = { id: resolved.tokenId, tenantId: resolved.tenantId, scope: resolved.scope };
        return true;
    }

    private extractToken(req: FastifyRequest): string | null {
        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
            return header.slice('Bearer '.length).trim();
        }
        return req.cookies?.[SESSION_COOKIE] ?? null;
    }
}
