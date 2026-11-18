import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    createSignatureRequestSchema,
    declineSignatureSchema,
    submitSignatureSchema,
    voidSignatureRequestSchema,
    type CreateSignatureRequestInput,
    type DeclineSignatureInput,
    type PublicSignatureDto,
    type SignatureRequestDto,
    type SubmitSignatureInput,
    type VoidSignatureRequestInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { contentDispositionHeader } from '../files/safe-content-type';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { AllowTenantQuery } from '../tenancy/allow-tenant-query.decorator';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SignaturesService } from './signatures.service';
import { VERIFY_BASE, verifyCsp, verifyLookupPage, verifyPage } from './verify-page';

export { verifyPage } from './verify-page';

function sendVerifyHtml(reply: FastifyReply, status: number, html: string): void {
    reply.raw.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': verifyCsp(),
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
    });
    reply.raw.end(html);
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

function sendPdf(reply: FastifyReply, doc: { buffer: Buffer; filename: string }, disposition: 'inline' | 'attachment'): void {
    reply.raw.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(doc.buffer.length),
        'content-disposition': contentDispositionHeader(disposition, doc.filename),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow',
    });
    reply.raw.end(doc.buffer);
}

/**
 * D6 (v0.1.446) — Firmas desde la ficha. Ver: quien ve el registro. Pedir,
 * reenviar y anular: quien puede editarlo (lo re-chequea el service con el
 * ACL de la fila).
 */
@PlanModule('documents')
@Controller('lists/:list/records/:record/signatures')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class SignaturesController {
    constructor(private readonly signatures: SignaturesService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async list(@Req() req: FastifyRequest, @Param('list') list: string, @Param('record', ParseIntPipe) record: number): Promise<{ data: SignatureRequestDto[] }> {
        return { data: await this.signatures.listForRecord(req.tenant!.tenantId, actor(req), list, record) };
    }

    @Get('sources')
    @RequireCapability('edit_records', 'edit_own_records')
    async sources(@Req() req: FastifyRequest, @Param('list') list: string, @Param('record', ParseIntPipe) record: number) {
        return { data: await this.signatures.sources(req.tenant!.tenantId, actor(req), list, record) };
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    async create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('record', ParseIntPipe) record: number,
        @Body(new ZodValidationPipe(createSignatureRequestSchema)) input: CreateSignatureRequestInput,
    ): Promise<{ data: SignatureRequestDto }> {
        return { data: await this.signatures.create(req.tenant!.tenantId, actor(req), list, { ...input, record_id: record }) };
    }

    @Post(':id/void')
    @RequireCapability('edit_records', 'edit_own_records')
    async void(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(voidSignatureRequestSchema)) input: VoidSignatureRequestInput,
    ): Promise<{ data: SignatureRequestDto }> {
        return { data: await this.signatures.void(req.tenant!.tenantId, actor(req), list, id, input) };
    }

    @Post(':id/signers/:signer/resend')
    @RequireCapability('edit_records', 'edit_own_records')
    async resend(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('signer', ParseIntPipe) signer: number,
    ): Promise<{ data: { sent: boolean } }> {
        return { data: await this.signatures.resend(req.tenant!.tenantId, actor(req), list, id, signer) };
    }

    /** El PDF (original o firmado). La empresa puede venir en `?t=`: lo abre un enlace o el visor de la app. */
    @Get(':id/file/:which')
    @AllowTenantQuery()
    @RequireCapability('view_records', 'view_own_records')
    async file(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('which') which: string,
        @Query('download') download?: string,
    ): Promise<void> {
        const doc = await this.signatures.download(req.tenant!.tenantId, actor(req), list, id, which === 'signed' ? 'signed' : 'original');
        sendPdf(reply, doc, download === '1' ? 'attachment' : 'inline');
    }
}

/**
 * La página de firma (sin sesión). El token de la URL es la credencial: un
 * HMAC por persona; cualquier cosa que no cuadre da el mismo 404.
 */
@Controller('public/sign')
export class PublicSignaturesController {
    constructor(private readonly signatures: SignaturesService) {}

    /** La página general: verificar con el archivo o con el código (`?code=` lleva a su página). */
    @Get('verify')
    async verifyHome(@Res() reply: FastifyReply, @Query('code') code?: string): Promise<void> {
        const clean = String(code ?? '').toUpperCase().replace(/\s+/g, '').slice(0, 16);
        if (clean) {
            reply.raw.writeHead(302, { location: `${VERIFY_BASE}/verify/${encodeURIComponent(clean)}`, 'cache-control': 'no-store' });
            reply.raw.end();
            return;
        }
        sendVerifyHtml(reply, 200, verifyLookupPage());
    }

    @Get('verify/:code')
    async verify(@Param('code') code: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
        const info = await this.signatures.verifyInfo(code, { ip: req.ip });
        sendVerifyHtml(reply, info.found ? 200 : 404, verifyPage(info));
    }

    /** De qué firma es un archivo, por su huella (la calcula el navegador: el PDF no viaja). */
    @Post('verify-hash')
    @HttpCode(200)
    async verifyHash(@Req() req: FastifyRequest, @Body() body: unknown) {
        const sha = body && typeof body === 'object' ? String((body as { sha256?: unknown }).sha256 ?? '') : '';
        return { data: await this.signatures.lookupByHash(sha, { ip: req.ip }) };
    }

    @Get(':token')
    async view(@Param('token') token: string, @Req() req: FastifyRequest): Promise<{ data: PublicSignatureDto }> {
        return { data: await this.signatures.publicView(token, { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') }) };
    }

    @Get(':token/document.pdf')
    async document(@Param('token') token: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply, @Query('download') download?: string): Promise<void> {
        const doc = await this.signatures.publicDocument(token, { ip: req.ip });
        sendPdf(reply, doc, download === '1' ? 'attachment' : 'inline');
    }

    @Post(':token/code')
    @HttpCode(200)
    async code(@Param('token') token: string, @Req() req: FastifyRequest) {
        return { data: await this.signatures.requestCode(token, { ip: req.ip }) };
    }

    @Post(':token/sign')
    @HttpCode(200)
    async sign(@Param('token') token: string, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(submitSignatureSchema)) input: SubmitSignatureInput) {
        return { data: await this.signatures.sign(token, input, { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') }) };
    }

    @Post(':token/decline')
    @HttpCode(200)
    async decline(@Param('token') token: string, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(declineSignatureSchema)) input: DeclineSignatureInput) {
        return { data: await this.signatures.decline(token, input, { ip: req.ip }) };
    }
}
