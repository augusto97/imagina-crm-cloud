import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { FormsController, PublicFormPageController, PublicFormsController } from './forms.controller';
import { FormsService } from './forms.service';

/**
 * v0.1.275 (ADR-S39) — Formularios públicos. @Global para que el catálogo
 * de automatizaciones (disparador «Cuando se envía un formulario») y el
 * asistente los lean sin ciclo de módulos.
 */
@Global()
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, FilesModule, RecordsModule],
    controllers: [FormsController, PublicFormsController, PublicFormPageController],
    providers: [FormsService],
    exports: [FormsService],
})
export class FormsModule {}
