import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { ButtonsController } from './buttons.controller';
import { ButtonsService } from './buttons.service';

/**
 * Campo «Botón» (A5). AutomationsModule y DocumentsModule son @Global (el
 * despachador, el servicio de automatizaciones y el de documentos llegan sin
 * importar el módulo). PortalModule usa `ButtonsService` para los botones del
 * portal: por eso se exporta.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, ActivityModule],
    controllers: [ButtonsController],
    providers: [ButtonsService],
    exports: [ButtonsService],
})
export class ButtonsModule {}
