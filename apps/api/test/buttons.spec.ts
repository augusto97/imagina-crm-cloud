import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocumentStarter, type Field, type PressButtonResult } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { buildButtonUrl } from '../src/buttons/button-url';
import { ButtonsService } from '../src/buttons/buttons.service';
import {
    applyButtonAutomationRefs,
    cleanResolvedButtonConfig,
    extractButtonAutomationRefs,
    portableButtonConfig,
} from '../src/buttons/button-portable';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { activity, automationRuns, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DocumentsService } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { emptyMaps, remapButtonConfig } from '../src/platform/tenant-transfer.remap';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * Campo «Botón» (A5): el enlace con variables, presionar (cambiar campos con
 * actividad, deshabilitado, roles y permiso de edición), correr una
 * automatización con su disparador, generar un PDF, el lote y la portabilidad
 * de la config (plantillas y migración de empresa).
 */

describe('Campo «Botón» — enlace (puro)', () => {
    const values: Record<string, unknown> = {
        telefono: '+573001112233',
        nombre: 'Ana & Cía',
        web: 'https://acme.test',
        email: 'ana@acme.test',
        estado: 'pagado',
    };
    const types: Record<string, string> = { telefono: 'phone', nombre: 'text', web: 'url', email: 'email', estado: 'select' };
    const ctx = {
        valueOf: (t: string) => values[t],
        typeOf: (t: string) => types[t],
        recordId: 42,
        resolveLabel: (t: string, v: unknown) => (t === 'estado' && v === 'pagado' ? 'Pagado' : v),
    };

    it('WhatsApp: el teléfono con indicativo y sin «+», el mensaje codificado entero', () => {
        const r = buildButtonUrl('https://wa.me/{{telefono}}?text=Hola {{nombre}}, tu pedido #{{record.id}} está {{estado|label}} ✅', ctx);
        expect(r).toEqual({
            ok: true,
            url: 'https://wa.me/573001112233?text=Hola%20Ana%20%26%20C%C3%ADa,%20tu%20pedido%20%2342%20est%C3%A1%20Pagado%20%E2%9C%85',
        });
    });

    it('tel: con «+»; mailto con el correo legible; una variable al principio es la dirección base', () => {
        expect(buildButtonUrl('tel:{{telefono}}', ctx)).toEqual({ ok: true, url: 'tel:+573001112233' });
        expect(buildButtonUrl('mailto:{{email}}?subject=Factura {{record.id}}', ctx)).toEqual({
            ok: true,
            url: 'mailto:ana@acme.test?subject=Factura%2042',
        });
        expect(buildButtonUrl('{{web}}/contacto?de={{nombre}}', ctx)).toEqual({ ok: true, url: 'https://acme.test/contacto?de=Ana%20%26%20C%C3%ADa' });
        // Lo que ya venía codificado se respeta.
        expect(buildButtonUrl('https://maps.google.com/?q=Calle%2010', ctx)).toEqual({ ok: true, url: 'https://maps.google.com/?q=Calle%2010' });
    });

    it('sólo https, mailto y tel: nada de javascript:, data: ni http:', () => {
        expect(buildButtonUrl('javascript:alert(1)', ctx).ok).toBe(false);
        expect(buildButtonUrl('data:text/html,<b>x</b>', ctx).ok).toBe(false);
        expect(buildButtonUrl('http://acme.test', ctx).ok).toBe(false);
        // El valor de un registro tampoco puede volver el enlace un javascript:.
        const evil = { ...ctx, valueOf: (t: string) => (t === 'web' ? 'javascript:alert(document.cookie)' : values[t]) };
        expect(buildButtonUrl('{{web}}', evil)).toMatchObject({ ok: false });
        // Una variable vacía al principio deja un enlace inválido.
        const empty = { ...ctx, valueOf: () => '' };
        expect(buildButtonUrl('{{web}}/x', empty)).toMatchObject({ ok: false });
        expect(buildButtonUrl('   ', ctx)).toEqual({ ok: false, error: 'Falta el enlace.' });
    });
});

