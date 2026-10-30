import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingPolicyService } from './billing-policy.service';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';

/** @Global para que RecordsController pueda inyectar el límite de plan. */
@Global()
@Module({
    imports: [AuthModule],
    controllers: [BillingController],
    providers: [BillingService, PlansService, BillingPolicyService],
    exports: [BillingService, PlansService, BillingPolicyService],
})
export class BillingModule {}
