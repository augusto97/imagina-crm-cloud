import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import {
    ListGuestsController,
    RecordSharesController,
    SharedWithMeController,
    WorkspaceGuestsController,
} from './guests.controller';
import { GuestsService } from './guests.service';

/** C3 — Invitados externos: compartir listas y registros con gente de afuera. */
@Module({
    imports: [AuthModule, BillingModule, ListsModule, RecordsModule],
    controllers: [ListGuestsController, RecordSharesController, WorkspaceGuestsController, SharedWithMeController],
    providers: [GuestsService],
    exports: [GuestsService],
})
export class GuestsModule {}
