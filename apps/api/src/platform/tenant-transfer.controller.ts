import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    exportTenantSchema,
    importTenantBodySchema,
    type ExportTenantInput,
    type ExportTenantResult,
    type ImportTenantBody,
    type ImportTenantResult,
    type TenantTransferStatus,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantTransferService } from './tenant-transfer.service';

/** Un archivo de empresa puede pesar mucho más que un adjunto (20 MB). */
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * v0.1.197 — Migración de UNA empresa entre instancias (ADR-S23). Sólo
 * superadmin de plataforma y sin TenantGuard: el operador actúa SOBRE las
 * empresas, no dentro de una.
 */
@Controller('platform')
@UseGuards(SessionGuard, SuperadminGuard)
export class TenantTransferController {
    constructor(private readonly transfers: TenantTransferService) {}

    @Get('transfers')
    status(): Promise<TenantTransferStatus> {
        return this.transfers.status();
    }

    @Post('tenants/:id/export')
    export(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(exportTenantSchema)) input: ExportTenantInput,
    ): Promise<ExportTenantResult> {
        return this.transfers.exportTenant(id, input);
    }

    @Get('transfers/:name/download')
    download(@Param('name') name: string, @Res() reply: FastifyReply): void {
        const file = this.transfers.resolve(name);
        const size = statSync(file).size;
        // `content-encoding: identity`: sin esto @fastify/compress comprime al
        // vuelo y se pierde el content-length (ni progreso ni resume).
        void reply
            .header('content-type', 'application/octet-stream')
            .header('content-encoding', 'identity')
            .header('content-length', String(size))
            .header('content-disposition', `attachment; filename="${path.basename(file)}"`)
            .header('x-content-type-options', 'nosniff')
            .send(createReadStream(file));
    }

    /** Sube un archivo exportado en OTRO servidor (multipart, campo `file`). */
    @Post('transfers/upload')
    async upload(@Req() req: FastifyRequest): Promise<{ file: string }> {
        const part = await req.file({ limits: { fileSize: MAX_ARCHIVE_BYTES } });
        if (!part) {
            throw new BadRequestException({
                code: 'no_file',
                message: 'Falta el archivo (multipart field `file`)',
                data: { status: 400 },
            });
        }
        const name = await this.transfers.receive(part.filename, part.file);
        if (part.file.truncated) {
            this.transfers.remove(name);
            throw new BadRequestException({
                code: 'file_too_large',
                message: 'El archivo supera el límite de subida.',
                data: { status: 400 },
            });
        }
        return { file: name };
    }

    @Post('transfers/:name/import')
    @HttpCode(200)
    import(
        @Param('name') name: string,
        @Body(new ZodValidationPipe(importTenantBodySchema)) body: ImportTenantBody,
    ): Promise<ImportTenantResult> {
        return this.transfers.importTenant({ ...body, file: name });
    }

    @Delete('transfers/:name')
    @HttpCode(204)
    remove(@Param('name') name: string): void {
        this.transfers.remove(name);
    }
}
