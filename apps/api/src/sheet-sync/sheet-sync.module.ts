import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { SheetSyncAiTools } from './sheet-sync-ai-tools';
import { SheetSyncController } from './sheet-sync.controller';
import { SheetSyncEngine } from './sheet-sync.engine';
import { SheetSyncQueue, SheetSyncQueueBootstrap } from './sheet-sync.queue';
import { SheetSyncService } from './sheet-sync.service';

/**
 * v0.1.459 (G3) — Una lista sincronizada con una pestaña de Google Sheets, en
 * uno o en los dos sentidos. Usa la conexión OAuth `google_sheets` de
 * Integraciones (ConnectorsModule, global).
 */
@Module({
    imports: [AuthModule, ActivityModule, AutomationsModule, BillingModule, FieldsModule, ListsModule],
    controllers: [SheetSyncController],
    providers: [SheetSyncEngine, SheetSyncService, SheetSyncQueue, SheetSyncQueueBootstrap, SheetSyncAiTools],
    exports: [SheetSyncService, SheetSyncEngine],
})
export class SheetSyncModule implements OnModuleInit {
    constructor(
        private readonly bootstrap: SheetSyncQueueBootstrap,
        private readonly service: SheetSyncService,
        private readonly engine: SheetSyncEngine,
    ) {}

    onModuleInit(): void {
        this.bootstrap.setHandlers({
            tick: () => this.service.tick(),
            runJob: (job) => this.engine.run(job.tenantId, job.syncId),
        });
    }
}
