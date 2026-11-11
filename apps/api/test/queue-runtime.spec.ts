import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env';
import { HelpdeskQueue, HelpdeskQueueBootstrap } from '../src/helpdesk/helpdesk.queue';
import {
    QueueRuntimeLifecycle,
    addDedupedJob,
    createWorker,
    drainWorkers,
    isShuttingDown,
    registerScheduler,
    resetQueueRuntimeForTests,
    workerConcurrencyTotal,
    workersEnabled,
} from '../src/redis/queue-runtime';
import { acquireRedisLock, releaseRedisLock, renewRedisLock, withRedisLock } from '../src/redis/redis-lock';
import { startRedis, type TestRedis } from './helpers/containers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => Promise<boolean> | boolean, ms = 8_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return;
        await sleep(40);
    }
    throw new Error('la condición no se cumplió a tiempo');
};

describe('Colas: piezas comunes (Redis real)', () => {
    let rd: TestRedis;
    const conns: IORedis[] = [];
    const conn = () => {
        const c = new IORedis(rd.url, { maxRetriesPerRequest: null });
        conns.push(c);
        return c;
    };
    let n = 0;
    const qname = () => `t-${Date.now()}-${n++}`;

    beforeAll(async () => {
        rd = await startRedis();
    });
    afterEach(() => {
        delete process.env.WORKERS;
        resetQueueRuntimeForTests();
    });
    afterAll(async () => {
        await Promise.all(conns.map((c) => c.quit().catch(() => undefined)));
        await rd.stop();
    });

    it('un trabajo con jobId fijo que falló deja mudo al siguiente `add` de BullMQ; addDedupedJob lo vuelve a encolar', async () => {
        const name = qname();
        const queue = new Queue(name, { connection: conn() });
        let runs = 0;
        let fail = true;
        const worker = new Worker(
            name,
            async () => {
                runs++;
                if (fail) throw new Error('falló la base un instante');
            },
            { connection: conn() },
        );
        // Lo de antes: jobId fijo + removeOnFail: 100.
        await queue.add('poll', {}, { jobId: 'poll-7', removeOnComplete: true, removeOnFail: 100 });
        await until(async () => (await queue.getJobState('poll-7')) === 'failed');
        fail = false;
        await queue.add('poll', {}, { jobId: 'poll-7', removeOnComplete: true, removeOnFail: 100 });
        await sleep(400);
        // El bug: el segundo add fue un no-op silencioso.
        expect(runs).toBe(1);
        expect(await queue.getJobState('poll-7')).toBe('failed');

        // El arreglo: el fallido se quita y el trabajo corre.
        await addDedupedJob(queue, 'poll', {}, { jobId: 'poll-7' });
        await until(() => runs === 2);
        await until(async () => (await queue.getJobState('poll-7')) === 'unknown');

        // Y uno que falla ya no ocupa el id.
        fail = true;
        await addDedupedJob(queue, 'poll', {}, { jobId: 'poll-8' });
        await until(() => runs === 3);
        await until(async () => (await queue.getJobState('poll-8')) === 'unknown');
        await worker.close();
        await queue.close();
    });

    it('addDedupedJob sigue deduplicando lo que está en espera', async () => {
        const queue = new Queue(qname(), { connection: conn() });
        await addDedupedJob(queue, 'run', { a: 1 }, { jobId: 'run-1', delay: 60_000 });
        await addDedupedJob(queue, 'run', { a: 2 }, { jobId: 'run-1', delay: 60_000 });
        expect(await queue.getDelayedCount()).toBe(1);
        expect((await queue.getJob('run-1'))?.data).toEqual({ a: 1 });
        await queue.obliterate({ force: true });
        await queue.close();
    });

    it('con Redis caído al arrancar, onModuleInit de una cola termina; el reloj se registra cuando Redis responde', async () => {
        // Un Redis que no existe: con `await upsertJobScheduler` esto no volvía nunca.
        const env = { REDIS_URL: 'redis://127.0.0.1:1', HELPDESK_POLL_CONCURRENCY: 1 } as unknown as Env;
        const boot = new HelpdeskQueueBootstrap(env, new HelpdeskQueue());
        const done = await Promise.race([boot.onModuleInit().then(() => 'listo'), sleep(3_000).then(() => 'colgado')]);
        expect(done).toBe('listo');
        // Apagar tampoco se cuelga con Redis caído.
        resetQueueRuntimeForTests();
        (boot as unknown as { connections: IORedis[] }).connections.forEach((c) => c.disconnect());

        // Registro que falla al principio y se reintenta solo.
        const queue = new Queue(qname(), { connection: conn() });
        let calls = 0;
        const flaky = {
            upsertJobScheduler: (async (...args: Parameters<Queue['upsertJobScheduler']>) => {
                calls++;
                if (calls === 1) throw new Error('Connection is closed.');
                return queue.upsertJobScheduler(...args);
            }) as Queue['upsertJobScheduler'],
        };
        const log = new Logger('test');
        log.warn = () => undefined;
        registerScheduler(flaky, 'tick', { every: 60_000 }, { name: 'tick', data: {} }, log);
        await until(async () => (await queue.getJobSchedulers()).length === 1, 6_000);
        expect(calls).toBe(2);
        await queue.obliterate({ force: true });
        await queue.close();
    });

    it('WORKERS=off: no crea workers ni registra relojes, pero la cola encola', async () => {
        process.env.WORKERS = 'off';
        expect(workersEnabled()).toBe(false);
        const name = qname();
        const queue = new Queue(name, { connection: conn() });
        expect(createWorker(name, async () => undefined, { connection: conn() })).toBeNull();
        registerScheduler(queue, 'tick', { every: 60_000 }, { name: 'tick', data: {} });
        await sleep(200);
        expect(await queue.getJobSchedulers()).toHaveLength(0);

        // Una cola completa arranca sin worker y sin reloj.
        const env = { REDIS_URL: rd.url, HELPDESK_POLL_CONCURRENCY: 2 } as unknown as Env;
        const dispatcher = new HelpdeskQueue();
        const boot = new HelpdeskQueueBootstrap(env, dispatcher);
        await boot.onModuleInit();
        expect((boot as unknown as { worker: unknown }).worker).toBeNull();
        expect(workerConcurrencyTotal()).toBe(0);
        const hq = new Queue('helpdesk', { connection: conn() });
        await sleep(200);
        expect(await hq.getJobSchedulers()).toHaveLength(0);
        dispatcher.enqueuePoll(1, 99);
        await until(async () => (await hq.getJobState('poll-99')) === 'waiting');
        await boot.onApplicationShutdown();
        await hq.obliterate({ force: true });
        await hq.close();
        await queue.close();

        process.env.WORKERS = 'on';
        expect(workersEnabled()).toBe(true);
    });

    it('apagado: todos los workers dejan de tomar trabajos a la vez, se espera a los que corren y pasado el plazo se cierran', async () => {
        const a = qname();
        const b = qname();
        const qa = new Queue(a, { connection: conn() });
        const qb = new Queue(b, { connection: conn() });
        let aDone = 0;
        let bStarted = 0;
        const wa = createWorker(
            a,
            async () => {
                await sleep(600);
                aDone++;
            },
            { connection: conn(), concurrency: 3 },
        )!;
        const wb = createWorker(
            b,
            async () => {
                bStarted++;
                await sleep(30_000);
            },
            { connection: conn(), concurrency: 2 },
        )!;
        expect(workerConcurrencyTotal()).toBe(5);
        await qa.add('x', {});
        await qb.add('lento', {});
        await until(() => bStarted === 1 && wa.isRunning());
        await sleep(100);
        const drain = drainWorkers(1_500);
        expect(isShuttingDown()).toBe(true);
        // Lo que llega durante el apagado ya no se toma.
        await sleep(50);
        await qa.add('tarde', {});
        await qb.add('tarde', {});
        const t0 = Date.now();
        const out = await drain;
        expect(Date.now() - t0).toBeLessThan(4_000);
        expect(aDone).toBe(1); // el corto terminó entero
        expect(bStarted).toBe(1); // el nuevo no arrancó
        expect(out).toEqual({ closed: 1, forced: 1 });
        expect(await qa.getWaitingCount()).toBe(1);
        expect(await qb.getWaitingCount()).toBe(1);
        expect((wb as unknown as { closed: boolean }).closed).toBe(true);
        await qa.obliterate({ force: true });
        await qb.obliterate({ force: true });
        await qa.close();
        await qb.close();
    });

    it('candado con dueño: sólo el dueño lo suelta o lo renueva; un error de Redis no cuenta como tomado', async () => {
        const redis = conn();
        const key = `lock:${qname()}`;
        const mine = await acquireRedisLock(redis, key, 30);
        expect(mine).toBeTruthy();
        expect(await acquireRedisLock(redis, key, 30)).toBeNull();
        // Otro (un nodo cuyo candado ya venció) no puede soltar ni renovar el mío.
        expect(await releaseRedisLock(redis, key, 'otro')).toBe(false);
        expect(await renewRedisLock(redis, key, 'otro', 30)).toBe(false);
        expect(await redis.get(key)).toBe(mine);
        expect(await renewRedisLock(redis, key, mine!, 100)).toBe(true);
        expect(await redis.ttl(key)).toBeGreaterThan(30);
        expect(await releaseRedisLock(redis, key, mine!)).toBe(true);
        expect(await redis.exists(key)).toBe(0);

        // Redis caído: nadie "toma" el candado.
        const broken = new IORedis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
        broken.on('error', () => undefined);
        expect(await acquireRedisLock(broken, key, 30)).toBeNull();
        expect(await withRedisLock(broken, key, 30, async () => 'corrió')).toEqual({ ran: false });
        broken.disconnect();

        // withRedisLock renueva mientras dura el trabajo y suelta al final.
        const ran = await withRedisLock(redis, key, 3, async (stillMine) => {
            await sleep(3_600);
            expect(await redis.exists(key)).toBe(1); // sin renovar habría vencido
            expect(await acquireRedisLock(redis, key, 3)).toBeNull();
            return stillMine();
        });
        expect(ran).toEqual({ ran: true, result: true });
        expect(await redis.exists(key)).toBe(0);
    });

    it('al arrancar avisa si la concurrencia de los workers supera el pool de la base', () => {
        const prev = process.env.DB_POOL_MAX;
        process.env.DB_POOL_MAX = '3';
        const w = createWorker(qname(), async () => undefined, { connection: conn(), concurrency: 9, autorun: false })!;
        const warns: string[] = [];
        const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
        new QueueRuntimeLifecycle().onApplicationBootstrap();
        expect(warns.some((m) => /suma 9/.test(m) && /3 conexiones/.test(m))).toBe(true);
        warns.length = 0;
        process.env.DB_POOL_MAX = '50';
        new QueueRuntimeLifecycle().onApplicationBootstrap();
        expect(warns).toHaveLength(0);
        spy.mockRestore();
        if (prev === undefined) delete process.env.DB_POOL_MAX;
        else process.env.DB_POOL_MAX = prev;
        void w.close(true);
    });
});
