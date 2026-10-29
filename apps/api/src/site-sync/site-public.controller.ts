import { Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SiteRealtimeService } from './site-realtime.service';
import { WordpressPluginService, type WpPluginInfo } from './wordpress-plugin.service';

/**
 * Avisos en tiempo real del complemento (v0.1.334, ADR-S84). PÚBLICO: el
 * token de la URL dice a qué sincronización va el aviso y la firma HMAC
 * (sobre el cuerpo CRUDO, con el timestamp) prueba que lo mandó el sitio.
 * Contesta enseguida: el aviso se procesa en la cola.
 */
@Controller('public/site-hooks')
export class SiteHooksController {
    constructor(private readonly realtime: SiteRealtimeService) {}

    @Post(':token')
    @HttpCode(200)
    async receive(
        @Param('token') token: string,
        @Req() req: FastifyRequest & { rawBody?: Buffer },
        @Headers() headers: Record<string, string | undefined>,
    ): Promise<{ ok: true }> {
        const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        await this.realtime.receive(token, headers, raw, typeof req.body === 'object' ? req.body : undefined);
        return { ok: true };
    }
}

/**
 * El complemento para descargar e instalar, y lo que pregunta WordPress para
 * actualizarlo (como cualquier plugin). PÚBLICO: es código abierto (GPL) y
 * WordPress lo pide sin sesión.
 */
@Controller('public/wordpress-plugin')
export class WordpressPluginPublicController {
    constructor(private readonly plugin: WordpressPluginService) {}

    @Get('info')
    info(): { data: WpPluginInfo } {
        const info = this.plugin.info();
        if (!info) throw new NotFoundException({ code: 'plugin_unavailable', message: 'Este servidor no trae el complemento de WordPress.', data: { status: 404 } });
        return { data: info };
    }

    @Get('download')
    download(@Res() reply: FastifyReply): void {
        const zip = this.plugin.zip();
        if (!zip) throw new NotFoundException({ code: 'plugin_unavailable', message: 'Este servidor no trae el complemento de WordPress.', data: { status: 404 } });
        // `content-encoding: identity`: un zip no se comprime de nuevo y conserva el content-length.
        void reply
            .header('content-type', 'application/zip')
            .header('content-encoding', 'identity')
            .header('content-length', String(zip.bytes.length))
            .header('content-disposition', `attachment; filename="${zip.filename}"`)
            .header('cache-control', 'no-store')
            .header('x-content-type-options', 'nosniff')
            .send(zip.bytes);
    }
}
