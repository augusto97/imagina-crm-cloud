import { Body, Controller, Delete, Get, HttpCode, Inject, Optional, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
    updateMonitoringSchema,
    type DiskCleanupResult,
    type DiskUsage,
    type GuardianStatus,
    type MonitoringStatus,
    type PlatformAlerts,
    type PlatformDiagnostics,
    type UpdateMonitoringInput,
    type WalReleaseResult,
} from '@imagina-base/shared';
import path from 'node:path';
import { ENV, type Env } from '../config/env';
import { LayoutDisk, MIN_FREE_INODES, dirBytes, freeBytes, freeInodes } from './disk-space';
import { PostgresWalService } from './postgres-wal';
import { GuardianService } from './guardian.service';
import { PlatformWatchQueue } from './platform-watch.queue';
import { processRole } from '../redis/queue-runtime';
import { PlatformAlertsService } from './platform-alerts.service';
import { PlatformWatchService } from './platform-watch.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type Redis from 'ioredis';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { serverConfigStatus } from '../common/web-build';
import { MailService } from '../mail/mail.service';
import { clearClientErrors, readClientErrors } from '../observability/client-errors';
import { clearDiagnostics, readMailLog, readServerErrors } from '../observability/diagnostics';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.238 — Plataforma → Diagnóstico (superadmin): si los correos de cuenta
 * tienen por dónde salir, los últimos correos con su resultado y los últimos
 * errores inesperados del servidor. Sin esto había que entrar al servidor a
 * leer el journal para saber por qué no llegó un correo o qué fue un "Error
 * interno".
 */
