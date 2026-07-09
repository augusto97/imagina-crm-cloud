import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { AggregateController } from './aggregate.controller';
import { AggregateService } from './aggregate.service';
import { RecordsAggregatesController } from './records-aggregates.controller';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule],
    controllers: [AggregateController, RecordsAggregatesController],
    providers: [AggregateService],
    exports: [AggregateService],
})
export class AggregateModule {}
