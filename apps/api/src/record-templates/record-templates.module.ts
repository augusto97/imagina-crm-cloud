import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { ChecklistsModule } from '../checklists/checklists.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { RecordTemplatesController } from './record-templates.controller';
import { RecordTemplatesService } from './record-templates.service';

/** C6 — Plantillas de registro (y de checklist). */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, ActivityModule, ChecklistsModule],
    controllers: [RecordTemplatesController],
    providers: [RecordTemplatesService],
    exports: [RecordTemplatesService],
})
export class RecordTemplatesModule {}
