import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsJobs } from './notifications.jobs';
import { NotificationsService } from './notifications.service';

/** v0.1.276 (ADR-S40) — «Mi trabajo» + bandeja de avisos. */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, DomainsModule],
    controllers: [NotificationsController],
    providers: [NotificationsService, NotificationsJobs],
    exports: [NotificationsService],
})
export class NotificationsModule {}
