import { Module } from '@nestjs/common';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/** Dashboards + widgets sobre el motor de agregados (TenantDb es @Global). */
@Module({
    imports: [AggregateModule, AuthModule],
    controllers: [DashboardsController],
    providers: [DashboardsService],
})
export class DashboardsModule {}
