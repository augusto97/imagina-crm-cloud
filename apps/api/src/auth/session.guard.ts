import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
export function isPortalApiPath(url: string): boolean {
    return (url.split('?')[0] ?? '').startsWith('/api/v1/portal/');
}

/** Rutas que una sesión del portal puede usar: el portal y cerrar sesión. */
export function isPortalPath(url: string): boolean {
    const path = url.split('?')[0] ?? '';
    return path.startsWith('/api/v1/portal/') || path === '/api/v1/auth/logout';
}

/**
 * Autenticación por sesión opaca: cookie httpOnly (SPA) o `Authorization:
 * Bearer` (API). Deja `authUserId` y `sessionToken` en el request.
 */
@Injectable()
export class SessionGuard implements CanActivate {
    constructor(private readonly sessions: SessionService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        if (isPortalApiPath(req.url)) return this.activatePortal(req);
        const token = this.extractToken(req);
        if (!token) {
            throw new UnauthorizedException('Sesión requerida');
        }
        const session = await this.sessions.get(token);
        if (!session) {
            throw new UnauthorizedException('Sesión inválida o expirada');
        }
        req.authUserId = session.userId;
        req.sessionToken = token;
        req.impersonatedBy = session.impersonatedBy;
        req.sessionVia = session.via;
        // SEC-24 (v0.1.225): una sesión abierta con un enlace del portal sólo
        // sirve para el portal. Sin este corte, el enlace de una cuenta que no
        // era cliente (el caso del superadmin) daba acceso a TODO lo que esa
        // cuenta podía hacer.
        if (session.portalTenantId !== undefined) {
            req.portalTenantId = session.portalTenantId;
            if (!isPortalPath(req.url)) {
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
            message: 'Entrá al portal con tu enlace de acceso',
            data: { status: 401 },
        });
    }

    private extractToken(req: FastifyRequest): string | null {
        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
            return header.slice('Bearer '.length).trim();
        }
        return req.cookies?.[SESSION_COOKIE] ?? null;
    }
}
