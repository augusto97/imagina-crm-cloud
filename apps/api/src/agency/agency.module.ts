import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';

/** v0.1.449 (I3, ADR-S108) — Modo agencia: la consola de la agencia. */
@Module({
    imports: [AuthModule],
    controllers: [AgencyController],
    providers: [AgencyService],
    exports: [AgencyService],
})
export class AgencyModule {}
