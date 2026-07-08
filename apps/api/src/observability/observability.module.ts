import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * Observabilidad (F5): métricas en memoria + interceptor global que cronometra
 * todas las requests. El `/metrics` expone el snapshot; `/health/*` (Health
 * module) cubre liveness/readiness.
 */
@Module({
    controllers: [MetricsController],
    providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
    exports: [MetricsService],
})
export class ObservabilityModule {}
