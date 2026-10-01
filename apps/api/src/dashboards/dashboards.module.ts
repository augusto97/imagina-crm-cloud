import { Module } from '@nestjs/common';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { RecordsModule } from '../records/records.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';
import { RecordLayoutController } from './record-layout.controller';
import { RecordLayoutDataService } from './record-layout-data.service';
import { ListsModule } from '../lists/lists.module';

/**
 * Dashboards + widgets sobre el motor de agregados (TenantDb es @Global).
 * RecordsModule/FieldsModule: el widget de tabla lista registros reales con
 * el ACL del viewer (v0.1.97).
 */
@Module({
    imports: [AggregateModule, AuthModule, FieldsModule, ListsModule, RecordsModule],
    controllers: [DashboardsController, RecordLayoutController],
    // v0.1.230 — datos de los bloques de la ficha (plantillas v3).
    providers: [DashboardsService, RecordLayoutDataService],
    // v0.1.167 — las plantillas (TemplatesModule) crean dashboards.
    exports: [DashboardsService, RecordLayoutDataService],
})
export class DashboardsModule {}
