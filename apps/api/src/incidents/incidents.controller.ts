import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { listIncidentsQuerySchema, type IncidentsPage, type ListIncidentsQuery, type Role } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { IncidentsService } from './incidents.service';

/**
 * v0.1.285 (ADR-S44) — Problemas de la empresa. El admin ve todos; el resto,
 * los de lo que creó (una conexión privada, por ejemplo). Se pueden leer y
 * cerrar en solo-lectura (ADR-S09): no toca datos de la empresa.
 */
@Controller('workspaces/current/incidents')
@UseGuards(SessionGuard, TenantGuard)
export class IncidentsController {
    constructor(private readonly svc: IncidentsService) {}

    @Get()
    async list(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(listIncidentsQuerySchema)) q: ListIncidentsQuery,
    ): Promise<{ data: IncidentsPage }> {
        return { data: await this.svc.list(req.tenant!.tenantId, viewer(req), q) };
    }

    @Post(':id/resolve')
    @HttpCode(200)
    @AllowReadOnly()
    async resolve(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: { ok: true } }> {
        await this.svc.markResolved(req.tenant!.tenantId, viewer(req), id);
        return { data: { ok: true } };
    }
}

function viewer(req: FastifyRequest): { userId: number; role: Role } {
    return { userId: req.authUserId!, role: req.tenant!.role as Role };
}
