import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module';
import { AggregateModule } from './aggregate/aggregate.module';
import { AiModule } from './ai/ai.module';
import { AgentHubModule } from './ai-agents/agent-hub';
import { AiAgentsModule } from './ai-agents/ai-agents.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { ApprovalHubModule } from './approvals/approval-hub';
import { ApprovalsModule } from './approvals/approvals.module';
import { HelpdeskModule } from './helpdesk/helpdesk.module';
import { AutomationsModule } from './automations/automations.module';
import { AuthModule } from './auth/auth.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { DashboardSharingModule } from './dashboard-sharing/dashboard-sharing.module';
import { LegalModule } from './legal/legal.module';
import { HelpModule } from './help/help.module';
import { BrandModule } from './brand/brand.module';
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
import { SiteSyncModule } from './site-sync/site-sync.module';
import { SqlSyncModule } from './sql-sync/sql-sync.module';
import { CollectionsModule } from './collections/collections.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { SmsModule } from './sms/sms.module';
import { FormsModule } from './forms/forms.module';
import { BookingModule } from './booking/booking.module';
import { DataConsentModule } from './data-consent/data-consent.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PwaModule } from './pwa/pwa.module';
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
import { TeamsModule } from './teams/teams.module';
import { RolesModule } from './roles/roles.module';
import { GuestsModule } from './guests/guests.module';
import { ViewsModule } from './views/views.module';
import { GanttModule } from './gantt/gantt.module';
import { WorkloadModule } from './workload/workload.module';
import { ChecklistsModule } from './checklists/checklists.module';
import { RecordTemplatesModule } from './record-templates/record-templates.module';
import { SavedFiltersModule } from './saved-filters/saved-filters.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { WhatsNewModule } from './whats-new/whats-new.module';

@Module({
    imports: [
        ConfigModule,
        DbModule,
        RedisModule,
        RecordChangeHubModule,
        NotifyHubModule,
        // C5 — aviso en proceso de "una aprobación se resolvió" (esperas de automatizaciones).
        ApprovalHubModule,
        // E6 — «Pedirle a un agente» (el motor de automatizaciones no importa a los agentes).
        AgentHubModule,
        IncidentHubModule,
        TenancyModule,
        AuthzModule,
        MailModule,
        ObservabilityModule,
        RealtimeModule,
        AuditModule,
        // C1 — equipos (global: ACL, avisos, «Mi trabajo», import/export).
        TeamsModule,
        // C2 — roles propios (global: miembros, permisos por lista, consola).
        RolesModule,
        ConnectorsModule,
        StoreSyncModule,
        // v0.1.333 (ADR-S83) — sitios WordPress.
        SiteSyncModule,
        SqlSyncModule,
        CollectionsModule,
        // D3 — WhatsApp oficial (Meta Cloud API).
        WhatsappModule,
        SmsModule,
        DocumentsModule,
        FormsModule,
        // D5 — agenda de citas pública.
        BookingModule,
        DataConsentModule,
        NotificationsModule,
        PwaModule,
        IncidentsModule,
        AiFieldsModule,
        TimeTrackingModule,
        AuthModule,
        WorkspacesModule,
        MeModule,
        FilesModule,
        MembersModule,
        // C3 — invitados externos (compartir listas y registros con gente de afuera).
        GuestsModule,
        ListsModule,
        FieldsModule,
        RecordsModule,
        // Campo «Botón» (A5): presionar botones de registros.
        ButtonsModule,
        RecurrencesModule,
        ViewsModule,
        GanttModule,
        WorkloadModule,
        // A9 / C6 — checklists del registro y plantillas de registro.
        ChecklistsModule,
        RecordTemplatesModule,
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
        // Fase 7 · entrega 2 — centro de ayuda (Plataforma → Ayuda).
        HelpModule,
        BrandModule,
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
        // C5 — aprobaciones: flujos por lista, solicitudes y decisiones.
        ApprovalsModule,
        // D2 + E5 — mesa de ayuda por correo + SLA.
        HelpdeskModule,
        // E6 — agentes de IA.
        AiAgentsModule,
        // F7 — «Empezar fácil»: bienvenida, datos de ejemplo y primeros pasos.
        OnboardingModule,
        // Fase 7 — novedades (catálogo de cada versión + lo que publica el operador).
        WhatsNewModule,
    ],
})
export class AppModule {}
