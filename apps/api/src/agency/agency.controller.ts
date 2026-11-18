import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    createAgencyClientSchema,
    updateAgencyClientSchema,
    type AgencyClient,
    type AgencyEnterResult,
    type AgencyOverview,
    type CreateAgencyClientInput,
    type UpdateAgencyClientInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AgencyService, notAgency } from './agency.service';

/**
 * v0.1.449 (I3, ADR-S108) — La consola de la agencia. Sólo un ADMIN DIRECTO
 * de una empresa marcada como agencia (no alguien que entró «por» otra
 * agencia, no una sesión de un token de la API).
 */
function assertAgencyAdmin(req: FastifyRequest): number {
    const t = req.tenant!;
    if (!t.isAgency) throw notAgency();
    if (t.role !== 'admin' || t.viaAgency || req.apiToken) {
        throw new ForbiddenException({
            code: 'agency_admin_only',
            message: 'Sólo un administrador de la agencia puede gestionar sus empresas cliente',
            data: { status: 403 },
        });
    }
    return t.tenantId;
}

@Controller('agency')
@UseGuards(SessionGuard, TenantGuard)
export class AgencyController {
    constructor(private readonly agency: AgencyService) {}

    @Get()
    overview(@Req() req: FastifyRequest): Promise<{ data: AgencyOverview }> {
        return this.agency.overview(assertAgencyAdmin(req)).then((data) => ({ data }));
    }

    @Get('clients')
    clients(@Req() req: FastifyRequest): Promise<{ data: AgencyClient[] }> {
        return this.agency.listClients(assertAgencyAdmin(req), req.authUserId!).then((data) => ({ data }));
    }

    @Post('clients')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createAgencyClientSchema)) input: CreateAgencyClientInput,
    ): Promise<{ data: AgencyClient }> {
        return this.agency.createClient(assertAgencyAdmin(req), req.authUserId!, input).then((data) => ({ data }));
    }

    @Patch('clients/:id')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateAgencyClientSchema)) input: UpdateAgencyClientInput,
    ): Promise<{ data: AgencyClient }> {
        return this.agency.updateClient(assertAgencyAdmin(req), req.authUserId!, id, input).then((data) => ({ data }));
    }

    /** Entrar a ver un cliente también se puede con la agencia en sólo lectura. */
    @Post('clients/:id/enter')
    @HttpCode(200)
    @AllowReadOnly()
    enter(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AgencyEnterResult }> {
        return this.agency.enter(assertAgencyAdmin(req), req.authUserId!, id).then((data) => ({ data }));
    }
}
