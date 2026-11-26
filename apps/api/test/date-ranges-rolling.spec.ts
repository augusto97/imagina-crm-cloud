import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { addDaysYmd, buildDocumentStarter, zonedToday, type DocDesign, type Field, type FilterGroup } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { docItemsFilterFromModel } from '../src/ai/tools/design-builders';
import { AiToolError } from '../src/ai/tools/registry';
import { RELATIVE_DATE_AI_HELP } from '../src/ai/tools/relative-dates';
import { rulesToFilterTree } from '../src/ai/tools/structure-tools';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { automationRuns, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DocumentsService } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const admin: Actor = { userId: 1, role: 'admin' };
const TZ = 'America/Bogota';

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(1),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};
const nullMail: MailTransport = { name: 'null', send: () => Promise.resolve() };

type LogEntry = { action: string; status: string; message: string };

/**
 * v0.1.469 — Fechas relativas con CUALQUIER cantidad de días («próximos 10
 * días», «hace más de 45 días») en el SQL de los filtros (fecha y fecha y
 * hora, en el reloj de la empresa), en las condiciones de las
 * automatizaciones y en el filtro de ítems de los PDF. Postgres real.
 */
describe('v0.1.469 — «N días» en los filtros de fecha (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let docs: DocumentsService;
    let tenantId: number;
    let tareasId: number;
    let clientesId: number;
    let f: Record<string, Field>;
    /** «Hoy» en la empresa (Bogotá), calculado una vez: los registros se arman contra él. */
    let today: string;
    const byName = new Map<string, number>();

    const k = (slug: string): string => `f${f[slug]!.id}`;
    const tree = (slug: string, value: unknown): FilterGroup => ({
        type: 'group',
        logic: 'and',
        children: [{ type: 'condition', field_id: f[slug]!.id, op: 'between_relative', value }],
    });
    const names = async (slug: string, value: unknown): Promise<string[]> => {
        const page = await recs.list(tenantId, admin, 'tareas', { filter_tree: tree(slug, value), limit: 100, sort_dir: 'asc' });
        return page.data.map((r) => String(r.data[k('titulo')])).sort();
    };

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const tzs = new TenantTimeZones(tenantDb);
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            tzs,
        );
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', FILES_SIGNING_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        autos = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(tzs), noHooks, connectors, tzs);
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
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-rolling-'))), env);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, new AuditService(tenantDb));

        const [t] = await pg.db
            .insert(tenants)
            .values({
                slug: 'rolling',
                name: 'Rolling',
                plan: 'enterprise',
                settings: { format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24', timezone: TZ } },
            })
            .returning();
        tenantId = t!.id;
        clientesId = (await lists.create(tenantId, { name: 'Clientes', slug: 'clientes' })).id;
        tareasId = (await lists.create(tenantId, { name: 'Tareas', slug: 'tareas' })).id;
        f = {};
        const mk = async (list: string, def: Parameters<FieldsService['create']>[2]): Promise<void> => {
            f[def.slug as string] = await fieldsSvc.create(tenantId, list, def);
        };
        await mk('clientes', { label: 'Razón social', type: 'text', slug: 'razon' });
        await mk('tareas', { label: 'Título', type: 'text', slug: 'titulo' });
        await mk('tareas', { label: 'Vence', type: 'date', slug: 'vence' });
        await mk('tareas', { label: 'Último contacto', type: 'datetime', slug: 'contacto' });
        await mk('tareas', { label: 'Estado', type: 'text', slug: 'estado' });
        await mk('tareas', { label: 'Valor', type: 'currency', slug: 'valor', config: { currency: 'COP', precision: 0 } });
        await mk('tareas', { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientesId } });

        today = zonedToday(TZ);
        const acme = await recs.create(tenantId, admin, 'clientes', { data: { [k('razon')]: 'Acme SAS' } });
        byName.set('acme', acme.id);
        // Una tarea por borde: hoy, +9/+10, −9/−10, −30/−31, +30/+31.
        for (const n of [0, 9, 10, -9, -10, -30, -31, 30, 31]) {
            const name = n >= 0 ? `+${n}` : String(n);
            const r = await recs.create(tenantId, admin, 'tareas', {
                data: {
                    [k('titulo')]: name,
                    [k('vence')]: addDaysYmd(today, n),
                    // 15:00 UTC = 10:00 en Bogotá, el mismo día.
                    [k('contacto')]: `${addDaysYmd(today, n)}T15:00:00.000Z`,
                    [k('valor')]: 1000,
                    [k('cliente')]: [acme.id],
                },
            });
            byName.set(name, r.id);
        }
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('listado por campo fecha: los cuatro sentidos con sus bordes', async () => {
        // Próximos 10 días: de hoy a hoy+9 (+10 ya no).
        expect(await names('vence', { days: 10, dir: 'next' })).toEqual(['+0', '+9']);
        // Últimos 10 días: de hoy−9 a hoy.
        expect(await names('vence', { days: 10, dir: 'last' })).toEqual(['+0', '-9']);
        // Hace más de 30 días: hace exactamente 30 NO entra.
        expect(await names('vence', { days: 30, dir: 'before' })).toEqual(['-31']);
        // Dentro de más de 30 días: hoy+30 NO entra.
        expect(await names('vence', { days: 30, dir: 'after' })).toEqual(['+31']);
        // N como texto (lo que puede mandar el asistente) y = el preset con N=7/30.
        expect(await names('vence', { days: '10', dir: 'next' })).toEqual(['+0', '+9']);
        expect(await names('vence', { days: 30, dir: 'next' })).toEqual(await names('vence', 'next_30_days'));
    });

    it('listado por campo fecha y hora: los días completos en la zona de la empresa', async () => {
        expect(await names('contacto', { days: 10, dir: 'next' })).toEqual(['+0', '+9']);
        expect(await names('contacto', { days: 30, dir: 'before' })).toEqual(['-31']);
        expect(await names('contacto', { days: 30, dir: 'after' })).toEqual(['+31']);

        // 04:30 UTC del día de hoy en Bogotá es todavía AYER allá (23:30); 05:30 ya es hoy.
        const late = await recs.create(tenantId, admin, 'tareas', { data: { [k('titulo')]: 'ayer-noche', [k('contacto')]: `${today}T04:30:00.000Z` } });
        const early = await recs.create(tenantId, admin, 'tareas', { data: { [k('titulo')]: 'hoy-madrugada', [k('contacto')]: `${today}T05:30:00.000Z` } });
        try {
            const next = await names('contacto', { days: 1, dir: 'next' });
            expect(next).toContain('hoy-madrugada');
            expect(next).not.toContain('ayer-noche');
            const last = await names('contacto', { days: 2, dir: 'last' });
            expect(last).toEqual(expect.arrayContaining(['ayer-noche', 'hoy-madrugada', '+0']));
        } finally {
            await recs.remove(tenantId, admin, 'tareas', late.id);
            await recs.remove(tenantId, admin, 'tareas', early.id);
        }
    });

    it('un valor que no sirve es un 400 con el motivo (nunca un rango a medias)', async () => {
        for (const bad of [{ days: 0, dir: 'next' }, { days: 3651, dir: 'last' }, { days: 10, dir: 'ayer' }, { days: 'diez', dir: 'next' }]) {
            const p = recs.list(tenantId, admin, 'tareas', { filter_tree: tree('vence', bad), limit: 10, sort_dir: 'asc' });
            await expect(p).rejects.toBeInstanceOf(BadRequestException);
            await expect(p).rejects.toThrow(/cantidad de días|1 a 3650/);
        }
    });

    it('automatizaciones: condición por paso, «Comprobar y detener» y «Según el valor de…» con N días', async () => {
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Vencimientos',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'switch',
                    config: {
                        source_field_id: f.vence!.id,
                        cases: [
                            { op: 'between_relative', value: { days: 10, dir: 'next' }, actions: [{ type: 'update_field', config: { values: { estado: 'pronto' } } }] },
                            { op: 'between_relative', value: { days: 30, dir: 'before' }, actions: [{ type: 'update_field', config: { values: { estado: 'viejo' } } }] },
                        ],
                        default_actions: [{ type: 'update_field', config: { values: { estado: 'otro' } } }],
                    },
                },
                { type: 'stop_unless', config: { condition: [{ field: 'vence', op: 'between_relative', value: { days: 10, dir: 'next' } }] } },
                { type: 'update_field', config: { values: { titulo: 'llegó' } } },
            ] as never,
        });
        const runFor = async (vence: string) => {
            const rec = await recs.create(tenantId, admin, 'tareas', { data: { [k('titulo')]: 'auto', [k('vence')]: vence } });
            const event: TriggerEvent = { tenantId, listId: tareasId, recordId: rec.id, trigger: 'record_created', after: rec.data };
            await engine.process(event);
            const runs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.recordId, rec.id)));
            const data = (await recs.get(tenantId, admin, 'tareas', rec.id)).data;
            return { data, log: runs[0]!.actionsLog as LogEntry[], status: runs[0]!.status };
        };

        const pronto = await runFor(addDaysYmd(today, 3));
        expect(pronto.status).toBe('success');
        expect(pronto.data[k('estado')]).toBe('pronto');
        expect(pronto.data[k('titulo')]).toBe('llegó');

        const viejo = await runFor(addDaysYmd(today, -45));
        expect(viejo.data[k('estado')]).toBe('viejo');
        // «Comprobar y detener» no se cumple: lo dice en palabras y no sigue.
        expect(viejo.data[k('titulo')]).toBe('auto');
        const stop = viejo.log.find((l) => l.action === 'stop_unless')!;
        expect(stop.status).toBe('skipped');
        expect(stop.message).toBe('No se cumplía «Vence» está en los próximos 10 días: la automatización no siguió.');

        const otro = await runFor(addDaysYmd(today, 20));
        expect(otro.data[k('estado')]).toBe('otro');

        // Un N que no sirve no se guarda (400 con el motivo).
        await expect(
            autos.create(tenantId, 'tareas', {
                name: 'Rota',
                trigger_type: 'record_created',
                actions: [
                    {
                        type: 'switch',
                        config: { source_field_id: f.vence!.id, cases: [{ op: 'between_relative', value: { days: 0, dir: 'next' }, actions: [] }] },
                    },
                ] as never,
            }),
        ).rejects.toThrow();
        await autos.remove(tenantId, 'tareas', auto.id);
    });

    it('PDF: la tabla de ítems filtrada por «próximos 10 días» y por «hace más de 30 días»', async () => {
        const base = buildDocumentStarter('estado_cuenta', {
            fields: { cliente: 'razon' },
            items: {
                source: { relation_field_id: f.cliente!.id, direction: 'reverse', list_id: tareasId },
                fields: { numero: 'titulo', vencimiento: 'vence', valor: 'valor' },
                info: {},
            },
        }).design;
        const withFilter = (value: unknown): DocDesign => ({
            ...base,
            blocks: base.blocks.map((b) => (b.type === 'items' ? ({ ...b, filter_tree: tree('vence', value) } as typeof b) : b)),
        });
        const render = (d: DocDesign) =>
            tenantDb.withTenant(tenantId, (tx) =>
                docs.renderInTx(tx, { tenantId, actor: admin, listId: clientesId, recordId: byName.get('acme')!, design: d, filename: 'x', mode: 'real' }),
            );
        const soon = await render(withFilter({ days: 10, dir: 'next' }));
        expect(soon.warnings).toEqual([]);
        expect(soon.content.items.items!.map((r) => r[0]).sort()).toEqual(['+0', '+9']);
        const old = await render(withFilter({ days: 30, dir: 'before' }));
        expect(old.content.items.items!.map((r) => r[0])).toEqual(['-31']);
        // Un N que no sirve: la regla se ignora con su aviso y salen todas.
        const bad = await render(withFilter({ days: 0, dir: 'next' }));
        expect(bad.warnings.join(' ')).toMatch(/cantidad de días de 1 a 3650/);
        expect(bad.content.items.items!).toHaveLength(9);
    });

    it('asistente y MCP: {days, dir} en los filtros; un N que no sirve es un error corregible', () => {
        const ids: Record<string, number> = { vence: 7, estado: 8 };
        const ok = rulesToFilterTree([{ field: 'vence', op: 'between_relative', value: { days: 45, dir: 'before' } }], (slug) => ids[slug]);
        expect(ok.children).toEqual([{ type: 'condition', field_id: 7, op: 'between_relative', value: { days: 45, dir: 'before' } }]);
        expect(() => rulesToFilterTree([{ field: 'vence', op: 'between_relative', value: { days: 0, dir: 'next' } }], (slug) => ids[slug])).toThrow(AiToolError);
        expect(() => rulesToFilterTree([{ field: 'vence', op: 'between_relative', value: { days: 10, dir: 'pronto' } }], (slug) => ids[slug])).toThrow(/1 a 3650/);
        // El filtro de ítems de un PDF que arma el modelo.
        const fields = [{ id: 7, slug: 'vence', label: 'Vence', type: 'date' as const }];
        const items = docItemsFilterFromModel({ logic: 'all', conditions: [{ field: 'vence', op: 'between_relative', value: { days: 10, dir: 'next' } }] }, fields, 'items');
        expect(items?.children).toEqual([{ type: 'condition', field_id: 7, op: 'between_relative', value: { days: 10, dir: 'next' } }]);
        expect(() =>
            docItemsFilterFromModel({ logic: 'all', conditions: [{ field: 'vence', op: 'between_relative', value: { days: 9999, dir: 'next' } }] }, fields, 'items'),
        ).toThrow(AiToolError);
        // Las descripciones de las herramientas explican la forma nueva.
        expect(RELATIVE_DATE_AI_HELP).toMatch(/\{days: N, dir: "next"\}/);
    });
});
