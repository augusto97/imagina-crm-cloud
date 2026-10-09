import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ImageProxyService } from './image-proxy';

/**
 * v0.1.210 — `GET /media/image?url=` — miniaturas de imágenes externas (ver
 * `image-proxy.ts`). Sólo sesión: un `<img>` manda la cookie pero no
 * `X-Tenant-Id`, y aquí no se toca ningún dato de la empresa.
 */
@Controller('media')
@UseGuards(SessionGuard)
export class ImageProxyController {
    constructor(private readonly images: ImageProxyService) {}

    @Get('image')
    async image(@Query('url') url: string, @Res() reply: FastifyReply): Promise<void> {
        const img = await this.images.fetch(url);
        void reply
            .header('content-type', img.contentType)
            .header('content-length', String(img.bytes.length))
            // Privado: la pidió una sesión. Un día alcanza para no volver a
            // pedirla en cada página de la tabla.
            .header('cache-control', 'private, max-age=86400')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', 'sandbox')
            .header('content-disposition', 'inline')
            // Sin compresión: una imagen ya viene comprimida.
            .header('content-encoding', 'identity')
            .send(img.bytes);
    }
}
