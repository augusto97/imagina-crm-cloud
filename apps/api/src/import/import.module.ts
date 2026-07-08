import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule],
    controllers: [ImportController],
    providers: [ImportService, RecordsRepository],
})
export class ImportModule {}
