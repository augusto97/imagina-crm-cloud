import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { loadEnv } from './config/env';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
    const env = loadEnv();
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
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
