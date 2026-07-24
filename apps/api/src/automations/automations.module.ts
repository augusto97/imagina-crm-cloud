import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsRepository } from '../fields/fields.repository';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { RelationsRepository } from '../records/relations.repository';
import { RecurrencesModule } from '../recurrences/recurrences.module';
import { AutomationDispatcher } from './automation-dispatcher.service';
import { AutomationEngine } from './automation-engine.service';
import { AutomationScheduler } from './automation-scheduler.service';
import { AutomationHooksController } from './automation-hooks.controller';
import { AutomationsCatalogController } from './automations-catalog.controller';
import { AutomationsController } from './automations.controller';
import { AutomationsQueueBootstrap } from './automations-queue';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';

/**
 * @Global para que RecordsService pueda inyectar el AutomationDispatcher sin
 * dependencia circular de módulos (records → automations → records repo).
 */
@Global()
@Module({
    // RecurrencesModule: el worker de la cola procesa el tick global de
    // recurrencias (job 'recurrences-tick'). Sin ciclo: recurrences NO importa
    // automations (el dispatcher le llega porque este módulo es @Global).
    imports: [AuthModule, ListsModule, RecurrencesModule],
    controllers: [AutomationsController, AutomationsCatalogController, AutomationHooksController],
    providers: [
        AutomationsService,
        AutomationsRepository,
        AutomationDispatcher,
        AutomationScheduler,
        AutomationEngine,
        AutomationsQueueBootstrap,
        FieldsRepository,
        RecordsRepository,
        RelationsRepository,
    ],
    exports: [AutomationsService, AutomationDispatcher],
})
export class AutomationsModule {}
