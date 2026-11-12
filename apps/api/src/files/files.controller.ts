import {
    BadRequestException,
    Controller,
    Delete,
    Get,
    HttpCode,
    Optional,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fileThumbWidth } from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AllowGuest } from '../tenancy/allow-guest.decorator';
import { BillingService } from '../billing/billing.service';
import { type FileActor, FilesService, type AttachmentDto, type OpenedFile } from './files.service';
import { contentDispositionHeader, parseByteRange, safeDisposition } from './safe-content-type';
import { ImageThumbsService, type ImageBytes } from './image-thumbs.service';
import { aclOf } from '../tenancy/acl-of';

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
    constructor(
        private readonly files: FilesService,
        // v0.1.426 — miniaturas (`&w=`). Opcional: los specs arman el controlador a mano.
        @Optional() private readonly thumbs?: ImageThumbsService,
    ) {}

    /**
     * v0.1.291 — `preview=1`: la vista previa de adjuntos lo pide servido por
     * el servidor (no redirigido al bucket de la empresa) y con rangos;
     * `dl=1`: el botón «Descargar» lo pide como archivo para guardar. Ninguno
     * de los dos amplía el acceso (la firma cubre el archivo y el vencimiento).
     */
    @Get(':id/signed')
    async signed(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Res() reply: FastifyReply,
        @Query('tenant') tenant?: string,
        @Query('exp') exp?: string,
        @Query('sig') sig?: string,
        @Query('preview') preview?: string,
        @Query('dl') dl?: string,
        @Query('w') w?: string,
    ): Promise<void> {
        const expSec = Number(exp ?? 0);
        const tenantId = Number(tenant ?? 0);
        const opts = { proxy: preview === '1', download: dl === '1' };
        // v0.1.253 — la URL firmada es inmutable hasta que vence (la firma
        // cubre id + exp): el navegador la puede guardar hasta entonces. Sin
        // esto, el logo del workspace se volvía a bajar en cada pantalla.
        const ttl = Math.max(0, Math.min(86_400, Math.floor(expSec - Date.now() / 1000)));
        const cacheControl = ttl > 0 ? `private, max-age=${ttl}, immutable` : undefined;
        // v0.1.426 — `w`: la miniatura (WebP al ancho pedido) de una IMAGEN.
        // Un ancho fuera de la lista, o un archivo que no es una imagen que se
        // pueda achicar (PDF, SVG…), se ignora: va el original como siempre.
        const width = opts.download ? null : fileThumbWidth(w);
        if (width !== null && this.thumbs) {
            this.files.assertSigned(id, tenantId, expSec, String(sig ?? ''));
            const thumb = await this.thumbs.attachmentThumb(tenantId, id, width);
            if (thumb) {
                sendImage(reply, thumb, cacheControl);
                return;
            }
        }
        const file = await this.files.openSigned(id, tenantId, expSec, String(sig ?? ''), opts);
        await streamFile(file, reply, cacheControl, {
            range: req.headers.range,
            download: opts.download,
        });
    }
}

/**
 * v0.1.426 — Una imagen ya en memoria (una miniatura). El tipo sale de los
 * bytes (WebP, o una imagen chica sin achicar), nunca SVG: se sirve inline con
 * las mismas barreras que cualquier archivo (`nosniff` + CSP `sandbox`).
 */
export function sendImage(reply: FastifyReply, img: ImageBytes, cacheControl?: string): void {
    reply.raw.writeHead(200, {
        'content-type': img.mime,
        'content-length': String(img.bytes.length),
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        ...(cacheControl ? { 'cache-control': cacheControl } : {}),
    });
    reply.raw.end(img.bytes);
}

/**
 * Streamea un archivo con guard de errores: si el stream falla a mitad de
 * respuesta (bytes corruptos/perdidos), se DESTRUYE la conexión — sin esto
 * la request quedaba colgada hasta el timeout del proxy (504).
 */
export async function streamFile(
    file: OpenedFile,
    reply: FastifyReply,
    cacheControl?: string,
    opts: { range?: string; download?: boolean } = {},
): Promise<void> {
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
    const { contentType, disposition } = safeDisposition(file.mime, { download: opts.download });
    const common = {
        'content-type': contentType,
        'content-disposition': contentDispositionHeader(disposition, file.filename),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        ...(file.range ? { 'accept-ranges': 'bytes' } : {}),
        ...(cacheControl ? { 'cache-control': cacheControl } : {}),
    };
    // v0.1.291 — un tramo (`Range`), si el almacenamiento sabe leerlo: el
    // video y el audio de la vista previa se adelantan pidiendo rangos.
    const range = file.range ? parseByteRange(opts.range, file.size) : null;
    if (range === 'invalid') {
        reply.raw.writeHead(416, { ...common, 'content-range': `bytes */${file.size}` });
        reply.raw.end();
        return;
    }
    const stream = range && file.range ? file.range(range.start, range.end) : file.stream;
    if (range) {
        reply.raw.writeHead(206, {
            ...common,
            'content-range': `bytes ${range.start}-${range.end}/${file.size}`,
            'content-length': String(range.end - range.start + 1),
        });
    } else {
        reply.raw.writeHead(200, { ...common, 'content-length': String(file.size) });
    }
    stream.pipe(reply.raw);
    await new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('error', () => {
            reply.raw.destroy();
            resolve();
        });
        // Quien mira adelantó el video (o cerró la vista previa): se corta la
        // lectura en vez de seguir leyendo para nadie.
        reply.raw.on('close', () => {
            stream.destroy();
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
    @AllowGuest()
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
    @AllowGuest()
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
    @AllowGuest()
    @RequireCapability('view_records', 'view_own_records')
    async download(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Res() reply: FastifyReply,
        @Query('preview') preview?: string,
        @Query('dl') dl?: string,
    ): Promise<void> {
        const opts = { proxy: preview === '1', download: dl === '1' };
        const file = await this.files.openDownload(req.tenant!.tenantId, id, fileActor(req), opts);
        await streamFile(file, reply, undefined, { range: req.headers.range, download: opts.download });
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
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
