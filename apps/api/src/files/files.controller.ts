import {
    BadRequestException,
    Controller,
    Delete,
    Get,
    HttpCode,
    Inject,
    NotFoundException,
    Optional,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { fileThumbWidth } from '@imagina-base/shared';
import { PORTAL_SESSION_COOKIE, SESSION_COOKIE, SessionGuard } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { fetchContextOf, isBrowserImageLoad, isCrossSiteEmbed } from '../common/hotlink';
import { REDIS } from '../redis/redis.module';
import { incrWithTtl } from '../redis/redis.util';
import { AllowTenantQuery } from '../tenancy/allow-tenant-query.decorator';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AllowGuest } from '../tenancy/allow-guest.decorator';
import { BillingService } from '../billing/billing.service';
import { type FileActor, FilesService, MAIL_URL_MIN_TTL, type AttachmentDto, type OpenedFile } from './files.service';
import { BIND_TAG_RE, FileBindingInterceptor, sessionBindTag } from './file-binding';
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
        // v0.1.427 — la sesión de una URL atada y el tope de las de correo.
        @Optional() private readonly sessions?: SessionService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
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
        @Query('b') b?: string,
    ): Promise<void> {
        const expSec = Number(exp ?? 0);
        const tenantId = Number(tenant ?? 0);
        const opts = { proxy: preview === '1', download: dl === '1' };
        // v0.1.427 — `b`: la URL es de UNA sesión (la app, el portal). Sólo la
        // abre el navegador que tiene esa sesión; copiada a otro lado, 404.
        const bindTag = b === undefined ? null : BIND_TAG_RE.test(b) ? b : '';
        if (bindTag === '') throw new NotFoundException();
        this.files.assertSigned(id, tenantId, expSec, String(sig ?? ''), bindTag);
        const secondsLeft = Math.floor(expSec - Date.now() / 1000);
        const mail = bindTag === null && secondsLeft > MAIL_URL_MIN_TTL;
        if (bindTag !== null) {
            if (!(await this.holdsSession(req, bindTag))) throw new NotFoundException();
        } else {
            const verdict = await this.publicVerdict(req, tenantId, id, mail);
            if (verdict !== 'ok') {
                refuse(reply, verdict);
                return;
            }
        }
        // v0.1.253 — la URL firmada es inmutable hasta que vence (la firma
        // cubre id + exp): el navegador la puede guardar hasta entonces. Sin
        // esto, el logo del workspace se volvía a bajar en cada pantalla.
        // v0.1.427 — la de un correo (dura años) se guarda un año.
        const ttl = Math.max(0, Math.min(mail ? 31_536_000 : 86_400, secondsLeft));
        const cacheControl = ttl > 0 ? `private, max-age=${ttl}, immutable` : undefined;
        // Lo que no es de un correo, el navegador no lo muestra dentro de una
        // página de otro sitio (aunque el servidor lo hubiera mandado).
        if (!mail) reply.raw.setHeader('cross-origin-resource-policy', 'same-site');
        // v0.1.426 — `w`: la miniatura (WebP al ancho pedido) de una IMAGEN.
        // Un ancho fuera de la lista, o un archivo que no es una imagen que se
        // pueda achicar (PDF, SVG…), se ignora: va el original como siempre.
        // Una imagen de correo va siempre tal cual (Outlook no lee WebP).
        const width = opts.download || mail ? null : fileThumbWidth(w);
        if (width !== null && this.thumbs) {
            const thumb = await this.thumbs.attachmentThumb(tenantId, id, width);
            if (thumb) {
                sendImage(reply, thumb, cacheControl);
                return;
            }
        }
        const file = await this.files.openSigned(id, tenantId, expSec, String(sig ?? ''), opts, bindTag);
        await streamFile(file, reply, cacheControl, {
            range: req.headers.range,
            download: opts.download,
        });
    }

    /**
     * ¿El pedido trae la sesión a la que está atada la URL? Se compara el
     * resumen de cada credencial que llega (la cookie de la app, la del portal,
     * un `Authorization`) con el de la URL, y la sesión tiene que seguir viva
     * (cerrar sesión o revocarla deja de servir sus URLs).
     */
    private async holdsSession(req: FastifyRequest, tag: string): Promise<boolean> {
        const header = req.headers.authorization;
        const candidates = [
            req.cookies?.[SESSION_COOKIE],
            req.cookies?.[PORTAL_SESSION_COOKIE],
            header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined,
        ];
        for (const token of candidates) {
            if (typeof token !== 'string' || token === '' || sessionBindTag(token) !== tag) continue;
            if (!this.sessions) return true;
            return (await this.sessions.peek(token).catch(() => null)) !== null;
        }
        return false;
    }

    /**
     * Una URL sin sesión es de una página PÚBLICA (la tienda, un formulario…)
     * o de un CORREO. La de una página pública sólo se muestra en esa página:
     * otro sitio no la puede usar. La de un correo sí (cada programa de correo
     * la pide a su manera), pero con un tope de pedidos por minuto, así no se
     * convierte en la imagen de la página de alguien.
     */
    private async publicVerdict(req: FastifyRequest, tenantId: number, id: number, mail: boolean): Promise<'ok' | 'hotlink' | 'busy'> {
        const ctx = fetchContextOf(req);
        if (!isCrossSiteEmbed(ctx)) return 'ok';
        if (!mail) return 'hotlink';
        if (!this.redis || !isBrowserImageLoad(ctx)) return 'ok';
        const minute = Math.floor(Date.now() / 60_000);
        try {
            const n = await incrWithTtl(this.redis, `filehot:${tenantId}:${id}:${minute}`, 120);
            return n > MAIL_IMAGE_LOADS_PER_MINUTE ? 'busy' : 'ok';
        } catch {
            return 'ok';
        }
    }
}

