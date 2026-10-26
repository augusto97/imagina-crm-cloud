import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createTeamSchema,
    updateTeamSchema,
    type CreateTeamInput,
    type Team,
    type UpdateTeamInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TeamsService } from './teams.service';

/**
 * C1 — Equipos. Leerlos es parte de dibujar la app (chips del campo
 * «Equipo», selectores, menciones), así que alcanza con ser del equipo de
 * trabajo; crearlos, editarlos y borrarlos exige `manage_teams`.
 */
@Controller('teams')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class TeamsController {
    constructor(private readonly teams: TeamsService) {}

    @Get()
    all(@Req() req: FastifyRequest): Promise<{ data: Team[] }> {
        return this.teams.list(req.tenant!.tenantId).then((data) => ({ data }));
    }

    @Get(':id')
    one(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: Team }> {
        return this.teams.get(req.tenant!.tenantId, id).then((data) => ({ data }));
    }

    @Post()
    @RequireCapability('manage_teams')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createTeamSchema)) input: CreateTeamInput,
    ): Promise<{ data: Team }> {
        return this.teams.create(req.tenant!.tenantId, req.authUserId!, input).then((data) => ({ data }));
    }

    @Patch(':id')
    @RequireCapability('manage_teams')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateTeamSchema)) input: UpdateTeamInput,
    ): Promise<{ data: Team }> {
        return this.teams.update(req.tenant!.tenantId, req.authUserId!, id, input).then((data) => ({ data }));
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_teams')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.teams.remove(req.tenant!.tenantId, req.authUserId!, id);
    }
}
