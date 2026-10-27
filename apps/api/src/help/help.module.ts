import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { HelpController, PlatformHelpController } from './help.controller';
import { HelpService } from './help.service';

/** Fase 7 · entrega 2 — centro de ayuda: lo que configura el operador. */
@Module({
    imports: [AuthModule],
    controllers: [HelpController, PlatformHelpController],
    providers: [HelpService, SuperadminGuard],
})
export class HelpModule {}
