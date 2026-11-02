import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { recordLabelsSchema, type RecordLabelsInput, type RecordQrInfo } from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { contentDispositionHeader } from '../files/safe-content-type';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { QrService } from './qr.service';
import { RecordLabelsService } from './record-labels.service';

/**
 * v0.1.344 — La imagen de un QR, SIN sesión: la piden Gmail, Outlook o los
 * servidores de WhatsApp al mostrar un correo o un mensaje con
 * `{{registro.qr}}`. El contenido viaja firmado en el nombre (ver qr-token):
 * un token alterado o inventado es 404 opaco.
 */
@Controller('public/qr')
export class PublicQrController {
    constructor(private readonly qr: QrService) {}

    // Comodín y no `:file`: el router de Fastify corta los parámetros de ruta
    // a 100 caracteres (`maxParamLength`) y responde 414, y el token de un
    // enlace completo los pasa. El comodín no tiene ese tope; el largo lo
    // acota la expresión de abajo.
    @Get('*')
    async image(@Req() req: FastifyRequest, @Query('s') size: string | undefined, @Res() reply: FastifyReply): Promise<void> {
        const file = (req.params as Record<string, string | undefined>)['*'] ?? '';
        const m = /^([A-Za-z0-9_.-]{1,1500})\.png$/.exec(file);
        const png = m ? await this.qr.png(m[1]!, size) : null;
        if (!png) {
            void reply.code(404).send({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
            return;
        }
        void reply
            .header('content-type', 'image/png')
            .header('content-disposition', 'inline')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "default-src 'none'; sandbox")
            // El contenido está en la URL: la misma URL es siempre la misma imagen.
            .header('cache-control', 'public, max-age=31536000, immutable')
            .send(png);
    }
}

/** El QR de un registro (ficha) y el PDF de etiquetas (una selección o lo que muestra la vista). */
@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordQrController {
    constructor(
        private readonly qr: QrService,
        private readonly labels: RecordLabelsService,
    ) {}

    @Get('qr/:recordId')
    @RequireCapability('view_records', 'view_own_records')
    record(@Req() req: FastifyRequest, @Param('list') list: string, @Param('recordId', ParseIntPipe) recordId: number): Promise<RecordQrInfo> {
        return this.qr.forRecord(req.tenant!.tenantId, actorOf(req), list, recordId);
    }

    @Post('labels')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    // ADR-S09: imprimir es leer (POST por la selección y los filtros) — vale en solo-lectura.
    @AllowReadOnly()
    async printLabels(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(recordLabelsSchema)) input: RecordLabelsInput,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const out = await this.labels.pdf(req.tenant!.tenantId, actorOf(req), list, input);
        void reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', contentDispositionHeader('attachment', out.filename))
            .header('x-content-type-options', 'nosniff')
            .header('x-label-count', String(out.count))
            .header('cache-control', 'no-store')
            .send(out.buffer);
    }
}

function actorOf(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
