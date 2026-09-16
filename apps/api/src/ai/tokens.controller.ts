import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { createPersonalTokenSchema, type CreatePersonalTokenInput, type CreatedPersonalToken, type PersonalToken } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PersonalTokensService } from './tokens.service';

/**
 * Tokens de acceso personal del usuario EN el workspace activo (ADR-S21
 * fase 3). Los crea y revoca cada persona para sí misma; el secreto sólo
 * viaja en la respuesta del POST. Quedan en la bitácora del workspace (sin
 * el secreto) porque un token es una puerta de entrada más a sus datos.
 */
@Controller('me/tokens')
@UseGuards(SessionGuard, TenantGuard)
export class PersonalTokensController {
    constructor(
        private readonly tokens: PersonalTokensService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    async list(@Req() req: FastifyRequest): Promise<{ data: PersonalToken[] }> {
        return { data: await this.tokens.list(req.authUserId!, req.tenant!.tenantId) };
    }

    @Post()
    @HttpCode(201)
    async create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createPersonalTokenSchema)) input: CreatePersonalTokenInput,
    ): Promise<CreatedPersonalToken> {
        const created = await this.tokens.create(req.authUserId!, req.tenant!.tenantId, input);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId!,
            action: 'token.create',
            targetType: 'personal_token',
            targetId: created.token.id,
            targetLabel: created.token.name,
            meta: { scope: created.token.scope, expires_at: created.token.expires_at, prefix: created.token.prefix },
        });
        return created;
    }

    @Delete(':id')
    async revoke(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PersonalToken> {
        const revoked = await this.tokens.revoke(req.authUserId!, req.tenant!.tenantId, id);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId!,
            action: 'token.revoke',
            targetType: 'personal_token',
            targetId: revoked.id,
            targetLabel: revoked.name,
            meta: { prefix: revoked.prefix },
        });
        return revoked;
    }
}
