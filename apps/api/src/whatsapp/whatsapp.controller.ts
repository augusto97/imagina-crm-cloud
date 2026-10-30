import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
    updateWhatsappConfigSchema,
    updateWhatsappListFieldsSchema,
    whatsappSendSchema,
    whatsappTestSendSchema,
    type UpdateWhatsappConfigInput,
    type UpdateWhatsappListFieldsInput,
    type WhatsappConnectionDetail,
    type WhatsappListColumns,
    type WhatsappRecordInfo,
    type WhatsappSendInput,
    type WhatsappSendResult,
    type WhatsappTemplate,
    type WhatsappTestSendInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { WhatsappService, type WhatsappActor } from './whatsapp.service';
import { PlanModule } from '../tenancy/plan-module.decorator';

const subscribeSchema = z.object({ override: z.boolean().default(false) });

/**
 * D3 — WhatsApp oficial. Configurar la conexión es de quien puede EDITARLA
 * (el admin, como toda integración); mandar desde un registro exige poder
 * editar ESE registro (ACL de la lista). Ningún endpoint se abre a invitados.
 */
@PlanModule('integrations')
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class WhatsappController {
    constructor(private readonly whatsapp: WhatsappService) {}

    /** Las conexiones de WhatsApp y sus plantillas aprobadas (editor de automatizaciones). */
    @Get('whatsapp/connections')
    @RequireCapability('manage_automations')
    async usable(@Req() req: FastifyRequest): Promise<{ data: Array<{ id: number; name: string; display_phone: string | null; templates: WhatsappTemplate[] }> }> {
        return { data: await this.whatsapp.usableConnections(tenantId(req), actorOf(req)) };
    }

    @Get('whatsapp/connections/:id')
    detail(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<WhatsappConnectionDetail> {
        return this.whatsapp.connectionDetail(tenantId(req), actorOf(req), id);
    }

    @Put('whatsapp/connections/:id/config')
    config(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateWhatsappConfigSchema)) input: UpdateWhatsappConfigInput,
    ): Promise<WhatsappConnectionDetail> {
        return this.whatsapp.updateConfig(tenantId(req), actorOf(req), id, input);
    }

    @Post('whatsapp/connections/:id/templates/refresh')
    @HttpCode(200)
    async refresh(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: WhatsappTemplate[] }> {
        return { data: await this.whatsapp.refreshTemplates(tenantId(req), actorOf(req), id) };
    }

    @Post('whatsapp/connections/:id/subscribe')
    @HttpCode(200)
    subscribe(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(subscribeSchema)) input: z.infer<typeof subscribeSchema>,
    ): Promise<WhatsappConnectionDetail> {
        return this.whatsapp.subscribeApp(tenantId(req), actorOf(req), id, input.override);
    }

    /** Las columnas de WhatsApp de una lista. */
    @Get('lists/:list/whatsapp/columns')
    @RequireCapability('manage_lists')
    columns(@Req() req: FastifyRequest, @Param('list') list: string): Promise<WhatsappListColumns> {
        return this.whatsapp.listColumns(tenantId(req), list);
    }

    @Put('lists/:list/whatsapp/columns')
    @RequireCapability('manage_lists')
    saveColumns(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(updateWhatsappListFieldsSchema)) input: UpdateWhatsappListFieldsInput,
    ): Promise<WhatsappListColumns> {
        return this.whatsapp.updateListColumns(tenantId(req), actorOf(req), list, input.fields);
    }

    /** «Preparar columnas»: crea las que falten (exige poder crear campos). */
    @Post('lists/:list/whatsapp/setup')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setup(@Req() req: FastifyRequest, @Param('list') list: string): Promise<WhatsappListColumns> {
        return this.whatsapp.setupListColumns(tenantId(req), actorOf(req), list);
    }

    @Get('lists/:list/records/:recordId/whatsapp')
    @RequireCapability('view_records', 'view_own_records')
    record(@Req() req: FastifyRequest, @Param('list') list: string, @Param('recordId', ParseIntPipe) recordId: number): Promise<WhatsappRecordInfo> {
        return this.whatsapp.recordInfo(tenantId(req), actorOf(req), list, recordId);
    }

    @Post('lists/:list/records/:recordId/whatsapp/send')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    send(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(whatsappSendSchema)) input: WhatsappSendInput,
    ): Promise<WhatsappSendResult> {
        return this.whatsapp.sendFromRecord(tenantId(req), actorOf(req), list, recordId, input);
    }

    /** «Probar ahora» de las acciones de WhatsApp: envía DE VERDAD al número escrito. */
    @Post('lists/:list/automations/whatsapp-test')
    @HttpCode(200)
    @RequireCapability('manage_automations')
    test(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(whatsappTestSendSchema)) input: WhatsappTestSendInput,
    ): Promise<WhatsappSendResult> {
        return this.whatsapp.testSend(tenantId(req), actorOf(req), list, input);
    }
}

/**
 * Avisos de Meta. PÚBLICO: el token de la URL dice de qué conexión es y la
 * firma `X-Hub-Signature-256` (HMAC del cuerpo crudo con la clave secreta de
 * la app) prueba que lo mandó Meta. Contesta enseguida: lo demás va a la cola.
 */
@Controller('public/whatsapp')
export class WhatsappHooksController {
    constructor(private readonly whatsapp: WhatsappService) {}

    /** Verificación de la URL (`hub.mode`, `hub.verify_token`, `hub.challenge`). */
    @Get(':token')
    verify(@Param('token') token: string, @Query() query: Record<string, unknown>): Promise<string> {
        return this.whatsapp.verifyChallenge(token, query ?? {});
    }

    @Post(':token')
    @HttpCode(200)
    async receive(
        @Param('token') token: string,
        @Req() req: FastifyRequest & { rawBody?: Buffer },
        @Headers('x-hub-signature-256') signature: string | undefined,
    ): Promise<{ ok: true }> {
        const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        await this.whatsapp.receive(token, raw, signature);
        return { ok: true };
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorOf(req: FastifyRequest): WhatsappActor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
