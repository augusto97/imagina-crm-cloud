import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

/** v0.1.285 (ADR-S44) — Problemas: escucha el `IncidentHub` y avisa. */
@Module({
    imports: [AuthModule, NotificationsModule],
    controllers: [IncidentsController],
    providers: [IncidentsService],
    exports: [IncidentsService],
})
export class IncidentsModule {}
