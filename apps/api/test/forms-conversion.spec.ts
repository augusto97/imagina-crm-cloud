import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
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
 * v0.1.374 (ADR-S97) — Medir conversiones de un formulario: de dónde vino
 * cada registro (en sus columnas), el valor y el id de cada envío para el
 * evento del sitio, las conversiones mejoradas y la página de gracias con
 * variables (nunca el correo ni el teléfono).
 */

class NoopDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

const IP = '203.0.113.74';

describe('v0.1.374 — medir conversiones de un formulario (Postgres + Redis reales)', () => {
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

    const stamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    const key = (slug: string): string => `f${f[slug]!.id}`;

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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-conv-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formconv-'))), env);
        svc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env);
        svc.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'medir', name: 'Medir', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        listId = (await lists.create(tenantId, { name: 'Clientes' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'clientes', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('correo', 'Correo', 'email');
        await mk('celular', 'Celular', 'phone');
        await mk('plan', 'Plan', 'select', { options: [{ value: 'basico', label: 'Básico' }, { value: 'pro', label: 'Pro' }] });
        await mk('puntos', 'Puntos', 'number');
        await mk('campana', 'Campaña', 'text');
        await mk('fuente', 'Fuente', 'text');
        await mk('clic', 'Clic de Google', 'text');
        await mk('pagina', 'Página', 'url');
    });

    afterAll(async () => {
        svc?.onModuleDestroy();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        dispatcher.events.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    async function contactForm(settings: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
        const items = [
            { id: 'qnombre1', type: 'field', field_id: f.nombre!.id, required: true },
            { id: 'qcorreo1', type: 'field', field_id: f.correo!.id },
            { id: 'qcelu001', type: 'field', field_id: f.celular!.id },
            { id: 'qplan001', type: 'field', field_id: f.plan!.id },
        ];
        const dto = await svc.create(tenantId, 0, 'clientes', {
            name: 'Contacto',
            config: formConfigSchema.parse({ items, settings: { title: 'Contáctanos', ...settings } }),
        });
        await svc.update(tenantId, 'clientes', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    it('guarda de dónde vino en sus columnas y nunca en una que el formulario pregunta', async () => {
        const form = await contactForm({
            attribution: {
                enabled: true,
                utm_campaign_field_id: f.campana!.id,
                utm_source_field_id: f.fuente!.id,
                gclid_field_id: f.clic!.id,
                page_url_field_id: f.pagina!.id,
                // El nombre ya es una pregunta: no sirve para el origen.
                utm_medium_field_id: f.nombre!.id,
            },
            conversion: { google_ads: 'AW-123456789/AbCdEf', meta_event: true },
        });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ config: forms.config }).from(forms).where(eq(forms.id, form.id)));
        const saved = formConfigSchema.parse(row!.config).settings.attribution;
        expect(saved.utm_medium_field_id).toBeNull();
        expect(saved.utm_campaign_field_id).toBe(f.campana!.id);

        const meta = await svc.meta(form.token);
        expect(meta.conversion).toEqual({ google_ads: 'AW-123456789/AbCdEf', meta_event: true, attribution: true, direct: null });
        expect(meta.redirect_delay).toBe(0);

        const out = await svc.submit(form.token, IP, {
            values: { [f.nombre!.id]: 'Ana', [f.correo!.id]: 'ana@acme.co' },
            uploads: {},
            stamp: stamp(form.id),
            attribution: { utm_campaign: 'Navidad', utm_source: 'google', gclid: 'Cj0K-xyz_1', page_url: 'javascript:alert(1)', utm_medium: 'pisar-el-nombre' },
        });
        expect(out.conversion!.submission_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
        expect(out.conversion).toMatchObject({ value: null, currency: null });
        expect(out.conversion!.user_data).toBeUndefined();
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.listId, listId)));
        const data = rec!.data as Record<string, unknown>;
        expect(data[key('campana')]).toBe('Navidad');
        expect(data[key('fuente')]).toBe('google');
        expect(data[key('clic')]).toBe('Cj0K-xyz_1');
        // Una dirección que no es http(s) se descarta; el nombre es lo que se respondió.
        expect(data[key('pagina')]).toBeUndefined();
        expect(data[key('nombre')]).toBe('Ana');

        // Apagado, no guarda nada aunque el navegador lo mande.
        const off = await contactForm({ attribution: { enabled: false, utm_campaign_field_id: f.campana!.id } });
        expect((await svc.meta(off.token)).conversion).toEqual({ google_ads: null, meta_event: false, attribution: false, direct: null });
        await svc.submit(off.token, IP, { values: { [f.nombre!.id]: 'Beto' }, uploads: {}, stamp: stamp(off.id), attribution: { utm_campaign: 'X' } });
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.listId, listId)));
        const beto = rows.map((r) => r.data as Record<string, unknown>).find((d) => d[key('nombre')] === 'Beto')!;
        expect(beto[key('campana')]).toBeUndefined();
    });

    it('el valor (fijo o de un cálculo), las conversiones mejoradas y la página de gracias con variables', async () => {
        const form = await contactForm({
            redirect_url: 'https://acme.co/gracias?n={{nombre}}&p={{plan}}&e={{correo}}&id={{envio.id}}&v={{valor}}&m={{moneda}}&c={{utm_campaign}}&x={{nada}}',
            redirect_delay: 3,
            conversion: { value: 'fixed', amount: 50000, currency: 'COP', share_contact: true },
        });
        expect((await svc.meta(form.token)).redirect_delay).toBe(3);
        const out = await svc.submit(form.token, IP, {
            values: { [f.nombre!.id]: 'Ana María & Cía', [f.correo!.id]: 'Ana@Acme.CO', [f.celular!.id]: '+57 300 111 2233', [f.plan!.id]: 'pro' },
            uploads: {},
            stamp: stamp(form.id),
            attribution: { utm_campaign: 'Black Friday' },
        });
        expect(out.conversion).toMatchObject({ value: 50000, currency: 'COP', user_data: { email: 'ana@acme.co', phone_number: '+573001112233' } });
        const u = new URL(out.redirect_url!);
        expect(u.origin).toBe('https://acme.co');
        expect(u.searchParams.get('n')).toBe('Ana María & Cía');
        // La opción se lee como la ve una persona.
        expect(u.searchParams.get('p')).toBe('Pro');
        // El correo NUNCA viaja en una dirección.
        expect(u.searchParams.get('e')).toBe('');
        expect(u.searchParams.get('id')).toBe(out.conversion!.submission_id);
        expect(u.searchParams.get('v')).toBe('50000');
        expect(u.searchParams.get('m')).toBe('COP');
        expect(u.searchParams.get('c')).toBe('Black Friday');
        expect(u.searchParams.get('x')).toBe('');

        // El valor sale de un cálculo del formulario.
        const calc = await contactForm({
            calcs: [{ id: 'calc0001', key: 'total', name: 'Total', start: 100, parts: [{ field_id: f.plan!.id, points: { basico: 10, pro: 25 } }] }],
            conversion: { value: 'calc', calc_key: 'total', currency: 'USD' },
        });
        const out2 = await svc.submit(calc.token, IP, { values: { [f.nombre!.id]: 'Calc', [f.plan!.id]: 'pro' }, uploads: {}, stamp: stamp(calc.id) });
        expect(out2.conversion).toMatchObject({ value: 125, currency: 'USD' });
        // Un cálculo que no existe vuelve a «sin valor» al guardar.
        const broken = await contactForm({ conversion: { value: 'calc', calc_key: 'noexiste' } });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ config: forms.config }).from(forms).where(eq(forms.id, broken.id)));
        expect(formConfigSchema.parse(row!.config).settings.conversion.value).toBe('none');
    });

    it('la página de gracias no acepta variables en el dominio; la trampa de robots no la completa', async () => {
        await expect(contactForm({ redirect_url: 'https://{{nombre}}.evil.co/x' })).rejects.toThrow();
        const form = await contactForm({ redirect_url: 'https://acme.co/gracias/{{nombre}}' });
        const robot = await svc.submit(form.token, IP, { values: { [f.nombre!.id]: '../../x' }, uploads: {}, stamp: stamp(form.id), hp: 'robot' });
        expect(robot.redirect_url).toBe('https://acme.co/gracias/');
        expect(robot.conversion).toBeUndefined();
        const real = await svc.submit(form.token, IP, { values: { [f.nombre!.id]: '../../x' }, uploads: {}, stamp: stamp(form.id) });
        // El valor no se sale de su segmento de la ruta.
        expect(real.redirect_url).toBe('https://acme.co/gracias/..%2F..%2Fx');
    });
});
