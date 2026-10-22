import { Module } from '@nestjs/common';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { DomainsModule } from '../domains/domains.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { DashboardSnapshotService } from './dashboard-snapshot.service';
import { DashboardSubscriptionScheduler } from './dashboard-subscription-scheduler';
import { DashboardSubscriptionsController } from './dashboard-subscriptions.controller';
import { DashboardSubscriptionsQueue } from './dashboard-subscriptions.queue';
import { DashboardSubscriptionsService } from './dashboard-subscriptions.service';
import {
    PublicDashboardPageController,
    PublicDashboardsAdminController,
    PublicDashboardsDataController,
} from './public-dashboards.controller';
import { PublicDashboardsService } from './public-dashboards.service';

/**
 * v0.1.292 (ADR-S50) — Compartir un tablero hacia afuera: enlace público de
 * sólo lectura (insertable por iframe) y envío programado por correo. Los
 * dos calculan los datos con el acceso de UNA persona (quien publicó / quien
 * es dueño del envío) por `DashboardSnapshotService`.
 */
@Module({
    imports: [AuthModule, AggregateModule, DashboardsModule, DomainsModule, FieldsModule, FilesModule],
    controllers: [
        PublicDashboardsAdminController,
        PublicDashboardsDataController,
        PublicDashboardPageController,
        DashboardSubscriptionsController,
    ],
    providers: [
        DashboardSnapshotService,
        PublicDashboardsService,
        DashboardSubscriptionScheduler,
        DashboardSubscriptionsService,
        DashboardSubscriptionsQueue,
    ],
    exports: [DashboardSnapshotService, PublicDashboardsService, DashboardSubscriptionsService],
})
export class DashboardSharingModule {}
