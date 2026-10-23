import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordsModule } from '../records/records.module';
import { PublicConsentController, RecordDataConsentController, WorkspaceDataConsentController } from './data-consent.controller';
import { DataConsentService } from './data-consent.service';

/**
 * Autorización de tratamiento de datos personales (Ley 1581 de 2012). @Global
 * para que los formularios, el portal, la ficha y el asistente la lean sin
 * ciclos de módulos (los inyectan como opcional).
 */
@Global()
@Module({
    imports: [AuthModule, FilesModule, NotificationsModule, RecordsModule],
    controllers: [WorkspaceDataConsentController, RecordDataConsentController, PublicConsentController],
    providers: [DataConsentService],
    exports: [DataConsentService],
})
export class DataConsentModule {}
