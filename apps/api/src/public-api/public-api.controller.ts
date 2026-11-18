import { Controller, Get, Header, Inject, Req, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { requestOrigin } from '../ai/oauth.util';
import { SessionGuard } from '../auth/session.guard';
import { DRIZZLE, type Db } from '../db/client';
import { tenants, users } from '../db/schema';
import { appVersion } from '../observability/client-errors';
import { TenantGuard } from '../tenancy/tenant.guard';
import { buildOpenApiDocument } from './openapi';

export interface WhoAmI {
    user: { id: number; name: string; email: string };
    tenant: { id: number; slug: string; name: string };
    role: string;
    /** El token con el que se pidió (`null` = sesión de la app). */
    token: { id: number; scope: 'read' | 'full' } | null;
}

/**
 * v0.1.441 (G1) — Lo propio de la API pública: `GET /whoami` (probar un token
 * desde n8n, Make o un script) y `GET /openapi.json` (el documento que se
 * importa en esas herramientas, en Postman o en un generador de clientes).
 */
@Controller()
export class PublicApiController {
    constructor(@Inject(DRIZZLE) private readonly db: Db) {}

    @Get('whoami')
    @UseGuards(SessionGuard, TenantGuard)
    async whoami(@Req() req: FastifyRequest): Promise<WhoAmI> {
        const userId = req.authUserId!;
        const { tenantId, tenantSlug, role } = req.tenant!;
        // Conexión base (sin RLS) filtrada por los ids que ya validaron los guards.
        const [u] = await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        const [t] = await this.db
            .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        return {
            user: { id: userId, name: u?.name ?? '', email: u?.email ?? '' },
            tenant: { id: tenantId, slug: t?.slug ?? tenantSlug, name: t?.name ?? '' },
            role,
            token: req.apiToken ? { id: req.apiToken.id, scope: req.apiToken.scope } : null,
        };
    }

    /** Público y sin sesión: describe las rutas, no tiene datos de nadie. */
    @Get('openapi.json')
    @Header('Cache-Control', 'public, max-age=300')
    openapi(@Req() req: FastifyRequest): Record<string, unknown> {
        return buildOpenApiDocument({ serverUrl: `${requestOrigin(req)}/api/v1`, version: appVersion() });
    }
}
