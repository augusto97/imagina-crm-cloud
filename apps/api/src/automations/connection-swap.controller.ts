import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
    applyConnectionSwapSchema,
    type ApplyConnectionSwapInput,
    type ConnectionSwapPreview,
    type ConnectionSwapResult,
    type Role,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { ConnectionSwapService } from './connection-swap.service';

/**
 * v0.1.400 — «Reemplazar en automatizaciones» desde una conexión de
 * Integraciones. Vive en el módulo de automatizaciones (es quien las guarda);
 * la ruta cuelga de la conexión DESTINO.
 */
@Controller('connections')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_automations')
@PlanModule('automations')
export class ConnectionSwapController {
    constructor(private readonly swap: ConnectionSwapService) {}

    /** Qué se puede pasar a esta conexión, agrupado por origen. */
    @Get(':id/swap')
    async preview(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: ConnectionSwapPreview }> {
        const data = await this.swap.preview(req.tenant!.tenantId, req.authUserId!, req.tenant!.role as Role, id);
        return { data };
    }

    /** Pasa los orígenes elegidos: cada automatización queda con su versión en el historial. */
    @Post(':id/swap')
    @HttpCode(200)
    async apply(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(applyConnectionSwapSchema)) input: ApplyConnectionSwapInput,
    ): Promise<{ data: ConnectionSwapResult }> {
        const data = await this.swap.apply(req.tenant!.tenantId, req.authUserId!, req.tenant!.role as Role, id, input.sources);
        return { data };
    }
}
