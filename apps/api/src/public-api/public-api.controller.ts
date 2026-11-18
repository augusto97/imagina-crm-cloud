import { Controller, Get, Header, Inject, NotFoundException, Req, Res, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requestOrigin } from '../ai/oauth.util';
import { SessionGuard } from '../auth/session.guard';
import { DRIZZLE, type Db } from '../db/client';
import { tenants, users } from '../db/schema';
import { appVersion } from '../observability/client-errors';
import { TenantGuard } from '../tenancy/tenant.guard';
import { N8N_TARBALL, n8nPackageInfo, n8nTarball, type N8nPackageInfo } from './n8n-package';
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

    /**
     * v0.1.443 — La app de n8n que trae este servidor: nombre del paquete,
     * versión y si se puede bajar de aquí (un n8n propio la instala con npm
     * desde la dirección de abajo). Público: es código abierto (MIT).
     */
    @Get('public/n8n')
    @Header('Cache-Control', 'public, max-age=300')
    n8nInfo(@Req() req: FastifyRequest): { data: N8nPackageInfo & { download_url: string | null } } {
        const info = n8nPackageInfo();
        return { data: { ...info, download_url: info.available ? `${requestOrigin(req)}/api/v1/public/n8n/${N8N_TARBALL}` : null } };
    }

    @Get(`public/n8n/${N8N_TARBALL}`)
    n8nPackage(@Res() reply: FastifyReply): void {
        const pkg = n8nTarball();
        if (!pkg) throw new NotFoundException({ code: 'n8n_package_unavailable', message: 'Este servidor no trae la app de n8n.', data: { status: 404 } });
        // `identity`: un .tgz ya viene comprimido y conserva su content-length.
        void reply
            .header('content-type', 'application/gzip')
            .header('content-encoding', 'identity')
            .header('content-length', String(pkg.bytes.length))
            .header('content-disposition', `attachment; filename="${pkg.filename}"`)
            .header('cache-control', 'public, max-age=3600')
            .header('x-content-type-options', 'nosniff')
            .send(pkg.bytes);
    }
}
