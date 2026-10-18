import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
    recoveryDriveClientSchema,
    recoveryFreshSchema,
    recoveryRestoreSchema,
    recoveryUnlockSchema,
    type BackupDriveStatus,
    type DriveConnectPoll,
    type RecoveryDriveClientInput,
    type RecoveryFreshInput,
    type RecoveryRestoreInput,
    type RecoveryStatus,
    type RecoveryUnlockInput,
    type RemoteBackup,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV, type Env } from '../config/env';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BackupDriveService } from '../update/backup-drive.service';
import { RECOVERY_COOKIE, RecoveryService } from './recovery.service';

/**
 * v0.1.283 (ADR-S43) — `/recovery/*`: sin sesión (todavía no hay empresas ni cuentas activas),
 * protegido por el código que imprimió `install.sh`. Fuera del modo
 * recuperación responde 404 a todo.
 */
@Controller('recovery')
export class RecoveryController {
    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly recovery: RecoveryService,
        private readonly drive: BackupDriveService,
    ) {}

    private async guard(req: FastifyRequest): Promise<void> {
        await this.recovery.assertActive();
        if (!this.recovery.verifyToken(req.cookies?.[RECOVERY_COOKIE])) {
            throw new ForbiddenException({ code: 'recovery_locked', message: 'Ingresa el código del instalador.', data: { status: 403 } });
        }
    }

    @Get('status')
    async status(@Req() req: FastifyRequest): Promise<RecoveryStatus> {
        await this.recovery.assertActive();
        return this.recovery.status(this.recovery.verifyToken(req.cookies?.[RECOVERY_COOKIE]));
    }

    @Post('unlock')
    @HttpCode(200)
    async unlock(
        @Body(new ZodValidationPipe(recoveryUnlockSchema)) input: RecoveryUnlockInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<{ ok: true }> {
        await this.recovery.assertActive();
        const token = this.recovery.unlock(input.code);
        reply.setCookie(RECOVERY_COOKIE, token, {
            httpOnly: true,
            secure: this.env.COOKIE_SECURE || this.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/api/v1/recovery',
            maxAge: 2 * 3600,
        });
        return { ok: true };
    }

    @Post('drive/client')
    @HttpCode(200)
    async driveClient(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(recoveryDriveClientSchema)) input: RecoveryDriveClientInput): Promise<BackupDriveStatus> {
        await this.guard(req);
        return this.recovery.setDriveClient(input);
    }

    @Post('drive/connect')
    async driveConnect(@Req() req: FastifyRequest): Promise<DriveConnectPoll> {
        await this.guard(req);
        return this.drive.connectStart();
    }

    @Post('drive/connect/poll')
    @HttpCode(200)
    async drivePoll(@Req() req: FastifyRequest): Promise<DriveConnectPoll> {
        await this.guard(req);
        return this.drive.connectPoll();
    }

    @Delete('drive/connect')
    @HttpCode(204)
    async driveCancel(@Req() req: FastifyRequest): Promise<void> {
        await this.guard(req);
        await this.drive.connectCancel();
    }

    @Get('drive/files')
    async driveFiles(@Req() req: FastifyRequest): Promise<RemoteBackup[]> {
        await this.guard(req);
        return this.drive.listRemote();
    }

    @Post('restore')
    @HttpCode(202)
    async restore(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(recoveryRestoreSchema)) input: RecoveryRestoreInput): Promise<{ ok: true }> {
        await this.guard(req);
        return this.recovery.startRestore(input);
    }

    @Post('fresh')
    @HttpCode(201)
    async fresh(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(recoveryFreshSchema)) input: RecoveryFreshInput): Promise<{ ok: true }> {
        await this.guard(req);
        return this.recovery.fresh(input);
    }
}
