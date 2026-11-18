import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { EventWebhooksController } from './event-webhooks.controller';
import { EventWebhooksQueue } from './event-webhooks.queue';
import { EventWebhooksService } from './event-webhooks.service';

/**
 * v0.1.442 (addendum de ADR-S105) — Webhooks de eventos. Escucha el
 * `EventWebhookHub` (global) que emiten el despachador de automatizaciones y
 * el borrado de registros: así ni los registros ni las automatizaciones
 * dependen de este módulo.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule],
    controllers: [EventWebhooksController],
    providers: [EventWebhooksService, EventWebhooksQueue],
    exports: [EventWebhooksService],
})
export class EventWebhooksModule {}
