import 'reflect-metadata';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { isBlockedCrossSite, isFormBodyOnOperatorRoute, ownOriginOf } from './common/cross-site';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { registerRequestInputHooks } from './common/request-input';
import { isHealthProbe, rateLimitMaxFor } from './common/rate-limit-policy';
import { routePath } from './common/route-path';
import { registerShopSiteRoutes } from './shop/shop-site.routes';
import { ShopSiteService } from './shop/shop-site.service';
import { rateKeyForIp } from './common/client-ip';
import { FILE_IMPORT_CONTENT_TYPE } from '@imagina-base/shared';
import { loadEnv } from './config/env';
import { buildTrustProxy } from './common/trust-proxy';
import { recordServerError } from './observability/diagnostics';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

// Red de seguridad: una promesa rechazada sin `catch` (p.ej. un comando Redis
// que falla en un camino no cubierto) NO debe tumbar el servidor. Se loguea y
// el proceso sigue; el estado real de las dependencias lo reporta /health/ready.
process.on('unhandledRejection', (reason) => {
    Logger.error(`Unhandled promise rejection: ${String(reason)}`, 'Process');
    recordServerError({ source: 'process', message: `Promesa rechazada sin manejar: ${String(reason)}` });
});

async function bootstrap(): Promise<void> {
    const env = loadEnv();
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter({
            // Tope explícito de body (SEC-05) — acota payloads abusivos.
            bodyLimit: env.BODY_LIMIT_BYTES,
            // Ver la IP real del cliente detrás del reverse proxy (para que el
            // rate limit no agrupe a todos bajo la IP del proxy).
            //
            // v0.1.202 — ya no es `true` (confiar en cualquiera que mande
            // `X-Forwarded-*`) sino la DIRECCIÓN del proxy: por defecto
            // `loopback`, que es donde corre el Caddy/nginx de este repo.
            //
            // v0.1.409 (ADR-S102) — una función: además de `TRUST_PROXY`, las
            // direcciones de Cloudflare cuando Plataforma → Dominios dice que
            // la dirección rápida pasa por ahí (o `TRUST_PROXY=…,cloudflare`).
            trustProxy: buildTrustProxy(env.TRUST_PROXY),
        }),
        // rawBody: para verificar la firma de los webhooks de pago (ADR-S12)
        // sobre el cuerpo exacto recibido, no el re-serializado.
        { rawBody: true },
    );

    // Rate limiting por IP (SEC-05): bucket general + uno estricto para las
    // rutas sensibles (login/registro/reset/portal) para frenar fuerza bruta,
    // credential stuffing y el DoS de CPU del verify argon2. Store en memoria
    // (por nodo) → no acopla la disponibilidad del login a Redis.
    // Qué límite le toca a cada ruta: `common/rate-limit-policy.ts`.
    await app.register(fastifyRateLimit, {
        global: true,
        max: (req) => rateLimitMaxFor(req, env),
        timeWindow: '1 minute',
        // Una red IPv6 (/64) cuenta como un solo visitante: rotar direcciones dentro del bloque no esquiva el límite.
        keyGenerator: (req) => rateKeyForIp(req.ip),
        // No limitar los health probes (evita 429/503 espurios del monitoreo).
        allowList: (req) => isHealthProbe(req),
    });

    // Compresión de respuestas (gzip/deflate/brotli). Las respuestas JSON del
    // API (listas de records, aggregates, activity) viajan por WAN al navegador;
    // sin esto van sin comprimir aunque el proxy no re-comprima los proxied
    // responses. `threshold` evita gastar CPU en payloads chicos. Transport-
    // agnóstico: sirve detrás de nginx, Caddy o directo.
    await app.register(fastifyCompress, { threshold: 1024, encodings: ['br', 'gzip', 'deflate'] });
    await app.register(fastifyCookie);
    // Upload de archivos (ADR-S16): un solo file por request, límite por env.
    await app.register(fastifyMultipart, {
        limits: { files: 1, fileSize: env.MAX_UPLOAD_BYTES },
    });
    // (El token endpoint OAuth recibe `x-www-form-urlencoded`: el adapter de
    // Nest ya registra @fastify/formbody, no hace falta otro parser.)
    const fastify = app.getHttpAdapter().getInstance();
    // v0.1.339 (ADR-S88) — «Crear desde un archivo» manda las hojas como texto
    // y pueden pasar del tope general: un tipo de contenido propio con su
    // propio tope, que SÓLO aceptan esas rutas. Cualquier otra ruta lo
    // rechaza antes de leer el cuerpo.
    const isFileImportUrl = (req: { url: string; routeOptions?: { url?: string } }): boolean =>
        routePath(req).startsWith('/api/v1/file-import/');
    fastify.addHook('onRequest', (req, reply, done) => {
        const ct = String(req.headers['content-type'] ?? '');
        if (ct.startsWith(FILE_IMPORT_CONTENT_TYPE) && !isFileImportUrl(req)) {
            void reply.code(415).send({ code: 'unsupported_media_type', message: 'Tipo de contenido no admitido.', data: { status: 415 } });
            return;
        }
        done();
    });
    fastify.addContentTypeParser(FILE_IMPORT_CONTENT_TYPE, { parseAs: 'string', bodyLimit: env.FILE_IMPORT_BODY_LIMIT_BYTES }, (req, body, done) => {
        if (!isFileImportUrl(req)) {
            done(Object.assign(new Error('Tipo de contenido no admitido.'), { statusCode: 415 }), undefined);
            return;
        }
        try {
            done(null, JSON.parse(body as string));
        } catch {
            done(Object.assign(new Error('El cuerpo del pedido no es JSON válido.'), { statusCode: 400 }), undefined);
        }
    });
    // CORS acotado a las superficies OAuth/MCP (v0.1.184): un cliente MCP que
    // corre EN el navegador (MCP Inspector, apps web) descubre la metadata y
    // canjea tokens con fetch cross-origin. No lleva cookies (auth por Bearer),
    // así que `*` no expone la sesión. El resto del API sigue same-origin.
    fastify.addHook('onRequest', (req, reply, done) => {
        const url = routePath(req);
        if (url.startsWith('/.well-known/oauth-') || url.startsWith('/api/v1/oauth/') || url === '/api/v1/mcp') {
            reply.raw.setHeader('Access-Control-Allow-Origin', '*');
            reply.raw.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            reply.raw.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id');
            reply.raw.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
            reply.raw.setHeader('Access-Control-Max-Age', '600');
            if (req.method === 'OPTIONS') {
                void reply.code(204).send();
                return;
            }
        }
        done();
    });
    // SEC-35 (v0.1.239) — CSRF / login CSRF: ver `common/cross-site.ts`.
    const crossSiteAllowed = (process.env.WS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
    const appOrigin = ownOriginOf(env.APP_BASE_URL);
    fastify.addHook('onRequest', (req, reply, done) => {
        const header = (name: string): string | undefined => {
            const v = req.headers[name];
            return Array.isArray(v) ? v[0] : v;
        };
        if (
            isBlockedCrossSite({
                method: req.method,
                path: (req.url.split('?')[0] ?? ''),
                host: req.host,
                protocol: req.protocol,
                secFetchSite: header('sec-fetch-site'),
                origin: header('origin'),
                allowedOrigins: crossSiteAllowed,
                appOrigin,
            })
        ) {
            void reply.code(403).send({
                code: 'cross_site_request',
                message: 'Pedido rechazado: viene de otro sitio.',
                data: { status: 403 },
            });
            return;
        }
        // Las consolas del operador sólo reciben JSON (o un archivo): un cuerpo de `<form>` no es de la app.
        if (isFormBodyOnOperatorRoute({ method: req.method, path: routePath(req), contentType: header('content-type') })) {
            void reply.code(415).send({
                code: 'unsupported_body',
                message: 'Este pedido sólo se acepta como JSON.',
                data: { status: 415 },
            });
            return;
        }
        done();
    });
    // NUL / sustitutos sueltos fuera del cuerpo, query y params; ids imposibles → 404.
    registerRequestInputHooks(fastify);
    // v0.1.227 — HSTS lo manda el propio API (antes sólo el proxy, y en un panel
    // como ServerAvatar esa cabecera no estaba). El navegador la guarda para
    // TODO el host sin importar qué respuesta la trajo, y la SPA pide al API
    // apenas carga: desde la primera visita el dominio queda fijado a HTTPS.
    // Sólo en producción y sólo sobre HTTPS (por RFC, sobre HTTP se ignora; y
    // el protocolo sale del `X-Forwarded-Proto` del proxy de confianza).
    // SIN `includeSubDomains` a propósito: si la app vive en el dominio raíz,
    // eso forzaría HTTPS durante un año en TODOS los subdominios del operador
    // (otras apps suyas que quizás no lo tienen). Eso lo decide el proxy.
    // v0.1.331 — nada de la app se indexa en buscadores. La promoción vive en el
    // sitio del producto (Plataforma → Marca → «Sitio del producto»): la app no
    // compite con él, y lo que publican las empresas (formularios, agendas,
    // listas y tableros públicos, páginas legales) no aparece en Google sin que
    // nadie lo decida. Una página que ya fija la suya se respeta.
    fastify.addHook('onSend', (_req, reply, payload, done) => {
        if (!reply.hasHeader('x-robots-tag')) void reply.header('X-Robots-Tag', 'noindex, nofollow');
        done(null, payload);
    });
    if (env.NODE_ENV === 'production') {
        fastify.addHook('onSend', (req, reply, payload, done) => {
            if (req.protocol === 'https' && !reply.hasHeader('strict-transport-security')) {
                void reply.header('Strict-Transport-Security', 'max-age=31536000');
            }
            done(null, payload);
        });
    }
    // La metadata de descubrimiento OAuth (RFC 8414/9728) vive en la RAÍZ del
    // host por definición — fuera del prefijo del API.
    app.setGlobalPrefix('api/v1', {
        exclude: [
            '.well-known/oauth-authorization-server',
            '.well-known/oauth-authorization-server/api/v1/mcp',
            '.well-known/openid-configuration',
            '.well-known/oauth-protected-resource',
            '.well-known/oauth-protected-resource/api/v1/mcp',
        ],
    });
    app.useGlobalFilters(new ApiExceptionFilter());

    // v0.1.423 — La tienda en SU dominio (ADR-S103): `/`, `/p/…`,
    // `/sitemap.xml`, `/robots.txt` y `/_imagina/site`. Fuera del prefijo del
    // API: el servidor web se los pasa a la app y, si no es el dominio de una
    // tienda, la app contesta 404 y el servidor web sirve el SPA.
    registerShopSiteRoutes(fastify, app.get(ShopSiteService));

    // Socket.io con Redis adapter (realtime multi-nodo — STANDALONE §12).
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connect(env.REDIS_URL);
    app.useWebSocketAdapter(ioAdapter);

    app.enableShutdownHooks();

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    Logger.log(`API escuchando en http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();
