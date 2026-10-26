import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RecordsModule } from '../records/records.module';
import { WorkloadController } from './workload.controller';
import { WorkloadService } from './workload.service';

/**
 * B2 — Vista «Carga de trabajo»: bundle por persona y columna, personas que
 * ven la lista y capacidad por persona. Módulo hoja (importa registros; nadie
 * lo importa a él).
 */
@Module({
    imports: [AuthModule, RecordsModule],
    controllers: [WorkloadController],
    providers: [WorkloadService],
    exports: [WorkloadService],
})
export class WorkloadModule {}
