import { Controller, Get, HttpCode, NotFoundException, Query, Req } from '@nestjs/common';
import type { PublicBoot } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
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
    constructor(private readonly domains: DomainsService) {}

    @Get('boot')
    boot(@Req() req: FastifyRequest): Promise<PublicBoot> {
        const fwd = req.headers['x-forwarded-host'];
        const host = (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.headers.host;
        return this.domains.resolveHost(host);
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
