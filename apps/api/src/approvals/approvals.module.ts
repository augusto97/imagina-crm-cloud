import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordsModule } from '../records/records.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsRepository } from './approvals.repository';
import { ApprovalsService } from './approvals.service';

/**
 * C5 — Aprobaciones. Depende de registros, avisos y actividad; el motor de
 * automatizaciones lo usa resolviéndolo en tiempo de ejecución (ModuleRef,
 * sin ciclo de DI) y se entera de las resoluciones por `ApprovalHub` (global).
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, ActivityModule, NotificationsModule],
    controllers: [ApprovalsController],
    providers: [ApprovalsService, ApprovalsRepository],
    exports: [ApprovalsService, ApprovalsRepository],
})
export class ApprovalsModule {}
