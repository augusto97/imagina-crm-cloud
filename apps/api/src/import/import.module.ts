import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { RecordsRepository } from '../records/records.repository';
import { ImportUpdateService } from './import-update.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule],
    controllers: [ImportController],
    providers: [ImportService, ImportUpdateService, RecordsRepository],
})
export class ImportModule {}
