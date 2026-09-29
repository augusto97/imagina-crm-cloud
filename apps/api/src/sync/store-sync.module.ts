import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { TemplatesModule } from '../templates/templates.module';
import { RecordChangeHub } from '../records/record-change-hub';
import { StoreBulkController } from './store-bulk.controller';
import { StoreBulkService } from './store-bulk.service';
import { StoreHooksController } from './store-hooks.controller';
import { StoreRealtimeService } from './store-realtime.service';
import { StoreSyncController } from './store-sync.controller';
import { StoreSyncEngine } from './store-sync.engine';
import { StoreSyncQueue, StoreSyncQueueBootstrap } from './store-sync.queue';
import { StoreSyncService } from './store-sync.service';

/**
 * Sincronización con tiendas (v0.1.206, ADR-S24): hoy WooCommerce. Cola
 * propia (`store-sync`) para que una importación de miles de pedidos no
 * compita con las automatizaciones de nadie.
 */
@Module({
    imports: [AuthModule, ActivityModule, AutomationsModule, BillingModule, FieldsModule, ListsModule, RecordsModule, TemplatesModule],
    controllers: [StoreSyncController, StoreHooksController, StoreBulkController],
    providers: [StoreBulkService, StoreSyncEngine, StoreSyncService, StoreRealtimeService, StoreSyncQueue, StoreSyncQueueBootstrap],
    exports: [StoreSyncService, StoreSyncEngine],
})
export class StoreSyncModule implements OnModuleInit {
    constructor(
        private readonly bootstrap: StoreSyncQueueBootstrap,
        private readonly service: StoreSyncService,
        private readonly realtime: StoreRealtimeService,
        private readonly changes: RecordChangeHub,
    ) {}

    onModuleInit(): void {
        this.bootstrap.setHandlers({
            tick: () => this.service.tick(),
            runJob: (job) => this.service.runJob(job.tenantId, job.syncId, { full: job.full, only: job.only }),
            hookJob: (job) => this.realtime.processHook(job, null),
            pushJob: (job) => this.realtime.processPush(job),
        });
        this.realtime.setCredsResolver((tenantId, syncId) => this.service.credsForSync(tenantId, syncId));
        // Edición en los dos sentidos: lo que se cambia en la app viaja a la tienda.
        this.changes.subscribe((change) => this.realtime.onRecordChange(change));
    }
}
