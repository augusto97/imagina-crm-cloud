import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { releaseChanged, watchRelease } from '../src/common/release-watch';
import { processRole, workersEnabled } from '../src/redis/queue-runtime';

/**
 * v0.1.435 — La app puede correr en dos procesos: `IMAGINA_ROLE=api` atiende a
 * las personas y `IMAGINA_ROLE=worker` hace los trabajos en segundo plano. Sin
 * papel (un solo proceso) manda `WORKERS`, como antes.
 */
const saved = { role: process.env.IMAGINA_ROLE, workers: process.env.WORKERS };
afterEach(() => {
    if (saved.role === undefined) delete process.env.IMAGINA_ROLE;
    else process.env.IMAGINA_ROLE = saved.role;
    if (saved.workers === undefined) delete process.env.WORKERS;
    else process.env.WORKERS = saved.workers;
});

describe('papel del proceso', () => {
    it('sin papel es «all» y decide WORKERS (encendido por defecto)', () => {
        delete process.env.IMAGINA_ROLE;
        delete process.env.WORKERS;
        expect(processRole()).toBe('all');
        expect(workersEnabled()).toBe(true);
        for (const off of ['off', '0', 'false', 'no', ' OFF ']) {
            process.env.WORKERS = off;
            expect(workersEnabled()).toBe(false);
        }
    });

    it('«api» nunca corre trabajos, aunque WORKERS diga que sí', () => {
        process.env.IMAGINA_ROLE = 'api';
        process.env.WORKERS = 'on';
        expect(processRole()).toBe('api');
        expect(workersEnabled()).toBe(false);
    });

    it('«worker» siempre corre trabajos, aunque WORKERS diga que no', () => {
        process.env.IMAGINA_ROLE = ' Worker ';
        process.env.WORKERS = 'off';
        expect(processRole()).toBe('worker');
        expect(workersEnabled()).toBe(true);
    });

    it('un papel desconocido se lee como un solo proceso', () => {
        process.env.IMAGINA_ROLE = 'todo';
        delete process.env.WORKERS;
        expect(processRole()).toBe('all');
        expect(workersEnabled()).toBe(true);
    });
});

describe('el proceso de los trabajos se entera de una versión nueva', () => {
    const root = mkdtempSync(join(tmpdir(), 'ib-release-watch-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const a = join(root, 'releases', 'a');
    const b = join(root, 'releases', 'b');
    mkdirSync(join(a, 'apps', 'api'), { recursive: true });
    mkdirSync(join(b, 'apps', 'api'), { recursive: true });
    const current = join(root, 'current');
    symlinkSync(a, current);
    const watchPath = join(current, 'apps', 'api');
    const startedIn = realpathSync(watchPath);

    it('mientras el enlace apunta a la misma versión no pasa nada', () => {
        expect(releaseChanged({ startedIn, watchPath })).toBeNull();
    });

    it('si el enlace no se puede leer (en medio del cambio) no hace nada', () => {
        expect(releaseChanged({ startedIn, watchPath: join(root, 'no-existe') })).toBeNull();
        expect(
            releaseChanged({
                startedIn,
                watchPath,
                resolve: () => {
                    throw new Error('ENOENT');
                },
            }),
        ).toBeNull();
    });

    it('cuando el enlace cambia de versión avisa UNA vez con la carpeta nueva', () => {
        vi.useFakeTimers();
        try {
            const seen: string[] = [];
            const stop = watchRelease({ startedIn, watchPath, onChange: (next) => seen.push(next) }, 1000);
            vi.advanceTimersByTime(3000);
            expect(seen).toEqual([]);
            unlinkSync(current);
            symlinkSync(b, current);
            vi.advanceTimersByTime(5000);
            expect(seen).toEqual([realpathSync(join(b, 'apps', 'api'))]);
            stop();
        } finally {
            vi.useRealTimers();
        }
    });
});
