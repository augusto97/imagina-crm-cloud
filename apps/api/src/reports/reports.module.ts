import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardSharingModule } from '../dashboard-sharing/dashboard-sharing.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * v0.1.464 (J1) — Informes: documentos armados con bloques de varias listas.
 * Reusan el motor de los tableros (`DashboardsModule`) y su envío programado
 * por correo (`DashboardSharingModule`, al que el servicio se registra como
 * fuente de informes: sin dependencia circular).
 */
@Module({
    imports: [AuthModule, DashboardsModule, DashboardSharingModule],
    controllers: [ReportsController],
    providers: [ReportsService],
    exports: [ReportsService],
})
export class ReportsModule {}
