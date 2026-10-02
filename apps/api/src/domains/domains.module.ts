import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { FilesModule } from '../files/files.module';
import { PublicDomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { PlatformDomainsController } from './platform-domains.controller';

/**
 * Dominio personalizado por tenant (ADR-S17): resolución Host→tenant para el
 * boot white-label, endpoint `ask` de Caddy y gestión del dominio propio
 * (los endpoints por-workspace viven en WorkspacesController).
 */
@Module({
    imports: [AuthModule, FilesModule],
    controllers: [PublicDomainsController, PlatformDomainsController],
    providers: [DomainsService, SuperadminGuard],
    exports: [DomainsService],
})
export class DomainsModule {}
