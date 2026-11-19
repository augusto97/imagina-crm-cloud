import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { RecordsModule } from '../records/records.module';
import { AgencyChargesService } from './agency-charges.service';
import { AgencyClientsListService } from './agency-clients-list.service';
import { AgencyBillingService } from './agency-billing.service';
import { AgencyBillingRemindersService } from './agency-billing-reminders.service';
import { AgencyClientBillingController, AgencyController, PublicAgencyPayController } from './agency.controller';
import { AgencyService } from './agency.service';

/** v0.1.449 (I3, ADR-S108) — Modo agencia: la consola de la agencia. */
@Module({
    imports: [AuthModule, DomainsModule, ActivityModule, RecordsModule],
    controllers: [AgencyController, AgencyClientBillingController, PublicAgencyPayController],
    providers: [AgencyService, AgencyBillingService, AgencyBillingRemindersService, AgencyClientsListService, AgencyChargesService],
    exports: [AgencyService, AgencyBillingService],
})
export class AgencyModule {}
