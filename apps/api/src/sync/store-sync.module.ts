import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { TemplatesModule } from '../templates/templates.module';
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
    imports: [AuthModule, ActivityModule, AutomationsModule, BillingModule, FieldsModule, ListsModule, TemplatesModule],
    controllers: [StoreSyncController],
    providers: [StoreSyncEngine, StoreSyncService, StoreSyncQueue, StoreSyncQueueBootstrap],
    exports: [StoreSyncService, StoreSyncEngine],
})
export class StoreSyncModule implements OnModuleInit {
    constructor(
        private readonly bootstrap: StoreSyncQueueBootstrap,
        private readonly service: StoreSyncService,
    ) {}

    onModuleInit(): void {
        this.bootstrap.setHandlers({
            tick: () => this.service.tick(),
            runJob: (job) => this.service.runJob(job.tenantId, job.syncId, { full: job.full, only: job.only }),
        });
    }
}
