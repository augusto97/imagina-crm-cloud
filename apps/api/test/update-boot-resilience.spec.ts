import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env';
import type { ReleasesRepository } from '../src/update/releases.repository';
import { UpdateManager } from '../src/update/update-manager.service';
import type { Deployer } from '../src/update/update.types';

/**
 * Regresión: si Redis no está disponible al bootear, el self-heal de
 * `UpdateManager.onModuleInit` NO debe lanzar — si lanzara, abortaría el
 * arranque de Nest y el API nunca escucharía (quedaría "vivo pero mudo"). Debe
 * degradar y dejar que el server levante; `/health/ready` reportará el 503.
 */
describe('UpdateManager.onModuleInit — resiliencia de arranque', () => {
    const deployer = { currentVersion: () => '0.1.2' } as unknown as Deployer;
    const releases = {} as unknown as ReleasesRepository;
    const env = {} as unknown as Env;

    it('NO lanza si Redis rechaza (p.ej. NOAUTH)', async () => {
        const redis = { get: vi.fn().mockRejectedValue(new Error('NOAUTH')) } as unknown as Redis;
        const mgr = new UpdateManager(env, redis, deployer, releases);
        await expect(mgr.onModuleInit()).resolves.toBeUndefined();
    });

    it('reconcilia normalmente cuando Redis responde', async () => {
        const run = JSON.stringify({ status: 'restarting', version: '0.1.2', message: null, started_at: '2026-01-01T00:00:00Z', finished_at: null });
        const redis = { get: vi.fn().mockResolvedValue(run), set: vi.fn().mockResolvedValue('OK') } as unknown as Redis;
        const mgr = new UpdateManager(env, redis, deployer, releases);
        await expect(mgr.onModuleInit()).resolves.toBeUndefined();
        // La versión servida coincide → se marca 'success'.
        expect(redis.set).toHaveBeenCalledOnce();
        const written = (redis.set as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[1] ?? '';
        expect(written).toContain('success');
    });
});
