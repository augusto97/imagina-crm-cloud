import { Global, Module } from '@nestjs/common';
import { TenantDb } from './tenant-db.service';
import { TenantGuard } from './tenant.guard';
import { TenantTimeZones } from './tenant-time-zone.service';

@Global()
@Module({
    providers: [TenantDb, TenantGuard, TenantTimeZones],
    exports: [TenantDb, TenantGuard, TenantTimeZones],
})
export class TenancyModule {}
