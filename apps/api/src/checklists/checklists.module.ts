import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { ChecklistsController } from './checklists.controller';
import { ChecklistsRepository } from './checklists.repository';
import { ChecklistsService } from './checklists.service';

/** A9 — Checklist dentro del registro. */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, ActivityModule],
    controllers: [ChecklistsController],
    providers: [ChecklistsRepository, ChecklistsService],
    exports: [ChecklistsRepository, ChecklistsService],
})
export class ChecklistsModule {}
