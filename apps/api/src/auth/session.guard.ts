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

    private extractToken(req: FastifyRequest): string | null {
        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
            return header.slice('Bearer '.length).trim();
        }
        return req.cookies?.[SESSION_COOKIE] ?? null;
    }
}