/**
 * v0.1.427 — Cuántas veces por minuto se puede pedir una imagen de correo desde
 * fuera de un proxy de correo (Gmail, Outlook y Apple Mail la piden por su
 * servidor y no cuentan). Un correo no se abre 60 veces en el mismo minuto;
 * una página de otro sitio que la usa como su imagen, sí.
 */
export const MAIL_IMAGE_LOADS_PER_MINUTE = 60;

/** La respuesta a quien no puede usar el archivo así. No se guarda en ningún caché. */
function refuse(reply: FastifyReply, verdict: 'hotlink' | 'busy'): void {
    const status = verdict === 'busy' ? 429 : 403;
    const body = verdict === 'busy' ? 'Demasiados pedidos de esta imagen.' : 'Este archivo sólo se puede ver en la página donde se publicó.';
    reply.raw.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    });
    reply.raw.end(body);
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
// v0.1.427 — las URLs que devuelve (subir, resolver) quedan atadas a la sesión.
@UseInterceptors(FileBindingInterceptor)
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

    /**
     * v0.1.427 — Dirección FIJA de un archivo para usar en la app sin pedir
     * antes su URL (las imágenes de la ficha diseñada y de los tableros). Una
     * `<img>` no manda el `X-Tenant-Id`, así que la empresa viaja en `?t=`; la
     * sesión es la cookie, que el navegador sólo manda desde la propia app.
     * Revisa el acceso y redirige a la URL atada a esta sesión (con `w` si se
     * pidió una miniatura): el navegador guarda las dos.
     */
    @Get(':id/view')
    @AllowGuest()
    @AllowTenantQuery()
    @RequireCapability('view_records', 'view_own_records')
    async view(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Res() reply: FastifyReply,
        @Query('w') w?: string,
    ): Promise<void> {
        const [dto] = await this.files.resolve(req.tenant!.tenantId, [id], fileActor(req));
        if (!dto) throw new NotFoundException();
        const width = fileThumbWidth(w);
        reply.raw.writeHead(302, {
            location: width !== null ? `${dto.url}&w=${width}` : dto.url,
            'cache-control': 'private, max-age=600',
            'referrer-policy': 'no-referrer',
        });
        reply.raw.end();
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
