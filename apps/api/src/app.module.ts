import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module';
import { AggregateModule } from './aggregate/aggregate.module';
import { AutomationsModule } from './automations/automations.module';
import { AuthModule } from './auth/auth.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { BillingModule } from './billing/billing.module';
import { ExportModule } from './export/export.module';
import { ImportModule } from './import/import.module';
import { AuthzModule } from './authz/authz.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { CommentsModule } from './comments/comments.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { FieldsModule } from './fields/fields.module';
import { HealthModule } from './health/health.module';
import { ListsModule } from './lists/lists.module';
import { MailModule } from './mail/mail.module';
import { MeModule } from './me/me.module';
import { MembersModule } from './members/members.module';
import { ObservabilityModule } from './observability/observability.module';
import { PaymentsModule } from './payments/payments.module';
import { UpdateModule } from './update/update.module';
import { PortalModule } from './portal/portal.module';
import { PublicListsModule } from './public-lists/public-lists.module';
import { PlatformModule } from './platform/platform.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RecordsModule } from './records/records.module';
import { RedisModule } from './redis/redis.module';
import { SlugsModule } from './slugs/slugs.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { ViewsModule } from './views/views.module';
import { SavedFiltersModule } from './saved-filters/saved-filters.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
    imports: [
        ConfigModule,
        DbModule,
        RedisModule,
        TenancyModule,
        AuthzModule,
        MailModule,
        ObservabilityModule,
        RealtimeModule,
        AuthModule,
        WorkspacesModule,
        MeModule,
        MembersModule,
        ListsModule,
        FieldsModule,
        RecordsModule,
        ViewsModule,
        SavedFiltersModule,
        ActivityModule,
        CommentsModule,
        AggregateModule,
        AutomationsModule,
        DashboardsModule,
        PortalModule,
        PublicListsModule,
        PlatformModule,
        BillingModule,
        PaymentsModule,
        ExportModule,
        ImportModule,
        BootstrapModule,
        SlugsModule,
        HealthModule,
        UpdateModule,
    ],
})
export class AppModule {}
