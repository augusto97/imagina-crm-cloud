import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    airtableApplySchema,
    airtableChooseBaseSchema,
    airtableConnectSchema,
    type AirtableApplyInput,
    type AirtableChooseBaseInput,
    type AirtableConnectInput,
    type AirtableImportStatus,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import type { AiToolContext } from '../ai/tools/registry';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AirtableImportService } from './airtable-import.service';

/**
 * v0.1.458 (ADR-S1XX) — «Importar de Airtable». Crear listas exige
 * `manage_lists` (y aplicar, además, `manage_fields` y `create_records`: lo
 * revisa el service). Es parte de las integraciones del plan. Cerrado a
 * invitados (no lleva `@AllowGuest()`); el TenantGuard deja afuera al cliente
 * del portal y a la empresa en solo lectura.
 */
@Controller('airtable-import')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@PlanModule('integrations')
export class AirtableImportController {
    constructor(private readonly service: AirtableImportService) {}

    /** Verifica el token y lista las bases. El token NO se guarda en la base de datos. */
    @Post('connect')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    connect(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(airtableConnectSchema)) input: AirtableConnectInput): Promise<AirtableImportStatus> {
        return this.service.connect(toolCtx(req), input.token);
    }

    /** Elige la base: lee su esquema y la recorre en segundo plano. */
    @Post(':id/base')
    @HttpCode(202)
    @RequireCapability('manage_lists')
    chooseBase(
        @Req() req: FastifyRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(airtableChooseBaseSchema)) input: AirtableChooseBaseInput,
    ): Promise<AirtableImportStatus> {
        return this.service.chooseBase(toolCtx(req), id, input.base_id);
    }

    @Get(':id')
    @RequireCapability('manage_lists')
    get(@Req() req: FastifyRequest, @Param('id') id: string): Promise<AirtableImportStatus> {
        return this.service.get(toolCtx(req), id);
    }

    /** Crea las listas y trae los registros, los vínculos y los adjuntos (en segundo plano). */
    @Post(':id/apply')
    @HttpCode(202)
    @RequireCapability('manage_lists')
    apply(
        @Req() req: FastifyRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(airtableApplySchema)) input: AirtableApplyInput,
    ): Promise<AirtableImportStatus> {
        return this.service.apply(toolCtx(req), id, input);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    cancel(@Req() req: FastifyRequest, @Param('id') id: string): Promise<AirtableImportStatus> {
        return this.service.cancel(toolCtx(req), id);
    }
}

function toolCtx(req: FastifyRequest): AiToolContext {
    return { tenantId: req.tenant!.tenantId, userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
