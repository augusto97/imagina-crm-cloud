import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SessionService } from './session.service';

export const SESSION_COOKIE = 'imbase_session';

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
