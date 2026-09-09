import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { RelationsRepository } from '../records/relations.repository';
import { ViewsModule } from '../views/views.module';
import { AutomationTemplatesService } from './automation-templates.service';
import { BlueprintService } from './blueprint.service';
import { DashboardTemplatesService } from './dashboard-templates.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Duplicar listas + plantillas de listas, dashboards y automatizaciones (v0.1.166/167). */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ViewsModule, AutomationsModule, BillingModule, DashboardsModule],
    controllers: [TemplatesController],
    providers: [
        BlueprintService,
        TemplatesService,
        DashboardTemplatesService,
        AutomationTemplatesService,
        RecordsRepository,
        RelationsRepository,
    ],
    exports: [BlueprintService, TemplatesService, DashboardTemplatesService, AutomationTemplatesService],
})
export class TemplatesModule {}
