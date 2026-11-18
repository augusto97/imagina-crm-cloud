import type { TenantContext } from '../tenancy/tenant.guard';

declare module 'fastify' {
    interface FastifyRequest {
        /** Seteado por SessionGuard. */
        authUserId?: number;
        /** Token de la sesión activa (para logout). */
        sessionToken?: string;
        /** Si la sesión es de impersonación: userId del operador. */
        impersonatedBy?: number;
        /**
         * SEC-24 — la sesión salió de un enlace del portal: es de ESA empresa y
         * sólo vale para `/portal/*`.
         */
        portalTenantId?: number;
        /** v0.1.241 — acceso con el que se abrió la sesión del portal. */
        portalLinkId?: number;
        /** v0.1.241 — la sesión del portal ve las cuentas de todas sus empresas. */
        portalAccount?: boolean;
        /** SEC-24 — cómo se abrió la sesión (ver SessionData.via). */
        sessionVia?: 'password' | 'portal';
        /** La sesión se abrió en la dirección de esta empresa: sólo sirve para ella. */
        boundTenantId?: number;
        /**
         * v0.1.441 (G1) — el pedido llegó con un token de la API REST: actúa
         * como `authUserId` en ESA empresa (TenantGuard la fija) y con ese alcance.
         */
        apiToken?: { id: number; tenantId: number; scope: 'read' | 'full' };
        /** Seteado por TenantGuard. */
        tenant?: TenantContext;
    }
}
