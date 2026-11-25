import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyHoursController } from './company-hours.controller';
import { CompanyHoursService } from './company-hours.service';

/**
 * v0.1.467 (E8) — Horario laboral de la empresa. @Global para que el motor de
 * automatizaciones y el reloj de las esperas lo lean sin importar el módulo
 * (y sin ciclos: este módulo no conoce a las automatizaciones; ellas se
 * suscriben a `onChange`).
 */
@Global()
@Module({
    imports: [AuthModule],
    controllers: [CompanyHoursController],
    providers: [CompanyHoursService],
    exports: [CompanyHoursService],
})
export class CompanyHoursModule {}
