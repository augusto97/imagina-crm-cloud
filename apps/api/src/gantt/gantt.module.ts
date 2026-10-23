import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { ViewsModule } from '../views/views.module';
import { GanttBaselinesRepository } from './gantt-baselines.repository';
import { GanttController } from './gantt.controller';
import { GanttService } from './gantt.service';

/**
 * B1 — Vista Gantt / línea de tiempo: bundle, línea base y PDF. Módulo hoja
 * (importa registros y vistas; nadie lo importa a él).
 */
@Module({
    imports: [AuthModule, ListsModule, RecordsModule, ViewsModule],
    controllers: [GanttController],
    providers: [GanttService, GanttBaselinesRepository],
    exports: [GanttService],
})
export class GanttModule {}
