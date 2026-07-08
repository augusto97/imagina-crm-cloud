import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsRepository } from '../fields/fields.repository';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { AutomationDispatcher } from './automation-dispatcher.service';
import { AutomationEngine } from './automation-engine.service';
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
    imports: [AuthModule, ListsModule],
    controllers: [AutomationsController],
    providers: [
        AutomationsService,
        AutomationsRepository,
        AutomationDispatcher,
        AutomationEngine,
        AutomationsQueueBootstrap,
        FieldsRepository,
        RecordsRepository,
    ],
    exports: [AutomationsService, AutomationDispatcher],
})
export class AutomationsModule {}
