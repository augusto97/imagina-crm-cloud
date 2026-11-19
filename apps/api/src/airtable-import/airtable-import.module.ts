import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { TemplatesModule } from '../templates/templates.module';
import { AirtableImportController } from './airtable-import.controller';
import { AirtableImportService } from './airtable-import.service';

/**
 * v0.1.458 (ADR-S1XX) — «Importar de Airtable». El constructor de listas del
 * asistente (AiModule), la facturación, la bitácora y el realtime son globales.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, FilesModule, TemplatesModule],
    controllers: [AirtableImportController],
    providers: [AirtableImportService],
})
export class AirtableImportModule {}
