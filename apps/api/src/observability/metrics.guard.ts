import { timingSafeEqual } from 'node:crypto';
import {
    CanActivate,
    ExecutionContext,
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
        if (!expected) return true;

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
