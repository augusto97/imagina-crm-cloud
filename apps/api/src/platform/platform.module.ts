import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { FilesModule } from '../files/files.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { TenantTransferController } from './tenant-transfer.controller';
import { TenantTransferService } from './tenant-transfer.service';

/**
 * Consola de plataforma (operador SaaS). `SuperadminGuard` se provee acá (no es
 * global). `BillingService` llega por el módulo @Global de billing y DRIZZLE por
 * DbModule @Global.
 */
@Module({
    imports: [AuthModule, FilesModule],
    controllers: [PlatformController, TenantTransferController],
    providers: [PlatformService, TenantTransferService, SuperadminGuard],
})
export class PlatformModule {}
