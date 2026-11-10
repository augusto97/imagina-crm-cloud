import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingModule } from '../booking/booking.module';
import { FilesModule } from '../files/files.module';
import { ContactWidgetsController, PublicWidgetController } from './contact-widgets.controller';
import { ContactWidgetsService } from './contact-widgets.service';
import { WidgetStatsService } from './widget-stats.service';

/**
 * v0.1.394 (ADR-S99) — Widgets de contacto. @Global: el envío de un
 * formulario abierto desde un widget («WhatsApp con datos primero») lo
 * consulta sin que los formularios dependan de este módulo.
 */
@Global()
@Module({
    imports: [AuthModule, FilesModule, BookingModule],
    controllers: [ContactWidgetsController, PublicWidgetController],
    providers: [ContactWidgetsService, WidgetStatsService],
    exports: [ContactWidgetsService, WidgetStatsService],
})
export class ContactWidgetsModule {}
