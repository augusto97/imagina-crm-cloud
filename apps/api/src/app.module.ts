import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module';
import { AggregateModule } from './aggregate/aggregate.module';
import { AiModule } from './ai/ai.module';
import { AutomationsModule } from './automations/automations.module';
import { AuthModule } from './auth/auth.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { DashboardSharingModule } from './dashboard-sharing/dashboard-sharing.module';
import { LegalModule } from './legal/legal.module';
import { DomainsModule } from './domains/domains.module';
import { BillingModule } from './billing/billing.module';
import { ExportModule } from './export/export.module';
import { ImportModule } from './import/import.module';
import { AuthzModule } from './authz/authz.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { CommentsModule } from './comments/comments.module';
import { RecordViewModule } from './record-view/record-view.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { FieldsModule } from './fields/fields.module';
import { HealthModule } from './health/health.module';
import { ListsModule } from './lists/lists.module';
import { MailModule } from './mail/mail.module';
import { FilesModule } from './files/files.module';
import { MeModule } from './me/me.module';
import { MembersModule } from './members/members.module';
import { ObservabilityModule } from './observability/observability.module';
import { PaymentsModule } from './payments/payments.module';
import { UpdateModule } from './update/update.module';
import { PortalModule } from './portal/portal.module';
import { RecoveryModule } from './recovery/recovery.module';
import { PublicListsModule } from './public-lists/public-lists.module';
import { PlatformModule } from './platform/platform.module';
import { AuditModule } from './audit/audit.service';
import { ConnectorsModule } from './connectors/connectors.module';
import { StoreSyncModule } from './sync/store-sync.module';
import { SqlSyncModule } from './sql-sync/sql-sync.module';
import { CollectionsModule } from './collections/collections.module';
import { FormsModule } from './forms/forms.module';
import { DataConsentModule } from './data-consent/data-consent.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiFieldsModule } from './ai-fields/ai-fields.module';
import { NotifyHubModule } from './notifications/notify-hub';
import { IncidentHubModule } from './incidents/incident-hub';
import { IncidentsModule } from './incidents/incidents.module';
import { DocumentsModule } from './documents/documents.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RecordChangeHubModule } from './records/record-change-hub';
import { RecordsModule } from './records/records.module';
import { ButtonsModule } from './buttons/buttons.module';
import { RecurrencesModule } from './recurrences/recurrences.module';
import { RedisModule } from './redis/redis.module';
import { TemplatesModule } from './templates/templates.module';
import { TimeTrackingModule } from './time-tracking/time-tracking.module';
import { TrashModule } from './trash/trash.module';
import { SlugsModule } from './slugs/slugs.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { ViewsModule } from './views/views.module';
import { GanttModule } from './gantt/gantt.module';
import { SavedFiltersModule } from './saved-filters/saved-filters.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
    imports: [
        ConfigModule,
        DbModule,
        RedisModule,
        RecordChangeHubModule,
        NotifyHubModule,
        IncidentHubModule,
        TenancyModule,
        AuthzModule,
        MailModule,
        ObservabilityModule,
        RealtimeModule,
        AuditModule,
        ConnectorsModule,
        StoreSyncModule,
        SqlSyncModule,
        CollectionsModule,
        DocumentsModule,
        FormsModule,
        DataConsentModule,
        NotificationsModule,
        IncidentsModule,
        AiFieldsModule,
        TimeTrackingModule,
        AuthModule,
        WorkspacesModule,
        MeModule,
        FilesModule,
        MembersModule,
        ListsModule,
        FieldsModule,
        RecordsModule,
        // Campo «Botón» (A5): presionar botones de registros.
        ButtonsModule,
        RecurrencesModule,
        ViewsModule,
        GanttModule,
        SavedFiltersModule,
        ActivityModule,
        CommentsModule,
        RecordViewModule,
        AggregateModule,
        AutomationsModule,
        DashboardsModule,
        // v0.1.292 (ADR-S50) — enlace público y envío programado de tableros.
        DashboardSharingModule,
        DomainsModule,
        LegalModule,
        PortalModule,
        PublicListsModule,
        PlatformModule,
        BillingModule,
        PaymentsModule,
        ExportModule,
        ImportModule,
        BootstrapModule,
        SlugsModule,
        TemplatesModule,
        AiModule,
        HealthModule,
        UpdateModule,
        RecoveryModule,
        // Papelera: restaurar, borrar para siempre y el vaciado diario.
        TrashModule,
    ],
})
export class AppModule {}
