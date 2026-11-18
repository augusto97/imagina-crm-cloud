import {
    INTEGRATIONS,
    USAGE_GROUPS,
    USAGE_MODULES,
    type PlatformUsage,
    type PlatformUsageApp,
    type PlatformUsageModule,
    type UsageGroup,
    type UsageModuleInfo,
} from '@imagina-base/shared';

import { formatNumber } from '@/lib/tenantFormat';

/**
 * v0.1.437 — Piezas puras de Plataforma → Uso: qué filas se ven con cada
 * filtro, cómo se agrupan y cómo se nombra cada app.
 */

export type UsageFilter = 'all' | 'used' | 'unused';

export interface UsageRowView {
    info: UsageModuleInfo;
    data: PlatformUsageModule;
}

export interface UsageGroupView {
    key: UsageGroup;
    label: string;
    rows: UsageRowView[];
}

/** Los módulos agrupados como en el catálogo, con el filtro aplicado (sin grupos vacíos). */
export function usageGroups(summary: PlatformUsage, filter: UsageFilter): UsageGroupView[] {
    const byKey = new Map(summary.modules.map((m) => [m.key, m]));
    return USAGE_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        rows: USAGE_MODULES.filter((info) => info.group === g.key)
            .map((info) => ({ info, data: byKey.get(info.key) }))
            .filter((r): r is UsageRowView => r.data !== undefined)
            .filter((r) => (filter === 'used' ? r.data.tenants_using > 0 : filter === 'unused' ? r.data.tenants_using === 0 : true)),
    })).filter((g) => g.rows.length > 0);
}

/** Cuántos módulos usa al menos una empresa. */
export function modulesInUse(summary: PlatformUsage): number {
    return summary.modules.filter((m) => m.tenants_using > 0).length;
}

/** El nombre de una app conectada (`http` es la API personalizada). */
export function usageAppName(key: string): string {
    if (key === 'http') return 'API personalizada';
    return INTEGRATIONS.find((i) => i.key === key)?.name ?? key;
}

/** Las apps de la que más empresas usan a la que menos (empate: más conexiones, después el nombre). */
export function sortedApps(apps: readonly PlatformUsageApp[]): PlatformUsageApp[] {
    return [...apps].sort((a, b) => b.tenants - a.tenants || b.connections - a.connections || usageAppName(a.key).localeCompare(usageAppName(b.key), 'es'));
}

/** «3 activas», «1.240 corridas»: un número con lo que cuenta. */
export function countText(n: number, label: string): string {
    return `${formatNumber(n)} ${label}`;
}

/** El porcentaje de empresas que lo usan, redondeado (0 si no hay empresas). */
export function usageShare(using: number, live: number): number {
    if (live <= 0) return 0;
    return Math.round((using / live) * 100);
}
