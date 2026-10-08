import {
    BadRequestException,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingService } from '../billing/billing.service';
import { type FileActor, FilesService, type AttachmentDto, type OpenedFile } from './files.service';
import { contentDispositionHeader, safeDisposition } from './safe-content-type';

/**
 * Archivos propios (ADR-S16). Upload multipart, resolución batch para la UI
 * (tarjetas/galerías) y descarga streameada — SIEMPRE detrás de sesión +
 * tenant (los bytes jamás se sirven sin el check de workspace).
 */
/**
 * Descarga por URL firmada (SIN sesión): la usa el portal del cliente.
 * La firma HMAC + expiración la valida FilesService; 404 opaco si no cuadra.
 */
@Controller('files')
export class SignedFilesController {
    constructor(private readonly files: FilesService) {}

    @Get(':id/signed')
    async signed(
        @Param('id', ParseIntPipe) id: number,
        @Res() reply: FastifyReply,
        @Query('tenant') tenant?: string,
        @Query('exp') exp?: string,
        @Query('sig') sig?: string,
    ): Promise<void> {
        const expSec = Number(exp ?? 0);
        const file = await this.files.openSigned(id, Number(tenant ?? 0), expSec, String(sig ?? ''));
        // v0.1.253 — la URL firmada es inmutable hasta que vence (la firma
        // cubre id + exp): el navegador la puede guardar hasta entonces. Sin
        // esto, el logo del workspace se volvía a bajar en cada pantalla.
        const ttl = Math.max(0, Math.min(86_400, Math.floor(expSec - Date.now() / 1000)));
        await streamFile(file, reply, ttl > 0 ? `private, max-age=${ttl}, immutable` : undefined);
    }
}

/**
 * Streamea un archivo con guard de errores: si el stream falla a mitad de
 * respuesta (bytes corruptos/perdidos), se DESTRUYE la conexión — sin esto
 * la request quedaba colgada hasta el timeout del proxy (504).
 */
async function streamFile(file: OpenedFile, reply: FastifyReply, cacheControl?: string): Promise<void> {
    // v0.1.268 (ADR-S36) — en el bucket de la empresa: al enlace temporal
    // del proveedor. Ese enlace vence en minutos, así que no se cachea la
    // redirección (la URL propia, firmada, es la que dura).
    if (file.kind === 'redirect') {
        reply.raw.writeHead(302, {
            location: file.url,
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
        });
        reply.raw.end();
        return;
    }
    // SEC-21 (v0.1.113): el mime lo eligió quien subió el archivo. Sólo los
    // tipos de la whitelist se sirven inline; el resto baja como binario
    // (`attachment`) para que un `.html`/`.svg` no ejecute script en nuestro
    // origen. El CSP `sandbox` es la segunda barrera: aunque un tipo se
    // colara, el documento queda sin origen, sin scripts y sin formularios.
    const { contentType, disposition } = safeDisposition(file.mime);
    reply.raw.writeHead(200, {
        'content-type': contentType,
        'content-length': String(file.size),
        'content-disposition': contentDispositionHeader(disposition, file.filename),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        ...(cacheControl ? { 'cache-control': cacheControl } : {}),
    });
    file.stream.pipe(reply.raw);
    await new Promise<void>((resolve) => {
        file.stream.on('end', resolve);
        file.stream.on('error', () => {
            reply.raw.destroy();
            resolve();
        });
    });
}

@Controller('files')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class FilesController {
    constructor(
        private readonly files: FilesService,
        private readonly billing: BillingService,
    ) {}

    /** Upload multipart (campo `file`). Subir pasa por poder editar records. */
    @Post()
    @HttpCode(201)
    @RequireCapability('create_records', 'edit_records', 'edit_own_records')
    async upload(@Req() req: FastifyRequest): Promise<AttachmentDto> {
        const part = await req.file();
        if (!part) {
            throw new BadRequestException({
                code: 'missing_file',
                message: 'Falta el archivo (multipart field `file`)',
                data: { status: 400 },
            });
        }
        const dto = await this.files.upload(
            req.tenant!.tenantId,
            req.authUserId!,
            part.filename ?? 'archivo',
            part.mimetype ?? 'application/octet-stream',
            part.file,
        );
        // `truncated` = el stream superó el límite configurado de multipart.
        if (part.file.truncated) {
            await this.files.remove(req.tenant!.tenantId, dto.id).catch(() => undefined);
            throw new BadRequestException({
                code: 'file_too_large',
                message: 'El archivo supera el tamaño máximo permitido',
                data: { status: 400 },
            });
        }
        // Cuota del plan (ADR-S16): el uso YA incluye este archivo — si con él
        // se pasa del tope, lo revertimos y rechazamos. Lo que va al
        // almacenamiento propio de la empresa no cuenta (ADR-S36).
        if (dto.external) return dto;
        try {
            await this.billing.assertCanUpload(req.tenant!.tenantId, 0);
        } catch (err) {
            await this.files.remove(req.tenant!.tenantId, dto.id).catch(() => undefined);
            throw err;
        }
        return dto;
    }

    /** Resolución batch: `?ids=1,2,3` → metadata + URL de descarga. */
    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async resolve(
        @Req() req: FastifyRequest,
        @Query('ids') ids?: string,
    ): Promise<{ data: AttachmentDto[] }> {
        const parsed = (ids ?? '')
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0);
        return { data: await this.files.resolve(req.tenant!.tenantId, parsed, fileActor(req)) };
    }

    /**
     * v0.1.265 — URL pública de larga vida para usar una imagen subida en un
     * correo o en la firma (ADR-S34).
     */
    @Post(':id/public-url')
    @HttpCode(200)
    @RequireCapability('create_records', 'edit_records', 'edit_own_records', 'manage_automations')
    async publicUrl(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ url: string }> {
        return { url: await this.files.publicImageUrl(req.tenant!.tenantId, id, fileActor(req)) };
    }

    /** Descarga streameada (inline; el browser decide por content-type). */
    @Get(':id/download')
    @RequireCapability('view_records', 'view_own_records')
    async download(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const file = await this.files.openDownload(req.tenant!.tenantId, id, fileActor(req));
        await streamFile(file, reply);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.files.remove(req.tenant!.tenantId, id, fileActor(req));
    }
}

function fileActor(req: FastifyRequest): FileActor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
