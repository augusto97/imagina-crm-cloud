import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { TemplatesModule } from '../templates/templates.module';
import { FileImportAiService } from './file-import-ai.service';
import { FileImportController } from './file-import.controller';
import { FileImportService } from './file-import.service';

/**
 * v0.1.339 (ADR-S88) — «Crear desde un archivo». El asistente IA (AiModule:
 * resolución de clave, constructor de listas), la facturación y el realtime
 * son globales.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, TemplatesModule],
    controllers: [FileImportController],
    providers: [FileImportService, FileImportAiService],
})
export class FileImportModule {}
