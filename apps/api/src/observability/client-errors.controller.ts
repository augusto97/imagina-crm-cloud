import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { clientErrorReportSchema, type ClientErrorReport } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { rateKeyForIp } from '../common/client-ip';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { REDIS } from '../redis/redis.module';
import { incrWithTtl } from '../redis/redis.util';
import { recordClientError } from './client-errors';

/** Por IP y por minuto, y para todo el servidor (un error en un bucle no llena nada). */
const PER_IP_PER_MIN = 20;
const GLOBAL_PER_MIN = 600;

/**
 * v0.1.435 — Los errores de las pantallas: la app (y el portal del cliente)
 * mandan aquí lo que falla en el navegador. Sin sesión a propósito: también
 * falla la pantalla de entrar. Siempre 204: a quien prueba no se le dice nada
 * y un error que no se guardó no le cuesta nada a nadie.
 */
@Controller('client-errors')
export class ClientErrorsController {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    @Post()
    @HttpCode(204)
    async report(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(clientErrorReportSchema)) input: ClientErrorReport): Promise<void> {
        try {
            const minute = Math.floor(Date.now() / 60_000);
            const ip = await incrWithTtl(this.redis, `cerr:ip:${rateKeyForIp(req.ip)}:${minute}`, 120);
            if (ip > PER_IP_PER_MIN) return;
            const all = await incrWithTtl(this.redis, `cerr:all:${minute}`, 120);
            if (all > GLOBAL_PER_MIN) return;
        } catch {
            return;
        }
        const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
        await recordClientError(this.redis, input, ua);
    }
}
