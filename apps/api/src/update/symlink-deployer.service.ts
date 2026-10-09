import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import type { AppRelease } from '@imagina-base/shared';
import type { Env } from '../config/env';
import type { DeployResult, Deployer } from './update.types';
import { verifyDetachedSignature } from './verify-signature';
import { LayoutDisk, MIN_FREE_INODES, freeBytes, freeInodes, spaceProblem } from './disk-space';

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

    /** v0.1.278 — limpieza y medición del disco del layout. */
    get disk(): LayoutDisk {
        return new LayoutDisk(this.base, this.env.UPDATER_KEEP_RELEASES);
    }

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

        // v0.1.278 — antes de descargar nada: si el disco no alcanza, primero
        // se limpia lo que sobra (zips y extracciones cortadas, releases y
        // copias viejas) y, si igual no alcanza, se corta con el número a la
        // vista. Antes se descomprimía a ciegas y un disco lleno dejaba basura
        // que llenaba más el siguiente intento.
        const minFree = this.env.UPDATER_MIN_FREE_MB * 1024 * 1024;
        try {
            // Bytes Y archivos (inodos): un disco puede quedarse sin inodos con
            // GB libres y el error es el mismo «No space left on device».
            if (spaceProblem(freeBytes(this.base), freeInodes(this.base), minFree)) {
                const freed = await this.disk.cleanup();
                this.logger.warn(
                    `Poco espacio antes de actualizar: se liberaron ${mb(freed.freed)} MB y ${freed.freedInodes} archivos (${freed.removed.length} elementos)`,
                );
            }
            const { free } = freeBytes(this.base);
            const inodes = freeInodes(this.base);
            const problem = spaceProblem({ free }, inodes, minFree);
            if (problem === 'bytes') {
                return {
                    ok: false,
                    message: `No hay espacio en disco para actualizar: quedan ${mb(free)} MB libres y hacen falta al menos ${mb(minFree)} MB. Liberá espacio (Plataforma → Diagnóstico → Disco) y probá de nuevo.`,
                    prevRelease,
                };
            }
            if (problem === 'inodes' && inodes) {
                return {
                    ok: false,
                    message: `El disco tiene ${mb(free)} MB libres pero se quedó sin lugar para más ARCHIVOS (inodos): quedan ${inodes.free} y una versión necesita unos ${MIN_FREE_INODES}. Hay que borrar archivos sueltos del servidor (ver docs/runbook-disk.md, «Sin inodos»).`,
                    prevRelease,
                };
            }
        } catch (err) {
            this.logger.warn(`No se pudo medir el espacio libre (sigo): ${String(err)}`);
        }

        try {
            // 1. Backup de BD (best-effort).
            await this.backup(shared).catch((e) => this.logger.warn(`Backup falló (sigo): ${String(e)}`));

            // 2. Descargar el ZIP (con token si el repo es privado).
            await this.download(release.bundle_url, zipPath);

            // 3. Verificar SHA-256 (fail-closed).
            const actual = await this.sha256(zipPath);
            if (actual.toLowerCase() !== release.checksum.toLowerCase()) {
                await run('rm', ['-f', zipPath]).catch(() => undefined);
                return { ok: false, message: `Checksum no coincide (esperado ${release.checksum.slice(0, 12)}…)`, prevRelease };
            }

            // 3b. Verificar FIRMA (SEC-12, opt-in). Con clave pública configurada,
            // además del checksum se exige una firma detached válida del zip
            // (asset `<bundle>.zip.sig`). Fail-closed si falta o no valida.
            if (this.env.UPDATER_PUBLIC_KEY) {
                const sigPath = `${zipPath}.sig`;
                try {
                    await this.download(`${release.bundle_url}.sig`, sigPath);
                } catch {
                    return { ok: false, message: 'Verificación de firma activada pero el release no trae .sig', prevRelease };
                }
                const validSig = await verifyDetachedSignature(zipPath, sigPath, this.env.UPDATER_PUBLIC_KEY);
                await run('rm', ['-f', sigPath]).catch(() => undefined);
                if (!validSig) {
                    return { ok: false, message: 'La firma del release no es válida; instalación rechazada', prevRelease };
                }
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
            // v0.1.278 — no dejar basura: un unzip cortado (disco lleno) dejaba
            // el zip y la carpeta a medio extraer, y el reintento llenaba más.
            await run('rm', ['-rf', releaseDir, zipPath, `${zipPath}.sig`]).catch(() => undefined);
            const raw = String(err instanceof Error ? err.message : err);
            const full = /No space left on device|ENOSPC/i.test(raw);
            let outOfInodes = false;
            try {
                outOfInodes = spaceProblem(freeBytes(this.base), freeInodes(this.base), minFree) === 'inodes';
            } catch {
                /* sin medición */
            }
            return {
                ok: false,
                message: !full
                    ? `Fallo en deploy: ${raw.slice(0, 600)}`
                    : outOfInodes
                      ? 'El servidor se quedó sin lugar para más ARCHIVOS (inodos) durante la actualización, aunque tenga espacio en GB. Se borró lo que quedó a medias; ver docs/runbook-disk.md, «Sin inodos».'
                      : 'El disco del servidor se llenó durante la actualización. Se borró lo que quedó a medias; liberá espacio (Plataforma → Diagnóstico → Disco) y probá de nuevo.',
                prevRelease,
            };
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

    async prune(): Promise<{ removed: string[] }> {
        if (!this.enabled) return { removed: [] };
        const out = await this.disk.cleanup();
        return { removed: out.removed };
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
            // v0.1.278 — una copia por actualización: quedan las 5 más nuevas
            // (con muchas actualizaciones por día, 30 días eran cientos).
            env: { ...process.env, DATABASE_URL: this.env.DATABASE_URL, BACKUP_RETENTION_DAYS: '30', BACKUP_KEEP: '5' },
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

function mb(bytes: number): number {
    return Math.round(bytes / 1024 / 1024);
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
