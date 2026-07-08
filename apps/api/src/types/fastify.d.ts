import type { TenantContext } from '../tenancy/tenant.guard';

declare module 'fastify' {
    interface FastifyRequest {
        /** Seteado por SessionGuard. */
        authUserId?: number;
        /** Token de la sesión activa (para logout). */
        sessionToken?: string;
        /** Seteado por TenantGuard. */
        tenant?: TenantContext;
    }
}
