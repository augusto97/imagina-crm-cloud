import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    updateEmailSignatureSchema,
    type MeUserSummary,
    type UpdateEmailSignatureInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { MeService } from './me.service';

/**
 * Recursos del usuario autenticado (`/me/*`). El search/lookup de usuarios es
 * tenant-scoped (pickers de menciones/asignación); la firma de email es
 * personal y no necesita tenant resuelto.
 */
@Controller('me')
export class MeController {
    constructor(private readonly me: MeService) {}

    @Get('users-search')
    @UseGuards(SessionGuard, TenantGuard)
    async searchUsers(
        @Req() req: FastifyRequest,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<{ data: MeUserSummary[] }> {
        const parsedLimit = limit === undefined ? undefined : Number(limit);
        return { data: await this.me.searchUsers(tenantId(req), q ?? '', parsedLimit) };
    }

    @Get('users/:id')
    @UseGuards(SessionGuard, TenantGuard)
    getUser(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<MeUserSummary> {
        return this.me.getUser(tenantId(req), id);
    }

    @Get('email-signature')
    @UseGuards(SessionGuard)
    async getSignature(@Req() req: FastifyRequest): Promise<{ signature: string }> {
        return { signature: await this.me.getEmailSignature(req.authUserId!) };
    }

    @Patch('email-signature')
    @UseGuards(SessionGuard)
    async updateSignature(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateEmailSignatureSchema)) input: UpdateEmailSignatureInput,
    ): Promise<{ signature: string }> {
        return { signature: await this.me.updateEmailSignature(req.authUserId!, input.signature) };
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
