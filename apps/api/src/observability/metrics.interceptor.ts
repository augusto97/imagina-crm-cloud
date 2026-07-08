import {
    type CallHandler,
    type ExecutionContext,
    Injectable,
    Logger,
    type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { type Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Interceptor global que cronometra cada request HTTP y lo registra en
 * MetricsService. Loguea las requests lentas (> SLOW_MS) — presupuesto como
 * señal operativa (STANDALONE §12/§13).
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
    private readonly logger = new Logger('Metrics');

    constructor(private readonly metrics: MetricsService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http') return next.handle();
        const start = process.hrtime.bigint();
        const record = (isError: boolean): void => {
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            this.metrics.record(ms, isError);
            if (ms > MetricsService.SLOW_MS) {
                const req = context.switchToHttp().getRequest<{ method: string; url: string }>();
                this.logger.warn(`slow ${req.method} ${req.url} — ${ms.toFixed(1)}ms`);
            }
        };
        return next.handle().pipe(
            tap({
                next: () => {
                    const res = context.switchToHttp().getResponse<FastifyReply>();
                    record(res.statusCode >= 500);
                },
                error: () => record(true),
            }),
        );
    }
}
