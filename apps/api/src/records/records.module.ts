import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecurrencesModule } from '../recurrences/recurrences.module';
import { RecordsController } from './records.controller';
import { RecordsGroupedController } from './records-grouped.controller';
import { RecordsGroupedService } from './records-grouped.service';
import { RecordsRepository } from './records.repository';
import { RelationsRepository } from './relations.repository';
import { RecordsService } from './records.service';
import { BulkEditService } from './bulk-edit.service';
import { BulkStructureService } from './bulk-structure.service';
import { BulkHistoryController } from './bulk-history.controller';
import { BulkHistoryService } from './bulk-history.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule, AggregateModule, RecurrencesModule],
    controllers: [RecordsController, RecordsGroupedController, BulkHistoryController],
    providers: [RecordsService, BulkEditService, BulkStructureService, BulkHistoryService, RecordsRepository, RelationsRepository, RecordsGroupedService],
    exports: [RecordsService, BulkHistoryService],
})
export class RecordsModule {}
