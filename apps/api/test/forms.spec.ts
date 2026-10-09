import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
    evaluateFormCondition,
    formConfigSchema,
    formItemVisible,
    newFormItemId,
    type Field,
    type FormConfig,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { activity, attachments, forms, lists as listsTable, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { formFrameAncestors, formPageCsp, renderFormPage } from '../src/forms/form-page';
import { FormsService, sanitizeConfig } from '../src/forms/forms.service';
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

class CapturingDispatcher extends AutomationDispatcher {
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

const IP = '203.0.113.7';

describe('v0.1.275 — formularios (puro)', () => {
    it('condiciones: igualdad, «alguno de», contiene, números y vacíos', () => {
        expect(evaluateFormCondition({ field_id: 1, op: 'eq', value: 'empresa' }, 'Empresa')).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'eq', value: 'empresa' }, ['persona', 'empresa'])).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'neq', value: 'empresa' }, null)).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'in', value: ['a', 'b'] }, 'b')).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'in', value: [] }, 'b')).toBe(false);
        expect(evaluateFormCondition({ field_id: 1, op: 'contains', value: 'bog' }, 'Bogotá')).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'gt', value: 10 }, '12')).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'lt', value: 10 }, 'abc')).toBe(false);
        expect(evaluateFormCondition({ field_id: 1, op: 'is_empty' }, false)).toBe(true);
        expect(evaluateFormCondition({ field_id: 1, op: 'is_not_empty' }, [])).toBe(false);
        expect(evaluateFormCondition({ field_id: 1, op: 'eq', value: true }, true)).toBe(true);
    });

    it('una pregunta cuyo campo de control está escondido también se esconde', () => {
        const items = [
            { type: 'field', field_id: 1, show_if: null },
            { type: 'field', field_id: 2, show_if: { field_id: 1, op: 'eq' as const, value: 'si' } },
            { type: 'field', field_id: 3, show_if: { field_id: 2, op: 'is_not_empty' as const } },
        ];
        // El 2 se respondió y después se escondió (el 1 cambió): el 3 no aparece.
        expect(formItemVisible(items[2]!, items, { '1': 'no', '2': 'algo' })).toBe(false);
        expect(formItemVisible(items[2]!, items, { '1': 'si', '2': 'algo' })).toBe(true);
        // Condición sobre un campo que ya no está en el formulario: no se cumple.
        expect(formItemVisible({ show_if: { field_id: 99, op: 'is_empty' } }, items, {})).toBe(false);
    });

    it('sanitizeConfig: campos de otra lista, repetidos o que no se preguntan, afuera', () => {
        const fields = [
            { id: 1, type: 'text' },
            { id: 2, type: 'relation' },
            { id: 3, type: 'select' },
        ];
        const cfg: FormConfig = formConfigSchema.parse({
            items: [
                { id: 'aaaa1', type: 'field', field_id: 1 },
                { id: 'aaaa2', type: 'field', field_id: 1 },
                { id: 'aaaa3', type: 'field', field_id: 2 },
                { id: 'aaaa4', type: 'field', field_id: 77 },
                { id: 'aaaa5', type: 'field', field_id: 3, show_if: { field_id: 2, op: 'is_empty' } },
                { id: 'aaaa6', type: 'heading', text: 'Datos' },
            ],
        });
        const out = sanitizeConfig(cfg, fields);
        expect(out.items.map((i) => i.id)).toEqual(['aaaa1', 'aaaa5', 'aaaa6']);
        // La condición apuntaba a un campo que no quedó en el formulario.
        expect(out.items[1]!.show_if).toBeNull();
    });

    it('página: CSP con nonce, sitios permitidos y nada del diseño como HTML', () => {
        expect(formFrameAncestors([])).toBe('*');
        expect(formFrameAncestors(['acme.com', 'https://www.acme.com/x', 'mal dominio<>', '*.acme.co'])).toBe(
            "'self' acme.com https://www.acme.com *.acme.co",
        );
        const csp = formPageCsp('abc', "'self'");
        expect(csp).toContain("script-src 'nonce-abc'");
        expect(csp).toContain("frame-ancestors 'self'");
        const html = renderFormPage({
            nonce: 'abc',
            title: '<b>Hola</b>',
            token: 'x',
            meta: { title: '</script><script>alert(1)</script>' } as never,
        });
        expect(html).toContain('<title>&lt;b&gt;Hola&lt;/b&gt;</title>');
        expect(html).not.toContain('</script><script>alert(1)');
        expect(html).toContain('<script nonce="abc">');
    });
});

