import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { RelationsRepository } from '../records/relations.repository';
import { ViewsModule } from '../views/views.module';
import { BlueprintService } from './blueprint.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Duplicar listas + plantillas (v0.1.166). */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ViewsModule, AutomationsModule, BillingModule],
    controllers: [TemplatesController],
    providers: [BlueprintService, TemplatesService, RecordsRepository, RelationsRepository],
    exports: [BlueprintService, TemplatesService],
})
export class TemplatesModule {}
