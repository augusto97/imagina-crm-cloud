import type { AppRelease } from '@imagina-base/shared';

/** Resultado de la fase previa al reinicio (backup + descarga + migrate + flip). */
export interface DeployResult {
    ok: boolean;
    message: string;
    /** Ruta del release anterior (para rollback en finalize). */
    prevRelease: string | null;
}

/**
 * Pasarela de despliegue intercambiable (ADR-S13). En producción es
 * `SymlinkDeployer`; en tests un fake (nunca se despliega de verdad en CI).
 */
export interface Deployer {
    readonly enabled: boolean;
    /** Versión que corre AHORA (lee VERSION del release activo). */
    currentVersion(): string;
    /** Backup + descarga + verificación + extracción + migrate + FLIP. No reinicia. */
    deploy(release: AppRelease): Promise<DeployResult>;
    /** Reinicio + health-check + rollback, DESACOPLADO (spawn detached). */
    finalize(prevRelease: string | null, targetVersion: string): void;
    /** Rollback manual al release anterior (desde el panel). */
    rollback(): { ok: boolean; message: string };
}

export const DEPLOYER = Symbol('DEPLOYER');
export const UPDATE_QUEUE = 'app-update';

/** Claves de estado en Redis (compartidas web/worker, sobreviven al flip). */
export const updateKeys = {
    state: 'imagina:update:state',
    lock: (version: string) => `imagina:update:lock:${version}`,
    done: (version: string) => `imagina:update:done:${version}`,
};

export function isNewer(available: AppRelease | null, current: string): boolean {
    if (!available) return false;
    return cmpSemver(available.version, current) > 0;
}

/** Compara `a` vs `b` (semver simple x.y.z, ignora sufijos). >0 si a es mayor. */
export function cmpSemver(a: string, b: string): number {
    const norm = (v: string) =>
        v
            .replace(/^v/, '')
            .split('-')[0]!
            .split('.')
            .map((n) => parseInt(n, 10) || 0);
    const pa = norm(a);
    const pb = norm(b);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
}
