import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { UpdateStatus } from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { CheckUpdatesService } from './check-updates.service';
import { UpdateManager } from './update-manager.service';
import { UpdateQueue } from './update-queue';

/**
 * Panel de auto-actualización (ADR-S13). Sólo superadmin de plataforma
 * (SuperadminGuard). No lleva TenantGuard: es una operación global del servidor.
 */
@Controller('system/update')
@UseGuards(SessionGuard, SuperadminGuard)
export class UpdateController {
    constructor(
        private readonly manager: UpdateManager,
        private readonly checkUpdates: CheckUpdatesService,
        private readonly queue: UpdateQueue,
    ) {}

    @Get('status')
    status(): Promise<UpdateStatus> {
        return this.manager.status();
    }

    /** Fuerza el chequeo de releases ahora y devuelve el estado actualizado. */
    @Post('check')
    async check(): Promise<UpdateStatus> {
        await this.checkUpdates.check().catch(() => null);
        return this.manager.status();
    }

    /** Encola la instalación del release disponible. */
    @Post('run')
    @HttpCode(202)
    async run(): Promise<{ queued: boolean; message: string }> {
        const status = await this.manager.status();
        if (!status.update_available || !status.available) {
            return { queued: false, message: 'No hay una actualización disponible' };
        }
        await this.manager.markQueued(status.available.version);
        const queued = await this.queue.enqueueRun();
        return { queued, message: queued ? 'Actualización encolada' : 'Cola no disponible' };
    }

    @Post('rollback')
    rollback(): Promise<{ ok: boolean; message: string }> {
        return this.manager.rollback();
    }
}
