import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
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
        new FastifyAdapter(),
        // rawBody: para verificar la firma de los webhooks de pago (ADR-S12)
        // sobre el cuerpo exacto recibido, no el re-serializado.
        { rawBody: true },
    );

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
