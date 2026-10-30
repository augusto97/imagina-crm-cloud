import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    helpdeskMailboxInputSchema,
    helpdeskMailboxTestSchema,
    helpdeskReplySchema,
    helpdeskTemplatePreviewSchema,
    updateHelpdeskSettingsSchema,
    type HelpdeskMailboxDto,
    type HelpdeskMailboxInput,
    type HelpdeskMailboxMarker,
    type HelpdeskMailboxTestInput,
    type HelpdeskReplyInput,
    type HelpdeskReplyResult,
    type HelpdeskSettings,
    type HelpdeskTicketDto,
    type ImapDiagnostic,
    type UpdateHelpdeskSettingsInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { HelpdeskConfigService } from './helpdesk-config.service';
import { HelpdeskReplyService } from './helpdesk-reply.service';
import { PlanModule } from '../tenancy/plan-module.decorator';

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

/**
 * D2/E5 — Configuración de la mesa de ayuda de una lista: el buzón de soporte
 * (IMAP) y los ajustes (mapeo, estados, protecciones, respuestas y SLA). Es de
 * quien arma la lista (`manage_lists`).
 */
@PlanModule('helpdesk')
@Controller('lists/:list/helpdesk')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class HelpdeskController {
    constructor(private readonly config: HelpdeskConfigService) {}

    @Get('settings')
    @RequireCapability('manage_lists', 'manage_automations')
    settings(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ settings: HelpdeskSettings; mailbox: HelpdeskMailboxMarker | null }> {
        return this.config.getSettings(req.tenant!.tenantId, list);
    }

    @Patch('settings')
    @RequireCapability('manage_lists')
    async updateSettings(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(updateHelpdeskSettingsSchema)) input: UpdateHelpdeskSettingsInput,
    ): Promise<{ settings: HelpdeskSettings }> {
        return { settings: await this.config.updateSettings(req.tenant!.tenantId, req.authUserId!, list, input) };
    }

    /** «Crear columnas del SLA»: vencimientos y estado, guardados en la lista. */
    @Post('settings/sla-columns')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    async slaColumns(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ settings: HelpdeskSettings }> {
        return { settings: await this.config.createSlaColumns(req.tenant!.tenantId, req.authUserId!, list) };
    }

    @Get('mailbox')
    @RequireCapability('manage_lists')
    async mailbox(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: HelpdeskMailboxDto | null }> {
        return { data: await this.config.getMailbox(req.tenant!.tenantId, list) };
    }

    /** Conectar o cambiar el buzón (upsert: uno por lista). */
    @Post('mailbox')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    async saveMailbox(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(helpdeskMailboxInputSchema)) input: HelpdeskMailboxInput,
    ): Promise<{ data: HelpdeskMailboxDto }> {
        return { data: await this.config.saveMailbox(req.tenant!.tenantId, req.authUserId!, list, input) };
    }

    @Delete('mailbox')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async removeMailbox(@Req() req: FastifyRequest, @Param('list') list: string): Promise<void> {
        await this.config.removeMailbox(req.tenant!.tenantId, req.authUserId!, list);
    }

    /** «Probar conexión» con lo que hay en el formulario (sin guardar). */
    @Post('mailbox/test')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    test(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(helpdeskMailboxTestSchema)) input: HelpdeskMailboxTestInput,
    ): Promise<ImapDiagnostic> {
        return this.config.test(req.tenant!.tenantId, list, input);
    }

    /** «Revisar ahora». */
    @Post('mailbox/check')
    @HttpCode(202)
    @RequireCapability('manage_lists')
    check(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ queued: boolean }> {
        return this.config.checkNow(req.tenant!.tenantId, list);
    }
}

/**
 * D2 — El ticket en la ficha: su hilo de correo, el SLA y «Responder por
 * correo». Ver pide ver el registro; responder pide editarlo (lo valida el
 * service con el ACL de la lista).
 */
@PlanModule('helpdesk')
@Controller('lists/:list/records/:id/helpdesk')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class HelpdeskTicketController {
    constructor(private readonly replies: HelpdeskReplyService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async ticket(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: HelpdeskTicketDto }> {
        return { data: await this.replies.ticket(req.tenant!.tenantId, actor(req), list, id) };
    }

    @Post('template')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    template(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(helpdeskTemplatePreviewSchema)) input: { template_id: string },
    ): Promise<{ body: string }> {
        return this.replies.renderTemplate(req.tenant!.tenantId, actor(req), list, id, input.template_id);
    }

    @Post('reply')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    reply(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(helpdeskReplySchema)) input: HelpdeskReplyInput,
    ): Promise<HelpdeskReplyResult> {
        return this.replies.reply(req.tenant!.tenantId, actor(req), list, id, input);
    }
}
