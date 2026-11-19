import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { AgencyBillingService } from './agency-billing.service';
import { AgencyBillingRemindersService } from './agency-billing-reminders.service';
import { AgencyClientBillingController, AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';

/** v0.1.449 (I3, ADR-S108) — Modo agencia: la consola de la agencia. */
@Module({
    imports: [AuthModule, DomainsModule],
    controllers: [AgencyController, AgencyClientBillingController],
    providers: [AgencyService, AgencyBillingService, AgencyBillingRemindersService],
    exports: [AgencyService, AgencyBillingService],
})
export class AgencyModule {}
