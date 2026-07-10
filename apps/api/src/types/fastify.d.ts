import type { TenantContext } from '../tenancy/tenant.guard';

declare module 'fastify' {
    interface FastifyRequest {
        /** Seteado por SessionGuard. */
        authUserId?: number;
        /** Token de la sesión activa (para logout). */
        sessionToken?: string;
        /** Si la sesión es de impersonación: userId del operador. */
        impersonatedBy?: number;
        /** Seteado por TenantGuard. */
        tenant?: TenantContext;
    }
}
