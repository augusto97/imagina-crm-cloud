import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppRelease } from '@imagina-base/shared';
import { loadEnv } from '../src/config/env';
import { ReleasesRepository } from '../src/update/releases.repository';
import { UpdateManager } from '../src/update/update-manager.service';
import { cmpSemver, isNewer, updateKeys, type DeployResult, type Deployer } from '../src/update/update.types';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/** Deployer fake: registra llamadas, nunca despliega de verdad (spec §7). */
class FakeDeployer implements Deployer {
    enabled = true;
    version = '1.0.0';
    deployCalls = 0;
    finalizeCalls = 0;
    rollbackCalls = 0;
    nextResult: DeployResult = { ok: true, message: 'ok', prevRelease: '/prev' };
    currentVersion(): string {
        return this.version;
    }
    deploy(_r: AppRelease): Promise<DeployResult> {
        this.deployCalls += 1;
        return Promise.resolve(this.nextResult);
    }
    finalize(): void {
        this.finalizeCalls += 1;
    }
    rollback(): { ok: boolean; message: string } {
        this.rollbackCalls += 1;
        return { ok: true, message: 'rollback en curso' };
    }
}

describe('cmpSemver / isNewer', () => {
    it('compara versiones', () => {
        expect(cmpSemver('1.3.0', '1.2.9')).toBe(1);
        expect(cmpSemver('1.2.0', '1.2.0')).toBe(0);
        expect(cmpSemver('v1.2.0', '1.10.0')).toBe(-1);
    });
    it('isNewer ignora null', () => {
        expect(isNewer(null, '1.0.0')).toBe(false);
        expect(isNewer({ version: '2.0.0' } as AppRelease, '1.0.0')).toBe(true);
    });
});

describe('UpdateManager (Postgres + Redis reales, deployer fake)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let repo: ReleasesRepository;
    let deployer: FakeDeployer;
    let manager: UpdateManager;

    const release = (version: string): Parameters<ReleasesRepository['upsert']>[0] => ({
        version,
        channel: 'stable',
        bundleUrl: `https://example.com/imagina-base-${version}.zip`,
        checksum: 'abc123',
        releasedAt: new Date(),
    });

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url });
        repo = new ReleasesRepository(pg.db);
        deployer = new FakeDeployer();
        manager = new UpdateManager(env, redis, deployer, repo);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    beforeEach(async () => {
        await redis.flushall();
        deployer.deployCalls = 0;
        deployer.finalizeCalls = 0;
        deployer.version = '1.0.0';
        deployer.nextResult = { ok: true, message: 'ok', prevRelease: '/prev' };
    });

    it('repo.upsert + latest devuelve el más reciente', async () => {
        await repo.upsert(release('1.0.0'));
        await repo.upsert(release('1.1.0'));
        const latest = await repo.latest('stable');
        expect(latest?.version).toBe('1.1.0');
    });

    it('status: update_available cuando hay una versión mayor', async () => {
        await repo.upsert(release('1.2.0'));
        const s = await manager.status();
        expect(s.current_version).toBe('1.0.0');
        expect(s.update_available).toBe(true);
        expect(s.available?.version).toBe('1.2.0');
    });

    it('update(): deploy ok → marca done + estado restarting + llama finalize', async () => {
        await repo.upsert(release('1.2.0'));
        await manager.update();
        expect(deployer.deployCalls).toBe(1);
        expect(deployer.finalizeCalls).toBe(1); // dispara el reinicio desacoplado
        expect(await redis.get(updateKeys.done('1.2.0'))).toBe('1'); // marcado ANTES de reiniciar
        const run = await manager.run();
        expect(run.status).toBe('restarting');
        expect(run.version).toBe('1.2.0');
    });

    it('update(): idempotente — con marker done ya seteado no re-despliega', async () => {
        await repo.upsert(release('1.2.0'));
        await redis.set(updateKeys.done('1.2.0'), '1');
        await manager.update();
        expect(deployer.deployCalls).toBe(0);
        const run = await manager.run();
        expect(run.status).toBe('success');
    });

    it('update(): lock evita despliegues concurrentes', async () => {
        await repo.upsert(release('1.2.0'));
        await redis.set(updateKeys.lock('1.2.0'), '1'); // otro intento tiene el lock
        await manager.update();
        expect(deployer.deployCalls).toBe(0);
    });

    it('update(): deploy falla → estado failed, sin finalize', async () => {
        await repo.upsert(release('1.2.0'));
        deployer.nextResult = { ok: false, message: 'checksum inválido', prevRelease: null };
        await manager.update();
        expect(deployer.finalizeCalls).toBe(0);
        const run = await manager.run();
        expect(run.status).toBe('failed');
        expect(run.message).toContain('checksum');
    });

    it('self-heal: restarting + la versión servida ya es la target → success', async () => {
        await redis.set(
            updateKeys.state,
            JSON.stringify({ status: 'restarting', version: '1.2.0', message: '…', started_at: new Date().toISOString(), finished_at: null }),
        );
        deployer.version = '1.2.0'; // el API ya sirve la nueva
        const run = await manager.run();
        expect(run.status).toBe('success');
    });

    it('reconcile onModuleInit: restarting + versiones distintas → rolled_back', async () => {
        await redis.set(
            updateKeys.state,
            JSON.stringify({ status: 'restarting', version: '1.2.0', message: '…', started_at: new Date().toISOString(), finished_at: null }),
        );
        deployer.version = '1.0.0'; // volvió al viejo (rollback en finalize)
        await manager.onModuleInit();
        const run = await manager.run();
        expect(run.status).toBe('rolled_back');
    });

    it('rollback(): delega en el deployer y deja estado restarting', async () => {
        const res = await manager.rollback();
        expect(res.ok).toBe(true);
        expect(deployer.rollbackCalls).toBe(1);
        expect((await manager.run()).status).toBe('restarting');
    });
});
