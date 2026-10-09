import { Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { DiskCleanupResult, DiskUsage, PlatformDiagnostics } from '@imagina-base/shared';
import path from 'node:path';
import { ENV, type Env } from '../config/env';
import { LayoutDisk, dirBytes, freeBytes } from './disk-space';
import type Redis from 'ioredis';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { MailService } from '../mail/mail.service';
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
    ) {}

    @Get()
    async get(): Promise<PlatformDiagnostics> {
        const [account_mail, mail, errors] = await Promise.all([
            this.mail.accountMailStatus(),
            readMailLog(this.redis, 100),
            readServerErrors(this.redis, 100),
        ]);
        return { account_mail, mail, errors };
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
        if (!base) {
            return { available: false, path: where, total_bytes: total, free_bytes: free, low: free < min, min_free_bytes: min, parts: [], reclaimable_bytes: 0 };
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
            parts: [
                { key: 'releases', label: 'Versiones de la app', bytes: releases },
                { key: 'backups', label: 'Copias de seguridad', bytes: backups },
                { key: 'uploads', label: 'Archivos subidos', bytes: uploads },
            ],
            reclaimable_bytes: reclaimable,
        };
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
    }
}
