import { Controller, Get } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/** Snapshot de métricas en memoria (observabilidad básica, sin auth). */
@Controller('metrics')
export class MetricsController {
    constructor(private readonly metrics: MetricsService) {}

    @Get()
    snapshot(): ReturnType<MetricsService['snapshot']> {
        return this.metrics.snapshot();
    }
}
