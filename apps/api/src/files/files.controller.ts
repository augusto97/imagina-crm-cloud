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
import { FilesService, type AttachmentDto } from './files.service';

/**
 * Archivos propios (ADR-S16). Upload multipart, resolución batch para la UI
 * (tarjetas/galerías) y descarga streameada — SIEMPRE detrás de sesión +
 * tenant (los bytes jamás se sirven sin el check de workspace).
 */
@Controller('files')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class FilesController {
    constructor(private readonly files: FilesService) {}

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
        return { data: await this.files.resolve(req.tenant!.tenantId, parsed) };
    }

    /** Descarga streameada (inline; el browser decide por content-type). */
    @Get(':id/download')
    @RequireCapability('view_records', 'view_own_records')
    async download(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const file = await this.files.openDownload(req.tenant!.tenantId, id);
        reply.raw.writeHead(200, {
            'content-type': file.mime,
            'content-length': String(file.size),
            'content-disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
            'x-content-type-options': 'nosniff',
        });
        file.stream.pipe(reply.raw);
        await new Promise<void>((resolve, reject) => {
            file.stream.on('end', resolve);
            file.stream.on('error', reject);
        });
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.files.remove(req.tenant!.tenantId, id);
    }
}
