import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { PlatformLegalController, PublicLegalController } from './legal.controller';
import { LegalService } from './legal.service';

/** Páginas públicas de la plataforma (v0.1.247): inicio, privacidad, condiciones. */
@Module({
    imports: [AuthModule],
    controllers: [PublicLegalController, PlatformLegalController],
    providers: [LegalService, SuperadminGuard],
})
export class LegalModule {}
