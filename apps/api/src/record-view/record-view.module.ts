import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordsModule } from '../records/records.module';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module';
import { ChecklistsModule } from '../checklists/checklists.module';
import { RecordViewController } from './record-view.controller';
import { RecordViewService } from './record-view.service';

/**
 * Bundle de la ficha del registro (regla de oro nº 8). Módulo hoja: importa
 * los dominios que junta y nadie lo importa a él (sin ciclos). Documentos y
 * cobros son @Global.
 */
@Module({
    imports: [
        AuthModule,
        ListsModule,
        FieldsModule,
        RecordsModule,
        ActivityModule,
        CommentsModule,
        NotificationsModule,
        DashboardsModule,
        TimeTrackingModule,
        // C5 — la sección «Aprobación» de la ficha.
        ApprovalsModule,
        ChecklistsModule,
    ],
    controllers: [RecordViewController],
    providers: [RecordViewService],
})
export class RecordViewModule {}
