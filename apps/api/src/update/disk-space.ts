import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statfsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * v0.1.278 — Espacio en disco del layout de releases. Nació de un servidor
 * que se llenó: cada actualización deja una copia de la base (pg_dump), se
 * guardaban 5 versiones con sus node_modules, y un deploy que fallaba dejaba
 * el zip y la carpeta a medio extraer — que nadie borraba y llenaban más.
 *
 * La decisión de QUÉ borrar es pura (`planCleanup`) y se testea sin disco.
 * Nunca toca: el release activo, `shared/uploads`, ni las copias manuales o
 * diarias (`imagina-snapshot-*`, ADR-S20, tienen su propia retención).
 */

export interface ReleaseEntry {
    name: string;
    isDir: boolean;
    /** Tiene `apps/api/dist` (un release completo, no uno a medio extraer). */
    complete: boolean;
}

export interface CleanupPlan {
    /** Rutas relativas a `releases/`. */
    releases: string[];
    /** Rutas relativas a `shared/backups/`. */
    dumps: string[];
}

/**
 * Qué sobra en `releases/` y en las copias previas a cada actualización.
 * - zips y firmas sueltas (de una descarga cortada) → fuera;
 * - carpetas incompletas (un unzip cortado) → fuera, salvo la activa;
 * - releases completos: quedan el activo + los `keep - 1` más nuevos;
 * - copias `imagina-base-*.dump*`: quedan las `keepDumps` más nuevas.
 */
export function planCleanup(
    entries: readonly ReleaseEntry[],
    currentName: string | null,
    keep: number,
    dumps: readonly string[],
    keepDumps: number,
): CleanupPlan {
    const releases: string[] = [];
    const complete: string[] = [];
    for (const e of entries) {
        if (e.name === currentName) continue;
        if (!e.isDir) {
            if (/\.(zip|sig)$/.test(e.name)) releases.push(e.name);
            continue;
        }
        if (!e.complete) releases.push(e.name);
        else complete.push(e.name);
    }
    // Los nombres empiezan con el timestamp UTC: el orden alfabético es el cronológico.
    complete.sort().reverse();
    releases.push(...complete.slice(Math.max(0, keep - 1)));
    const sortedDumps = dumps.filter((d) => /^imagina-base-.*\.dump/.test(d)).sort().reverse();
    return { releases, dumps: sortedDumps.slice(Math.max(0, keepDumps)) };
}

export function freeBytes(dir: string): { free: number; total: number } {
    const s = statfsSync(dir);
    return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
}

/**
 * Inodos: la cantidad de ARCHIVOS que el disco puede tener, aparte de los
 * bytes. Una versión trae ~36.000 archivos (node_modules), así que un disco
 * puede quedarse sin inodos con decenas de GB libres — y el error es el mismo
 * «No space left on device». `null` si el sistema de archivos no tiene un
 * tope fijo (btrfs/xfs dinámico informan 0).
 */
export function freeInodes(dir: string): { free: number; total: number } | null {
    const s = statfsSync(dir);
    const total = Number(s.files);
    if (!total) return null;
    return { free: Number(s.ffree), total };
}

/** Una versión trae ~36.000 archivos; con margen para la copia y lo demás. */
export const MIN_FREE_INODES = 60_000;

/** Qué falta para instalar una versión: bytes, archivos (inodos) o nada. */
export function spaceProblem(
    bytes: { free: number },
    inodes: { free: number } | null,
    minBytes: number,
    minInodes = MIN_FREE_INODES,
): 'bytes' | 'inodes' | null {
    if (bytes.free < minBytes) return 'bytes';
    if (inodes !== null && inodes.free < minInodes) return 'inodes';
    return null;
}

export async function dirBytes(dir: string): Promise<number | null> {
    if (!existsSync(dir)) return 0;
    try {
        const { stdout } = await run('du', ['-sb', dir], { timeout: 60_000 });
        return Number(stdout.trim().split(/\s+/)[0]) || 0;
    } catch {
        return null;
    }
}

export class LayoutDisk {
    constructor(
        private readonly base: string,
        private readonly keep: number,
        private readonly keepDumps = 5,
    ) {}

    get releasesDir(): string {
        return path.join(this.base, 'releases');
    }
    get backupsDir(): string {
        return path.join(this.base, 'shared', 'backups');
    }

    currentName(): string | null {
        try {
            return path.basename(realpathSync(path.join(this.base, 'current')));
        } catch {
            return null;
        }
    }

    plan(): CleanupPlan {
        let entries: ReleaseEntry[] = [];
        try {
            entries = readdirSync(this.releasesDir, { withFileTypes: true }).map((d) => ({
                name: d.name,
                isDir: d.isDirectory(),
                complete: d.isDirectory() && existsSync(path.join(this.releasesDir, d.name, 'apps', 'api', 'dist')),
            }));
        } catch {
            entries = [];
        }
        let dumps: string[] = [];
        try {
            dumps = readdirSync(this.backupsDir);
        } catch {
            dumps = [];
        }
        return planCleanup(entries, this.currentName(), this.keep, dumps, this.keepDumps);
    }

    async reclaimable(): Promise<number> {
        const p = this.plan();
        let total = 0;
        for (const r of p.releases) total += (await dirBytes(path.join(this.releasesDir, r))) ?? 0;
        for (const d of p.dumps) total += (await dirBytes(path.join(this.backupsDir, d))) ?? 0;
        return total;
    }

    async cleanup(): Promise<{ freed: number; freedInodes: number; removed: string[] }> {
        const before = freeBytes(this.base).free;
        const beforeInodes = freeInodes(this.base)?.free ?? 0;
        const p = this.plan();
        const removed: string[] = [];
        for (const r of p.releases) {
            await rm(path.join(this.releasesDir, r), { recursive: true, force: true }).catch(() => undefined);
            removed.push(`releases/${r}`);
        }
        for (const d of p.dumps) {
            await rm(path.join(this.backupsDir, d), { force: true }).catch(() => undefined);
            removed.push(`shared/backups/${d}`);
        }
        return {
            freed: Math.max(0, freeBytes(this.base).free - before),
            freedInodes: Math.max(0, (freeInodes(this.base)?.free ?? 0) - beforeInodes),
            removed,
        };
    }
}
