import { Controller, Get, HttpCode, NotFoundException, Query, Req } from '@nestjs/common';
import type { PublicBoot } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { PlatformBrandService } from '../brand/platform-brand.service';
import { DomainsService } from './domains.service';

/**
 * Endpoints PÚBLICOS del white-label por dominio (ADR-S17) — sin auth:
 *
 * - `GET /public/boot`: el SPA lo llama al arrancar con el Host de la URL;
 *   si es un dominio/subdominio de un tenant devuelve su marca para pintarla
 *   ANTES del login. Solo expone datos de marca (nada operativo).
 * - `GET /public/domains/check?domain=`: el `ask` del `on_demand_tls` de
 *   Caddy — 200 = emitir certificado, 404 = rechazar (evita que cualquiera
 *   apunte un dominio y nos haga pedir certs arbitrarios).
 */
@Controller('public')
export class PublicDomainsController {
    constructor(
        private readonly domains: DomainsService,
        private readonly brand: PlatformBrandService,
    ) {}

    @Get('boot')
    async boot(@Req() req: FastifyRequest): Promise<PublicBoot> {
        const fwd = req.headers['x-forwarded-host'];
        const host = (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.headers.host;
        const [hostBoot, platform] = await Promise.all([this.domains.resolveHost(host), this.brand.get()]);
        // v0.1.423 — En el dominio de una tienda no hay app: el SPA se va a la
        // tienda (a `/` si el servidor ya le pasa esa ruta al API; si no, la
        // dirección de la tienda en la plataforma, que funciona siempre).
        const shop = hostBoot.tenant ? null : await this.domains.resolveShopHost(host);
        return { ...hostBoot, platform, shop: shop ? { path: `/api/v1/public/s/${shop.token}` } : null };
    }

    @Get('domains/check')
    @HttpCode(200)
    async check(@Query('domain') domain?: string): Promise<{ ok: true }> {
        if (!(await this.domains.isServableDomain(domain))) {
            throw new NotFoundException({ code: 'domain_unknown', message: 'Dominio no registrado', data: { status: 404 } });
        }
        return { ok: true };
    }
}
