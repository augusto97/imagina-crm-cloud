import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, type Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine, formEventValue } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { formPendingSubmissions, forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { FormsService } from '../src/forms/forms.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.386 — «Origen y etiquetas» de un formulario: la página desde donde se
 * envió (limpia, también en el enlace directo), el nombre del formulario y
 * valores fijos (etiquetas, estado) en cada registro, y las automatizaciones
 * que filtran por la página y la usan como variable.
 */

class NoopDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

const IP = '203.0.113.86';

describe('v0.1.386 — origen y etiquetas de un formulario (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let files: FilesService;
    let dispatcher: NoopDispatcher;
    let svc: FormsService;
    let tenantId: number;
    let listId: number;
    const f: Record<string, Field> = {};
    const sent: Array<{ to: string; html: string }> = [];

    const stamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    const key = (slug: string): string => `f${f[slug]!.id}`;
    const recordOf = async (id: number): Promise<Record<string, unknown>> => {
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(and(eq(records.listId, listId), eq(records.id, id))));
        return rec!.data as Record<string, unknown>;
    };

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        dispatcher = new NoopDispatcher();
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
        );
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-origin-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formorigin-'))), env);
        const mail = new MailService(env, {
            name: 'memoria',
            send: (m) => {
                sent.push({ to: Array.isArray(m.to) ? m.to.join(',') : String(m.to), html: String(m.html ?? '') });
                return Promise.resolve();
            },
        });
        svc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env, undefined, undefined, undefined, undefined, mail);
        svc.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'origen', name: 'Origen', settings: {} }).returning();
        tenantId = t!.id;
        listId = (await lists.create(tenantId, { name: 'Leads' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'leads', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('correo', 'Correo', 'email');
        await mk('intereses', 'Intereses', 'multi_select', {
            options: [
                { value: 'regalos', label: 'Regalos' },
                { value: 'navidad', label: 'Navidad' },
                { value: 'web', label: 'Web' },
            ],
        });
        await mk('canal', 'Canal', 'select', { options: [{ value: 'web', label: 'Sitio web' }, { value: 'tienda', label: 'Tienda' }] });
        await mk('vip', 'VIP', 'checkbox');
        await mk('formulario', 'Formulario', 'text');
        await mk('pagina', 'Página de origen', 'url');
        await mk('llego', 'Llegó desde', 'url');
        await mk('nota', 'Nota', 'text');
    });

    afterAll(async () => {
        svc?.onModuleDestroy();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        dispatcher.events.length = 0;
        sent.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    async function landingForm(settings: Record<string, unknown> = {}, name = 'Landing Navidad'): Promise<{ id: number; token: string }> {
        const items = [
            { id: 'qnombre1', type: 'field', field_id: f.nombre!.id, required: true },
            { id: 'qcorreo1', type: 'field', field_id: f.correo!.id },
            { id: 'qinter01', type: 'field', field_id: f.intereses!.id },
        ];
        const dto = await svc.create(tenantId, 0, 'leads', { name, config: formConfigSchema.parse({ items, settings: { title: 'Escríbenos', ...settings } }) });
        await svc.update(tenantId, 'leads', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    it('guarda limpio: el nombre en texto, valores fijos válidos y nunca en lo que se pregunta (salvo «varias opciones»)', async () => {
        const form = await landingForm({
            record_values: {
                form_name_field_id: f.formulario!.id,
                form_name_source: 'name',
                fixed: [
                    { field_id: f.canal!.id, value: 'web' },
                    { field_id: f.intereses!.id, value: ['navidad'] },
                    // El nombre se pregunta: no se fija.
                    { field_id: f.nombre!.id, value: 'Pisado' },
                    // Una opción que el campo no tiene: se descarta.
                    { field_id: f.canal!.id, value: 'tienda' },
                    { field_id: f.vip!.id, value: true },
                    { field_id: f.nota!.id, value: 'Llegó por la landing' },
                ],
            },
            attribution: { enabled: true, page_url_field_id: f.pagina!.id, referrer_field_id: f.llego!.id },
        });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ config: forms.config }).from(forms).where(eq(forms.id, form.id)));
        const saved = formConfigSchema.parse(row!.config).settings.record_values;
        expect(saved.form_name_field_id).toBe(f.formulario!.id);
        expect(saved.fixed).toEqual([
            { field_id: f.canal!.id, value: 'web' },
            { field_id: f.intereses!.id, value: ['navidad'] },
            { field_id: f.vip!.id, value: true },
            { field_id: f.nota!.id, value: 'Llegó por la landing' },
        ]);

        // Una columna no guarda dos cosas: si la página ya la usa, el nombre del formulario no.
        const clash = await landingForm({
            record_values: { form_name_field_id: f.nota!.id },
            attribution: { enabled: true, page_url_field_id: f.nota!.id },
        });
        const [row2] = await withTenant(pg.db, tenantId, (tx) => tx.select({ config: forms.config }).from(forms).where(eq(forms.id, clash.id)));
        const s2 = formConfigSchema.parse(row2!.config).settings;
        expect(s2.attribution.page_url_field_id).toBe(f.nota!.id);
        expect(s2.record_values.form_name_field_id).toBeNull();
    });

    it('al enviar: la página limpia, el nombre, las etiquetas sumadas y la automatización recibe el origen', async () => {
        const form = await landingForm({
            record_values: {
                form_name_field_id: f.formulario!.id,
                fixed: [
                    { field_id: f.intereses!.id, value: ['navidad'] },
                    { field_id: f.canal!.id, value: 'web' },
                    { field_id: f.vip!.id, value: true },
                ],
            },
            attribution: { enabled: true, page_url_field_id: f.pagina!.id, referrer_field_id: f.llego!.id },
        });
        await svc.submit(form.token, IP, {
            values: { [f.nombre!.id]: 'Ana', [f.correo!.id]: 'ana@acme.co', [f.intereses!.id]: ['regalos'] },
            uploads: {},
            stamp: stamp(form.id),
            attribution: {
                page_url: 'https://tienda.co/navidad/regalos?producto=taza&utm_source=ig&gclid=Cj0Kxyz123#form',
                referrer: 'https://www.google.com/',
                utm_campaign: 'Navidad',
            },
        });
        const ev = dispatcher.events.find((e) => e.trigger === 'form_submitted')!;
        const data = await recordOf(ev.recordId!);
        expect(data[key('pagina')]).toBe('https://tienda.co/navidad/regalos?producto=taza');
        expect(data[key('llego')]).toBe('https://www.google.com/');
        expect(data[key('formulario')]).toBe('Landing Navidad');
        expect(data[key('intereses')]).toEqual(['regalos', 'navidad']);
        expect(data[key('canal')]).toBe('web');
        expect(data[key('vip')]).toBe(true);
        expect(ev.form).toEqual({
            id: form.id,
            name: 'Landing Navidad',
            title: 'Escríbenos',
            origin: { page_url: 'https://tienda.co/navidad/regalos?producto=taza', referrer: 'https://www.google.com/', utm_campaign: 'Navidad' },
        });
        expect(formEventValue(ev.form, 'pagina')).toBe('https://tienda.co/navidad/regalos?producto=taza');
        expect(formEventValue(ev.form, 'titulo')).toBe('Escríbenos');
        expect(formEventValue(ev.form, 'utm_campaign')).toBe('Navidad');
        expect(formEventValue(ev.form, '12.enlace')).toBeUndefined();
    });

    it('sin columnas de origen, la automatización igual sabe la página; con el título público como nombre', async () => {
        const form = await landingForm({ record_values: { form_name_field_id: f.formulario!.id, form_name_source: 'title' } });
        await svc.submit(form.token, IP, {
            values: { [f.nombre!.id]: 'Beto' },
            uploads: {},
            stamp: stamp(form.id),
            attribution: { page_url: 'https://app.test/api/v1/public/f/abc?origen=instagram' },
        });
        const ev = dispatcher.events.find((e) => e.trigger === 'form_submitted')!;
        const data = await recordOf(ev.recordId!);
        expect(data[key('formulario')]).toBe('Escríbenos');
        expect(data[key('pagina')]).toBeUndefined();
        expect(ev.form?.origin).toEqual({ page_url: 'https://app.test/api/v1/public/f/abc?origen=instagram' });
    });

    it('motor: «sólo si la página contiene…» y {{formulario.pagina}}', async () => {
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-origin-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const audit = new AuditService(tenantDb);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), noHooks, connectors);
        const engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), { name: 'nulo', send: () => Promise.resolve() }),
            connectors,
        );
        const form = await landingForm();
        await automations.create(tenantId, 'leads', {
            name: 'Leads de Navidad',
            trigger_type: 'form_submitted',
            trigger_config: { page_contains: 'navidad, black-friday', page_excludes: '/pruebas' },
            actions: [{ type: 'update_field', config: { values: { nota: 'De {{formulario.pagina}} · {{formulario.titulo}}' } } }],
            is_active: true,
        });
        const run = async (page: string): Promise<unknown> => {
            dispatcher.events.length = 0;
            await svc.submit(form.token, IP, { values: { [f.nombre!.id]: 'X' }, uploads: {}, stamp: stamp(form.id), attribution: { page_url: page } });
            const ev = dispatcher.events.find((e) => e.trigger === 'form_submitted')!;
            await engine.process(ev);
            return (await recordOf(ev.recordId!))[key('nota')];
        };
        expect(await run('https://tienda.co/Promo-NAVIDAD/')).toBe('De https://tienda.co/Promo-NAVIDAD/ · Escríbenos');
        expect(await run('https://tienda.co/contacto/')).toBeUndefined();
        expect(await run('https://tienda.co/pruebas/navidad/')).toBeUndefined();
        expect(await run('https://tienda.co/black-friday')).toBe('De https://tienda.co/black-friday · Escríbenos');
    });

    it('con confirmación por correo, el origen espera con la respuesta y llega al confirmar', async () => {
        const form = await landingForm({
            respondent_email_field_id: f.correo!.id,
            confirm_email: true,
            record_values: { fixed: [{ field_id: f.canal!.id, value: 'web' }] },
        });
        await svc.submit(form.token, IP, {
            values: { [f.nombre!.id]: 'Cami', [f.correo!.id]: 'cami@acme.co' },
            uploads: {},
            stamp: stamp(form.id),
            attribution: { page_url: 'https://tienda.co/navidad?utm_medium=cpc', utm_source: 'meta' },
        });
        const [pending] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions).where(eq(formPendingSubmissions.formId, form.id)));
        expect(pending!.origin).toEqual({ page_url: 'https://tienda.co/navidad', utm_source: 'meta' });
        expect(dispatcher.events.find((e) => e.trigger === 'form_submitted')).toBeUndefined();
        const link = /\/api\/v1\/public\/f\/confirm\/([A-Za-z0-9_-]+)/.exec(sent.map((m) => m.html).join(''))![1]!;
        await svc.confirm(link);
        const ev = dispatcher.events.find((e) => e.trigger === 'form_submitted')!;
        expect(ev.form?.origin).toEqual({ page_url: 'https://tienda.co/navidad', utm_source: 'meta' });
        expect((await recordOf(ev.recordId!))[key('canal')]).toBe('web');
    });
});
