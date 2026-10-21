import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { TimeTrackingController } from './time-tracking.controller';
import { TimeTrackingService } from './time-tracking.service';

/** v0.1.291 — Registro de tiempo por registro (cronómetro + entradas manuales). */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule],
    controllers: [TimeTrackingController],
    providers: [TimeTrackingService],
    exports: [TimeTrackingService],
})
export class TimeTrackingModule {}
