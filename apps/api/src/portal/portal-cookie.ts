import type { FastifyReply, FastifyRequest } from 'fastify';
import { PORTAL_SESSION_COOKIE } from '../auth/session.guard';
import type { SessionService } from '../auth/session.service';
import type { Env } from '../config/env';

/**
 * Deja abierta en el navegador la sesión del portal recién creada (con un
 * enlace o con la contraseña). v0.1.241: cookie PROPIA del portal, así abrir
 * un portal no cierra la sesión de trabajo de la app en el mismo navegador; y
 * la sesión del portal que hubiera antes en este navegador se cierra (si no,
 * quedaba viva 30 días sin que nadie la usara).
 */
export async function openPortalSession(
    req: FastifyRequest,
    reply: FastifyReply,
    sessionToken: string,
    deps: { sessions: SessionService; env: Env },
): Promise<void> {
    const previous = req.cookies?.[PORTAL_SESSION_COOKIE];
    if (previous && previous !== sessionToken) {
        const old = await deps.sessions.peek(previous);
        if (old?.portalTenantId !== undefined) await deps.sessions.destroy(previous);
    }
    reply.setCookie(PORTAL_SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        // SEC-14: en producción SIEMPRE Secure.
        secure: deps.env.COOKIE_SECURE || deps.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: deps.env.SESSION_TTL_SECONDS,
    });
}
