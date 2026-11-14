import { describe, expect, it } from 'vitest';

import { agoText, checkTone, guardianChecks, heartbeatProvider, severityVariant } from './serverWatch';

describe('serverWatch (v0.1.431)', () => {
    it('las filas del guardián van con la entrada por el dominio primero y el disco con lo libre', () => {
        const rows = guardianChecks(
            {
                version: 1,
                updated_at: '2026-11-14T12:00:00Z',
                domain: 'base.acme.co',
                web_mode: 'serveravatar',
                requested: false,
                current_release: 'r',
                checks: {
                    api: 'ok',
                    database: 'ok',
                    redis: 'ok',
                    web_server: 'ok',
                    front: 'down',
                    disk: { ok: false, free_bytes: 500, total_bytes: 1000, free_inodes: 1, total_inodes: 2 },
                },
                rescue: { enabled: true, port: 8899, cert: 'domain', active: true },
                last_action: null,
            },
            (b) => `${b} B`,
        );
        expect(rows.map((r) => r.key)).toEqual(['front', 'api', 'database', 'redis', 'web_server', 'disk']);
        expect(rows[0]).toMatchObject({ state: 'down', detail: 'base.acme.co' });
        expect(rows[4]!.label).toBe('Nginx (ServerAvatar)');
        expect(rows[5]).toMatchObject({ state: 'down', detail: '500 B libres' });
    });

    it('tonos, gravedad, «hace…» y el servicio del latido', () => {
        expect(checkTone('ok')).toBe('ok');
        expect(checkTone('cert')).toBe('bad');
        expect(checkTone('updating')).toBe('wait');
        expect(checkTone('skipped')).toBe('none');
        expect(severityVariant('critical')).toBe('destructive');
        const now = Date.parse('2026-11-14T12:00:00Z');
        expect(agoText('2026-11-14T11:59:30Z', now)).toBe('hace un momento');
        expect(agoText('2026-11-14T11:40:00Z', now)).toBe('hace 20 min');
        expect(agoText('2026-11-11T12:00:00Z', now)).toBe('hace 3 días');
        expect(agoText(null, now)).toBe('—');
        expect(heartbeatProvider('https://uptime.betterstack.com/api/v1/heartbeat/x')).toBe('Better Stack');
        expect(heartbeatProvider('https://hc-ping.com/abc')).toBe('Healthchecks.io');
        expect(heartbeatProvider('https://ejemplo.com/x')).toBeNull();
    });
});
