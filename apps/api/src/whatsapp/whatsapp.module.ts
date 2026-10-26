import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AiFieldsModule } from '../ai-fields/ai-fields.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { WhatsappController, WhatsappHooksController } from './whatsapp.controller';
import { WhatsappQueue } from './whatsapp-queue';
import { WhatsappService } from './whatsapp.service';

/**
 * D3 — WhatsApp oficial (Meta WhatsApp Cloud API). El motor de
 * automatizaciones lo resuelve al usarlo (`moduleRef`), como las aprobaciones:
 * este módulo depende de registros y campos, que ya dependen del motor.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule, RecordsModule, AiFieldsModule],
    controllers: [WhatsappController, WhatsappHooksController],
    providers: [WhatsappService, WhatsappQueue],
    exports: [WhatsappService],
})
export class WhatsappModule {}
