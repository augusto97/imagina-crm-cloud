import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { updateBackupsSettingsSchema, type BackupsSettings, type BackupsStatus, type UpdateBackupsSettingsInput } from '@imagina-base/shared';
import type { FastifyReply } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BackupsService } from './backups.service';
import { UpdateQueue } from './update-queue';

/**
 * v0.1.179 — Copias de seguridad completas (ADR-S20). Sólo superadmin de
 * plataforma; sin TenantGuard: es una operación global del servidor.
 */
@Controller('system/backups')
@UseGuards(SessionGuard, SuperadminGuard)
export class BackupsController {
    constructor(
        private readonly backups: BackupsService,
        private readonly queue: UpdateQueue,
    ) {}

    @Get()
    status(): Promise<BackupsStatus> {
        return this.backups.status();
    }

    /** Encola una copia ahora (la hace el worker in-process, una a la vez). */
    @Post()
    @HttpCode(202)
    async create(): Promise<{ queued: boolean; message: string }> {
        const status = await this.backups.status();
        if (!status.available) return { queued: false, message: status.reason ?? 'Copias no disponibles' };
        if (['queued', 'running', 'restoring'].includes(status.run.status)) {
            return { queued: false, message: 'Ya hay una operación en curso' };
        }
        await this.backups.markQueued();
        const queued = await this.queue.enqueueSnapshot();
        if (!queued) await this.backups.markFailed('Cola no disponible (¿Redis caído?)');
        return { queued, message: queued ? 'Copia encolada' : 'Cola no disponible' };
    }

    @Patch('settings')
    settings(@Body(new ZodValidationPipe(updateBackupsSettingsSchema)) patch: UpdateBackupsSettingsInput): Promise<BackupsSettings> {
        return this.backups.setSettings(patch);
    }

    @Get(':name/download')
    download(@Param('name') name: string, @Res() reply: FastifyReply): void {
        const file = this.backups.resolve(name);
        const size = statSync(file).size;
        // `content-encoding: identity` le dice a @fastify/compress que NO
        // comprima: un tar de cientos de MB comprimido al vuelo pierde el
        // content-length (sin barra de progreso ni resume en el navegador).
        void reply
            .header('content-type', 'application/octet-stream')
            .header('content-encoding', 'identity')
            .header('content-length', String(size))
            .header('content-disposition', `attachment; filename="${path.basename(file)}"`)
            .header('x-content-type-options', 'nosniff')
            .send(createReadStream(file));
    }

    @Delete(':name')
    @HttpCode(204)
    remove(@Param('name') name: string): void {
        this.backups.remove(name);
    }

    @Post(':name/restore')
    restore(@Param('name') name: string): Promise<{ ok: boolean; message: string }> {
        return this.backups.restore(name);
    }
}
