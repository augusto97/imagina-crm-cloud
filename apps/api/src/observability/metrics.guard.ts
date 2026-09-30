import { timingSafeEqual } from 'node:crypto';
import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ENV, type Env } from '../config/env';

/**
 * Protege GET /metrics (SEC-17). Si `METRICS_TOKEN` está vacío, el endpoint
 * queda abierto (dev). Si está seteado, exige `Authorization: Bearer <token>`
 * con comparación timing-safe — funciona con scrapers (Prometheus) sin sesión.
 */
@Injectable()
export class MetricsGuard implements CanActivate {
    constructor(@Inject(ENV) private readonly env: Env) {}

    canActivate(context: ExecutionContext): boolean {
        const expected = this.env.METRICS_TOKEN;
        // SEC-25 (v0.1.226): vacío = abierto SÓLO en desarrollo. En producción
        // quedaban públicos contadores y latencias por ruta del servidor; sin
        // token el endpoint se cierra (se configura METRICS_TOKEN para el scraper).
        if (!expected) {
            if (this.env.NODE_ENV !== 'production') return true;
            throw new ForbiddenException('Métricas deshabilitadas: configurá METRICS_TOKEN');
        }

        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const header = req.headers['authorization'];
        const provided =
            typeof header === 'string' && header.startsWith('Bearer ')
                ? header.slice('Bearer '.length)
                : '';

        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            throw new UnauthorizedException('Token de métricas inválido');
        }
        return true;
    }
}
