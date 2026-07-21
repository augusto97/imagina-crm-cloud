import { Module } from '@nestjs/common';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { RecordsModule } from '../records/records.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/**
 * Dashboards + widgets sobre el motor de agregados (TenantDb es @Global).
 * RecordsModule/FieldsModule: el widget de tabla lista registros reales con
 * el ACL del viewer (v0.1.97).
 */
@Module({
    imports: [AggregateModule, AuthModule, FieldsModule, RecordsModule],
    controllers: [DashboardsController],
    providers: [DashboardsService],
})
export class DashboardsModule {}
