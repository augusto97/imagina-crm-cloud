import type { TenantFormat } from './tenant';

/**
 * v0.1.412 — Número con los separadores de la empresa, sin dependencias (la
 * página pública de la tienda no carga zod). Igual que `groupNumber` de los
 * correos y PDF.
 */
export function groupNumberPlain(n: number, decimals: number | null, format: TenantFormat['number_format']): string {
    const fixed = decimals === null ? String(Math.round(n * 1e6) / 1e6) : n.toFixed(decimals);
    const negative = fixed.startsWith('-');
    const [int, dec] = (negative ? fixed.slice(1) : fixed).split('.');
    const thousands = format === 'dot_comma' ? '.' : format === 'space_comma' ? ' ' : ',';
    const decimal = format === 'comma_dot' ? '.' : ',';
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return `${negative ? '-' : ''}${grouped}${dec ? decimal + dec : ''}`;
}
