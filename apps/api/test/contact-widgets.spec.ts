import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contactWidgetConfigSchema, formConfigSchema, type ContactWidgetConfig, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { ContactWidgetsService } from '../src/contact-widgets/contact-widgets.service';
import { renderWidgetPage, widgetPageCsp } from '../src/contact-widgets/widget-page';
import { WidgetStatsService } from '../src/contact-widgets/widget-stats.service';
import { bookingPages, contactWidgets, forms, memberships, records, shops, tenants, users, widgetStats } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { FORM_EMBED_JS } from '../src/forms/form-page';
import { embedScriptSource } from '../src/forms/forms.controller';
import { WIDGET_PAGE_CACHE_CONTROL } from '../src/contact-widgets/contact-widgets.controller';
import { FormsService } from '../src/forms/forms.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.394 (ADR-S99) — Widget de contacto: publicar sólo lo que funciona,
 * lo público sin números de WhatsApp, la redirección a WhatsApp con la página
 * de donde vino, y «WhatsApp con datos primero» (el registro queda y el envío
 * devuelve el enlace con el mensaje armado con las respuestas).
 */

class NoopDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

const IP = '203.0.113.90';

describe('v0.1.394 — widget de contacto (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let widgets: ContactWidgetsService;
    let formsSvc: FormsService;
    let recsSvc: RecordsService;
    let envSvc: ReturnType<typeof loadEnv>;
    let tenantId: number;
    let otherTenantId: number;
    let listId: number;
    const f: Record<string, Field> = {};

    const stamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const formToken = async (id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, id)));
        return row!.token;
    };
    const widgetToken = async (tid: number, id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tid, (tx) => tx.select().from(contactWidgets).where(eq(contactWidgets.id, id)));
        return row!.token;
    };
    const cfg = (partial: Record<string, unknown>): ContactWidgetConfig => contactWidgetConfigSchema.parse(partial);

    async function leadForm(enabled = true): Promise<{ id: number; token: string }> {
        const items = [
            { id: 'qnombre1', type: 'field', field_id: f.nombre!.id, required: true },
            { id: 'qcelu001', type: 'field', field_id: f.celular!.id, required: true },
            { id: 'qplan001', type: 'field', field_id: f.plan!.id },
        ];
        const dto = await formsSvc.create(tenantId, 0, 'prospectos', { name: 'Datos para WhatsApp', config: formConfigSchema.parse({ items, settings: { title: 'Déjanos tus datos' } }) });
        if (enabled) await formsSvc.update(tenantId, 'prospectos', dto.id, { enabled: true });
        return { id: dto.id, token: await formToken(dto.id) };
    }

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const dispatcher = new NoopDispatcher();
        const recs = (recsSvc = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
        ));
        const env = (envSvc = loadEnv({ FILES_SIGNING_SECRET: 'widget-secret', APP_BASE_URL: 'https://app.test' }));
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-widget-'))), env);
        widgets = new ContactWidgetsService(pg.db, tenantDb, files);
        // FormsService con el widget (el último @Optional).
        const none = undefined;
        formsSvc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env, none, none, none, none, none, none, none, none, none, none, none, none, widgets);
        formsSvc.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-w', name: 'Acme', settings: { branding: { primary_color: '#7c3aed', app_name: 'Acme Store' } } }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-w', name: 'Otra' }).returning();
        otherTenantId = o!.id;
        listId = (await lists.create(tenantId, { name: 'Prospectos' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'prospectos', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('celular', 'Celular', 'phone');
        await mk('plan', 'Plan', 'select', { options: [{ value: 'basico', label: 'Básico' }, { value: 'pro', label: 'Pro' }] });
    });

    afterAll(async () => {
        formsSvc?.onModuleDestroy();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(contactWidgets).where(eq(contactWidgets.tenantId, tenantId));
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    it('se crea con WhatsApp, no se publica con problemas y descarta formularios ajenos', async () => {
        const w = await widgets.create(tenantId, 0, { name: 'Sitio web' });
        expect(w.enabled).toBe(false);
        expect(w.config.buttons).toHaveLength(1);
        expect(w.config.buttons[0]!.type).toBe('whatsapp');
        expect(w.problems.map((p) => p.message).join(' ')).toMatch(/número de WhatsApp/);
        await expect(widgets.update(tenantId, w.id, { enabled: true })).rejects.toMatchObject({ response: { code: 'widget_not_ready' } });

        const draft = await leadForm(false);
        const config = cfg({
            buttons: [
                { id: 'wa', type: 'whatsapp', phone: '+57 300 111 2233', message: 'Hola, vengo de {{pagina}}' },
                { id: 'fm', type: 'form', form_id: draft.id },
                // Un formulario que no es de esta empresa se descarta al guardar.
                { id: 'ajeno', type: 'form', form_id: 999_999 },
            ],
        });
        const saved = (await widgets.update(tenantId, w.id, { config })).dto;
        expect(saved.config.buttons.find((b) => b.id === 'ajeno')!.form_id).toBeNull();
        expect(saved.problems.some((p) => p.button_id === 'fm' && /no está publicado/.test(p.message))).toBe(true);
        await expect(widgets.update(tenantId, w.id, { enabled: true })).rejects.toMatchObject({ response: { code: 'widget_not_ready' } });

        await formsSvc.update(tenantId, 'prospectos', draft.id, { enabled: true });
        const okConfig = cfg({ buttons: config.buttons.filter((b) => b.id !== 'ajeno') });
        const published = (await widgets.update(tenantId, w.id, { config: okConfig, enabled: true })).dto;
        expect(published.enabled).toBe(true);
        expect(published.problems).toEqual([]);

        // Otra empresa no lo ve ni lo toca (RLS + empresa en cada consulta).
        expect(await widgets.list(otherTenantId)).toEqual([]);
        await expect(widgets.get(otherTenantId, w.id)).rejects.toMatchObject({ response: { code: 'widget_not_found' } });
    });

    it('lo público: sólo botones que funcionan, sin el número de WhatsApp, y la redirección con la página', async () => {
        const lead = await leadForm(true);
        const [bp] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(bookingPages).values({ tenantId, listId, name: 'Citas', token: 'agenda-token-1234567890', enabled: true, config: {} }).returning(),
        );
        const w = await widgets.create(tenantId, 0, { name: 'Sitio' });
        await widgets.update(tenantId, w.id, {
            enabled: true,
            config: cfg({
                title: 'Hola',
                buttons: [
                    { id: 'wa', type: 'whatsapp', phone: '+573001112233', message: 'Hola, vengo de {{pagina}} ({{url}})' },
                    { id: 'fm', type: 'form', form_id: lead.id, description: 'Te llamamos' },
                    { id: 'ag', type: 'booking', booking_page_id: bp!.id },
                    { id: 'tel', type: 'call', phone: '+57 (300) 444-5566' },
                    { id: 'mail', type: 'email', email: 'hola@acme.co', subject: 'Una pregunta' },
                    { id: 'web', type: 'link', url: 'https://acme.co/catalogo', new_tab: true },
                ],
            }),
        });
        const token = await widgetToken(tenantId, w.id);
        const info = await widgets.cachedPageInfo(token);
        expect(info).not.toBeNull();
        const meta = info!.meta;
        expect(meta.accent).toBe('#7c3aed');
        expect(meta.company).toBe('Acme Store');
        expect(meta.buttons.map((b) => b.id)).toEqual(['wa', 'fm', 'ag', 'tel', 'mail', 'web']);
        const by = Object.fromEntries(meta.buttons.map((b) => [b.id, b]));
        expect(by.wa!.href).toBe(`/api/v1/public/w/${token}/go/wa`);
        expect(by.wa!.color).toBe('#25D366');
        expect(by.fm!.frame).toBe(`/api/v1/public/f/${lead.token}?imb_chat=1`);
        expect(by.ag!.frame).toBe('/api/v1/public/b/agenda-token-1234567890');
        expect(by.tel!.href).toBe('tel:+573004445566');
        expect(by.mail!.href).toBe('mailto:hola@acme.co?subject=Una%20pregunta');
        expect(by.web).toMatchObject({ href: 'https://acme.co/catalogo', target: '_blank' });
        // El número de WhatsApp nunca viaja a la página.
        expect(JSON.stringify(meta)).not.toContain('3001112233');

        const url = await widgets.whatsappUrl(token, 'wa', { url: 'https://acme.co/planes', title: 'Planes y precios' });
        expect(url).toBe(`https://wa.me/573001112233?text=${encodeURIComponent('Hola, vengo de Planes y precios (https://acme.co/planes)')}`);
        expect(await widgets.whatsappUrl(token, 'tel', { url: null, title: null })).toBeNull();
        expect(await widgets.whatsappUrl('noexiste-noexiste-noexiste', 'wa', { url: null, title: null })).toBeNull();

        // Un formulario que se despublica deja de verse en el sitio.
        await formsSvc.update(tenantId, 'prospectos', lead.id, { enabled: false });
        await redis.flushall();
        const again = await new ContactWidgetsService(pg.db, tenantDb, files).cachedPageInfo(token);
        expect(again!.meta.buttons.map((b) => b.id)).not.toContain('fm');

        // Despublicado, archivada la empresa: no existe.
        await widgets.update(tenantId, w.id, { enabled: false });
        expect(await new ContactWidgetsService(pg.db, tenantDb, files).cachedPageInfo(token)).toBeNull();
    });

    it('WhatsApp con datos primero: el registro queda y el envío devuelve WhatsApp con las respuestas', async () => {
        const lead = await leadForm(true);
        const w = await widgets.create(tenantId, 0, { name: 'Con datos' });
        await widgets.update(tenantId, w.id, {
            enabled: true,
            config: cfg({
                buttons: [
                    { id: 'wa', type: 'whatsapp', phone: '+573001112233', capture_form_id: lead.id, message: 'Hola, soy {{nombre}} ({{celular}}), me interesa el plan {{plan}}. Vengo de {{pagina}}.' },
                    { id: 'wa2', type: 'whatsapp', phone: '+573009998877', message: 'Directo' },
                ],
            }),
        });
        const token = await widgetToken(tenantId, w.id);
        const info = await widgets.cachedPageInfo(token);
        const wa = info!.meta.buttons.find((b) => b.id === 'wa')!;
        expect(wa).toMatchObject({ capture: true, href: null, frame: `/api/v1/public/f/${lead.token}?imb_chat=1` });

        const out = await formsSvc.submit(lead.token, IP, {
            values: { [f.nombre!.id]: 'Ana', [f.celular!.id]: '+57 310 555 1234', [f.plan!.id]: 'pro' },
            uploads: {},
            stamp: stamp(lead.id),
            attribution: { page_url: 'https://acme.co/planes?ref=x' },
            widget: { token, button: 'wa', page_title: 'Planes' },
        });
        expect(out.whatsapp).toBeTruthy();
        const u = new URL(out.whatsapp!.url);
        expect(u.origin + u.pathname).toBe('https://wa.me/573001112233');
        expect(u.searchParams.get('text')).toBe('Hola, soy Ana (+573105551234), me interesa el plan Pro. Vengo de Planes.');
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.listId, listId)));
        expect(rows).toHaveLength(1);
        expect((rows[0]!.data as Record<string, unknown>)[`f${f.nombre!.id}`]).toBe('Ana');

        // Otro botón (que no pide ESTE formulario) o un widget de otra empresa: no hay WhatsApp.
        const other = await formsSvc.submit(lead.token, IP, {
            values: { [f.nombre!.id]: 'Beto', [f.celular!.id]: '+573105551235' },
            uploads: {},
            stamp: stamp(lead.id),
            widget: { token, button: 'wa2' },
        });
        expect(other.whatsapp).toBeUndefined();
        const foreign = await widgets.create(otherTenantId, 0, { name: 'Ajeno', whatsapp_phone: '+573001112233' });
        await widgets.update(otherTenantId, foreign.id, { enabled: true });
        const foreignToken = await widgetToken(otherTenantId, foreign.id);
        const spoof = await formsSvc.submit(lead.token, IP, {
            values: { [f.nombre!.id]: 'Caro', [f.celular!.id]: '+573105551236' },
            uploads: {},
            stamp: stamp(lead.id),
            widget: { token: foreignToken, button: foreign.config.buttons[0]!.id },
        });
        expect(spoof.whatsapp).toBeUndefined();

        // Si el formulario se despublica, el botón sigue abriendo WhatsApp directo.
        await formsSvc.update(tenantId, 'prospectos', lead.id, { enabled: false });
        await redis.flushall();
        const fallback = await new ContactWidgetsService(pg.db, tenantDb, files).cachedPageInfo(token);
        expect(fallback!.meta.buttons.find((b) => b.id === 'wa')).toMatchObject({ capture: false, href: `/api/v1/public/w/${token}/go/wa` });
    });

    it('v0.1.395 — varias personas: por turnos, el registro queda asignado y {{asesor}} en el mensaje', async () => {
        const mkUser = async (email: string, name: string, role: string): Promise<number> => {
            const [u] = await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning();
            await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role: role as never }));
            return u!.id;
        };
        const ana = await mkUser(`ana-${Date.now()}@acme.co`, 'Ana', 'agent');
        const luis = await mkUser(`luis-${Date.now()}@acme.co`, 'Luis', 'agent');
        const cliente = await mkUser(`cli-${Date.now()}@acme.co`, 'Cliente', 'client');
        const asignado = await fieldsSvc.create(tenantId, 'prospectos', { label: 'Asesor', type: 'user', slug: `asesor_${Date.now() % 100000}` } as never);
        const lead = await leadForm(true);
        const rr = new ContactWidgetsService(pg.db, tenantDb, files, undefined, redis as never);
        const w = await rr.create(tenantId, 0, { name: 'Equipo' });
        const saved = (
            await rr.update(tenantId, w.id, {
                enabled: true,
                config: cfg({
                    buttons: [
                        {
                            id: 'wa',
                            type: 'whatsapp',
                            capture_form_id: lead.id,
                            assign_field_id: asignado.id,
                            message: 'Hola {{asesor}}, soy {{nombre}}.',
                            advisors: [
                                { id: 'a1', name: 'Ana', phone: '+573001110001', user_id: ana },
                                { id: 'a2', name: 'Luis', phone: '+573001110002', user_id: luis },
                                // Un cliente del portal no puede "atender": su usuario se descarta (el número queda).
                                { id: 'a3', name: 'Externo', phone: '+573001110003', user_id: cliente },
                            ],
                        },
                        { id: 'wd', type: 'whatsapp', message: 'Directo con {{asesor}}', advisors: [{ id: 'b1', name: 'Ana', phone: '+573001110001' }, { id: 'b2', name: 'Luis', phone: '+573001110002' }] },
                    ],
                }),
            })
        ).dto;
        expect(saved.problems).toEqual([]);
        expect(saved.config.buttons[0]!.advisors.map((a) => a.user_id)).toEqual([ana, luis, null]);
        expect(saved.config.buttons[0]!.assign_field_id).toBe(asignado.id);
        const token = await widgetToken(tenantId, w.id);
        // Lo público no lleva a nadie.
        const meta = (await rr.cachedPageInfo(token))!.meta;
        expect(JSON.stringify(meta)).not.toContain('300111000');

        // Directo: por turnos, cada clic a la siguiente persona.
        const direct = [] as string[];
        for (let i = 0; i < 3; i++) direct.push((await rr.whatsappUrl(token, 'wd', { url: null, title: null }))!);
        expect(direct.map((u) => new URL(u).pathname)).toEqual(['/573001110001', '/573001110002', '/573001110001']);
        expect(new URL(direct[1]!).searchParams.get('text')).toBe('Directo con Luis');

        // Con datos primero: el registro queda asignado a quien le tocó.
        const u = undefined;
        const forms2 = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recsSvc, files, redis as never, new NoopDispatcher(), envSvc, u, u, u, u, u, u, u, u, u, u, u, u, rr);
        forms2.onModuleInit();
        const sent: string[] = [];
        for (const nombre of ['Caro', 'Dani', 'Eva']) {
            const out = await forms2.submit(lead.token, IP, { values: { [f.nombre!.id]: nombre, [f.celular!.id]: '+573105550000' }, uploads: {}, stamp: stamp(lead.id), widget: { token, button: 'wa' } });
            sent.push(out.whatsapp!.url);
        }
        forms2.onModuleDestroy();
        expect(sent.map((u) => new URL(u).pathname)).toEqual(['/573001110001', '/573001110002', '/573001110003']);
        expect(new URL(sent[0]!).searchParams.get('text')).toBe('Hola Ana, soy Caro.');
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.listId, listId)).orderBy(records.id));
        expect(rows.map((r) => (r.data as Record<string, unknown>)[`f${asignado.id}`] ?? null)).toEqual([ana, luis, null]);

        // Una persona sin número no deja publicar.
        await expect(
            rr.update(tenantId, w.id, { config: cfg({ buttons: [{ id: 'wa', type: 'whatsapp', advisors: [{ id: 'a1', name: 'Sin número', phone: '' }] }] }) }),
        ).rejects.toMatchObject({ response: { code: 'widget_not_ready' } });
        await fieldsSvc.remove(tenantId, 'prospectos', String(asignado.id)).catch(() => undefined);
    });

    it('v0.1.395 — horario: va a la página con los festivos de los próximos días resueltos', async () => {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const plus = (n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
        const fakeHolidays = {
            items: async (code: string) =>
                code === 'CO'
                    ? [
                          { date: plus(-3), name: 'Pasado', kind: 'national' },
                          { date: plus(2), name: 'Nacional', kind: 'national' },
                          { date: plus(4), name: 'Regional', kind: 'regional' },
                          { date: plus(60), name: 'Lejos', kind: 'national' },
                      ]
                    : null,
        };
        await pg.db.update(tenants).set({ settings: { branding: { primary_color: '#7c3aed' }, format: { timezone: 'America/Bogota', time_format: 'h12' } } }).where(eq(tenants.id, tenantId));
        const hw = new ContactWidgetsService(pg.db, tenantDb, files, undefined, redis as never, fakeHolidays as never);
        const w = await hw.create(tenantId, 0, { name: 'Horario', whatsapp_phone: '+573001112233' });
        const config = cfg({
            hours: { enabled: true, holiday_country: 'CO', timezone: 'Marte/Olimpo' },
            buttons: [
                { id: 'wa', type: 'whatsapp', phone: '+573001112233', when: 'open' },
                { id: 'fm', type: 'call', phone: '+573001112233', when: 'closed' },
            ],
        });
        const saved = (await hw.update(tenantId, w.id, { enabled: true, config })).dto;
        // Una zona que no existe vuelve a la de la empresa.
        expect(saved.config.hours.timezone).toBeNull();
        const meta = (await hw.cachedPageInfo(await widgetToken(tenantId, w.id)))!.meta;
        expect(meta.hours).toMatchObject({ tz: 'America/Bogota', time_format: 'h12', closed_dates: [plus(2)], online_label: 'En línea' });
        expect(meta.hours!.week[1]).toEqual([[480, 1080]]);
        expect(meta.buttons.map((b) => [b.id, b.when])).toEqual([
            ['wa', 'open'],
            ['fm', 'closed'],
        ]);
        await pg.db.update(tenants).set({ settings: { branding: { primary_color: '#7c3aed', app_name: 'Acme Store' } } }).where(eq(tenants.id, tenantId));
    });

    it('v0.1.396 — dónde aparece y saludo van a la página; las estadísticas se suman y se vuelcan sin pisarse', async () => {
        const lead = await leadForm();
        const w = await widgets.create(tenantId, 0, { name: 'Con estadísticas' });
        const config = cfg({
            buttons: [
                { id: 'wa', type: 'whatsapp', phone: '+573001112233' },
                { id: 'fm', type: 'form', form_id: lead.id },
            ],
            display: { pages: 'only', page_terms: 'planes, cotizacion', devices: 'mobile', delay_s: 8, scroll_pct: 30 },
            greeting: { enabled: true, text: '¿Te ayudamos?', rules: [{ contains: 'planes', text: '¿Dudas con los planes?' }, { contains: '', text: 'sin palabras' }] },
        });
        await widgets.update(tenantId, w.id, { enabled: true, config });
        const token = await widgetToken(tenantId, w.id);
        const info = (await widgets.cachedPageInfo(token))!;
        expect(info.meta.display).toEqual({ pages: 'only', page_terms: 'planes, cotizacion', devices: 'mobile', delay_s: 8, scroll_pct: 30 });
        // La regla sin palabras no viaja.
        expect(info.meta.greeting).toEqual({ text: '¿Te ayudamos?', rules: [{ contains: 'planes', text: '¿Dudas con los planes?' }], delay_s: 5, mobile: false });
        expect(info.buttonIds).toEqual(['wa', 'fm']);
        expect(info.timeZone).toBeTruthy();

        const stats = new WidgetStatsService(tenantDb, redis);
        const target = { tenantId, widgetId: w.id, timeZone: info.timeZone };
        const ids = new Set(info.buttonIds);
        await stats.record(target, IP, [{ kind: 'view', dev: 'mobile' }, { kind: 'open' }, { kind: 'click', button: 'wa' }, { kind: 'click', button: 'otro' }], ids);
        await stats.record(target, IP, [{ kind: 'view' }, { kind: 'click', button: 'fm' }, { kind: 'lead', button: 'fm' }, { kind: 'lead', button: 'otro' }], ids);
        // Antes de volcar se ve lo que está en Redis.
        let sum = await stats.summary(target, 7);
        expect(sum).toMatchObject({ views: 2, opens: 1, clicks: 2, leads: 1, mobile: 1, desktop: 1 });
        expect(await stats.flush()).toBe(1);
        await stats.record(target, IP, [{ kind: 'view' }, { kind: 'greet' }, { kind: 'greet_click' }], ids);
        await stats.flush();
        sum = await stats.summary(target, 7);
        expect(sum).toMatchObject({ views: 3, opens: 1, clicks: 2, leads: 1, greetings: 1, greeting_clicks: 1 });
        expect(sum.buttons).toEqual([
            { id: 'fm', clicks: 1, leads: 1 },
            { id: 'wa', clicks: 1, leads: 0 },
        ]);
        // RLS: la otra empresa no ve las filas.
        const otherRows = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(widgetStats));
        expect(otherRows).toHaveLength(0);
        // El widget borrado se lleva sus números y lo que quedaba en Redis no rompe el volcado.
        await stats.record(target, IP, [{ kind: 'view' }], ids);
        await widgets.remove(tenantId, w.id);
        expect(await stats.flush()).toBe(0);
        const left = await withTenant(pg.db, tenantId, (tx) => tx.select().from(widgetStats).where(eq(widgetStats.widgetId, w.id)));
        expect(left).toHaveLength(0);
    });

    it('v0.1.409 — el logo: dirección fija del propio widget, sólo ese archivo y en memoria', async () => {
        // Un PNG mínimo (8 bytes de firma + IHDR) y un archivo que no es imagen.
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
        const { logoId, otherId } = await withTenant(pg.db, tenantId, async (tx) => ({
            logoId: (await files.storeBufferInTx(tx, tenantId, 0, 'logo.png', 'image/png', png)).id,
            otherId: (await files.storeBufferInTx(tx, tenantId, 0, 'nota.txt', 'text/plain', Buffer.from('hola'))).id,
        }));
        const [before] = await pg.db.select().from(tenants).where(eq(tenants.id, tenantId));
        const settings = (before!.settings ?? {}) as Record<string, unknown>;
        await pg.db
            .update(tenants)
            .set({ settings: { ...settings, branding: { ...((settings.branding as object) ?? {}), logo_file_id: logoId } } })
            .where(eq(tenants.id, tenantId));
        try {
            const w = await widgets.create(tenantId, 0, { name: 'Con logo' });
            await widgets.update(tenantId, w.id, { enabled: true, config: cfg({ buttons: [{ id: 'wa', type: 'whatsapp', phone: '+573001112233' }] }) });
            const token = await widgetToken(tenantId, w.id);
            const fresh = new ContactWidgetsService(pg.db, tenantDb, files);
            const info = await fresh.cachedPageInfo(token);
            // La dirección no lleva firma ni vencimiento: la misma para siempre
            // (el navegador y Cloudflare la guardan un año).
            expect(info!.meta.logo_url).toBe(`/api/v1/public/w/${token}/logo/${logoId}`);
            expect(info!.logoFileId).toBe(logoId);

            let reads = 0;
            const read = files.readStream.bind(files);
            (files as unknown as { readStream: typeof read }).readStream = (...a) => {
                reads++;
                return read(...a);
            };
            const got = await fresh.logo(token, logoId);
            expect(got?.mime).toBe('image/png');
            expect(got?.bytes.equals(png)).toBe(true);
            // La segunda vez sale de memoria, sin leer el archivo de nuevo.
            await fresh.logo(token, logoId);
            expect(reads).toBe(1);
            // Sólo sirve el logo que ese widget muestra: otro archivo de la
            // misma empresa (o un número cualquiera) no sale por aquí.
            expect(await fresh.logo(token, otherId)).toBeNull();
            expect(await fresh.logo(token, logoId + 999)).toBeNull();
            expect(await fresh.logo('noexiste-noexiste-noexiste', logoId)).toBeNull();
            (files as unknown as { readStream: typeof read }).readStream = read;

            // Si el logo de la empresa no es una imagen, no se sirve.
            await pg.db
                .update(tenants)
                .set({ settings: { ...settings, branding: { ...((settings.branding as object) ?? {}), logo_file_id: otherId } } })
                .where(eq(tenants.id, tenantId));
            expect(await new ContactWidgetsService(pg.db, tenantDb, files).logo(token, otherId)).toBeNull();
        } finally {
            await pg.db.update(tenants).set({ settings }).where(eq(tenants.id, tenantId));
        }
    });

    it('v0.1.419 — botón «Ver la tienda»: sólo tiendas de la empresa, publicadas y que el plan incluye', async () => {
        const [mine] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(shops).values({ tenantId, listId, name: 'Tienda Acme', token: 'tiendaacmewidget0001', enabled: false, config: {}, settings: {} }).returning(),
        );
        const otherList = (await lists.create(otherTenantId, { name: 'Productos' })).id;
        const [foreign] = await withTenant(pg.db, otherTenantId, (tx) =>
            tx.insert(shops).values({ tenantId: otherTenantId, listId: otherList, name: 'Ajena', token: 'tiendaajenawidget0001', enabled: true, config: {}, settings: {} }).returning(),
        );
        try {
            const opts = await widgets.options(tenantId);
            expect(opts.shops).toEqual([{ id: mine!.id, name: 'Tienda Acme', enabled: false, list_name: 'Prospectos', public_path: '/api/v1/public/s/tiendaacmewidget0001' }]);

            const w = await widgets.create(tenantId, 0, { name: 'Sitio con tienda' });
            const config = cfg({
                buttons: [
                    { id: 'tienda', type: 'shop', shop_id: mine!.id },
                    // Una tienda de otra empresa se descarta al guardar.
                    { id: 'ajena', type: 'shop', shop_id: foreign!.id },
                    { id: 'link', type: 'link', url: 'https://acme.co' },
                ],
            });
            const saved = (await widgets.update(tenantId, w.id, { config })).dto;
            expect(saved.config.buttons.find((b) => b.id === 'ajena')!.shop_id).toBeNull();
            expect(saved.problems.map((p) => p.message)).toEqual(['«Ver la tienda»: la tienda «Tienda Acme» no está publicada.', '«Ver la tienda»: elige la tienda que se abre.']);

            // Publicada, pero el plan de prueba no incluye la tienda: el botón no se muestra.
            await withTenant(pg.db, tenantId, (tx) => tx.update(shops).set({ enabled: true }).where(eq(shops.id, mine!.id)));
            const ok = cfg({ buttons: config.buttons.filter((b) => b.id !== 'ajena') });
            const published = (await widgets.update(tenantId, w.id, { config: ok, enabled: true })).dto;
            expect(published.problems).toEqual([]);
            const token = await widgetToken(tenantId, w.id);
            const trial = (await new ContactWidgetsService(pg.db, tenantDb, files).cachedPageInfo(token))!;
            expect(trial.meta.buttons.map((b) => b.id)).toEqual(['link']);

            // Con un plan que la incluye, se abre en el panel con la página de la tienda.
            await pg.db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, tenantId));
            const pro = (await new ContactWidgetsService(pg.db, tenantDb, files).cachedPageInfo(token))!;
            expect(pro.meta.buttons.find((b) => b.id === 'tienda')).toMatchObject({ type: 'shop', frame: '/api/v1/public/s/tiendaacmewidget0001', label: 'Ver la tienda', icon: 'cart', href: null });

            // Suspendida por la plataforma: cuenta como no publicada.
            await withTenant(pg.db, tenantId, (tx) => tx.update(shops).set({ suspendedAt: new Date() }).where(eq(shops.id, mine!.id)));
            const susp = (await new ContactWidgetsService(pg.db, tenantDb, files).cachedPageInfo(token))!;
            expect(susp.meta.buttons.map((b) => b.id)).toEqual(['link']);
        } finally {
            await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
            await withTenant(pg.db, tenantId, (tx) => tx.delete(shops).where(eq(shops.tenantId, tenantId)));
            await withTenant(pg.db, otherTenantId, (tx) => tx.delete(shops).where(eq(shops.tenantId, otherTenantId)));
        }
    });

    it('v0.1.409 — embed.js minificado: el mismo script, más chico', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { minifyEmbed } = require('../scripts/minify-embed.cjs') as { minifyEmbed: (s: string) => string };
        const min = minifyEmbed(FORM_EMBED_JS);
        expect(min.length).toBeLessThan(FORM_EMBED_JS.length * 0.7);
        for (const marker of ['__imbFormsEmbed', 'data-imagina-widget', 'imb-w-size', 'imagina-popup', 'imb-conversion']) {
            expect(min).toContain(marker);
        }
        // Se puede evaluar (no rompe la sintaxis) y el servidor lo prefiere si está.
        expect(() => new Function(min)).not.toThrow();
        const dir = mkdtempSync(join(tmpdir(), 'imb-embed-'));
        expect(embedScriptSource(dir)).toBe(FORM_EMBED_JS);
        writeFileSync(join(dir, 'embed.min.js'), `${min}\n`);
        expect(embedScriptSource(dir)).toBe(`${min}\n`);
        // Uno roto o vacío no se usa.
        writeFileSync(join(dir, 'embed.min.js'), 'x');
        expect(embedScriptSource(dir)).toBe(FORM_EMBED_JS);
    });

    it('v0.1.409 — la página del widget se guarda 5 minutos en el navegador', () => {
        expect(WIDGET_PAGE_CACHE_CONTROL).toMatch(/^public, /);
        expect(WIDGET_PAGE_CACHE_CONTROL).toContain('max-age=300');
        expect(WIDGET_PAGE_CACHE_CONTROL).toContain('stale-while-revalidate');
        expect(WIDGET_PAGE_CACHE_CONTROL).not.toMatch(/private|no-store/);
    });

    it('la página: CSP con los sitios elegidos, sin nada de afuera, y embed.js con el modo widget', () => {
        const csp = widgetPageCsp("'sha256-abc'", ['acme.co', 'https://www.acme.co', 'javascript:alert(1)']);
        expect(csp).toContain("script-src 'sha256-abc'");
        expect(csp).toContain("frame-src 'self'");
        expect(csp).toContain("frame-ancestors 'self' acme.co https://www.acme.co");
        expect(csp).not.toContain('javascript');
        expect(widgetPageCsp('', [])).toContain('frame-ancestors *');
        const html = renderWidgetPage({ title: '<x>', meta: null, client: 'console.log("</script><b>")' });
        expect(html).toContain('<title>&lt;x&gt;</title>');
        expect(html).not.toContain('</script><b>');
        expect(FORM_EMBED_JS).toContain('data-imagina-widget');
        expect(FORM_EMBED_JS).toContain('imb-w-size');
        // v0.1.396 — cuenta el tiempo en la página y cuánto bajó, y lo avisa al bajar.
        expect(FORM_EMBED_JS).toContain('watch_scroll');
        expect(FORM_EMBED_JS).toContain('scroll: scrollPct()');
    });
});
