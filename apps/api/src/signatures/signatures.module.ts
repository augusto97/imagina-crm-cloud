import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { SmsModule } from '../sms/sms.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PublicSignaturesController, SignatureChannelsController, SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';
import { SignatureTasksService } from './signatures-tasks.service';

/**
 * D6 (v0.1.446, ADR-S107) — Firma electrónica de documentos. `DocumentsService`
 * llega por su módulo @Global (arma el PDF de una plantilla).
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, FilesModule, RecordsModule, ActivityModule, SmsModule, WhatsappModule],
    controllers: [SignaturesController, SignatureChannelsController, PublicSignaturesController],
    providers: [SignaturesService, SignatureTasksService],
    exports: [SignaturesService],
})
export class SignaturesModule {}
