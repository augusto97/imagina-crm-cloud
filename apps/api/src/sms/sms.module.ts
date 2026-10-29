import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AiFieldsModule } from '../ai-fields/ai-fields.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { SmsController, SmsHooksController } from './sms.controller';
import { SmsQueue } from './sms-queue';
import { SmsService } from './sms.service';

/**
 * SMS (ADR-S82) — Twilio, BulkGate, Infobip, LabsMobile y Onurix con la
 * credencial de cada empresa. El motor de automatizaciones y los
 * recordatorios de la agenda lo resuelven al usarlo (`moduleRef`), como
 * WhatsApp: este módulo depende de registros y campos, que ya dependen del
 * motor.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule, RecordsModule, AiFieldsModule],
    controllers: [SmsController, SmsHooksController],
    providers: [SmsService, SmsQueue],
    exports: [SmsService],
})
export class SmsModule {}
