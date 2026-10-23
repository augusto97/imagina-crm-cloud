import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
    pressButtonBulkSchema,
    type ButtonPressStatus,
    type PressButtonBulkInput,
    type PressButtonBulkResult,
    type PressButtonResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ButtonsService } from './buttons.service';

/**
 * Campo «Botón» — presionar un botón de un registro (uno o en lote) y
 * consultar cómo terminaron las automatizaciones que inició. Ver alcance y
 * permisos en `ButtonsService`: el servidor re-chequea todo.
 */
@Controller('lists/:list/records')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ButtonsController {
    constructor(private readonly buttons: ButtonsService) {}

    @Post('buttons/:fieldId/bulk')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    bulk(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('fieldId', ParseIntPipe) fieldId: number,
        @Body(new ZodValidationPipe(pressButtonBulkSchema)) input: PressButtonBulkInput,
    ): Promise<PressButtonBulkResult> {
        return this.buttons.pressBulk(req.tenant!.tenantId, actor(req), list, fieldId, input.ids);
    }

    @Get('buttons/presses/:pressId')
    @RequireCapability('view_records', 'view_own_records')
    status(@Req() req: FastifyRequest, @Param('list') list: string, @Param('pressId') pressId: string): Promise<ButtonPressStatus> {
        return this.buttons.pressStatus(req.tenant!.tenantId, list, pressId);
    }

    @Post(':id/buttons/:fieldId')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    press(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('fieldId', ParseIntPipe) fieldId: number,
    ): Promise<PressButtonResult> {
        return this.buttons.press(req.tenant!.tenantId, actor(req), list, id, fieldId);
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
