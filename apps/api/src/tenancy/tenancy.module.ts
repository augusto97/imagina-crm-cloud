import { Global, Module } from '@nestjs/common';
import { TenantDb } from './tenant-db.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
    providers: [TenantDb, TenantGuard],
    exports: [TenantDb, TenantGuard],
})
export class TenancyModule {}
