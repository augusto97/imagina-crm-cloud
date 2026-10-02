import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { SqlSyncController } from './sql-sync.controller';
import { SqlSyncEngine } from './sql-sync.engine';
import { SqlSyncQueue, SqlSyncQueueBootstrap } from './sql-sync.queue';
import { SqlSyncService } from './sql-sync.service';

/**
 * Sincronización desde SQL Server / Azure SQL (v0.1.243): una consulta o un
 * procedimiento, programado, cuyo resultado se carga en una lista emparejando
 * por una columna clave. El driver (`SQL_RUNNER`) lo provee ConnectorsModule.
 */
@Module({
    imports: [AuthModule, ActivityModule, AutomationsModule, BillingModule, FieldsModule, ListsModule],
    controllers: [SqlSyncController],
    providers: [SqlSyncEngine, SqlSyncService, SqlSyncQueue, SqlSyncQueueBootstrap],
    exports: [SqlSyncService, SqlSyncEngine],
})
export class SqlSyncModule implements OnModuleInit {
    constructor(
        private readonly bootstrap: SqlSyncQueueBootstrap,
        private readonly service: SqlSyncService,
        private readonly engine: SqlSyncEngine,
    ) {}

    onModuleInit(): void {
        this.bootstrap.setHandlers({
            tick: () => this.service.tick(),
            runJob: (job) => this.engine.run(job.tenantId, job.syncId),
        });
    }
}
