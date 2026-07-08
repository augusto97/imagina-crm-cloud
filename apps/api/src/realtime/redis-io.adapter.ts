import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { guardRedis } from '../redis/redis.util';

/**
 * IoAdapter con el Redis adapter de socket.io (STANDALONE §12: "Socket.io con
 * Redis adapter desde el día 1"). Hace que `io.to(room).emit()` se propague a
 * TODOS los nodos del cluster — la app puede escalar horizontalmente sin
 * re-arquitectura. Si Redis no está disponible, cae a modo single-node.
 */
export class RedisIoAdapter extends IoAdapter {
    private readonly logger = new Logger(RedisIoAdapter.name);
    private adapterFactory: ReturnType<typeof createAdapter> | null = null;

    async connect(redisUrl: string): Promise<void> {
        const pubClient = guardRedis(
            new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 }),
            this.logger,
            'socket.io/pub',
        );
        const subClient = guardRedis(pubClient.duplicate(), this.logger, 'socket.io/sub');
        try {
            await Promise.all([pubClient.connect(), subClient.connect()]);
            this.adapterFactory = createAdapter(pubClient, subClient);
        } catch {
            // Sin Redis: single-node. No rompe el arranque en dev/tests.
            pubClient.disconnect();
            subClient.disconnect();
        }
    }

    override createIOServer(port: number, options?: ServerOptions): Server {
        const server: Server = super.createIOServer(port, options);
        if (this.adapterFactory) {
            server.adapter(this.adapterFactory);
        }
        return server;
    }
}
