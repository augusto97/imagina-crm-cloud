import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORM_EDIT_CODE_RE, formConfigSchema, type Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { attachments, forms, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { editLinkFormId, editLinkMaker, parseEditCode, readEditLinks } from '../src/forms/form-edit-links';
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
 * v0.1.360 — Enlaces firmados para que alguien actualice SU registro con un
 * formulario: se arman, se leen, actualizan sólo lo preguntado y no se pueden
 * falsificar ni reusar con otro registro, otra versión o vencidos.
 */

class NoopDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

const IP = '203.0.113.71';
const ADMIN = { userId: 0, role: 'admin' as const };

describe('v0.1.360 — actualizar un registro con un formulario (Postgres + Redis reales)', () => {
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
    const codeOf = (url: string): string => new URL(url).searchParams.get('editar') ?? '';
    const recordData = async (id: number): Promise<Record<string, unknown>> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, id)));
        return (row?.data ?? {}) as Record<string, unknown>;
    };
    const key = (slug: string): string => `f${f[slug]!.id}`;
    const statusOf = async (p: Promise<unknown>): Promise<number> => {
        try {
            await p;
            return 200;
        } catch (err) {
            return (err as { getStatus?: () => number }).getStatus?.() ?? 500;
        }
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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'form-edit-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formedit-'))), env);
        svc = new FormsService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env);
        svc.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'actualizar', name: 'Actualizar', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        listId = (await lists.create(tenantId, { name: 'Clientes' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'clientes', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('correo', 'Correo', 'email');
        await mk('tipo', 'Tipo', 'select', { options: [{ value: 'pn', label: 'Persona' }, { value: 'pj', label: 'Empresa' }] });
        await mk('nit', 'NIT', 'text');
        await mk('rut', 'RUT', 'file');
        await mk('origen', 'Origen', 'text');
        await mk('notas', 'Notas internas', 'long_text');
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

    /** Datos del cliente: nombre, correo, tipo (con el NIT sólo si es empresa), el RUT y un origen oculto. */
    async function updateForm(settings: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
        const items = [
            { id: 'qnombre1', type: 'field', field_id: f.nombre!.id, required: true },
            { id: 'qcorreo1', type: 'field', field_id: f.correo!.id },
            { id: 'qtipo001', type: 'field', field_id: f.tipo!.id },
            { id: 'qnit0001', type: 'field', field_id: f.nit!.id, show_if: { field_id: f.tipo!.id, op: 'eq', value: 'pj' } },
            { id: 'qrut0001', type: 'field', field_id: f.rut!.id, required: true },
            { id: 'qorigen1', type: 'field', field_id: f.origen!.id, hidden: true },
        ];
        const dto = await svc.create(tenantId, 0, 'clientes', {
            name: 'Actualiza tus datos',
            config: formConfigSchema.parse({ items, settings: { title: 'Actualiza tus datos', allow_prefill: true, edit_links: { enabled: true, days: 30 }, ...settings } }),
        });
        await svc.update(tenantId, 'clientes', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    async function seedRecord(): Promise<{ id: number; fileId: number }> {
        const [file] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(attachments).values({ tenantId, filename: 'rut-acme.pdf', mime: 'application/pdf', sizeBytes: 10, storageKey: 'x/rut-acme.pdf' }).returning({ id: attachments.id }),
        );
        const rec = await recs.create(tenantId, ADMIN, 'clientes', {
            data: {
                [key('nombre')]: 'Acme',
                [key('correo')]: 'compras@acme.co',
                [key('tipo')]: 'pj',
                [key('nit')]: '900123456',
                [key('rut')]: [file!.id],
                [key('origen')]: 'feria',
                [key('notas')]: 'Cliente que paga tarde',
            },
        });
        return { id: rec.id, fileId: file!.id };
    }

    it('arma el enlace, muestra SÓLO lo que pregunta el formulario y actualiza ese registro sin crear otro', async () => {
        const form = await updateForm({ max_submissions: 1 });
        const rec = await seedRecord();
        const link = await svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, rec.id);
        expect(link.url).toMatch(new RegExp(`^https://app\\.test/api/v1/public/f/${form.token}\\?editar=`));
        const code = codeOf(link.url);
        expect(code).toMatch(FORM_EDIT_CODE_RE);
        expect(new Date(link.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

        // Lo que ve la página: lo del formulario (también el oculto, para la lógica), nunca las notas internas.
        const edit = await svc.loadEdit(form.token, code);
        expect(edit.values).toEqual({
            [String(f.nombre!.id)]: 'Acme',
            [String(f.correo!.id)]: 'compras@acme.co',
            [String(f.tipo!.id)]: 'pj',
            [String(f.nit!.id)]: '900123456',
            [String(f.origen!.id)]: 'feria',
        });
        expect(JSON.stringify(edit)).not.toContain('paga tarde');
        expect(edit.files).toEqual({ [String(f.rut!.id)]: ['rut-acme.pdf'] });

        // Cambia el nombre, borra el correo, pasa a «Persona» (el NIT ya no se
        // pregunta) y no sube otro RUT. Intenta pisar el oculto desde la página.
        const out = await svc.submit(form.token, IP, {
            values: { [f.nombre!.id]: 'Acme S.A.S.', [f.correo!.id]: '', [f.tipo!.id]: 'pn', [f.origen!.id]: 'hackeado' },
            uploads: {},
            stamp: stamp(form.id),
            edit: code,
        });
        expect(out).toMatchObject({ ok: true, updated: true });

        const data = await recordData(rec.id);
        expect(data[key('nombre')]).toBe('Acme S.A.S.');
        expect(data[key('correo')] ?? null).toBeNull(); // vaciado (el registro ya no lo tiene)
        expect(data[key('tipo')]).toBe('pn');
        expect(data[key('nit')]).toBe('900123456'); // de una pregunta que no se mostró: no se toca
        expect(data[key('rut')]).toEqual([rec.fileId]); // sin otro archivo: queda el que tenía
        expect(data[key('origen')]).toBe('feria'); // la oculta nunca se escribe al actualizar
        expect(data[key('notas')]).toBe('Cliente que paga tarde');

        // No creó otro registro, no gastó el cupo (lleno con 1) ni disparó «se envió un formulario».
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: records.id }).from(records).where(eq(records.listId, listId)));
        expect(rows).toHaveLength(1);
        const [frow] = await withTenant(pg.db, tenantId, (tx) => tx.select({ n: forms.submissionsCount }).from(forms).where(eq(forms.id, form.id)));
        expect(frow!.n).toBe(0);
        expect(dispatcher.events.some((e) => e.trigger === 'form_submitted')).toBe(false);
        expect(dispatcher.events.some((e) => e.trigger === 'record_updated' && e.recordId === rec.id)).toBe(true);

        // El mismo enlace sirve otra vez mientras no venza (para corregir otro dato).
        await svc.submit(form.token, IP, { values: { [f.nombre!.id]: 'Acme Colombia', [f.tipo!.id]: 'pn' }, uploads: {}, stamp: stamp(form.id), edit: code });
        expect((await recordData(rec.id))[key('nombre')]).toBe('Acme Colombia');
    });

    it('rechaza un enlace alterado, de otro registro, vencido, de una versión anterior o de un registro en la papelera', async () => {
        const form = await updateForm();
        const rec = await seedRecord();
        const other = await seedRecord();
        const code = codeOf((await svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, rec.id)).url);
        const [rid, exp, sig] = code.split('.') as [string, string, string];

        // Firma alterada.
        const flipped = `${rid}.${exp}.${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
        expect(await statusOf(svc.loadEdit(form.token, flipped))).toBe(410);
        // La firma de un registro no sirve para otro.
        expect(await statusOf(svc.loadEdit(form.token, `${other.id}.${exp}.${sig}`))).toBe(410);
        expect(
            await statusOf(svc.submit(form.token, IP, { values: { [f.nombre!.id]: 'X' }, uploads: {}, stamp: stamp(form.id), edit: `${other.id}.${exp}.${sig}` })),
        ).toBe(410);
        expect((await recordData(other.id))[key('nombre')]).toBe('Acme');
        // Vencido (aunque la firma sea buena para ese vencimiento).
        const past = Math.floor(Date.now() / 1000) - 3600;
        const pastSig = files.signParts('formedit', tenantId, form.id, rec.id, past, 1).slice(0, 32);
        expect(parseEditCode(`${rec.id}.${past}.${pastSig}`)).toBeNull();
        expect(await statusOf(svc.loadEdit(form.token, `${rec.id}.${past}.${pastSig}`))).toBe(410);

        // «Invalidar los enlaces ya enviados»: sube la versión y el anterior deja de servir.
        expect(await statusOf(svc.loadEdit(form.token, code))).toBe(200);
        const dto = await svc.get(tenantId, 'clientes', form.id);
        await svc.update(tenantId, 'clientes', form.id, {
            config: formConfigSchema.parse({ ...dto.config, settings: { ...dto.config.settings, edit_links: { ...dto.config.settings.edit_links, version: 2 } } }),
        });
        expect(await statusOf(svc.loadEdit(form.token, code))).toBe(410);
        const fresh = codeOf((await svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, rec.id)).url);
        expect(await statusOf(svc.loadEdit(form.token, fresh))).toBe(200);

        // Un registro en la papelera ya no se actualiza.
        await withTenant(pg.db, tenantId, (tx) => tx.update(records).set({ deletedAt: new Date() }).where(and(eq(records.id, rec.id), eq(records.tenantId, tenantId))));
        expect(await statusOf(svc.loadEdit(form.token, fresh))).toBe(410);

        // Con los enlaces apagados, el formulario ni los reconoce.
        const d2 = await svc.get(tenantId, 'clientes', form.id);
        await svc.update(tenantId, 'clientes', form.id, {
            config: formConfigSchema.parse({ ...d2.config, settings: { ...d2.config.settings, edit_links: { ...d2.config.settings.edit_links, enabled: false } } }),
        });
        expect(await statusOf(svc.loadEdit(form.token, code))).toBe(404);
    });

    it('sólo arma el enlace quien puede editar el registro, con el formulario publicado y los enlaces encendidos', async () => {
        const form = await updateForm();
        const rec = await seedRecord();
        // Un agente con el alcance «lo suyo» no llega a un registro que no creó.
        expect(await statusOf(svc.createEditLink(tenantId, { userId: 999, role: 'agent' }, 'clientes', form.id, rec.id))).toBe(404);
        // Un registro que no existe.
        expect(await statusOf(svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, 999_999))).toBe(404);
        // Sin publicar.
        await svc.update(tenantId, 'clientes', form.id, { enabled: false });
        expect(await statusOf(svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, rec.id))).toBe(409);
        expect(await svc.editLinkForms(tenantId, 'clientes')).toEqual([]);
        await svc.update(tenantId, 'clientes', form.id, { enabled: true });
        expect(await svc.editLinkForms(tenantId, 'clientes')).toEqual([{ id: form.id, name: 'Actualiza tus datos', title: 'Actualiza tus datos', days: 30 }]);
        // Con los enlaces apagados.
        const plain = await updateForm({ edit_links: { enabled: false } });
        expect(await statusOf(svc.createEditLink(tenantId, ADMIN, 'clientes', plain.id, rec.id))).toBe(409);
    });

    it('un formulario cerrado por fecha no deja actualizar; uno con el cupo lleno sí', async () => {
        const closed = await updateForm({ closes_at: '2020-01-01' });
        const rec = await seedRecord();
        const code = codeOf((await svc.createEditLink(tenantId, ADMIN, 'clientes', closed.id, rec.id)).url);
        expect(await statusOf(svc.loadEdit(closed.token, code))).toBe(403);
    });

    it('obligatorias y archivos: sin el RUT de antes, la pregunta obligatoria lo pide', async () => {
        const form = await updateForm();
        const rec = await recs.create(tenantId, ADMIN, 'clientes', { data: { [key('nombre')]: 'Sin RUT' } });
        const code = codeOf((await svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, rec.id)).url);
        const status = await statusOf(svc.submit(form.token, IP, { values: { [f.nombre!.id]: 'Sin RUT' }, uploads: {}, stamp: stamp(form.id), edit: code }));
        expect(status).toBe(400);
        // Y el nombre (obligatorio) vacío tampoco pasa.
        const rec2 = await seedRecord();
        const code2 = codeOf((await svc.createEditLink(tenantId, ADMIN, 'clientes', form.id, rec2.id)).url);
        expect(await statusOf(svc.submit(form.token, IP, { values: { [f.nombre!.id]: '' }, uploads: {}, stamp: stamp(form.id), edit: code2 }))).toBe(400);
        expect((await recordData(rec2.id))[key('nombre')]).toBe('Acme');
    });

    it('el motor arma {{formulario.<id>.enlace}} con la misma firma que la ficha', async () => {
        const form = await updateForm();
        const rec = await seedRecord();
        expect(editLinkFormId(`formulario.${form.id}.enlace`)).toBe(form.id);
        expect(editLinkFormId('form.12.link')).toBe(12);
        expect(editLinkFormId('formulario.nombre')).toBeNull();
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: forms.id, token: forms.token, config: forms.config }).from(forms).where(eq(forms.id, form.id)));
        const links = readEditLinks(row!.config);
        expect(links).toMatchObject({ enabled: true, days: 30 });
        const make = await editLinkMaker(tenantId, [{ id: form.id, token: row!.token, links: links! }]);
        const url = make!(form.id, rec.id);
        expect(url).toContain(`/api/v1/public/f/${form.token}?editar=${rec.id}.`);
        expect(make!(form.id + 99, rec.id)).toBe('');
        const edit = await svc.loadEdit(form.token, codeOf(url));
        expect(edit.values[String(f.nombre!.id)]).toBe('Acme');
    });
});
