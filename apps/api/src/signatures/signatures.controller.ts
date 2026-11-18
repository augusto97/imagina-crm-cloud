import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    createSignatureRequestSchema,
    declineSignatureSchema,
    SIGNATURE_STATUS_LABELS,
    SIGNER_STATUS_LABELS,
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
import { escapeHtml } from '../portal/portal-email';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { AllowTenantQuery } from '../tenancy/allow-tenant-query.decorator';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SignaturesService } from './signatures.service';

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

    @Get('verify/:code')
    async verify(@Param('code') code: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
        const info = await this.signatures.verifyInfo(code, { ip: req.ip });
        const html = verifyPage(info);
        reply.raw.writeHead(info.found ? 200 : 404, {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex, nofollow',
        });
        reply.raw.end(html);
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

type VerifyInfo = Awaited<ReturnType<SignaturesService['verifyInfo']>>;

/** Página de verificación (HTML del servidor, sin scripts, todo escapado). */
export function verifyPage(info: VerifyInfo): string {
    const e = escapeHtml;
    const head = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Verificar una firma</title>
<style>body{margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827}main{max-width:620px;margin:32px auto;padding:0 16px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}h1{font-size:20px;margin:0 0 4px}.muted{color:#6b7280;font-size:14px}.ok{display:inline-block;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600}.g{background:#dcfce7;color:#166534}.a{background:#fef3c7;color:#92400e}.r{background:#fee2e2;color:#991b1b}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td{padding:8px 0;border-top:1px solid #f0f1f3;vertical-align:top}td:first-child{color:#6b7280;width:38%;padding-right:12px}code{font-size:12px;word-break:break-all}ul{padding-left:18px;margin:6px 0}</style></head><body><main><div class="card">`;
    const foot = `</div><p class="muted" style="text-align:center;margin-top:14px">Firma electrónica simple (Ley 527 de 1999 y Decreto 2364 de 2012).</p></main></body></html>`;
    if (!info.found) {
        return `${head}<h1>No encontramos esa firma</h1><p class="muted">El código no existe o la solicitud ya no está disponible. Revisa que lo hayas escrito igual que en la constancia (por ejemplo ABCDE-23456).</p>${foot}`;
    }
    const status = info.status!;
    const tone = status === 'completed' ? 'g' : status === 'pending' ? 'a' : 'r';
    const when = (v: string | null | undefined) => (v && info.formatWhen ? info.formatWhen(v) : '—');
    const signers = (info.signers ?? [])
        .map((s) => `<li>${e(s.name)}${s.role ? ` <span class="muted">(${e(s.role)})</span>` : ''} — ${s.status === 'signed' ? `firmó el ${e(when(s.signed_at))}` : e(SIGNER_STATUS_LABELS[s.status].toLowerCase())}</li>`)
        .join('');
    return `${head}<h1>${e(info.title ?? '')}</h1><p class="muted">${e(info.company ?? '')}</p>
<p><span class="ok ${tone}">${e(SIGNATURE_STATUS_LABELS[status])}</span></p>
<table>
<tr><td>Personas</td><td><ul>${signers}</ul></td></tr>
${info.completed_at ? `<tr><td>Firmado por todos</td><td>${e(when(info.completed_at))}</td></tr>` : ''}
<tr><td>Huella SHA-256 del original</td><td><code>${e(info.original_sha256 ?? '')}</code></td></tr>
${info.signed_sha256 ? `<tr><td>Huella SHA-256 del PDF firmado</td><td><code>${e(info.signed_sha256)}</code></td></tr>` : ''}
</table>
<p class="muted" style="margin-top:16px">Para comprobar un archivo, calcula su huella SHA-256 y compárala con la de arriba: si cambió una sola letra del documento, la huella no coincide.</p>${foot}`;
}
