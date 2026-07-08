import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Bootstrap } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BootstrapService } from './bootstrap.service';

@Controller('bootstrap')
@UseGuards(SessionGuard, TenantGuard)
export class BootstrapController {
    constructor(private readonly bootstrap: BootstrapService) {}

    /** Todo lo necesario para el primer paint del workspace activo. */
    @Get()
    build(@Req() req: FastifyRequest): Promise<Bootstrap> {
        return this.bootstrap.build(req.authUserId!, req.tenant!);
    }
}
