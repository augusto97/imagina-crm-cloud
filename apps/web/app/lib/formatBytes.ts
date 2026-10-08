import { formatNumber } from '@/lib/tenantFormat';

/**
 * v0.1.268 — «1.2 MB» / «1,2 MB» con los separadores de la empresa. Un decimal
 * por debajo de 100 de la unidad; desde ahí, sin decimales.
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 1024) return `${formatNumber(Math.max(0, Math.round(bytes || 0)))} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
    }
    return `${formatNumber(Number(v.toFixed(v >= 100 ? 0 : 1)))} ${units[i]}`;
}
