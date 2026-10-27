import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { FilesModule } from '../files/files.module';
import { PlatformWhatsNewController, WhatsNewController, WhatsNewImagesController } from './whats-new.controller';
import { WhatsNewAdminService } from './whats-new-admin.service';
import { WhatsNewSyncService } from './whats-new-sync.service';
import { WhatsNewService } from './whats-new.service';

/**
 * Fase 7 · entrega 3 — Novedades: el catálogo que viaja con cada versión (se
 * sincroniza al arrancar), lo que publica el operador y lo que vio cada
 * persona.
 */
@Module({
    imports: [AuthModule, FilesModule],
    controllers: [WhatsNewController, PlatformWhatsNewController, WhatsNewImagesController],
    providers: [WhatsNewService, WhatsNewAdminService, WhatsNewSyncService, SuperadminGuard],
})
export class WhatsNewModule {}
