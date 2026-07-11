import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { RecurrencesController } from './recurrences.controller';
import { RecurrencesRepository } from './recurrences.repository';
import { RecurrencesService } from './recurrences.service';

/**
 * Recurrencias sobre campos de fecha (paridad con `Recurrences/*` del
 * plugin). NO importa RecordsModule (usa RecordsRepository directo, como
 * AutomationsModule) — así RecordsModule puede importar este módulo para el
 * hook post-update sin ciclo. AutomationDispatcher/RealtimeService/TenantDb
 * llegan por módulos @Global.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule],
    controllers: [RecurrencesController],
    providers: [RecurrencesService, RecurrencesRepository, RecordsRepository],
    exports: [RecurrencesService],
})
export class RecurrencesModule {}
