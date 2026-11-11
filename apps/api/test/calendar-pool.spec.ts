import { describe, expect, it } from 'vitest';
import { CalendarPool } from '../src/booking/calendar-pool';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
}

describe('cupo de lecturas de calendarios externos', () => {
    it('una empresa no pasa de su parte y no frena a las demás', async () => {
        const pool = new CalendarPool({ total: 4, perKey: 2, maxWaitMs: 1000, maxQueue: 10 });
        const gate = deferred();
        const started: string[] = [];
        const slow = (name: string) => async () => {
            started.push(name);
            await gate.promise;
            return name;
        };
        // La empresa A pide 4 lecturas lentas: entran 2, las otras 2 esperan.
        const a = ['a1', 'a2', 'a3', 'a4'].map((n) => pool.run('A', slow(n)));
        await tick();
        expect(started).toEqual(['a1', 'a2']);
        // La empresa B entra igual aunque A tenga gente en la fila.
        expect(await pool.run('B', async () => 'b1')).toBe('b1');
        gate.resolve();
        expect(await Promise.all(a)).toEqual(['a1', 'a2', 'a3', 'a4']);
        expect(pool.stats()).toEqual({ active: 0, queued: 0 });
    });

    it('lo que no consigue lugar a tiempo devuelve null (se sigue sin ese calendario)', async () => {
        const pool = new CalendarPool({ total: 1, perKey: 1, maxWaitMs: 20, maxQueue: 1 });
        const gate = deferred();
        const first = pool.run('A', async () => {
            await gate.promise;
            return 'ok';
        });
        await tick();
        const waited = pool.run('A', async () => 'tarde');
        // La fila (de 1) está llena: ni espera.
        expect(await pool.run('A', async () => 'sin fila')).toBeNull();
        expect(await waited).toBeNull();
        gate.resolve();
        expect(await first).toBe('ok');
        // Un fallo de la tarea suelta el lugar.
        await expect(pool.run('A', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
        expect(await pool.run('A', async () => 'libre')).toBe('libre');
    });
});
