import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PublicDomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

/**
 * Dominio personalizado por tenant (ADR-S17): resolución Host→tenant para el
 * boot white-label, endpoint `ask` de Caddy y gestión del dominio propio
 * (los endpoints por-workspace viven en WorkspacesController).
 */
@Module({
    imports: [FilesModule],
    controllers: [PublicDomainsController],
    providers: [DomainsService],
    exports: [DomainsService],
})
export class DomainsModule {}
