import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { RecordTemplatesModule } from '../record-templates/record-templates.module';
import { PlatformCaptchaController, WorkspaceCaptchaController } from './captcha.controller';
import { CaptchaService } from './captcha.service';
import { FormsController, PublicFormPageController, PublicFormsController } from './forms.controller';
import { FormsService } from './forms.service';

/**
 * v0.1.275 (ADR-S39) — Formularios públicos. @Global para que el catálogo
 * de automatizaciones (disparador «Cuando se envía un formulario») y el
 * asistente los lean sin ciclo de módulos.
 *
 * v0.1.289 — más la verificación anti-robots (llaves de la plataforma y de
 * cada empresa) y la confirmación del correo de quien responde.
 */
@Global()
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, FilesModule, RecordsModule, RecordTemplatesModule],
    controllers: [FormsController, PublicFormsController, PublicFormPageController, PlatformCaptchaController, WorkspaceCaptchaController],
    providers: [FormsService, CaptchaService],
    exports: [FormsService, CaptchaService],
})
export class FormsModule {}