describe('Campo «Botón» — portabilidad de la config (puro)', () => {
    const config = {
        label: 'Cobrar',
        actions: [
            { type: 'update_fields', values: [{ field_id: 11, mode: 'set', value: 'pagado' }, { field_id: 99, mode: 'today' }] },
            { type: 'run_automation', automation_id: 501 },
            { type: 'generate_pdf', document_template_id: 7, mode: 'save', save_field_id: 12 },
        ],
        disabled_if: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 11, op: 'eq', value: 'pagado' }] },
    };

    it('blueprint: la automatización viaja por índice, la plantilla no viaja y se re-apunta al crear', () => {
        const portable = portableButtonConfig(config, new Map([[501, 0]]));
        const acts = portable.actions as Array<Record<string, unknown>>;
        expect(acts[1]).toEqual({ type: 'run_automation', automation_id: { $automation: 0 } });
        expect(acts[2]).not.toHaveProperty('document_template_id');
        const ex = extractButtonAutomationRefs(portable);
        expect(ex.refs).toEqual([{ action: 1, auto: 0 }]);
        expect((ex.config.actions as Array<Record<string, unknown>>)[1]).toEqual({ type: 'run_automation' });
        const applied = applyButtonAutomationRefs(ex.config, ex.refs, [777]);
        expect((applied.actions as Array<Record<string, unknown>>)[1]).toEqual({ type: 'run_automation', automation_id: 777 });
    });

    it('migración de empresa: campos, plantilla y automatización a los ids nuevos; lo que no resuelve se quita', () => {
        const maps = emptyMaps();
        maps.field.set(11, 111).set(12, 112);
        maps.document.set(7, 70);
        const out = remapButtonConfig(config, maps, new Map([[501, 5010]]));
        const acts = out.actions as Array<Record<string, unknown>>;
        expect(acts[0]).toEqual({ type: 'update_fields', values: [{ field_id: 111, mode: 'set', value: 'pagado' }] });
        expect(acts[1]).toEqual({ type: 'run_automation', automation_id: 5010 });
        expect(acts[2]).toEqual({ type: 'generate_pdf', document_template_id: 70, mode: 'save', save_field_id: 112 });
        expect((out.disabled_if as { children: Array<{ field_id: number }> }).children[0]!.field_id).toBe(111);
        // Una automatización que no viajó: el botón corre las que escuchan.
        const lost = remapButtonConfig(config, maps, new Map());
        expect((lost.actions as Array<Record<string, unknown>>)[1]).toEqual({ type: 'run_automation' });
        // Una condición cuyo campo no viajó desaparece (no deshabilita para siempre).
        const noCond = cleanResolvedButtonConfig({ actions: [], disabled_if: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: null, op: 'eq' }] } });
        expect(noCond).not.toHaveProperty('disabled_if');
    });
});

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

/** Una cola en memoria: guarda los jobs y deja procesarlos a mano. */
class MemoryQueue {
    readonly jobs = new Map<string, { data: TriggerEvent; state: string; returnvalue?: unknown }>();
    add(_name: string, data: TriggerEvent, opts: { jobId?: string }): Promise<{ id: string }> {
        const id = opts.jobId ?? `job-${this.jobs.size + 1}`;
        this.jobs.set(id, { data, state: 'waiting' });
        return Promise.resolve({ id });
    }
    getJob(id: string): Promise<unknown> {
        const j = this.jobs.get(id);
        if (!j) return Promise.resolve(undefined);
        return Promise.resolve({ ...j, getState: () => Promise.resolve(j.state), failedReason: null });
    }
}

