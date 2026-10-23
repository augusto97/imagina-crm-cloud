import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    adminWithdrawConsentSchema,
    listDataConsentsQuerySchema,
    updateDataConsentSchema,
    type AdminWithdrawConsentInput,
    type DataConsentRecordDto,
    type DataConsentRecordsPage,
    type DataConsentState,
    type DataConsentVersionDto,
    type ListDataConsentsQuery,
    type RecordDataConsentDto,
    type Role,
    type UpdateDataConsentInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { formPageCsp, newNonce } from '../forms/form-page';
import { FormsService } from '../forms/forms.service';
import { RecordsService } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { renderWithdrawInvalid, renderWithdrawLanding, renderWithdrawResult } from './consent-page';
import { DataConsentService } from './data-consent.service';

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant!.role !== 'admin') {
        throw new ForbiddenException({
            code: 'admin_only',
            message: 'Sólo el admin del workspace puede ver y editar la autorización de datos personales',
            data: { status: 403 },
        });
    }
}

function userAgent(req: FastifyRequest): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' && ua !== '' ? ua : null;
}

/**
 * Ajustes → Datos personales (admin): el texto de la autorización, sus
 * versiones y la evidencia de cada aceptación (con correo e IP del titular:
 * por eso sólo el admin, y la descarga queda en la bitácora).
 */
@Controller('workspaces/current/data-consent')
@UseGuards(SessionGuard, TenantGuard)
export class WorkspaceDataConsentController {
    constructor(
        private readonly consents: DataConsentService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    get(@Req() req: FastifyRequest): Promise<DataConsentState> {
        assertAdmin(req);
        return this.consents.state(req.tenant!.tenantId);
    }

    @Put()
    async update(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateDataConsentSchema)) input: UpdateDataConsentInput,
    ): Promise<DataConsentState> {
        assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        const before = await this.consents.state(tenantId);
        const { state, newVersion } = await this.consents.update(tenantId, req.authUserId ?? null, input);
        if (newVersion !== null) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: 'data_consent.version',
                targetType: 'data_consent',
                targetLabel: `Versión ${newVersion}`,
                meta: { version: newVersion },
            });
        }
        if (before.config.enabled !== state.config.enabled || before.config.ask_in_portal !== state.config.ask_in_portal) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: 'data_consent.update',
                targetType: 'data_consent',
                targetLabel: state.config.enabled ? 'activada' : 'desactivada',
                meta: { enabled: state.config.enabled, ask_in_portal: state.config.ask_in_portal },
            });
        }
        return state;
    }

    @Get('versions/:version')
    version(@Req() req: FastifyRequest, @Param('version', ParseIntPipe) version: number): Promise<DataConsentVersionDto> {
        assertAdmin(req);
        return this.consents.version(req.tenant!.tenantId, version);
    }

    @Get('records')
    list(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(listDataConsentsQuerySchema)) q: ListDataConsentsQuery,
    ): Promise<DataConsentRecordsPage> {
        assertAdmin(req);
        return this.consents.list(req.tenant!.tenantId, q);
    }

    @Get('records/export')
    async export(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(listDataConsentsQuerySchema)) q: ListDataConsentsQuery,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        const { filename, csv, count } = await this.consents.exportCsv(tenantId, q);
        await this.audit.log({
            tenantId,
            userId: req.authUserId ?? null,
            action: 'data_consent.export',
            targetType: 'data_consent',
            targetLabel: `${count} autorizaciones`,
            meta: { count, status: q.status, source: q.source, from: q.from ?? null, to: q.to ?? null },
        });
        reply.raw.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
            'cache-control': 'no-store',
        });
        reply.raw.end(csv);
    }

    /** Un retiro que llegó por otro canal (correo, teléfono): la empresa lo registra. */
    @Post('records/:id/withdraw')
    @HttpCode(200)
    async withdraw(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(adminWithdrawConsentSchema)) input: AdminWithdrawConsentInput,
    ): Promise<DataConsentRecordDto> {
        assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        const dto = await this.consents.adminWithdraw(tenantId, req.authUserId!, id, input.note);
        await this.audit.log({
            tenantId,
            userId: req.authUserId ?? null,
            action: 'data_consent.withdraw_admin',
            targetType: 'data_consent',
            targetId: id,
            targetLabel: dto.subject_name || dto.subject_email || `Autorización #${id}`,
            meta: { note: input.note, record_id: dto.record_id },
        });
        return dto;
    }
}

/**
 * La línea «Autorización de datos» de la ficha. Quien ve el registro la ve
 * (sin IP ni navegador: eso queda para el admin).
 */
@Controller('lists/:list/records/:id/data-consents')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordDataConsentController {
    constructor(
        private readonly consents: DataConsentService,
        private readonly records: RecordsService,
    ) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async forRecord(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: RecordDataConsentDto[] }> {
        const actor = { userId: req.authUserId!, role: req.tenant!.role as Role };
        // 404 si la persona no ve el registro (mismo ACL que la ficha).
        const record = await this.records.get(req.tenant!.tenantId, actor, list, id);
        return { data: await this.consents.forRecord(req.tenant!.tenantId, record.id) };
    }
}

/**
 * El enlace PÚBLICO para retirar una autorización (`<empresa>.<ref>.<firma>`):
 * sin sesión, el token firmado es la credencial y sólo sirve para esto. Uno
 * mal formado, con firma falsa o desconocido da la misma página 404.
 */
@Controller('public/consent')
export class PublicConsentController {
    constructor(
        private readonly consents: DataConsentService,
        private readonly forms: FormsService,
    ) {}

    @Get('withdraw/:token')
    async landing(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const landing = await this.consents.peekWithdraw(token);
        if (!landing) {
            this.send(reply, renderWithdrawInvalid(), 404);
            return;
        }
        this.send(reply, renderWithdrawLanding(landing, `/api/v1/public/consent/withdraw/${encodeURIComponent(token)}`), 200);
    }

    @Post('withdraw/:token')
    async withdraw(@Req() req: FastifyRequest, @Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const out = await this.consents.withdrawByToken(token, { ip: req.ip, userAgent: userAgent(req) }, (tenantId, pendingId) =>
            this.forms.discardPending(tenantId, pendingId),
        );
        if (out.status === 'invalid') {
            this.send(reply, renderWithdrawInvalid(), 404);
            return;
        }
        this.send(reply, renderWithdrawResult(out.status, out.landing), 200);
    }

    private send(reply: FastifyReply, html: string, status: number): void {
        const nonce = newNonce();
        reply
            .status(status)
            .header('Content-Security-Policy', formPageCsp(nonce, "'none'"))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            // El token va en la ruta: que no se filtre a otros sitios.
            .header('Referrer-Policy', 'no-referrer')
            .type('text/html; charset=utf-8')
            .send(html);
    }
}
