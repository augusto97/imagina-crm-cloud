import { Controller, Get, UseGuards } from '@nestjs/common';
import { MetricsGuard } from './metrics.guard';
import { MetricsService } from './metrics.service';

/**
 * Snapshot de métricas en memoria (observabilidad básica). Protegido por
 * `MetricsGuard`: abierto si METRICS_TOKEN está vacío, o Bearer token si se
 * configuró (SEC-17).
 */
@Controller('metrics')
@UseGuards(MetricsGuard)
export class MetricsController {
    constructor(private readonly metrics: MetricsService) {}

    @Get()
    snapshot(): ReturnType<MetricsService['snapshot']> {
        return this.metrics.snapshot();
    }
}