describe('v0.1.275 — formularios (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let dispatcher: CapturingDispatcher;
    let svc: FormsService;
    let tenantId: number;
    let otherTenant: number;
    let listId: number;
    let f: Record<string, Field>;

    const oldStamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    const countRecords = async (): Promise<number> =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)))).length;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        dispatcher = new CapturingDispatcher();
        const recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
        );
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-secret' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-forms-'))), env);
        svc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;
        listId = (await lists.create(tenantId, { name: 'Contactos' })).id;
        f = {};
        f.nombre = await fieldsSvc.create(tenantId, 'contactos', { label: 'Nombre', type: 'text', slug: 'nombre' });
        f.email = await fieldsSvc.create(tenantId, 'contactos', { label: 'Email', type: 'email', slug: 'email' });
        f.tipo = await fieldsSvc.create(tenantId, 'contactos', {
            label: 'Tipo',
            type: 'select',
            slug: 'tipo',
            config: { options: [{ value: 'persona', label: 'Persona' }, { value: 'empresa', label: 'Empresa' }] },
        });
        f.nit = await fieldsSvc.create(tenantId, 'contactos', { label: 'NIT', type: 'text', slug: 'nit' });
        f.origen = await fieldsSvc.create(tenantId, 'contactos', { label: 'Origen', type: 'text', slug: 'origen' });
        f.interno = await fieldsSvc.create(tenantId, 'contactos', { label: 'Nota interna', type: 'text', slug: 'interno' });
        f.monto = await fieldsSvc.create(tenantId, 'contactos', { label: 'Presupuesto', type: 'currency', slug: 'monto' });
        f.adjunto = await fieldsSvc.create(tenantId, 'contactos', { label: 'Adjunto', type: 'file', slug: 'adjunto' });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        dispatcher.events.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    /** Formulario «Contacto»: nombre (obligatorio), email, tipo, NIT si es empresa, origen oculto. */
    type ItemIds = { nombre: string; email: string; tipo: string; nit: string; origen: string; monto: string; adjunto: string };
    async function contactForm(over: Record<string, unknown> = {}): Promise<{ id: number; token: string; ids: ItemIds }> {
        const ids: ItemIds = { nombre: newFormItemId(), email: newFormItemId(), tipo: newFormItemId(), nit: newFormItemId(), origen: newFormItemId(), monto: newFormItemId(), adjunto: newFormItemId() };
        const dto = await svc.create(tenantId, 0, 'contactos', {
            name: 'Contacto',
            config: formConfigSchema.parse({
                items: [
                    { id: ids.nombre, type: 'field', field_id: f.nombre!.id, required: true },
                    { id: ids.email, type: 'field', field_id: f.email!.id },
                    { id: ids.tipo, type: 'field', field_id: f.tipo!.id },
                    { id: ids.nit, type: 'field', field_id: f.nit!.id, required: true, show_if: { field_id: f.tipo!.id, op: 'eq', value: 'empresa' } },
                    { id: ids.origen, type: 'field', field_id: f.origen!.id, hidden: true },
                    { id: ids.monto, type: 'field', field_id: f.monto!.id },
                    { id: ids.adjunto, type: 'field', field_id: f.adjunto!.id },
                ],
                settings: { title: 'Escríbenos', ...over },
            }),
        });
        await svc.update(tenantId, 'contactos', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id), ids };
    }

    it('alta con el diseño de arranque: los campos que se preguntan, en orden, sin publicar', async () => {
        const dto = await svc.create(tenantId, 0, 'contactos', { name: 'Rápido' });
        expect(dto.enabled).toBe(false);
        expect(dto.config.settings.title).toBe('Contactos');
        const asked = dto.config.items.map((i) => (i.type === 'field' ? i.field_id : null));
        expect(asked).toEqual([f.nombre!.id, f.email!.id, f.tipo!.id, f.nit!.id, f.origen!.id, f.interno!.id, f.monto!.id, f.adjunto!.id]);
        // Sin publicar: la dirección responde igual que una que no existe.
        await expect(svc.meta(await tokenOf(dto.id))).rejects.toMatchObject({ status: 404 });
        await expect(svc.meta('no-existe-este-token-xyz')).rejects.toMatchObject({ status: 404 });
    });

    it('lo público trae SÓLO las preguntas del formulario (nada de la lista entera)', async () => {
        const { token } = await contactForm();
        const meta = await svc.meta(token);
        expect(meta.title).toBe('Escríbenos');
        expect(meta.closed).toBeNull();
        const labels = meta.items.flatMap((i) => (i.type === 'field' ? [i.label] : []));
        expect(labels).toEqual(['Nombre', 'Email', 'Tipo', 'NIT', 'Origen', 'Presupuesto', 'Adjunto']);
        expect(JSON.stringify(meta)).not.toContain('Nota interna');
        const tipo = meta.items.find((i) => i.type === 'field' && i.slug === 'tipo');
        expect(tipo).toMatchObject({ display: 'radio', options: [{ value: 'persona', label: 'Persona' }, { value: 'empresa', label: 'Empresa' }] });
        expect(meta.stamp).toMatch(/^\d+\.[0-9a-f]{64}$/);
    });

    it('envío: crea el registro sólo con lo que el formulario pregunta y avisa a las automatizaciones', async () => {
        const { id, token } = await contactForm();
        const res = await svc.submit(token, IP, {
            values: {
                [f.nombre!.id]: 'Ana Pérez',
                [f.email!.id]: 'ANA@acme.co',
                [f.tipo!.id]: 'persona',
                // El NIT se respondió pero la pregunta está escondida (no es empresa): no se guarda.
                [f.nit!.id]: '900123',
                [f.origen!.id]: 'instagram',
                // Una columna que el formulario NO pregunta: se ignora.
                [f.interno!.id]: 'hackeado',
                [f.monto!.id]: 150000,
            },
            uploads: {},
            stamp: oldStamp(id),
        });
        expect(res).toEqual({ ok: true, redirect_url: null });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect(rec!.data).toEqual({
            [`f${f.nombre!.id}`]: 'Ana Pérez',
            [`f${f.email!.id}`]: 'ana@acme.co',
            [`f${f.tipo!.id}`]: 'persona',
            [`f${f.origen!.id}`]: 'instagram',
            [`f${f.monto!.id}`]: 150000,
        });
        expect(rec!.createdBy).toBe(0);
        // La actividad del alta no se atribuye a "usuario #0".
        const [act] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.recordId, rec!.id)));
        expect(act!.userId).toBeNull();
        expect(dispatcher.events.map((e) => e.trigger)).toEqual(['record_created', 'form_submitted']);
        expect(dispatcher.events[1]!.form).toEqual({ id, name: 'Contacto' });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, id)));
        expect(row!.submissionsCount).toBe(1);
        expect(row!.lastSubmittedAt).not.toBeNull();
    });

    it('obligatorias y datos inválidos vuelven por pregunta; la condicional cuenta sólo si se ve', async () => {
        const { id, token, ids } = await contactForm();
        await expect(
            svc.submit(token, IP, {
                values: { [f.email!.id]: 'no-es-un-correo', [f.tipo!.id]: 'empresa' },
                uploads: {},
                stamp: oldStamp(id),
            }),
        ).rejects.toMatchObject({
            response: { code: 'form_invalid', data: { errors: { [ids.nombre]: expect.any(String), [ids.email]: 'Email inválido.', [ids.nit]: 'Esta pregunta es obligatoria.' } } },
        });
        expect(await countRecords()).toBe(0);
    });

    it('robots: el campo trampa se "acepta" sin guardar; el sello falso o apurado se rechaza', async () => {
        const { id, token } = await contactForm();
        const ok = await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Bot' }, uploads: {}, stamp: oldStamp(id), hp: 'http://spam' });
        expect(ok.ok).toBe(true);
        expect(await countRecords()).toBe(0);
        const fresh = `${Date.now()}.${files.signParts('formstamp', id, Date.now())}`;
        await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: 'Rápido' }, uploads: {}, stamp: fresh })).rejects.toMatchObject({
            response: { code: 'form_too_fast' },
        });
        await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: 'Falso' }, uploads: {}, stamp: '123.abc' })).rejects.toMatchObject({
            response: { code: 'form_stale' },
        });
        // El sello de OTRO formulario no sirve.
        const other = await contactForm();
        await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: 'Cruzado' }, uploads: {}, stamp: oldStamp(other.id) })).rejects.toMatchObject({
            response: { code: 'form_stale' },
        });
    });

    it('freno por IP: una persona no manda 9 respuestas en un minuto', async () => {
        const { id, token } = await contactForm();
        for (let i = 0; i < 8; i++) {
            await svc.submit(token, IP, { values: { [f.nombre!.id]: `R${i}` }, uploads: {}, stamp: oldStamp(id) });
        }
        await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: 'R9' }, uploads: {}, stamp: oldStamp(id) })).rejects.toMatchObject({ status: 429 });
        // Otra IP sigue pudiendo.
        await svc.submit(token, '198.51.100.9', { values: { [f.nombre!.id]: 'Otra IP' }, uploads: {}, stamp: oldStamp(id) });
        expect(await countRecords()).toBe(9);
    });

    it('cerrado: tope de respuestas, fecha vencida y empresa en solo-lectura', async () => {
        const { id, token } = await contactForm({ max_submissions: 1 });
        await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Primera' }, uploads: {}, stamp: oldStamp(id) });
        expect((await svc.meta(token)).closed).toMatch(/no está recibiendo/);
        await expect(svc.submit(token, IP, { values: { [f.nombre!.id]: 'Segunda' }, uploads: {}, stamp: oldStamp(id) })).rejects.toMatchObject({
            status: 403,
        });

        const past = await contactForm({ closes_at: '2020-01-01', closed_message: 'Inscripciones cerradas.' });
        expect((await svc.meta(past.token)).closed).toBe('Inscripciones cerradas.');

        const open = await contactForm();
        await pg.db.update(tenants).set({ status: 'past_due', paidUntil: new Date('2020-01-01') }).where(eq(tenants.id, tenantId));
        try {
            expect((await svc.meta(open.token)).closed).not.toBeNull();
            await expect(svc.submit(open.token, IP, { values: { [f.nombre!.id]: 'Impaga' }, uploads: {}, stamp: oldStamp(open.id) })).rejects.toMatchObject({
                status: 403,
            });
        } finally {
            await pg.db.update(tenants).set({ status: 'active', paidUntil: null }).where(eq(tenants.id, tenantId));
        }
    });

    it('archivos: el comprobante ata el archivo a ESTE formulario; los que nadie envió se borran', async () => {
        const { id, token } = await contactForm();
        const up = await svc.upload(token, IP, { filename: 'cv.pdf', mimetype: 'application/pdf', file: Readable.from([Buffer.from('%PDF-1.4 hola')]) });
        expect(up.name).toBe('cv.pdf');
        // Un comprobante alterado no adjunta nada.
        const [attId, exp] = up.token.split('.');
        await expect(
            svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana' }, uploads: { [f.adjunto!.id]: [`${Number(attId) + 1}.${exp}.deadbeef`] }, stamp: oldStamp(id) }),
        ).rejects.toMatchObject({ response: { code: 'form_invalid' } });

        await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana' }, uploads: { [f.adjunto!.id]: [up.token] }, stamp: oldStamp(id) });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect(rec!.data[`f${f.adjunto!.id}`]).toEqual([Number(attId)]);

        // Uno subido y nunca enviado: el barrido lo borra; el enviado queda.
        const orphan = await svc.upload(token, IP, { filename: 'olvidado.txt', mimetype: 'text/plain', file: Readable.from([Buffer.from('x')]) });
        const removed = await svc.sweepOrphanUploads(Date.now() + 25 * 3600 * 1000);
        expect(removed).toBe(1);
        const left = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: attachments.id }).from(attachments));
        expect(left.map((a) => a.id)).toEqual([Number(attId)]);
        expect(left.map((a) => a.id)).not.toContain(Number(orphan.token.split('.')[0]));
    });

    it('lista de una tienda online: no recibe formularios', async () => {
        const store = await lists.create(tenantId, { name: 'Productos tienda' });
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(listsTable)
                .set({ settings: { store_sync: { connection_id: 1, role: 'products' } } })
                .where(eq(listsTable.id, store.id)),
        );
        await expect(svc.create(tenantId, 0, String(store.id), { name: 'X' })).rejects.toMatchObject({ response: { code: 'store_managed' } });
    });

    it('RLS: los formularios de una empresa no se ven desde otra', async () => {
        await contactForm();
        const mine = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms));
        const theirs = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(forms));
        expect(mine.length).toBe(1);
        expect(theirs.length).toBe(0);
        await expect(svc.get(otherTenant, String(listId), mine[0]!.id)).rejects.toBeTruthy();
    });

    it('motor: «Cuando se envía un formulario» filtra por formulario y conoce {{formulario.nombre}}', async () => {
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
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
        const a = await contactForm();
        const b = await contactForm();
        await automations.create(tenantId, 'contactos', {
            name: 'Marcar origen',
            trigger_type: 'form_submitted',
            trigger_config: { form_id: a.id },
            actions: [{ type: 'update_field', config: { values: { interno: 'vino de {{formulario.nombre}}' } } }],
            is_active: true,
        });
        const run = async (form: { id: number; token: string }, nombre: string): Promise<unknown> => {
            dispatcher.events.length = 0;
            await svc.submit(form.token, `10.0.0.${form.id}`, { values: { [f.nombre!.id]: nombre }, uploads: {}, stamp: oldStamp(form.id) });
            const ev = dispatcher.events.find((e) => e.trigger === 'form_submitted')!;
            await engine.process(ev);
            const [rec] = await withTenant(pg.db, tenantId, (tx) =>
                tx.select().from(records).where(and(eq(records.listId, listId), eq(records.id, ev.recordId))),
            );
            return rec!.data[`f${f.interno!.id}`];
        };
        expect(await run(a, 'Por A')).toBe('vino de Contacto');
        expect(await run(b, 'Por B')).toBeUndefined();
    });
});
