import type { Field } from '@imagina-base/shared';
import { zonedToday } from '@imagina-base/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { tenants } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { RecurrencesRepository } from '../src/recurrences/recurrences.repository';
import { RecurrencesService } from '../src/recurrences/recurrences.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { BrandingService } from '../src/workspaces/branding.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

class NullCaptures implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}
const nullMail: MailTransport = { name: 'null', send: () => Promise.resolve() };

/**
 * v0.1.263 — Zona horaria de la empresa. Dos zonas lejanas (Kiritimati UTC+14
 * y Pago Pago UTC−11) hacen que los casos sean deterministas a cualquier hora
 * del día: la fecha de "hoy" en Kiritimati todavía no llegó en Pago Pago.
 */
describe('Zona horaria de la empresa (v0.1.263)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let tzs: TenantTimeZones;
    let branding: BrandingService;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recordsSvc: RecordsService;
    let automationsSvc: AutomationsService;
    let engine: AutomationEngine;
    let tenantId: number;
    let f: Record<string, Field>;
    const upserts: Array<{ id: string; repeat: Record<string, unknown> }> = [];

    const setTz = async (tz: string | null) => branding.setFormat(tenantId, { timezone: tz });
    const key = (slug: string) => `f${f[slug]!.id}`;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        tzs = new TenantTimeZones(tenantDb);
        branding = new BrandingService(tenantDb, { signedUrl: () => '' } as never, tzs);
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recordsSvc = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            activity,
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            tzs,
        );
        const scheduler = new AutomationScheduler(tzs);
        scheduler.setQueue({
            upsertJobScheduler: (id: string, repeat: Record<string, unknown>) => (upserts.push({ id, repeat }), Promise.resolve()),
            removeJobScheduler: () => Promise.resolve(true),
            add: () => Promise.resolve(),
        } as never);
        const connectors = new ConnectorsService(
            tenantDb,
            pg.db,
            loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }),
            memoryOAuthStore(),
            new AuditService(tenantDb),
            memoryIntegrationApps(),
        );
        automationsSvc = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, scheduler, new NullCaptures(), connectors, tzs);
        // Igual que AutomationsQueue: cambiar la zona re-registra los horarios.
        tzs.onChange((t) => automationsSvc.resyncTenantSchedules(t).then(() => undefined));
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), nullMail),
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            tzs,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'tz-co', name: 'TZ Co' }).returning();
        tenantId = t!.id;
        await lists.create(tenantId, { name: 'Tareas', slug: 'tareas' });
        f = {};
        for (const def of [
            { label: 'Nombre', slug: 'nombre', type: 'text' as const },
            { label: 'Vence', slug: 'vence', type: 'date' as const },
            { label: 'Estado', slug: 'estado', type: 'text' as const },
        ]) {
            f[def.slug] = await fieldsSvc.create(tenantId, 'tareas', def);
        }
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('la zona se guarda en el formato regional; una desconocida para Postgres se rechaza', async () => {
        expect((await branding.getFormat(tenantId)).timezone).toBeNull();
        expect((await setTz('America/Bogota')).timezone).toBe('America/Bogota');
        expect(await tzs.get(tenantId)).toBe('America/Bogota');
        // Llega validada por Zod en el controller; aquí se prueba la segunda
        // barrera (la lista de zonas de Postgres) con una que Node no conoce.
        await expect(branding.setFormat(tenantId, { timezone: 'Etc/Nunca' })).rejects.toThrow(/zona horaria/i);
        expect((await branding.getFormat(tenantId)).timezone).toBe('America/Bogota');
    });

    it('un horario sin zona corre en la de la empresa y la sigue cuando cambia', async () => {
        await setTz('America/Bogota');
        // Lo que guardan el asistente/MCP o la API: sin tz.
        const auto = await automationsSvc.create(tenantId, 'tareas', {
            name: 'A las 8',
            trigger_type: 'scheduled',
            trigger_config: { frequency: 'daily', hour: 8, minute: 0 },
            actions: [{ type: 'update_field', config: { values: {} } }],
        });
        expect(upserts.at(-1)).toEqual({ id: `sched:${auto.id}`, repeat: { pattern: '0 8 * * *', tz: 'America/Bogota' } });

        // Una con zona propia la conserva.
        const own = await automationsSvc.create(tenantId, 'tareas', {
            name: 'Madrid',
            trigger_type: 'scheduled',
            trigger_config: { frequency: 'daily', hour: 9, tz: 'Europe/Madrid' },
            actions: [{ type: 'update_field', config: { values: {} } }],
        });
        expect(upserts.at(-1)!.repeat).toEqual({ pattern: '0 9 * * *', tz: 'Europe/Madrid' });

        // La empresa cambia de zona → se re-registran: la sin zona pasa a la
        // nueva, la de Madrid sigue en Madrid.
        upserts.length = 0;
        await setTz('America/Mexico_City');
        const byId = new Map(upserts.map((u) => [u.id, u.repeat]));
        expect(byId.get(`sched:${auto.id}`)).toEqual({ pattern: '0 8 * * *', tz: 'America/Mexico_City' });
        expect(byId.get(`sched:${own.id}`)).toEqual({ pattern: '0 9 * * *', tz: 'Europe/Madrid' });

        // Volver a guardar la MISMA zona no re-registra nada.
        upserts.length = 0;
        await setTz('America/Mexico_City');
        expect(upserts).toHaveLength(0);

        // Sin zona en ningún lado: UTC explícito (no la hora del servidor).
        await setTz(null);
        await automationsSvc.update(tenantId, 'tareas', auto.id, { trigger_config: { frequency: 'daily', hour: 8 } });
        expect(upserts.at(-1)!.repeat).toEqual({ pattern: '0 8 * * *', tz: 'UTC' });
        await automationsSvc.remove(tenantId, 'tareas', auto.id);
        await automationsSvc.remove(tenantId, 'tareas', own.id);
    });

    it('una fecha sin hora vence a la medianoche de la empresa (disparo por fecha)', async () => {
        const ahead = zonedToday('Pacific/Kiritimati'); // el "hoy" que llega primero en el mundo
        const rec = await recordsSvc.create(tenantId, admin, 'tareas', {
            data: { [key('nombre')]: 'Vence hoy en Kiritimati', [key('vence')]: ahead, [key('estado')]: 'nueva' },
        });
        const auto = await automationsSvc.create(tenantId, 'tareas', {
            name: 'Al vencer',
            trigger_type: 'due_date_reached',
            trigger_config: { due_field: 'vence', offset_minutes: 0 },
            actions: [{ type: 'update_field', config: { values: { estado: 'vencida' } } }],
        });
        const estado = async () => (await recordsSvc.get(tenantId, admin, 'tareas', rec.id)).data[key('estado')];

        // En Pago Pago (UTC−11) ese día todavía no empezó: no vence.
        await setTz('Pacific/Pago_Pago');
        await engine.runDueDate(tenantId, auto.id);
        expect(await estado()).toBe('nueva');

        // En Kiritimati (UTC+14) ya empezó: vence.
        await setTz('Pacific/Kiritimati');
        await engine.runDueDate(tenantId, auto.id);
        expect(await estado()).toBe('vencida');
        await automationsSvc.remove(tenantId, 'tareas', auto.id);
        await recordsSvc.remove(tenantId, admin, 'tareas', rec.id);
    });

    it('"hoy" de los filtros es el de la empresa', async () => {
        const ahead = zonedToday('Pacific/Kiritimati');
        const rec = await recordsSvc.create(tenantId, admin, 'tareas', {
            data: { [key('nombre')]: 'Hoy allá', [key('vence')]: ahead },
        });
        const today = {
            type: 'group' as const,
            logic: 'and' as const,
            children: [{ type: 'condition' as const, field_id: f.vence!.id, op: 'between_relative' as const, value: 'today' }],
        };
        const ids = async () => (await recordsSvc.list(tenantId, admin, 'tareas', { filter_tree: today, limit: 50, sort_dir: 'asc' })).data.map((r) => r.id);

        await setTz('Pacific/Kiritimati');
        expect(await ids()).toContain(rec.id);
        await setTz('Pacific/Pago_Pago');
        expect(await ids()).not.toContain(rec.id);
        await recordsSvc.remove(tenantId, admin, 'tareas', rec.id);
    });

    it('recurrencias: una fecha sin hora se rueda cuando empieza ese día en la empresa', async () => {
        const repo = new RecurrencesRepository();
        const recSvc = new RecurrencesService(
            tenantDb,
            repo,
            lists,
            fieldsSvc,
            new RecordsRepository(),
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            rt,
            new AutomationDispatcher(),
            pg.db,
            undefined,
            tzs,
        );
        const rec = await recordsSvc.create(tenantId, admin, 'tareas', {
            data: { [key('nombre')]: 'Mensual', [key('vence')]: '2026-10-07' },
        });
        await recSvc.upsert(tenantId, 'tareas', rec.id, {
            date_field_id: f.vence!.id,
            frequency: 'monthly',
            interval_n: 1,
            trigger_type: 'schedule',
            action_type: 'update',
        });
        const due = async (now: string) =>
            (await repo.dueScheduled(pg.db, now)).filter((r) => r.tenantId === tenantId).map((r) => r.recordId);

        // 03:00 UTC del 7 = 22:00 del 6 en Bogotá: todavía no.
        await setTz('America/Bogota');
        expect(await due('2026-10-07 03:00:00')).not.toContain(rec.id);
        // 05:00 UTC = medianoche del 7 en Bogotá: ya.
        expect(await due('2026-10-07 05:00:00')).toContain(rec.id);
        // Sin zona (UTC), a las 03:00 UTC del 7 ya era el 7.
        await setTz(null);
        expect(await due('2026-10-07 03:00:00')).toContain(rec.id);
    });
    it('el filtro de un rollup usa el "hoy" de la empresa', async () => {
        await lists.create(tenantId, { name: 'Proyectos', slug: 'proyectos' });
        const proyectos = await lists.get(tenantId, 'proyectos');
        const nombreP = await fieldsSvc.create(tenantId, 'proyectos', { label: 'Nombre', slug: 'nombre_p', type: 'text' });
        const rel = await fieldsSvc.create(tenantId, 'tareas', {
            label: 'Proyecto', slug: 'proyecto', type: 'relation', config: { target_list_id: proyectos.id },
        });
        const p = await recordsSvc.create(tenantId, admin, 'proyectos', { data: { [`f${nombreP.id}`]: 'Alfa' } });
        const ahead = zonedToday('Pacific/Kiritimati');
        await recordsSvc.create(tenantId, admin, 'tareas', {
            data: { [key('nombre')]: 'Vence hoy allá', [key('vence')]: ahead, [`f${rel.id}`]: [p.id] },
        });
        const hoy = await fieldsSvc.create(tenantId, 'proyectos', {
            label: 'Vencen hoy', slug: 'vencen_hoy', type: 'rollup',
            config: {
                relation_field_id: rel.id,
                operation: 'count',
                filter_tree: {
                    type: 'group', logic: 'and',
                    children: [{ type: 'condition', field_id: f.vence!.id, op: 'between_relative', value: 'today' }],
                },
            },
        });
        const count = async () => (await recordsSvc.get(tenantId, admin, 'proyectos', p.id)).data[`f${hoy.id}`];

        await setTz('Pacific/Kiritimati');
        expect(await count()).toBe(1);
        await setTz('Pacific/Pago_Pago');
        expect(await count()).toBe(0);
    });
});
