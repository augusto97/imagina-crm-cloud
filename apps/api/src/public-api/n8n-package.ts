import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.1.443 (G2) — La app de n8n (`integrations/n8n`) viaja en cada release ya
 * empaquetada (`npm pack`): así un n8n instalado en un servidor propio la
 * instala desde ESTA app, sin depender de que esté publicada en npm:
 *
 *   cd ~/.n8n/nodes && npm install https://<app>/api/v1/public/n8n/n8n-nodes-imagina-base.tgz
 *
 * En desarrollo no hay paquete (se arma con `npm pack` en el release): la
 * ruta responde 404 y la pantalla muestra sólo el nombre del paquete de npm.
 */

export const N8N_PACKAGE = 'n8n-nodes-imagina-base';
export const N8N_TARBALL = `${N8N_PACKAGE}.tgz`;
/** Un paquete de más de 5 MB es un error de empaquetado: no se reparte. */
const MAX_BYTES = 5 * 1024 * 1024;

export function n8nDirCandidates(): string[] {
    const rel = path.join('integrations', 'n8n');
    return [
        // <release>/apps/api/dist/public-api → <release>/integrations/n8n (y lo mismo desde el repo)
        path.resolve(__dirname, '../../../..', rel),
        path.resolve(process.cwd(), '../..', rel),
        path.resolve(process.cwd(), rel),
    ];
}

export interface N8nPackageInfo {
    package: string;
    /** Versión del paquete (`null` si este servidor no lo trae). */
    version: string | null;
    /** `true` si este servidor lo reparte (`GET /public/n8n/<paquete>.tgz`). */
    available: boolean;
}

interface Found {
    version: string | null;
    tarball: string | null;
}

function find(dirs: string[]): Found {
    for (const dir of dirs) {
        const pkg = path.join(dir, 'package.json');
        if (!existsSync(pkg)) continue;
        let version: string | null = null;
        try {
            const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: unknown; version?: unknown };
            if (parsed.name !== N8N_PACKAGE) continue;
            version = typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version) ? parsed.version : null;
        } catch {
            continue;
        }
        const tgz = path.join(dir, N8N_TARBALL);
        const ok = existsSync(tgz) && statSync(tgz).isFile() && statSync(tgz).size > 0 && statSync(tgz).size <= MAX_BYTES;
        return { version, tarball: ok ? tgz : null };
    }
    return { version: null, tarball: null };
}

/** Lo que sabe la app del paquete que reparte. */
export function n8nPackageInfo(dirs = n8nDirCandidates()): N8nPackageInfo {
    const f = find(dirs);
    return { package: N8N_PACKAGE, version: f.version, available: !!f.tarball };
}

let cache: { path: string; mtime: number; bytes: Buffer } | null = null;

/** Los bytes del paquete (`null` si este servidor no lo trae). */
export function n8nTarball(dirs = n8nDirCandidates()): { bytes: Buffer; filename: string } | null {
    const f = find(dirs);
    if (!f.tarball) return null;
    const mtime = statSync(f.tarball).mtimeMs;
    if (!cache || cache.path !== f.tarball || cache.mtime !== mtime) cache = { path: f.tarball, mtime, bytes: readFileSync(f.tarball) };
    return { bytes: cache.bytes, filename: f.version ? `${N8N_PACKAGE}-${f.version}.tgz` : N8N_TARBALL };
}
