import 'reflect-metadata';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { loadEnv } from './config/env';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

// Red de seguridad: una promesa rechazada sin `catch` (p.ej. un comando Redis
// que falla en un camino no cubierto) NO debe tumbar el servidor. Se loguea y
// el proceso sigue; el estado real de las dependencias lo reporta /health/ready.
process.on('unhandledRejection', (reason) => {
    Logger.error(`Unhandled promise rejection: ${String(reason)}`, 'Process');
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
            trustProxy: env.TRUST_PROXY,
        }),
        // rawBody: para verificar la firma de los webhooks de pago (ADR-S12)
        // sobre el cuerpo exacto recibido, no el re-serializado.
        { rawBody: true },
    );

    // Rate limiting por IP (SEC-05): bucket general + uno estricto para las
    // rutas sensibles (login/registro/reset/portal) para frenar fuerza bruta,
    // credential stuffing y el DoS de CPU del verify argon2. Store en memoria
    // (por nodo) → no acopla la disponibilidad del login a Redis.
    const sensitivePaths = [
        '/auth/login',
        '/auth/register',
        '/auth/forgot-password',
        '/auth/reset-password',
        '/portal/consume',
    ];
    await app.register(fastifyRateLimit, {
        global: true,
        max: (req) =>
            sensitivePaths.some((p) => req.url.includes(p))
                ? env.RATE_LIMIT_AUTH_MAX
                : env.RATE_LIMIT_MAX,
        timeWindow: '1 minute',
        // No limitar los health probes (evita 429/503 espurios del monitoreo).
        allowList: (req) => req.url.includes('/health'),
    });

    // Compresión de respuestas (gzip/deflate/brotli). Las respuestas JSON del
    // API (listas de records, aggregates, activity) viajan por WAN al navegador;
    // sin esto van sin comprimir aunque el proxy no re-comprima los proxied
    // responses. `threshold` evita gastar CPU en payloads chicos. Transport-
    // agnóstico: sirve detrás de nginx, Caddy o directo.
    await app.register(fastifyCompress, { threshold: 1024, encodings: ['br', 'gzip', 'deflate'] });
    await app.register(fastifyCookie);
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ApiExceptionFilter());

    // Socket.io con Redis adapter (realtime multi-nodo — STANDALONE §12).
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connect(env.REDIS_URL);
    app.useWebSocketAdapter(ioAdapter);

    app.enableShutdownHooks();

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    Logger.log(`API escuchando en http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();
