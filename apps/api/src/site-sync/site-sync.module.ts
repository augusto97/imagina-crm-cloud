import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordChangeHub } from '../records/record-change-hub';
import { RecordsModule } from '../records/records.module';
import { REDIS } from '../redis/redis.module';
import { TemplatesModule } from '../templates/templates.module';
import { SiteSyncController, WordpressCallbackController, WordpressConnectController } from './site-sync.controller';
import { SiteSyncEngine } from './site-sync.engine';
import { SiteSyncQueue, SiteSyncQueueBootstrap } from './site-sync.queue';
import { SiteSyncService } from './site-sync.service';
import { SiteWriteBackService } from './site-writeback.service';
import { WP_CONNECT_STATE, WordpressConnectService } from './wordpress-connect.service';

/**
 * Sitios WordPress (v0.1.333, ADR-S83): conectar en un clic con «Autorizar
 * aplicación», traer páginas, entradas, tipos de contenido propios y
 * taxonomías a listas espejo, y editar desde la app. Cola propia
 * (`site-sync`) para no competir con la de la tienda.
 */
@Module({
    imports: [AuthModule, ActivityModule, AutomationsModule, BillingModule, FieldsModule, ListsModule, RecordsModule, TemplatesModule],
    controllers: [SiteSyncController, WordpressConnectController, WordpressCallbackController],
    providers: [
        SiteSyncEngine,
        SiteSyncService,
        SiteWriteBackService,
        SiteSyncQueue,
        SiteSyncQueueBootstrap,
        WordpressConnectService,
        { provide: WP_CONNECT_STATE, useExisting: REDIS },
    ],
    exports: [SiteSyncService],
})
export class SiteSyncModule implements OnModuleInit {
    constructor(
        private readonly bootstrap: SiteSyncQueueBootstrap,
        private readonly service: SiteSyncService,
        private readonly writeBack: SiteWriteBackService,
        private readonly changes: RecordChangeHub,
    ) {}

    onModuleInit(): void {
        this.bootstrap.setHandlers({
            tick: () => this.service.tick(),
            runJob: (job) => this.service.runJob(job.tenantId, job.syncId, { full: job.full, only: job.only }),
            pushJob: (job) => this.writeBack.processPush(job),
        });
        this.writeBack.setCredsResolver((tenantId, syncId) => this.service.credsForSync(tenantId, syncId));
        // Edición en los dos sentidos: lo que se cambia en la app viaja al sitio.
        this.changes.subscribe((change) => this.writeBack.onRecordChange(change));
    }
}