describe('Campo «Botón» — presionar (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let docs: DocumentsService;
    let automations: AutomationsService;
    let engine: AutomationEngine;
    let buttons: ButtonsService;
    let queue: MemoryQueue;
    let tenantId: number;
    let ana: Actor;
    let agente: Actor;
    let viewer: Actor;
    const f: Record<string, Field> = {};
    let otherListField: Field;
    let templateId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const tz = new TenantTimeZones(tenantDb);
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const dispatcher = new AutomationDispatcher();
        queue = new MemoryQueue();
        dispatcher.setQueue(queue as never);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activitySvc, dispatcher, new RelationsRepository(), undefined, undefined, undefined, tz);
        const env = loadEnv({ FILES_SIGNING_SECRET: 'test-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-btn-'))), env);
        const audit = new AuditService(tenantDb);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, audit);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), noHooks, connectors);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new CapturingMailTransport()),
            connectors,
        );
        buttons = new ButtonsService(tenantDb, lists, fieldsSvc, recs, activitySvc, dispatcher, automations, docs, rt, tz);

        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        agente = { userId: await mk('agente@acme.test', 'Agente'), role: 'agent' };
        viewer = { userId: await mk('viewer@acme.test', 'Vera'), role: 'viewer' };
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana.userId, role: 'admin' },
                { tenantId, userId: agente.userId, role: 'agent' },
                { tenantId, userId: viewer.userId, role: 'viewer' },
            ]),
        );

        await lists.create(tenantId, { name: 'Facturas', slug: 'facturas' });
        await lists.create(tenantId, { name: 'Otra', slug: 'otra' });
        f.cliente = await fieldsSvc.create(tenantId, 'facturas', { label: 'Cliente', type: 'text', slug: 'cliente' });
        f.estado = await fieldsSvc.create(tenantId, 'facturas', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagado', label: 'Pagado' }] },
        });
        f.pago = await fieldsSvc.create(tenantId, 'facturas', { label: 'Fecha de pago', type: 'date', slug: 'fecha_pago' });
        f.cobrador = await fieldsSvc.create(tenantId, 'facturas', { label: 'Cobrador', type: 'user', slug: 'cobrador' });
        f.llamadas = await fieldsSvc.create(tenantId, 'facturas', { label: 'Llamadas', type: 'number', slug: 'llamadas' });
        f.telefono = await fieldsSvc.create(tenantId, 'facturas', { label: 'Teléfono', type: 'phone', slug: 'telefono' });
        f.documento = await fieldsSvc.create(tenantId, 'facturas', { label: 'Documento', type: 'file', slug: 'documento' });
        otherListField = await fieldsSvc.create(tenantId, 'otra', { label: 'Nota', type: 'text', slug: 'nota' });
        const tpl = await docs.create(tenantId, ana.userId, 'facturas', {
            name: 'Cuenta de cobro',
            filename: 'Cuenta {{record.id}}',
            design: buildDocumentStarter('cuenta_cobro', { fields: { cliente: 'cliente' } }).design,
        });
        templateId = tpl.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    const k = (field: Field) => `f${field.id}`;
    const newInvoice = (data: Record<string, unknown> = {}) =>
        recs.create(tenantId, ana, 'facturas', { data: { [k(f.cliente!)]: 'Beta Ltda.', [k(f.estado!)]: 'pendiente', [k(f.telefono!)]: '+573001112233', ...data } });
    const ok = (r: PressButtonResult) => {
        expect(r.actions.filter((a) => !a.ok)).toEqual([]);
        expect(r.ok).toBe(true);
        return r;
    };

    it('la config se valida al guardar: campos de otra lista, tipos y enlaces peligrosos se rechazan', async () => {
        const bad = (config: Record<string, unknown>) =>
            expect(fieldsSvc.create(tenantId, 'facturas', { label: 'Malo', type: 'button', config })).rejects.toMatchObject({ response: { code: 'invalid_button_config' } });
        await bad({ actions: [{ type: 'update_fields', values: [{ field_id: otherListField.id, mode: 'set', value: 'x' }] }] });
        await bad({ actions: [{ type: 'update_fields', values: [{ field_id: f.estado!.id, mode: 'set', value: 'no_existe' }] }] });
        await bad({ actions: [{ type: 'update_fields', values: [{ field_id: f.cliente!.id, mode: 'today' }] }] });
        await bad({ actions: [{ type: 'open_url', url: 'javascript:alert(1)' }] });
        await bad({ actions: [{ type: 'generate_pdf', document_template_id: 999_999 }] });
        await expect(fieldsSvc.create(tenantId, 'facturas', { label: 'Malo', type: 'button', config: { actions: [{ type: 'teleport' }] } })).rejects.toMatchObject({
            response: { code: 'invalid_field_config' },
        });
        // Un botón no se convierte a otro tipo (ni al revés).
        const conv = await fieldsSvc.create(tenantId, 'facturas', { label: 'Conv', type: 'button', config: { actions: [] } });
        await expect(fieldsSvc.update(tenantId, 'facturas', String(conv.id), { type: 'text' })).rejects.toMatchObject({ response: { code: 'type_not_convertible' } });
        await fieldsSvc.remove(tenantId, 'facturas', String(conv.id), { internal: true });
    });

    it('«Marcar como pagado»: cambia los campos, deja actividad, y después queda deshabilitado con su motivo', async () => {
        f.pagar = await fieldsSvc.create(tenantId, 'facturas', {
            label: 'Pagar',
            type: 'button',
            slug: 'pagar',
            config: {
                label: 'Marcar como pagado',
                color: 'green',
                icon: 'check',
                confirm: '¿Marcar como pagado?',
                actions: [
                    {
                        type: 'update_fields',
                        values: [
                            { field_id: f.estado!.id, mode: 'set', value: 'pagado' },
                            { field_id: f.pago!.id, mode: 'today' },
                            { field_id: f.cobrador!.id, mode: 'me' },
                            { field_id: f.llamadas!.id, mode: 'add', value: 1 },
                        ],
                    },
                ],
                disabled_if: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.estado!.id, op: 'eq', value: 'pagado' }] },
                disabled_reason: 'Ya está pagado',
            },
        });
        // Un PATCH que trae un valor para el botón no rompe ni lo guarda.
        const r = await newInvoice({ [k(f.pagar)]: 'x', [k(f.llamadas!)]: 2 });
        expect(r.data).not.toHaveProperty(k(f.pagar));

        const res = ok(await buttons.press(tenantId, ana, 'facturas', r.id, f.pagar.id));
        expect(res.message).toBe('Listo: «Marcar como pagado».');
        expect(res.actions[0]).toMatchObject({ type: 'update_fields', ok: true, changed: ['Estado', 'Fecha de pago', 'Cobrador', 'Llamadas'] });
        const after = await recs.get(tenantId, ana, 'facturas', r.id);
        expect(after.data[k(f.estado!)]).toBe('pagado');
        expect(after.data[k(f.pago!)]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(after.data[k(f.cobrador!)]).toBe(ana.userId);
        expect(after.data[k(f.llamadas!)]).toBe(3);

        const log = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(activity).where(and(eq(activity.tenantId, tenantId), eq(activity.recordId, r.id))),
        );
        const pressed = log.find((a) => a.action === 'button_pressed');
        expect(pressed?.userId).toBe(ana.userId);
        expect(pressed?.diff).toMatchObject({ button: { field_id: f.pagar.id, label: 'Marcar como pagado', ok: true, actions: ['update_fields'] } });
        expect(log.some((a) => a.action === 'record_updated' && k(f.estado!) in (a.diff as Record<string, unknown>))).toBe(true);

        await expect(buttons.press(tenantId, ana, 'facturas', r.id, f.pagar.id)).rejects.toMatchObject({
            response: { code: 'button_disabled', data: { reason: 'Ya está pagado' } },
        });
    });

    it('roles y permiso de edición: el rol elegido, y para cambiar campos poder editar el registro', async () => {
        const r = await newInvoice();
        // El viewer puede presionar (todo el equipo por defecto) pero no editar.
        await expect(buttons.press(tenantId, viewer, 'facturas', r.id, f.pagar!.id)).rejects.toMatchObject({ response: { code: 'button_needs_edit' } });
        // El agente sólo alcanza lo suyo: un registro de Ana no lo ve.
        await expect(buttons.press(tenantId, agente, 'facturas', r.id, f.pagar!.id)).rejects.toMatchObject({ status: 404 });
        const propio = await recs.create(tenantId, agente, 'facturas', { data: { [k(f.cliente!)]: 'Del agente', [k(f.estado!)]: 'pendiente' } });
        ok(await buttons.press(tenantId, agente, 'facturas', propio.id, f.pagar!.id));

        // Un botón sólo para managers: el agente queda afuera aunque pueda editar.
        await fieldsSvc.update(tenantId, 'facturas', String(f.pagar!.id), { config: { ...f.pagar!.config, roles: ['manager'] } });
        const otro = await recs.create(tenantId, agente, 'facturas', { data: { [k(f.cliente!)]: 'Otro', [k(f.estado!)]: 'pendiente' } });
        await expect(buttons.press(tenantId, agente, 'facturas', otro.id, f.pagar!.id)).rejects.toMatchObject({ response: { code: 'button_forbidden' } });
        await fieldsSvc.update(tenantId, 'facturas', String(f.pagar!.id), { config: { ...f.pagar!.config, roles: undefined } });

        // Un botón que sólo abre un enlace sí lo presiona el viewer.
        f.whatsapp = await fieldsSvc.create(tenantId, 'facturas', {
            label: 'WhatsApp',
            type: 'button',
            slug: 'whatsapp',
            config: { icon: 'message', actions: [{ type: 'open_url', url: 'https://wa.me/{{telefono}}?text=Hola {{cliente}}, tu factura #{{record.id}} está {{estado|label}}' }] },
        });
        const res = ok(await buttons.press(tenantId, viewer, 'facturas', r.id, f.whatsapp.id));
        expect(res.actions[0]).toEqual({
            type: 'open_url',
            ok: true,
            url: `https://wa.me/573001112233?text=Hola%20Beta%20Ltda.,%20tu%20factura%20%23${r.id}%20est%C3%A1%20Pendiente`,
        });
        expect(res.record).toBeNull();
    });

    it('«Correr una automatización»: se encola con el botón y sólo corren las que lo escuchan', async () => {
        f.avisar = await fieldsSvc.create(tenantId, 'facturas', { label: 'Avisar', type: 'button', slug: 'avisar', config: { actions: [{ type: 'run_automation' }] } });
        const r = await newInvoice();
        await expect(buttons.press(tenantId, ana, 'facturas', r.id, f.avisar.id)).rejects.toMatchObject({ response: { code: 'button_no_automation' } });
        expect([...queue.jobs.values()].some((j) => j.data.trigger === 'button_pressed')).toBe(false);
        const nota = await fieldsSvc.create(tenantId, 'facturas', { label: 'Nota', type: 'text', slug: 'nota' });
        const mine = await automations.create(tenantId, 'facturas', {
            name: 'Avisar al cobrar',
            trigger_type: 'button_pressed',
            trigger_config: { button_field_id: f.avisar.id },
            actions: [{ type: 'update_field', config: { values: { nota: 'Avisado por {{boton.persona}} con «{{boton.nombre}}»' } } }],
        });
        // Otra que escucha OTRO botón no corre.
        await automations.create(tenantId, 'facturas', {
            name: 'De otro botón',
            trigger_type: 'button_pressed',
            trigger_config: { button_field_id: f.whatsapp!.id },
            actions: [{ type: 'update_field', config: { values: { nota: 'no debería' } } }],
        });
        const res = ok(await buttons.press(tenantId, ana, 'facturas', r.id, f.avisar.id));
        const act = res.actions[0] as Extract<PressButtonResult['actions'][number], { type: 'run_automation'; ok: true }>;
        expect(act.automations).toEqual([{ id: mine.id, name: 'Avisar al cobrar' }]);
        expect(act.press_id).toMatch(new RegExp(`^btn-${tenantId}-`));

        // El worker procesa el evento (aquí, a mano) y deja la corrida.
        const job = queue.jobs.get(act.press_id!)!;
        expect(job.data).toMatchObject({ trigger: 'button_pressed', recordId: r.id, button: { field_id: f.avisar.id, user_name: 'Ana' }, automation_ids: [mine.id] });
        expect(await buttons.pressStatus(tenantId, 'facturas', act.press_id!)).toEqual({ state: 'queued', runs: [] });
        const runs = await engine.process(job.data);
        Object.assign(job, { state: 'completed', returnvalue: runs });
        expect(runs.map((x) => x.automation_id)).toEqual([mine.id]);
        const status = await buttons.pressStatus(tenantId, 'facturas', act.press_id!);
        expect(status).toEqual({ state: 'done', runs: [{ automation_id: mine.id, name: 'Avisar al cobrar', status: 'success', error: null }] });
        const after = await recs.get(tenantId, ana, 'facturas', r.id);
        expect(after.data[k(nota)]).toBe('Avisado por Ana con «Avisar»');
        // Una corrida por botón (no por la otra automatización).
        const all = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.recordId, r.id)));
        expect(all).toHaveLength(1);

        // Un botón que corre UNA automatización puntual: se valida al guardar.
        await expect(
            fieldsSvc.update(tenantId, 'facturas', String(f.avisar.id), { config: { actions: [{ type: 'run_automation', automation_id: 999_999 }] } }),
        ).rejects.toMatchObject({ response: { code: 'invalid_button_config' } });
    });

    it('«Generar un PDF»: descargar devuelve el PDF; guardar lo deja en el campo Archivo; la plantilla en uso no se borra', async () => {
        f.pdf = await fieldsSvc.create(tenantId, 'facturas', {
            label: 'PDF',
            type: 'button',
            slug: 'pdf',
            config: { actions: [{ type: 'generate_pdf', document_template_id: templateId, mode: 'download' }] },
        });
        const r = await newInvoice();
        const res = ok(await buttons.press(tenantId, ana, 'facturas', r.id, f.pdf.id));
        const pdf = res.actions[0] as Extract<PressButtonResult['actions'][number], { type: 'generate_pdf'; ok: true }>;
        expect(Buffer.from(pdf.pdf!, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.filename).toBe(`Cuenta ${r.id}.pdf`);

        await fieldsSvc.update(tenantId, 'facturas', String(f.pdf.id), {
            config: { actions: [{ type: 'generate_pdf', document_template_id: templateId, mode: 'save', save_field_id: f.documento!.id }] },
        });
        const saved = ok(await buttons.press(tenantId, ana, 'facturas', r.id, f.pdf.id));
        const fileId = (saved.actions[0] as { file_id: number }).file_id;
        expect(fileId).toBeGreaterThan(0);
        expect((saved.record as { data: Record<string, unknown> }).data[k(f.documento!)]).toEqual([fileId]);

        await expect(docs.remove(tenantId, ana.userId, 'facturas', templateId)).rejects.toMatchObject({
            response: { code: 'document_template_in_use', data: { buttons: ['PDF'] } },
        });
    });

    it('en lote: cada fila con su resultado; los que abren enlaces no van en lote', async () => {
        const a = await newInvoice();
        const b = await newInvoice({ [k(f.estado!)]: 'pagado' });
        const c = await newInvoice();
        const res = await buttons.pressBulk(tenantId, ana, 'facturas', f.pagar!.id, [a.id, b.id, c.id, 999_999]);
        expect(res.ok).toBe(2);
        expect(res.failed).toBe(2);
        expect(res.results.find((x) => x.id === b.id)).toMatchObject({ ok: false, message: 'No se puede presionar «Marcar como pagado»: Ya está pagado' });
        expect((await recs.get(tenantId, ana, 'facturas', c.id)).data[k(f.estado!)]).toBe('pagado');
        await expect(buttons.pressBulk(tenantId, ana, 'facturas', f.whatsapp!.id, [a.id])).rejects.toMatchObject({ response: { code: 'button_no_bulk' } });
    });

    it('una acción que falla frena las siguientes y la respuesta dice por qué', async () => {
        const broken = await fieldsSvc.create(tenantId, 'facturas', {
            label: 'Roto',
            type: 'button',
            slug: 'roto',
            config: {
                actions: [
                    { type: 'open_url', url: '{{cliente}}' },
                    { type: 'update_fields', values: [{ field_id: f.estado!.id, mode: 'set', value: 'pagado' }] },
                ],
            },
        });
        const r = await newInvoice();
        const res = await buttons.press(tenantId, ana, 'facturas', r.id, broken.id);
        expect(res.ok).toBe(false);
        expect(res.actions[0]).toMatchObject({ type: 'open_url', ok: false });
        expect(res.actions[1]).toMatchObject({ type: 'update_fields', ok: false, skipped: true });
        expect((await recs.get(tenantId, ana, 'facturas', r.id)).data[k(f.estado!)]).toBe('pendiente');
    });
});
