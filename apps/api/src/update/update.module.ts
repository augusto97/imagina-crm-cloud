import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ENV, type Env } from '../config/env';
import { BackupDriveService } from './backup-drive.service';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { CheckUpdatesService } from './check-updates.service';
import { ReleasesRepository } from './releases.repository';
import { DiagnosticsController } from './diagnostics.controller';
import { PostgresWalService } from './postgres-wal';
import { GuardianService } from './guardian.service';
import { PlatformAlertsService } from './platform-alerts.service';
import { PlatformWatchQueue } from './platform-watch.queue';
import { PlatformWatchService } from './platform-watch.service';
import { SmtpController } from './smtp.controller';
import { SymlinkDeployer } from './symlink-deployer.service';
import { UpdateController } from './update.controller';
import { UpdateManager } from './update-manager.service';
import { UpdateQueue } from './update-queue';
import { DEPLOYER } from './update.types';

/**
 * Auto-actualización desde GitHub Releases (ADR-S13). El Deployer real
 * (SymlinkDeployer) se auto-deshabilita en dev (sin UPDATER_BASE_PATH). El
 * estado del run vive en Redis (compartido, sobrevive al flip del symlink).
 */
@Module({
    imports: [AuthModule],
    controllers: [UpdateController, SmtpController, BackupsController, DiagnosticsController],
    providers: [
        SuperadminGuard,
        ReleasesRepository,
        CheckUpdatesService,
        UpdateManager,
        BackupsService,
        BackupDriveService,
        UpdateQueue,
        PostgresWalService,
        // v0.1.431 (ADR-S104) — la reparación automática, los avisos y el monitoreo.
        GuardianService,
        PlatformAlertsService,
        PlatformWatchService,
        PlatformWatchQueue,
        {
            provide: DEPLOYER,
            inject: [ENV],
            useFactory: (env: Env) => new SymlinkDeployer(env),
        },
    ],
    exports: [UpdateManager, BackupsService, BackupDriveService, PlatformAlertsService],
})
export class UpdateModule {}
