import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { PlatformNetworkController, PublicNetCheckController } from './network.controller';
import { PlatformNetworkService } from './platform-network.service';

/**
 * v0.1.409 (ADR-S102) — la dirección rápida para lo que se inserta en los
 * sitios (por Cloudflare). Global: la leen formularios, agenda y widgets al
 * armar sus códigos.
 */
@Global()
@Module({
    imports: [AuthModule],
    controllers: [PlatformNetworkController, PublicNetCheckController],
    providers: [PlatformNetworkService, SuperadminGuard],
    exports: [PlatformNetworkService],
})
export class NetworkModule {}
