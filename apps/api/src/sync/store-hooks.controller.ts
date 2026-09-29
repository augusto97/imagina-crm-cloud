import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { StoreRealtimeService } from './store-realtime.service';

/**
 * v0.1.207 (ADR-S24 fase 3) — Avisos en tiempo real de una tienda. PÚBLICO:
 * el token de la URL dice a qué sincronización va el aviso y la firma HMAC
 * (verificada sobre el cuerpo CRUDO) prueba que lo mandó la tienda. Contesta
 * enseguida: el aviso se procesa en la cola.
 */
@Controller('public/store-hooks')
export class StoreHooksController {
    constructor(private readonly realtime: StoreRealtimeService) {}

    @Post(':token')
    @HttpCode(200)
    async receive(
        @Param('token') token: string,
        @Req() req: FastifyRequest & { rawBody?: Buffer },
        @Headers() headers: Record<string, string | undefined>,
    ): Promise<{ ok: true }> {
        const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        await this.realtime.receive(token, headers, raw, req.body);
        return { ok: true };
    }
}
