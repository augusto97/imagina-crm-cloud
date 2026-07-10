import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/**
 * Consola de plataforma (operador SaaS). `SuperadminGuard` se provee acá (no es
 * global). `BillingService` llega por el módulo @Global de billing y DRIZZLE por
 * DbModule @Global.
 */
@Module({
    imports: [AuthModule],
    controllers: [PlatformController],
    providers: [PlatformService, SuperadminGuard],
})
export class PlatformModule {}
