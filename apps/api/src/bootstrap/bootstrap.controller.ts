import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Bootstrap } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BootstrapService } from './bootstrap.service';

/**
 * SEC-07: `/bootstrap` devuelve toda la estructura del tenant (listas, campos,
 * vistas, capabilities). Requiere `access_admin` para que el rol `client`
 * (usuario externo del portal, sin esa capability) no pueda enumerar el
 * esquema del workspace — su superficie es solo `/portal/*`.
 */
@Controller('bootstrap')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class BootstrapController {
    constructor(private readonly bootstrap: BootstrapService) {}

    /** Todo lo necesario para el primer paint del workspace activo. */
    @Get()
    @RequireCapability('access_admin')
    build(@Req() req: FastifyRequest): Promise<Bootstrap> {
        return this.bootstrap.build(req.authUserId!, req.tenant!);
    }
}
