import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { AiFieldsController } from './ai-fields.controller';
import { AiFieldsService } from './ai-fields.service';

/** v0.1.277 (ADR-S41) — Campos con IA (usa AiSettings/AiQuota del AiModule global). */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, FilesModule],
    controllers: [AiFieldsController],
    providers: [AiFieldsService],
    exports: [AiFieldsService],
})
export class AiFieldsModule {}
