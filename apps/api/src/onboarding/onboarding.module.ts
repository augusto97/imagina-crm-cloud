import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { TemplatesModule } from '../templates/templates.module';
import { OnboardingAiService } from './onboarding-ai.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * F7 (ADR-S72) — «Empezar fácil». El asistente IA (AiModule) y el correo son
 * globales: de ahí salen la resolución de la clave, la cuota, el constructor
 * de listas del asistente y el «correo propio».
 */
@Module({
    imports: [AuthModule, ListsModule, RecordsModule, TemplatesModule],
    controllers: [OnboardingController],
    providers: [OnboardingService, OnboardingAiService],
})
export class OnboardingModule {}
