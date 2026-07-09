import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ENV, type Env } from '../config/env';
import { CheckUpdatesService } from './check-updates.service';
import { ReleasesRepository } from './releases.repository';
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
    controllers: [UpdateController, SmtpController],
    providers: [
        SuperadminGuard,
        ReleasesRepository,
        CheckUpdatesService,
        UpdateManager,
        UpdateQueue,
        {
            provide: DEPLOYER,
            inject: [ENV],
            useFactory: (env: Env) => new SymlinkDeployer(env),
        },
    ],
    exports: [UpdateManager],
})
export class UpdateModule {}
