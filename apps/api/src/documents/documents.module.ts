import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * v0.1.266 (ADR-S35) — Documentos PDF. @Global para que el motor de
 * automatizaciones (acción «Generar PDF» y adjuntos de «Enviar email») lo
 * inyecte sin ciclo de módulos.
 */
@Global()
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, FilesModule, RecordsModule],
    controllers: [DocumentsController],
    providers: [DocumentsService],
    exports: [DocumentsService],
})
export class DocumentsModule {}
