import { describe, expect, it } from 'vitest';
import { HitLimiter, LiveLinkCache, PdfRenderGate } from '../src/documents/pdf-limits';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Límites de la generación de PDF', () => {
    it('la compuerta deja pasar de a uno, con fila acotada y espera máxima', async () => {
        const gate = new PdfRenderGate(1, 2, 60);
        let running = 0;
        let peak = 0;
        const task = (ms: number) => async () => {
            running++;
            peak = Math.max(peak, running);
            await sleep(ms);
            running--;
            return ms;
        };
        const a = gate.run(task(30));
        const b = gate.run(task(5));
        const c = gate.run(task(5));
        // Fila llena (2): el cuarto recibe «ocupado» en el acto.
        await expect(gate.run(task(1))).rejects.toMatchObject({ status: 503 });
        expect(await Promise.all([a, b, c])).toEqual([30, 5, 5]);
        expect(peak).toBe(1);
        expect(gate.inFlight).toBe(0);
        // Espera máxima: quien espera más de 60 ms se va con «ocupado» y no queda en la fila.
        const slow = gate.run(task(150));
        await expect(gate.run(task(1))).rejects.toMatchObject({ status: 503 });
        expect(gate.queued).toBe(0);
        await slow;
        // Una tarea que falla libera su lugar.
        await expect(gate.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
        expect(await gate.run(task(1))).toBe(1);
    });

    it('entre un PDF y el siguiente se cede el hilo (otros pedidos avanzan)', async () => {
        const gate = new PdfRenderGate(1, 10, 5000);
        let ticks = 0;
        const timer = setInterval(() => ticks++, 1);
        const block = (ms: number) => async () => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
                /* trabajo sincrónico, como la maquetación */
            }
        };
        await Promise.all([gate.run(block(25)), gate.run(block(25)), gate.run(block(25)), gate.run(block(25))]);
        clearInterval(timer);
        // Sin ceder el hilo, los cuatro correrían pegados y el reloj no avanzaría entre ellos.
        expect(ticks).toBeGreaterThanOrEqual(3);
        expect(gate.slowestMs).toBeGreaterThanOrEqual(20);
    });

    it('la caché del enlace público: una vez por documento, tope de bytes y vencimiento', async () => {
        let now = 1000;
        const cache = new LiveLinkCache<{ buffer: Buffer }>((d) => d.buffer.length, { ttlMs: 100, maxEntries: 3, maxBytes: 4000, maxQueue: 1, waitMs: 50 }, () => now);
        let calls = 0;
        const load = (size: number) => async () => {
            calls++;
            await sleep(5);
            return { buffer: Buffer.alloc(size) };
        };
        const [x, y] = await Promise.all([cache.get('a', load(500)), cache.get('a', load(500))]);
        expect(calls).toBe(1);
        expect(x).toBe(y);
        expect(await cache.get('a', load(500))).toBe(x);
        expect(calls).toBe(1);
        now += 101;
        expect(await cache.get('a', load(500))).not.toBe(x);
        expect(calls).toBe(2);
        // Uno demasiado grande no se guarda; el total no pasa del tope.
        await cache.get('big', load(2000));
        await cache.get('big', load(2000));
        expect(calls).toBe(4);
        for (const k of ['b', 'c', 'd', 'e']) await cache.get(k, load(900));
        const before = calls;
        await cache.get('e', load(900));
        expect(calls).toBe(before);
        await cache.get('a', load(500)); // el más viejo ya salió
        expect(calls).toBe(before + 1);
        // Un armado que falla no se guarda y no traba al siguiente.
        await expect(cache.get('z', async () => Promise.reject(new Error('no')))).rejects.toThrow('no');
        expect((await cache.get('z', load(10))).buffer.length).toBe(10);
        // Un armado en curso + fila llena → «ocupado».
        const slow = cache.get('s1', load(10));
        const waiting = cache.get('s2', load(10));
        await expect(cache.get('s3', load(10))).rejects.toMatchObject({ status: 503 });
        await Promise.all([slow, waiting]);
    });

    it('contador de pedidos por ventana (sin Redis cuenta en memoria)', async () => {
        const limiter = new HitLimiter(null);
        const results = [];
        for (let i = 0; i < 5; i++) results.push(await limiter.hit('k', 3, 60));
        expect(results).toEqual([true, true, true, false, false]);
        expect(await limiter.hit('otra', 3, 60)).toBe(true);
        // Con un Redis que falla, sigue contando.
        const broken = new HitLimiter({ incr: () => Promise.reject(new Error('caído')), expire: () => Promise.resolve(1) });
        expect([await broken.hit('k', 1, 60), await broken.hit('k', 1, 60)]).toEqual([true, false]);
    });
});
