import Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { periodOf } from '../src/mail/email-quota.service';
import { PlansService } from '../src/billing/plans.service';
import { PlatformUsageService } from '../src/platform/platform-usage.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.437 — Plataforma → Uso: qué empresa usa qué y cuánto, calculado de una
 * vez sobre la base (sin RLS) y guardado unos minutos en Redis.
 */
describe('uso por módulo', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let usage: PlatformUsageService;
    const ids = { a: 0, b: 0, archived: 0 };

    const one = async <T>(q: ReturnType<typeof sql>): Promise<T> => {
        const res = (await pg.db.execute(q)) as unknown as { rows: T[] };
        return res.rows[0]!;
    };

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        usage = new PlatformUsageService(pg.db, new PlansService(pg.db), redis);

        ids.a = Number((await one<{ id: number }>(sql`INSERT INTO tenants (slug, name, plan) VALUES ('usa-a', 'Empresa A', 'pro') RETURNING id`)).id);
        ids.b = Number((await one<{ id: number }>(sql`INSERT INTO tenants (slug, name, plan) VALUES ('usa-b', 'Empresa B', 'trial') RETURNING id`)).id);
        ids.archived = Number((await one<{ id: number }>(sql`INSERT INTO tenants (slug, name, plan, archived_at) VALUES ('usa-c', 'Archivada', 'pro', now()) RETURNING id`)).id);

        // A: una automatización activa (y una pausada) con 3 corridas recientes y una vieja.
        const list = await one<{ id: number }>(sql`INSERT INTO lists (tenant_id, slug, name) VALUES (${ids.a}, 'clientes', 'Clientes') RETURNING id`);
        const auto = await one<{ id: number }>(
            sql`INSERT INTO automations (tenant_id, list_id, name, trigger_type, is_active) VALUES (${ids.a}, ${list.id}, 'Bienvenida', 'record_created', true) RETURNING id`,
        );
        await pg.db.execute(sql`INSERT INTO automations (tenant_id, list_id, name, trigger_type, is_active) VALUES (${ids.a}, ${list.id}, 'Pausada', 'record_created', false)`);
        for (let i = 0; i < 3; i++) {
            await pg.db.execute(sql`INSERT INTO automation_runs (tenant_id, automation_id, status, created_at) VALUES (${ids.a}, ${auto.id}, 'success', now() - interval '1 day')`);
        }
        await pg.db.execute(sql`INSERT INTO automation_runs (tenant_id, automation_id, status, created_at) VALUES (${ids.a}, ${auto.id}, 'success', now() - interval '40 days')`);

        // A: dos equipos, WhatsApp y SMS conectados, IA de este mes y correos del mes pasado.
        await pg.db.execute(sql`INSERT INTO teams (tenant_id, name) VALUES (${ids.a}, 'Ventas'), (${ids.a}, 'Soporte')`);
        await pg.db.execute(sql`INSERT INTO connections (tenant_id, name, provider) VALUES (${ids.a}, 'Whats', 'whatsapp_web'), (${ids.a}, 'SMS', 'sms_twilio')`);
        await pg.db.execute(sql`INSERT INTO ai_usage (tenant_id, period, requests) VALUES (${ids.a}, ${periodOf(new Date())}, 7)`);
        await pg.db.execute(sql`INSERT INTO email_usage (tenant_id, period, sent) VALUES (${ids.a}, '2000-01', 40)`);

        // B: un rol propio y una API personalizada.
        await pg.db.execute(sql`INSERT INTO custom_roles (tenant_id, name, base_role) VALUES (${ids.b}, 'Contador', 'viewer')`);
        await pg.db.execute(sql`INSERT INTO connections (tenant_id, name, provider) VALUES (${ids.b}, 'Mi API', 'http')`);

        // La archivada: equipos que NO tienen que contar.
        await pg.db.execute(sql`INSERT INTO teams (tenant_id, name) VALUES (${ids.archived}, 'X'), (${ids.archived}, 'Y'), (${ids.archived}, 'Z')`);

        // El plan de prueba apaga la tienda.
        await pg.db.execute(sql`UPDATE plans SET disabled_modules = '["shop"]'::jsonb WHERE slug = 'trial'`);
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('cuenta por módulo cuántas empresas lo usan, cuánto y cuánto en los últimos 30 días (sin las archivadas)', async () => {
        const s = await usage.summary();
        const mod = (k: string) => s.modules.find((m) => m.key === k)!;
        expect(s.tenants_live).toBe(2);
        // Todas las consultas corrieron (una rota saldría acá y en la pantalla).
        expect(s.unmeasured).toEqual([]);
        expect(mod('automations')).toMatchObject({ tenants_using: 1, tenants_active: 1, total: 1, activity: 3 });
        expect(mod('teams')).toMatchObject({ tenants_using: 1, total: 2, activity: null });
        expect(mod('whatsapp')).toMatchObject({ tenants_using: 1, total: 1 });
        expect(mod('sms')).toMatchObject({ tenants_using: 1, total: 1 });
        expect(mod('integrations')).toMatchObject({ tenants_using: 2, total: 3 });
        expect(mod('custom_roles')).toMatchObject({ tenants_using: 1, total: 1 });
        // Sin cantidad: usar = haber tenido actividad (en el mes, para la IA y el correo).
        expect(mod('ai_assistant')).toMatchObject({ tenants_using: 1, activity: 7 });
        expect(mod('email')).toMatchObject({ tenants_using: 0, activity: 0 });
        expect(mod('shop')).toMatchObject({ tenants_using: 0 });
        expect(mod('shop').disabled_in_plans.length).toBe(1);
        expect(s.apps).toEqual(
            expect.arrayContaining([
                { key: 'whatsapp_web', tenants: 1, connections: 1 },
                { key: 'sms_twilio', tenants: 1, connections: 1 },
                { key: 'http', tenants: 1, connections: 1 },
            ]),
        );
    });

    it('el detalle de un módulo lista las empresas que lo usan, y el de una empresa sus módulos', async () => {
        const auto = await usage.module('automations');
        expect(auto.rows).toHaveLength(1);
        expect(auto.rows[0]).toMatchObject({ tenant_id: ids.a, name: 'Empresa A', plan: 'pro', total: 1, activity: 3 });
        expect(auto.rows[0]!.last_at).not.toBeNull();

        const teams = await usage.module('teams');
        expect(teams.rows.map((r) => r.tenant_id)).toEqual([ids.a]);

        const a = await usage.tenant(ids.a);
        expect(a.modules.map((m) => m.key).sort()).toEqual(['ai_assistant', 'automations', 'integrations', 'sms', 'teams', 'whatsapp']);
        const b = await usage.tenant(ids.b);
        expect(b.modules.map((m) => m.key).sort()).toEqual(['custom_roles', 'integrations']);
    });

    it('queda guardado unos minutos; «Actualizar» recalcula, pero no más seguido que cada 30 s', async () => {
        const t0 = new Date(Date.now() + 60 * 60_000);
        const first = await usage.summary({ refresh: true, now: t0 });
        await pg.db.execute(sql`INSERT INTO teams (tenant_id, name) VALUES (${ids.b}, 'Nuevo')`);

        // Sin «Actualizar» (y dentro de los 10 minutos): lo guardado.
        const cached = await usage.summary({ now: new Date(t0.getTime() + 60_000) });
        expect(cached.generated_at).toBe(first.generated_at);
        expect(cached.modules.find((m) => m.key === 'teams')!.tenants_using).toBe(1);

        // «Actualizar» enseguida: igual lo guardado.
        const tooSoon = await usage.summary({ refresh: true, now: new Date(t0.getTime() + 10_000) });
        expect(tooSoon.generated_at).toBe(first.generated_at);

        // Pasados 30 s, recalcula.
        const fresh = await usage.summary({ refresh: true, now: new Date(t0.getTime() + 31_000) });
        expect(fresh.generated_at).not.toBe(first.generated_at);
        expect(fresh.modules.find((m) => m.key === 'teams')!.tenants_using).toBe(2);

        // Otro proceso lo lee de Redis sin volver a la base.
        const other = new PlatformUsageService(pg.db, new PlansService(pg.db), redis);
        expect((await other.summary({ now: new Date(t0.getTime() + 40_000) })).generated_at).toBe(fresh.generated_at);
        // La clave es un cálculo, no un ajuste: no viaja en las copias (`platform:*`).
        expect(await redis.exists('diag:usage:v1')).toBe(1);
        expect(await redis.keys('platform:*')).toEqual([]);
    });
});
