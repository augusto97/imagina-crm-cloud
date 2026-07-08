import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import type { AppRelease } from '@imagina-base/shared';
import type { Env } from '../config/env';
import type { DeployResult, Deployer } from './update.types';

const run = promisify(execFile);

/**
 * Deployer real (ADR-S13): descarga+verifica+extrae el bundle AL LADO del
 * release vivo y hace un flip de symlink atómico; el reinicio+health+rollback
 * lo hace finalize.sh desacoplado. NUNCA sobreescribe los archivos vivos.
 * Deshabilitado si falta UPDATER_BASE_PATH (dev).
 */
@Injectable()
export class SymlinkDeployer implements Deployer {
    private readonly logger = new Logger(SymlinkDeployer.name);

    constructor(private readonly env: Env) {}

    get enabled(): boolean {
        return this.env.UPDATER_BASE_PATH !== '';
    }

    private get base(): string {
        return this.env.UPDATER_BASE_PATH;
    }
    private get current(): string {
        return path.join(this.base, 'current');
    }
    private get healthUrl(): string {
        return `http://127.0.0.1:${this.env.PORT}/api/v1/health/ready`;
    }

    currentVersion(): string {
        try {
            if (this.enabled) return readFileSync(path.join(this.current, 'VERSION'), 'utf8').trim();
        } catch {
            /* sin VERSION */
        }
        return 'dev';
    }

    async deploy(release: AppRelease): Promise<DeployResult> {
        if (!this.enabled) {
            return { ok: false, message: 'Updater deshabilitado (falta UPDATER_BASE_PATH)', prevRelease: null };
        }
        // Fail-closed: sin checksum no se instala código sin verificar (gotcha #4).
        if (!release.checksum) {
            return { ok: false, message: 'El release no trae checksum .sha256; instalación rechazada', prevRelease: null };
        }

        const shared = path.join(this.base, 'shared');
        const releasesDir = path.join(this.base, 'releases');
        const stamp = stampNow();
        const releaseDir = path.join(releasesDir, `${stamp}_${release.version}`);
        const zipPath = path.join(releasesDir, `${stamp}_${release.version}.zip`);
        const prevRelease = existsSync(this.current) ? safeReadlink(this.current) : null;

        try {
            // 1. Backup de BD (best-effort).
            await this.backup(shared).catch((e) => this.logger.warn(`Backup falló (sigo): ${String(e)}`));

            // 2. Descargar el ZIP (con token si el repo es privado).
            await this.download(release.bundle_url, zipPath);

            // 3. Verificar SHA-256 (fail-closed).
            const actual = await this.sha256(zipPath);
            if (actual.toLowerCase() !== release.checksum.toLowerCase()) {
                return { ok: false, message: `Checksum no coincide (esperado ${release.checksum.slice(0, 12)}…)`, prevRelease };
            }

            // 4. Extraer.
            await run('mkdir', ['-p', releaseDir]);
            await run('unzip', ['-q', '-o', zipPath, '-d', releaseDir]);
            await run('rm', ['-f', zipPath]);

            // 5. deploy.sh: link shared + migrate + FLIP atómico.
            await run('bash', [path.join(releaseDir, 'deploy', 'deploy.sh')], {
                env: { ...process.env, BASE_PATH: this.base, RELEASE_DIR: releaseDir },
            });

            return { ok: true, message: `Release ${release.version} desplegado`, prevRelease };
        } catch (err) {
            return { ok: false, message: `Fallo en deploy: ${String(err instanceof Error ? err.message : err)}`, prevRelease };
        }
    }

    finalize(prevRelease: string | null, targetVersion: string): void {
        if (!this.enabled) return;
        // Desacoplado: sobrevive al reinicio del API que él mismo dispara.
        const child = spawn('bash', [path.join(this.current, 'deploy', 'finalize.sh')], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                BASE_PATH: this.base,
                PREV_RELEASE: prevRelease ?? '',
                HEALTH_URL: this.healthUrl,
                UPDATER_KEEP_RELEASES: String(this.env.UPDATER_KEEP_RELEASES),
            },
        });
        child.unref();
        this.logger.log(`finalize.sh lanzado (target ${targetVersion})`);
    }

    rollback(): { ok: boolean; message: string } {
        if (!this.enabled) return { ok: false, message: 'Updater deshabilitado' };
        const releasesDir = path.join(this.base, 'releases');
        const currentTarget = safeReadlink(this.current);
        // Releases ordenados por nombre (timestamp) desc; el previo es el que no
        // es el activo.
        let dirs: string[];
        try {
            dirs = readdirSync(releasesDir)
                .map((d) => path.join(releasesDir, d))
                .filter((p) => existsSync(path.join(p, 'apps', 'api', 'dist')))
                .sort()
                .reverse();
        } catch {
            return { ok: false, message: 'No se pudo listar releases' };
        }
        const prev = dirs.find((d) => d !== currentTarget);
        if (!prev) return { ok: false, message: 'No hay un release anterior al cual volver' };

        const child = spawn('bash', [path.join(this.current, 'deploy', 'finalize.sh')], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                BASE_PATH: this.base,
                PREV_RELEASE: prev,
                HEALTH_URL: this.healthUrl,
                FORCE_ROLLBACK: '1',
            },
        });
        child.unref();
        return { ok: true, message: `Rollback a ${path.basename(prev)} en curso` };
    }

    private async backup(shared: string): Promise<void> {
        const script = path.join(this.current, 'deploy', 'backup.sh');
        if (!existsSync(script)) return;
        await run('bash', [script, path.join(shared, 'backups')], {
            env: { ...process.env, DATABASE_URL: this.env.DATABASE_URL, BACKUP_RETENTION_DAYS: '30' },
        });
    }

    private async download(url: string, dest: string): Promise<void> {
        const args = ['-fL', '--retry', '3', '-o', dest];
        if (this.env.UPDATER_GITHUB_TOKEN) {
            args.push('-H', `Authorization: Bearer ${this.env.UPDATER_GITHUB_TOKEN}`, '-H', 'Accept: application/octet-stream');
        }
        args.push(url);
        await run('curl', args);
    }

    private async sha256(file: string): Promise<string> {
        const { stdout } = await run('sha256sum', [file]);
        return stdout.trim().split(/\s+/)[0] ?? '';
    }
}

function stampNow(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
function safeReadlink(link: string): string | null {
    try {
        return readlinkSync(link);
    } catch {
        return null;
    }
}
