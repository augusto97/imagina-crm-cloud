import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { PushKeysService } from './push-keys.service';
import { PushService } from './push.service';
import { PushController, PwaManifestController } from './pwa.controller';

/**
 * H1 — App instalable (manifiesto por Host) y notificaciones push (Web Push
 * con VAPID). `PushService` es el canal push del pipeline de avisos.
 */
@Module({
    imports: [AuthModule, DomainsModule],
    controllers: [PwaManifestController, PushController],
    providers: [PushKeysService, PushService],
    exports: [PushService],
})
export class PwaModule {}
