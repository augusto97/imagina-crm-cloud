import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { ViewsModule } from '../views/views.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ViewsModule],
    controllers: [ExportController],
    providers: [ExportService],
})
export class ExportModule {}
