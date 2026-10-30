import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
    smsBulkSchema,
    smsSendSchema,
    smsTestSendSchema,
    updateSmsListFieldsSchema,
    type SmsBatchStatus,
    type SmsBulkInput,
    type SmsBulkPreview,
    type SmsBulkResult,
    type SmsConnectionDetail,
    type SmsConnectionSummary,
    type SmsListColumns,
    type SmsRecordInfo,
    type SmsSendInput,
    type SmsSendResult,
    type SmsTestSendInput,
    type UpdateSmsListFieldsInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SmsService, type SmsActor } from './sms.service';
import { PlanModule } from '../tenancy/plan-module.decorator';

/**
 * SMS (ADR-S82). Mandar desde un registro exige poder editar ESE registro
 * (ACL de la lista, también en la selección: fila por fila); la página de la
 * conexión es de quien puede editarla. Ningún endpoint se abre a invitados.
 */
@PlanModule('integrations')
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class SmsController {
    constructor(private readonly sms: SmsService) {}

    /** Las conexiones de SMS que la persona puede usar (editor de automatizaciones, agenda). */
    @Get('sms/connections')
    async usable(@Req() req: FastifyRequest): Promise<{ data: SmsConnectionSummary[] }> {
        return { data: await this.sms.usableConnections(tenantId(req), actorOf(req)) };
    }

    @Get('sms/connections/:id')
    detail(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<SmsConnectionDetail> {
        return this.sms.connectionDetail(tenantId(req), actorOf(req), id);
    }

    @Get('lists/:list/sms/columns')
    @RequireCapability('manage_lists')
    columns(@Req() req: FastifyRequest, @Param('list') list: string): Promise<SmsListColumns> {
        return this.sms.listColumns(tenantId(req), list);
    }

    @Put('lists/:list/sms/columns')
    @RequireCapability('manage_lists')
    saveColumns(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(updateSmsListFieldsSchema)) input: UpdateSmsListFieldsInput,
    ): Promise<SmsListColumns> {
        return this.sms.updateListColumns(tenantId(req), actorOf(req), list, input.fields);
    }

    /** «Preparar columnas»: crea «Último SMS» y «Estado del último SMS» si faltan. */
    @Post('lists/:list/sms/setup')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setup(@Req() req: FastifyRequest, @Param('list') list: string): Promise<SmsListColumns> {
        return this.sms.setupListColumns(tenantId(req), actorOf(req), list);
    }

    @Get('lists/:list/records/:recordId/sms')
    @RequireCapability('view_records', 'view_own_records')
    record(@Req() req: FastifyRequest, @Param('list') list: string, @Param('recordId', ParseIntPipe) recordId: number): Promise<SmsRecordInfo> {
        return this.sms.recordInfo(tenantId(req), actorOf(req), list, recordId);
    }

    @Post('lists/:list/records/:recordId/sms/send')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    send(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(smsSendSchema)) input: SmsSendInput,
    ): Promise<SmsSendResult> {
        return this.sms.sendFromRecord(tenantId(req), actorOf(req), list, recordId, input);
    }

    /** La vista previa del diálogo: el texto real con las variables del registro. No manda nada. */
    @Post('lists/:list/records/:recordId/sms/preview')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    preview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(smsSendSchema)) input: SmsSendInput,
    ): Promise<SmsSendResult> {
        return this.sms.previewFromRecord(tenantId(req), actorOf(req), list, recordId, input);
    }

    /**
     * «Probar ahora» de «Enviar SMS»: resuelve las variables contra un registro
     * real y muestra qué saldría. Sólo manda si se pide (`send: true`) y al
     * número que se escribe («Enviarme una prueba»).
     */
    @Post('lists/:list/automations/sms-test')
    @HttpCode(200)
    @RequireCapability('manage_automations')
    test(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(smsTestSendSchema)) input: SmsTestSendInput,
    ): Promise<SmsSendResult> {
        return this.sms.testSend(tenantId(req), actorOf(req), list, input);
    }

    @Post('lists/:list/sms/bulk/preview')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    bulkPreview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(smsBulkSchema)) input: SmsBulkInput,
    ): Promise<SmsBulkPreview> {
        return this.sms.bulkPreview(tenantId(req), actorOf(req), list, input);
    }

    @Post('lists/:list/sms/bulk')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    bulkSend(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(smsBulkSchema)) input: SmsBulkInput,
    ): Promise<SmsBulkResult> {
        return this.sms.bulkSend(tenantId(req), actorOf(req), list, input);
    }

    @Get('lists/:list/sms/batches/:batchId')
    batch(@Req() req: FastifyRequest, @Param('list') list: string, @Param('batchId') batchId: string): Promise<SmsBatchStatus> {
        return this.sms.batchStatus(tenantId(req), actorOf(req), list, batchId);
    }
}

/**
 * Avisos de entrega de los proveedores. PÚBLICO: el token de la URL (opaco,
 * 32 caracteres) dice de qué conexión es; Twilio además firma
 * (`X-Twilio-Signature`). Los demás no firman: un aviso sólo puede mover un SMS
 * que mandamos nosotros por ESA conexión, y el estado sólo avanza.
 */
@Controller('public/sms')
export class SmsHooksController {
    constructor(private readonly sms: SmsService) {}

    /** BulkGate y LabsMobile avisan por GET (y BulkGate prueba la URL con un GET vacío). */
    @Get(':token')
    async receiveGet(@Param('token') token: string, @Query() query: Record<string, unknown>, @Req() req: FastifyRequest): Promise<{ ok: true }> {
        await this.sms.receive(token, { method: 'GET', query: query ?? {}, body: null, headers: headersOf(req) });
        return { ok: true };
    }

    @Post(':token')
    @HttpCode(200)
    async receivePost(@Param('token') token: string, @Query() query: Record<string, unknown>, @Req() req: FastifyRequest): Promise<{ ok: true }> {
        await this.sms.receive(token, { method: 'POST', query: query ?? {}, body: req.body ?? null, headers: headersOf(req) });
        return { ok: true };
    }
}

function headersOf(req: FastifyRequest): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    return out;
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorOf(req: FastifyRequest): SmsActor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
