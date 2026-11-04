import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { BookingAvailabilityService } from './booking-availability.service';
import { BookingCalendarService } from './booking-calendar';
import { BookingHolidaysService } from './booking-holidays';
import { BookingPublicService } from './booking-public.service';
import { BookingRemindersService } from './booking-reminders.service';
import { BOOKING_SIMULATOR } from './booking-simulator';
import { BookingController, MyAgendaCalendarController, PublicBookingController, PublicBookingPageController } from './booking.controller';
import { BookingMyCalendarService } from './booking-my-calendar.service';
import { BookingCalendarSyncService } from './booking-calendar-sync.service';
import { BookingService } from './booking.service';

/**
 * D5 — Agenda de citas pública (estilo Calendly). @Global para que el motor de
 * automatizaciones (simulación del disparador «Cuando se agenda…»), el
 * asistente y la plantilla de listas la lean sin ciclo de módulos.
 */
@Global()
@Module({
    imports: [AuthModule, DomainsModule, ListsModule, FieldsModule, FilesModule, RecordsModule],
    controllers: [BookingController, MyAgendaCalendarController, PublicBookingController, PublicBookingPageController],
    providers: [
        BookingService,
        BookingPublicService,
        BookingAvailabilityService,
        BookingCalendarService,
        BookingHolidaysService,
        BookingRemindersService,
        BookingMyCalendarService,
        BookingCalendarSyncService,
        { provide: BOOKING_SIMULATOR, useExisting: BookingPublicService },
    ],
    exports: [BookingService, BookingMyCalendarService, BookingCalendarSyncService, BookingPublicService, BookingAvailabilityService, BookingHolidaysService, BookingRemindersService, BOOKING_SIMULATOR],
})
export class BookingModule {}
