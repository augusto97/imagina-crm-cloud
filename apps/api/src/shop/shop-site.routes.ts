import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ShopSiteRoute, ShopSiteService } from './shop-site.service';

/**
 * v0.1.423 — Las rutas de la raíz para la tienda en su dominio. Van directo
 * en Fastify (fuera del prefijo `/api/v1` de Nest) y le pasan todo a
 * `ShopSiteService`. Un error inesperado nunca deja la app sin cargar: en el
 * dominio de la plataforma el servidor web sirve el SPA ante un 404 o un 5xx.
 */
export function registerShopSiteRoutes(fastify: FastifyInstance, site: ShopSiteService): void {
    const handler =
        (route: ShopSiteRoute) =>
        async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
            try {
                await site.handle(route, req, reply);
            } catch (err) {
                req.log.error({ err }, 'tienda en su dominio');
                if (!reply.sent) void reply.status(503).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('Unavailable');
            }
        };
    fastify.get('/', handler('home'));
    fastify.get('/p/*', handler('product'));
    fastify.get('/sitemap.xml', handler('sitemap'));
    fastify.get('/robots.txt', handler('robots'));
    fastify.get('/_imagina/site', handler('probe'));
}
