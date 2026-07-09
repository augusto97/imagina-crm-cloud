import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsController } from './records.controller';
import { RecordsGroupedController } from './records-grouped.controller';
import { RecordsGroupedService } from './records-grouped.service';
import { RecordsRepository } from './records.repository';
import { RecordsService } from './records.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule, AggregateModule],
    controllers: [RecordsController, RecordsGroupedController],
    providers: [RecordsService, RecordsRepository, RecordsGroupedService],
    exports: [RecordsService],
})
export class RecordsModule {}
