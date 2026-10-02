import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import {
    platformDomainCheckSchema,
    type PlatformDomain,
    type PlatformDomains,
} from '@imagina-base/shared';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DomainsService } from './domains.service';

/**
 * v0.1.246 — Plataforma → Dominios (sólo superadmin). Con ServerAvatar cada
 * dominio de una empresa se habilita a mano como alias del servidor web: acá
 * el operador ve qué hay que agregar (verificado pero no responde), qué ya
 * funciona y qué hay que sacar (dominios que una empresa dejó de usar).
 */
@Controller('platform/domains')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformDomainsController {
    constructor(private readonly domains: DomainsService) {}

    @Get()
    list(): Promise<PlatformDomains> {
        return this.domains.listForPlatform();
    }

    /** Re-comprueba UN dominio sin caché (después de agregar el alias). */
    @Post('check')
    @HttpCode(200)
    async check(
        @Body(new ZodValidationPipe(platformDomainCheckSchema)) body: z.infer<typeof platformDomainCheckSchema>,
    ): Promise<PlatformDomain> {
        const entry = await this.domains.checkForPlatform(body.tenant_id, body.kind);
        if (!entry) {
            throw new NotFoundException({ code: 'domain_not_found', message: 'Esa empresa no tiene ese dominio', data: { status: 404 } });
        }
        return entry;
    }

    /** "Ya lo saqué del servidor": deja de figurar en la lista para quitar. */
    @Delete('retired/:domain')
    @HttpCode(204)
    async dismiss(@Param('domain') domain: string): Promise<void> {
        await this.domains.dismissRetired(domain);
    }
}
