import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { UpdateRun, UpdateStatus } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { ReleasesRepository } from './releases.repository';
import { DEPLOYER, type Deployer, isNewer, updateKeys } from './update.types';

const STUCK_MS = 20 * 60 * 1000; // 20 min → auto-sanar un run colgado
const idleRun: UpdateRun = { status: 'idle', version: null, message: null, started_at: null, finished_at: null };

/**
 * Orquestación de la auto-actualización (ADR-S13). Estado del run en Redis
 * (compartido y sobrevive al flip del symlink); lock + marker `done` para
 * re-entrancia; auto-sanación de runs colgados. La lógica destructiva vive en
 * el Deployer.
 */
@Injectable()
export class UpdateManager implements OnModuleInit {
    private readonly logger = new Logger(UpdateManager.name);

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(DEPLOYER) private readonly deployer: Deployer,
        private readonly releases: ReleasesRepository,
    ) {}

    /** Al bootear: si veníamos de un reinicio de update, resolvé el resultado. */
    async onModuleInit(): Promise<void> {
        const run = await this.readRun();
        if (run.status === 'restarting') {
            const resolved: UpdateRun =
                this.deployer.currentVersion() === run.version
                    ? { ...run, status: 'success', message: 'Actualización aplicada', finished_at: nowISO() }
                    : { ...run, status: 'rolled_back', message: 'Health-check falló; se revirtió', finished_at: nowISO() };
            await this.writeRun(resolved);
            this.logger.log(`Reconciliado post-reinicio: ${resolved.status}`);
        }
    }

    currentVersion(): string {
        return this.deployer.currentVersion();
    }

    async status(): Promise<UpdateStatus> {
        const current = this.currentVersion();
        const available = await this.releases.latest(this.env.UPDATER_CHANNEL);
        return {
            current_version: current,
            available,
            update_available: isNewer(available, current),
            run: await this.run(),
        };
    }

    /** Estado del run con auto-sanación de colgados (gotcha #7). */
    async run(): Promise<UpdateRun> {
        const run = await this.readRun();
        if (run.status === 'restarting' && this.currentVersion() === run.version) {
            const healed: UpdateRun = { ...run, status: 'success', message: 'Actualización aplicada', finished_at: nowISO() };
            await this.writeRun(healed);
            return healed;
        }
        if ((run.status === 'running' || run.status === 'restarting') && stuck(run.started_at)) {
            const healed: UpdateRun = { ...run, status: 'failed', message: 'El proceso quedó colgado', finished_at: nowISO() };
            await this.writeRun(healed);
            return healed;
        }
        return run;
    }

    async markQueued(version: string): Promise<void> {
        await this.writeRun({ status: 'queued', version, message: 'En cola', started_at: nowISO(), finished_at: null });
    }

    async markFailed(message: string): Promise<void> {
        const run = await this.readRun();
        await this.writeRun({ ...run, status: 'failed', message, finished_at: nowISO() });
    }

    /** El corazón: lo llama el RunUpdateJob (dentro del worker in-process). */
    async update(): Promise<void> {
        const release = await this.releases.latest(this.env.UPDATER_CHANNEL);
        if (!release) {
            await this.writeRun({ ...idleRun, status: 'failed', message: 'No hay release disponible', finished_at: nowISO() });
            return;
        }
        const version = release.version;

        // Marker `done`: una repetición confirma éxito (idempotencia, gotcha #3).
        if ((await this.redis.get(updateKeys.done(version))) === '1') {
            await this.writeRun({ status: 'success', version, message: 'Ya instalado', started_at: null, finished_at: nowISO() });
            return;
        }
        // Lock: si otro intento ya despliega, no hacer nada.
        const got = await this.redis.set(updateKeys.lock(version), '1', 'EX', 1800, 'NX');
        if (got !== 'OK') {
            this.logger.warn(`Update ${version} ya en curso (lock tomado)`);
            return;
        }
        try {
            await this.writeRun({ status: 'running', version, message: 'Instalando…', started_at: nowISO(), finished_at: null });
            const result = await this.deployer.deploy(release);
            if (result.ok) {
                // Marcar `done` + `restarting` ANTES de reiniciar (gotcha #2): el
                // finalize mata este proceso; el estado ya quedó persistido.
                await this.redis.set(updateKeys.done(version), '1');
                await this.writeRun({ status: 'restarting', version, message: 'Reiniciando y verificando…', started_at: nowISO(), finished_at: null });
                this.deployer.finalize(result.prevRelease, version); // detached: reinicia el API
            } else {
                await this.writeRun({ status: 'failed', version, message: result.message, started_at: null, finished_at: nowISO() });
            }
        } finally {
            await this.redis.del(updateKeys.lock(version));
        }
    }

    /** Rollback manual al release anterior (botón del panel). */
    async rollback(): Promise<{ ok: boolean; message: string }> {
        const res = this.deployer.rollback();
        if (res.ok) {
            await this.writeRun({ status: 'restarting', version: null, message: res.message, started_at: nowISO(), finished_at: null });
        }
        return res;
    }

    private async readRun(): Promise<UpdateRun> {
        const raw = await this.redis.get(updateKeys.state);
        if (!raw) return idleRun;
        try {
            return JSON.parse(raw) as UpdateRun;
        } catch {
            return idleRun;
        }
    }

    private async writeRun(run: UpdateRun): Promise<void> {
        await this.redis.set(updateKeys.state, JSON.stringify(run));
    }
}

function nowISO(): string {
    return new Date().toISOString();
}
function stuck(startedAt: string | null): boolean {
    if (!startedAt) return false;
    return Date.now() - new Date(startedAt).getTime() > STUCK_MS;
}