@Controller('system/diagnostics')
@UseGuards(SessionGuard, SuperadminGuard)
export class DiagnosticsController {
    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        private readonly mail: MailService,
        @Inject(ENV) private readonly env: Env,
        private readonly wal: PostgresWalService,
        private readonly guardian: GuardianService,
        private readonly alerts: PlatformAlertsService,
        private readonly watch: PlatformWatchService,
        @Optional() private readonly watchQueue?: PlatformWatchQueue,
    ) {}

    // ── v0.1.431 (ADR-S104): la reparación automática, los avisos y el monitoreo ──

    @Get('guardian')
    async guardianStatus(): Promise<GuardianStatus> {
        const status = this.guardian.status();
        const workers = this.watchQueue ? await this.watchQueue.workersConnected() : null;
        return { ...status, processes: { role: processRole(), workers } };
    }

    /** «Reparar ahora»: el guardián revisa al instante (sólo un archivo vacío; lo que hace lo decide él). */
    @Post('guardian/request')
    @HttpCode(200)
    guardianRequest(): { ok: boolean; reason: string | null } {
        return this.guardian.requestRepair();
    }

    @Get('alerts')
    alertsList(): Promise<PlatformAlerts> {
        return this.alerts.list();
    }

    /** «Revisar ahora»: todas las revisiones (también las de cada 15 min y 6 h). */
    @Post('alerts/check')
    @HttpCode(200)
    async alertsCheck(): Promise<PlatformAlerts> {
        await this.watch.tick({ force: true });
        return this.alerts.list();
    }

    @Post('alerts/:key/dismiss')
    @HttpCode(200)
    async alertsDismiss(@Param('key') key: string): Promise<PlatformAlerts> {
        await this.alerts.dismiss(key.slice(0, 200));
        return this.alerts.list();
    }

    @Get('monitoring')
    monitoring(): Promise<MonitoringStatus> {
        return this.watch.monitoringStatus();
    }

    @Put('monitoring')
    monitoringUpdate(@Body(new ZodValidationPipe(updateMonitoringSchema)) patch: UpdateMonitoringInput): Promise<MonitoringStatus> {
        return this.watch.setMonitoring(patch);
    }

    /** «Probar»: un latido ahora (aunque esté pausado) y el estado. */
    @Post('monitoring/test')
    @HttpCode(200)
    async monitoringTest(): Promise<MonitoringStatus> {
        await this.watch.heartbeat(Date.now(), { test: true });
        return this.watch.monitoringStatus();
    }

    @Get()
    async get(): Promise<PlatformDiagnostics> {
        const [account_mail, mail, errors, client_errors] = await Promise.all([
            this.mail.accountMailStatus(),
            readMailLog(this.redis, 100),
            readServerErrors(this.redis, 100),
            readClientErrors(this.redis, 100).catch(() => []),
        ]);
        return { server: serverConfigStatus(this.env), account_mail, mail, errors, client_errors };
    }

    /**
     * v0.1.278 — El disco del servidor: libre/total y lo que ocupan las
     * carpetas de la app que crecen. Sin esto, un disco lleno se descubría
     * cuando fallaba una actualización.
     */
    @Get('disk')
    async disk(): Promise<DiskUsage> {
        const base = this.env.UPDATER_BASE_PATH;
        const min = this.env.UPDATER_MIN_FREE_MB * 1024 * 1024;
        const where = base || process.cwd();
        const { free, total } = freeBytes(where);
        const ino = freeInodes(where);
        const inodes = {
            total_inodes: ino?.total ?? null,
            free_inodes: ino?.free ?? null,
            min_free_inodes: MIN_FREE_INODES,
            low_inodes: ino !== null && ino.free < MIN_FREE_INODES,
        };
        // v0.1.337 — la base, su registro de cambios (WAL) y el archivo: lo que
        // antes quedaba escondido en «Base de datos, sistema y otros».
        const postgres = await this.wal.status();
        if (!base) {
            return { available: false, path: where, total_bytes: total, free_bytes: free, low: free < min, min_free_bytes: min, ...inodes, parts: [], reclaimable_bytes: 0, postgres };
        }
        const layout = new LayoutDisk(base, this.env.UPDATER_KEEP_RELEASES);
        const [releases, backups, uploads, reclaimable] = await Promise.all([
            dirBytes(path.join(base, 'releases')),
            dirBytes(path.join(base, 'shared', 'backups')),
            dirBytes(path.join(base, 'shared', 'uploads')),
            layout.reclaimable(),
        ]);
        return {
            available: true,
            path: base,
            total_bytes: total,
            free_bytes: free,
            low: free < min,
            min_free_bytes: min,
            ...inodes,
            parts: [
                { key: 'releases', label: 'Versiones de la app', bytes: releases },
                { key: 'backups', label: 'Copias de seguridad', bytes: backups },
                { key: 'uploads', label: 'Archivos subidos', bytes: uploads },
            ],
            reclaimable_bytes: reclaimable,
            postgres,
        };
    }

    /**
     * v0.1.337 — «Liberar y reparar» el registro de cambios trabado: da por
     * archivados los pendientes, hace un punto de control y le devuelve la
     * carpeta del archivo a postgres. Sólo si el archivado está fallando.
     */
    @Post('disk/wal-release')
    @HttpCode(200)
    async walRelease(): Promise<WalReleaseResult> {
        return this.wal.release();
    }

    /** «Liberar espacio»: lo mismo que hace solo el actualizador cuando falta lugar. */
    @Post('disk/cleanup')
    @HttpCode(200)
    async cleanup(): Promise<DiskCleanupResult> {
        const base = this.env.UPDATER_BASE_PATH;
        if (!base) return { freed_bytes: 0, removed: [], free_bytes: freeBytes(process.cwd()).free };
        const out = await new LayoutDisk(base, this.env.UPDATER_KEEP_RELEASES).cleanup();
        return { freed_bytes: out.freed, removed: out.removed, free_bytes: freeBytes(base).free };
    }

    @Delete()
    @HttpCode(204)
    async clear(): Promise<void> {
        await clearDiagnostics(this.redis);
        await clearClientErrors(this.redis);
    }
}
