import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { PublicQrController, RecordQrController } from './qr.controller';
import { QrService } from './qr.service';
import { RecordLabelsService } from './record-labels.service';

/**
 * v0.1.344 — El QR de los registros (ADR-S92): la imagen pública firmada, el
 * QR de la ficha y el PDF de etiquetas. Global porque registra al arrancar lo
 * que usan las variables `{{registro.enlace}}`, `{{registro.qr}}` y `|qr` en
 * automatizaciones, documentos, SMS y WhatsApp.
 */
@Global()
@Module({
    imports: [AuthModule, DomainsModule, FieldsModule, ListsModule, RecordsModule],
    controllers: [PublicQrController, RecordQrController],
    providers: [QrService, RecordLabelsService],
    exports: [QrService],
})
export class QrModule {}
