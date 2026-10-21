import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_JOB_RETENTION } from '../src/redis/redis.util';
import { startRedis, type TestRedis } from './helpers/containers';

/**
 * Regresión: los jobs de las tareas programadas (`upsertJobScheduler`) nunca
 * se borraban (el template no traía removeOnComplete/removeOnFail) y se
 * acumulaban miles de hashes por día en Redis. Con `defaultJobOptions` en la
 * cola, también los generados por el scheduler se recortan solos.
 */
describe('retención de jobs de BullMQ', () => {
    let redis: TestRedis;
    const conns: IORedis[] = [];
    const conn = (): IORedis => {
        const c = new IORedis(redis.url, { maxRetriesPerRequest: null });
        conns.push(c);
        return c;
    };

    beforeAll(async () => {
        redis = await startRedis();
    });
    afterAll(async () => {
        for (const c of conns) c.disconnect();
        await redis?.stop();
    });

    it('los jobs del scheduler heredan la retención y el set de completados no crece', async () => {
        const queue = new Queue('retention-test', { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
        await queue.upsertJobScheduler('tick', { every: 20 }, { name: 'tick', data: {} });
        const scheduler = await queue.getJobScheduler('tick');
        expect(scheduler?.template?.opts).toMatchObject(QUEUE_JOB_RETENTION);

        // Un `add` sin opciones también las toma; uno con opciones propias manda.
        const plain = await queue.add('x', {});
        expect(plain.opts).toMatchObject(QUEUE_JOB_RETENTION);
        const own = await queue.add('y', {}, { removeOnComplete: true });
        expect(own.opts.removeOnComplete).toBe(true);

        const worker = new Worker('retention-test', async () => undefined, { connection: conn(), concurrency: 5 });
        try {
            // Más de 100 ticks completados → el set queda recortado a 100.
            const deadline = Date.now() + 30_000;
            let done = 0;
            worker.on('completed', () => {
                done++;
            });
            while (done < 130 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
            expect(done).toBeGreaterThanOrEqual(130);
            expect(await queue.getCompletedCount()).toBeLessThanOrEqual(QUEUE_JOB_RETENTION.removeOnComplete);
        } finally {
            await queue.removeJobScheduler('tick');
            await worker.close();
            await queue.close();
        }
    });
});
