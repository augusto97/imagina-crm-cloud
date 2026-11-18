import { describe, expect, it } from 'vitest';
import { USAGE_MODULE_KEYS, type PlatformUsage } from '@imagina-base/shared';

import { modulesInUse, sortedApps, usageAppName, usageGroups, usageShare } from './usageView';

/** v0.1.437 — Plataforma → Uso: filtros, grupos y nombres de las apps. */
function summary(using: Partial<Record<string, number>>): PlatformUsage {
    return {
        generated_at: '2026-11-18T12:00:00.000Z',
        days: 30,
        tenants_live: 4,
        modules: USAGE_MODULE_KEYS.map((key) => ({
            key,
            tenants_using: using[key] ?? 0,
            tenants_active: 0,
            total: using[key] ?? 0,
            activity: null,
            last_at: null,
            disabled_in_plans: [],
        })),
        apps: [],
        unmeasured: [],
    };
}

describe('uso por módulo', () => {
    it('agrupa como el catálogo y el filtro deja sólo lo usado o lo que nadie usa (sin grupos vacíos)', () => {
        const s = summary({ automations: 2, sms: 1 });
        const all = usageGroups(s, 'all');
        expect(all.map((g) => g.key)).toEqual(['work', 'receive', 'connect', 'team']);
        expect(all.flatMap((g) => g.rows).length).toBe(USAGE_MODULE_KEYS.length);

        const used = usageGroups(s, 'used');
        expect(used.map((g) => g.key)).toEqual(['work', 'connect']);
        expect(used.flatMap((g) => g.rows.map((r) => r.info.key))).toEqual(['automations', 'sms']);

        const unused = usageGroups(s, 'unused').flatMap((g) => g.rows.map((r) => r.info.key));
        expect(unused).not.toContain('automations');
        expect(unused.length).toBe(USAGE_MODULE_KEYS.length - 2);
        expect(modulesInUse(s)).toBe(2);
    });

    it('nombra las apps por el catálogo, la API personalizada y lo desconocido tal cual', () => {
        expect(usageAppName('http')).toBe('API personalizada');
        expect(usageAppName('whatsapp_web')).toBe('WhatsApp (Whats)');
        expect(usageAppName('algo_nuevo')).toBe('algo_nuevo');
        expect(
            sortedApps([
                { key: 'http', tenants: 1, connections: 4 },
                { key: 'sms_twilio', tenants: 3, connections: 3 },
                { key: 'whatsapp_web', tenants: 1, connections: 9 },
            ]).map((a) => a.key),
        ).toEqual(['sms_twilio', 'whatsapp_web', 'http']);
    });

    it('el porcentaje de empresas no divide por cero', () => {
        expect(usageShare(1, 4)).toBe(25);
        expect(usageShare(0, 0)).toBe(0);
    });
});
