import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { ChecklistsRepository } from '../src/checklists/checklists.repository';
import { ChecklistsService, completedChecklists } from '../src/checklists/checklists.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import {
    activity,
    automationRuns,
    automations,
    forms,
    memberships,
    recordChecklistItems,
    recordChecklists,
    records as recordsTable,
    recordTemplates,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub, type NotifyEvent } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordTemplatesService } from '../src/record-templates/record-templates.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { toBundleRow } from '../src/records/records-grouped.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve(null),
    expire: () => Promise.resolve(null),
    lrange: () => Promise.resolve([]),
};

/**
 * A9 + C6 — Checklists dentro del registro y plantillas de registro, con
 * Postgres real y RLS: permisos (ver = ver el registro, marcar = editarlo),
 * progreso en el listado y la columna «Avance», el disparador «se completa un
 * checklist», «Mi trabajo», convertir en subtarea, y el alta desde una
 * plantilla en UNA transacción (con el límite del plan para el lote entero).
 */
describe('Checklists y plantillas de registro (Postgres real + RLS)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let checklists: ChecklistsService;
    let templates: RecordTemplatesService;
    let aggregate: AggregateService;
    let notifications: NotificationsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let billing: BillingService;
    const dispatcher = new CapturingDispatcher();
    const hubEvents: NotifyEvent[] = [];
    let tenantA: number;
    let tenantB: number;
    let ana: Actor;
    let beto: Actor;
    let vero: Actor;
    let caro: Actor;
    let clienteId: number;
    const f: Record<string, Field> = {};
    const k = (slug: string): string => `f${f[slug]!.id}`;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const plans = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const hub = new NotifyHub();
        hub.subscribe((e) => void hubEvents.push(e));
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const zones = new TenantTimeZones(tenantDb);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            activitySvc,
            dispatcher,
            new RelationsRepository(),
            undefined,
            undefined,
            billing,
            zones,
            hub,
        );
        checklists = new ChecklistsService(tenantDb, lists, fieldsSvc, recs, new RecordsRepository(), new ChecklistsRepository(), activitySvc, rt, dispatcher, hub, zones);
        templates = new RecordTemplatesService(
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            new RecordsRepository(),
            checklists,
            new ChecklistsRepository(),
            activitySvc,
            rt,
            new AuditService(tenantDb),
            zones,
        );
        aggregate = new AggregateService(tenantDb, lists, fieldsSvc);
        notifications = new NotificationsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            rt,
            { enqueue: () => Promise.resolve() } as never,
            null as never,
            loadEnv({ APP_BASE_URL: 'https://app.test' }),
            undefined,
            undefined,
            zones,
        );
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            lists,
            new AutomationScheduler(),
            noHooks,
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            billing,
        );
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new CapturingMail()),
            connectors,
            undefined,
            dispatcher,
            billing,
            undefined,
            zones,
            undefined,
            undefined,
            // Como lo resuelve la app (ModuleRef): registros y plantillas.
            { get: (cls: unknown) => (cls === RecordTemplatesService ? templates : recs) } as never,
        );

        const [ta] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'Acme', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        beto = { userId: await mk('beto@acme.test', 'Beto'), role: 'agent' };
        vero = { userId: await mk('vero@acme.test', 'Vero'), role: 'viewer' };
        caro = { userId: await mk('caro@acme.test', 'Caro'), role: 'manager' };
        clienteId = await mk('cli@cliente.test', 'Cliente');
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([
                { tenantId: tenantA, userId: ana.userId, role: 'admin' },
                { tenantId: tenantA, userId: beto.userId, role: 'agent' },
                { tenantId: tenantA, userId: vero.userId, role: 'viewer' },
                { tenantId: tenantA, userId: caro.userId, role: 'manager' },
                { tenantId: tenantA, userId: clienteId, role: 'client' },
            ]),
        );
        await lists.create(tenantA, { name: 'Proyectos', slug: 'proyectos' });
        f.nombre = await fieldsSvc.create(tenantA, 'proyectos', { label: 'Nombre', type: 'text', slug: 'nombre' });
        f.estado = await fieldsSvc.create(tenantA, 'proyectos', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'curso', label: 'En curso' }] },
        });
        f.responsable = await fieldsSvc.create(tenantA, 'proyectos', { label: 'Responsable', type: 'user', slug: 'responsable' });
        f.inicio = await fieldsSvc.create(tenantA, 'proyectos', { label: 'Inicio', type: 'date', slug: 'inicio' });
        f.entrega = await fieldsSvc.create(tenantA, 'proyectos', { label: 'Entrega', type: 'date', slug: 'entrega' });
        f.avance = await fieldsSvc.create(tenantA, 'proyectos', { label: 'Avance', type: 'checklist_progress', slug: 'avance' });
        f.calculado = await fieldsSvc.create(tenantA, 'proyectos', {
            label: 'Suma',
            type: 'computed',
            slug: 'suma',
            config: { operation: 'concat', inputs: [f.nombre.id] },
        });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        dispatcher.events.length = 0;
        hubEvents.length = 0;
        billing.recordLimit = BillingService.prototype.recordLimit;
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantA));
            await tx.delete(automations).where(eq(automations.tenantId, tenantA));
            await tx.delete(forms).where(eq(forms.tenantId, tenantA));
            await tx.delete(recordChecklistItems).where(eq(recordChecklistItems.tenantId, tenantA));
            await tx.delete(recordChecklists).where(eq(recordChecklists.tenantId, tenantA));
            await tx.delete(recordTemplates).where(eq(recordTemplates.tenantId, tenantA));
            await tx.delete(activity).where(eq(activity.tenantId, tenantA));
            await tx.delete(recordsTable).where(eq(recordsTable.tenantId, tenantA));
        });
    });

    const rec = async (name: string, by: Actor = ana, extra: Record<string, unknown> = {}) =>
        (await recs.create(tenantA, by, 'proyectos', { data: { [k('nombre')]: name, ...extra } })).id;
    const actions = async (recordId: number) =>
        (await withTenant(pg.db, tenantA, (tx) => tx.select().from(activity).where(eq(activity.recordId, recordId)).orderBy(activity.id))).map((a) => a.action);
    const completions = () => dispatcher.events.filter((e) => e.trigger === 'checklist_completed');

    it('crear, agregar, marcar, editar, mover y borrar: cada paso queda en la actividad', async () => {
        const id = await rec('Sitio web');
        let out = await checklists.create(tenantA, ana, 'proyectos', id, { name: 'Lanzamiento', items: [{ text: 'Diseño' }, { text: 'Contenido' }] });
        const cl = out.checklists[0]!;
        expect(cl.items.map((i) => i.text)).toEqual(['Diseño', 'Contenido']);
        out = await checklists.addItems(tenantA, ana, 'proyectos', id, cl.id, { items: [{ text: 'Revisión' }], after_id: cl.items[0]!.id });
        expect(out.checklists[0]!.items.map((i) => i.text)).toEqual(['Diseño', 'Revisión', 'Contenido']);
        const diseño = out.checklists[0]!.items[0]!;
        out = await checklists.updateItem(tenantA, ana, 'proyectos', id, diseño.id, { done: true, assignee_id: caro.userId, due: '2026-11-03' });
        expect(out.checklists[0]!.items[0]).toMatchObject({ done: true, done_by: ana.userId, assignee_id: caro.userId, due: '2026-11-03' });
        expect(out).toMatchObject({ done: 1, total: 3 });
        const ids = out.checklists[0]!.items.map((i) => i.id).reverse();
        out = await checklists.reorderItems(tenantA, ana, 'proyectos', id, cl.id, { ids }.ids);
        expect(out.checklists[0]!.items.map((i) => i.text)).toEqual(['Contenido', 'Revisión', 'Diseño']);
        out = await checklists.removeItem(tenantA, ana, 'proyectos', id, out.checklists[0]!.items[1]!.id);
        out = await checklists.rename(tenantA, ana, 'proyectos', id, cl.id, { name: 'Salida' });
        expect(out.checklists[0]!.name).toBe('Salida');
        expect(await actions(id)).toEqual([
            'record_created',
            'checklist_created',
            'checklist_items_added',
            'checklist_item_checked',
            'checklist_item_updated',
            'checklist_item_deleted',
            'checklist_updated',
        ]);
        // Asignar avisa a la persona (la de otro, no la propia).
        expect(hubEvents).toEqual([
            expect.objectContaining({ type: 'checklist_assigned', recordId: id, actorId: ana.userId, assignments: [{ userId: caro.userId, text: 'Diseño', checklist: 'Lanzamiento' }] }),
        ]);
        out = await checklists.remove(tenantA, ana, 'proyectos', id, cl.id);
        expect(out).toEqual({ checklists: [], done: 0, total: 0 });
    });

    it('«se completa un checklist»: una vez por checklist, con all_done sólo en el último', async () => {
        const id = await rec('Mudanza');
        const a = (await checklists.create(tenantA, ana, 'proyectos', id, { name: 'Antes', items: [{ text: 'Cajas' }] })).checklists[0]!;
        const b = (await checklists.create(tenantA, ana, 'proyectos', id, { name: 'Después', items: [{ text: 'Desempacar' }, { text: 'Limpiar' }] })).checklists[1]!;
        expect(completions()).toHaveLength(0);
        await checklists.updateItem(tenantA, ana, 'proyectos', id, a.items[0]!.id, { done: true });
        expect(completions().map((e) => e.checklist)).toEqual([{ id: a.id, name: 'Antes', all_done: false, total: 1 }]);
        await checklists.updateItem(tenantA, ana, 'proyectos', id, b.items[0]!.id, { done: true });
        expect(completions()).toHaveLength(1);
        await checklists.updateItem(tenantA, ana, 'proyectos', id, b.items[1]!.id, { done: true });
        expect(completions().map((e) => e.checklist)).toEqual([
            { id: a.id, name: 'Antes', all_done: false, total: 1 },
            { id: b.id, name: 'Después', all_done: true, total: 2 },
        ]);
        // Desmarcar y volver a marcar vuelve a disparar (se completó de nuevo).
        await checklists.updateItem(tenantA, ana, 'proyectos', id, a.items[0]!.id, { done: false });
        await checklists.updateItem(tenantA, ana, 'proyectos', id, a.items[0]!.id, { done: true });
        expect(completions()).toHaveLength(3);
        // Puro: dos que se completan juntos → all_done sólo en el último.
        const item = (done: boolean) => ({ id: 1, checklist_id: 1, text: 'x', done, done_by: null, done_at: null, assignee_id: null, due: null, position: 0, created_at: '' });
        const cl = (id: number, done: boolean) => ({ id, list_id: 1, record_id: 1, name: `C${id}`, position: id, items: [item(done)], created_at: '' });
        expect(completedChecklists([cl(1, false), cl(2, false)], [cl(1, true), cl(2, true)])).toEqual([
            { id: 1, name: 'C1', all_done: false, total: 1 },
            { id: 2, name: 'C2', all_done: true, total: 1 },
        ]);
    });

    it('permisos: ver = ver el registro; marcar = poder editarlo; responsables del equipo', async () => {
        const id = await rec('Contrato');
        const cl = (await checklists.create(tenantA, ana, 'proyectos', id, { items: [{ text: 'Firmar' }] })).checklists[0]!;
        // El agente ve sólo lo suyo: el registro de Ana no existe para él.
        await expect(checklists.forRecord(tenantA, beto, 'proyectos', id)).rejects.toBeInstanceOf(NotFoundException);
        await expect(checklists.updateItem(tenantA, beto, 'proyectos', id, cl.items[0]!.id, { done: true })).rejects.toBeInstanceOf(NotFoundException);
        // Quien sólo mira lo ve, pero no lo marca.
        expect((await checklists.forRecord(tenantA, vero, 'proyectos', id)).total).toBe(1);
        await expect(checklists.updateItem(tenantA, vero, 'proyectos', id, cl.items[0]!.id, { done: true })).rejects.toBeInstanceOf(ForbiddenException);
        // En su propio registro el agente sí.
        const propio = await rec('Mío', beto);
        const suyo = (await checklists.create(tenantA, beto, 'proyectos', propio, { items: [{ text: 'Hacer' }] })).checklists[0]!;
        expect((await checklists.updateItem(tenantA, beto, 'proyectos', propio, suyo.items[0]!.id, { done: true })).done).toBe(1);
        // Responsable: un cliente del portal o alguien de afuera → 400.
        await expect(checklists.updateItem(tenantA, ana, 'proyectos', id, cl.items[0]!.id, { assignee_id: clienteId })).rejects.toBeInstanceOf(BadRequestException);
        // Un ítem de OTRO registro no se toca por este.
        await expect(checklists.updateItem(tenantA, ana, 'proyectos', id, suyo.items[0]!.id, { done: false })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('RLS: otra empresa no ve checklists, ítems ni plantillas', async () => {
        const id = await rec('Privado');
        await checklists.create(tenantA, ana, 'proyectos', id, { items: [{ text: 'Secreto' }] });
        await templates.create(tenantA, ana.userId, 'proyectos', { kind: 'record', name: 'Base', content: { values: {}, subtasks: [], checklists: [], record_description: null } });
        const seen = await withTenant(pg.db, tenantB, async (tx) => ({
            cl: await tx.select().from(recordChecklists),
            it: await tx.select().from(recordChecklistItems),
            tp: await tx.select().from(recordTemplates),
        }));
        expect(seen).toEqual({ cl: [], it: [], tp: [] });
        const mine = await withTenant(pg.db, tenantA, async (tx) => (await tx.select().from(recordChecklistItems)).length);
        expect(mine).toBe(1);
    });

    it('progreso en el listado y la columna «Avance»: filtra, ordena y promedia', async () => {
        const a = await rec('A');
        const b = await rec('B');
        await rec('Sin checklist');
        const ca = (await checklists.create(tenantA, ana, 'proyectos', a, { items: [{ text: '1' }, { text: '2' }, { text: '3' }, { text: '4' }] })).checklists[0]!;
        await checklists.updateItem(tenantA, ana, 'proyectos', a, ca.items[0]!.id, { done: true });
        await checklists.updateItem(tenantA, ana, 'proyectos', a, ca.items[1]!.id, { done: true });
        await checklists.updateItem(tenantA, ana, 'proyectos', a, ca.items[2]!.id, { done: true });
        await checklists.create(tenantA, ana, 'proyectos', b, { items: [{ text: 'x', done: true }, { text: 'y' }] });
        const page = await recs.list(tenantA, ana, 'proyectos', { limit: 50, sort_dir: 'desc' });
        const byName = new Map(page.data.map((r) => [r.data[k('nombre')], r]));
        expect(byName.get('A')!.checklist).toEqual({ done: 3, total: 4 });
        expect(byName.get('B')!.checklist).toEqual({ done: 1, total: 2 });
        expect(byName.get('Sin checklist')!.checklist).toBeUndefined();
        // La columna derivada (0-100) se lee en el registro.
        expect(byName.get('A')!.data[k('avance')]).toBe(75);
        expect(byName.get('Sin checklist')!.data[k('avance')] ?? null).toBeNull();
        const filtered = await recs.list(tenantA, ana, 'proyectos', {
            limit: 50,
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.avance!.id, op: 'gt', value: 60 }] },
        } as never);
        expect(filtered.data.map((r) => r.data[k('nombre')])).toEqual(['A']);
        const sorted = await recs.list(tenantA, ana, 'proyectos', { limit: 50, sort: `field_${f.avance!.id}:asc` } as never);
        expect(sorted.data.map((r) => r.data[k('nombre')])).toEqual(['B', 'A', 'Sin checklist']);
        const avg = await aggregate.run(tenantA, 'proyectos', { metric: 'avg', field_id: f.avance!.id } as never);
        expect(Number((avg as { value: unknown }).value)).toBeCloseTo(62.5, 1);
    });

    it('«Mi trabajo»: los ítems asignados a mí sin hacer, ordenados por vencimiento', async () => {
        const id = await rec('Evento');
        const cl = (
            await checklists.create(tenantA, ana, 'proyectos', id, {
                name: 'Logística',
                items: [
                    { text: 'Sin fecha', assignee_id: caro.userId },
                    { text: 'Catering', assignee_id: caro.userId, due: '2026-11-10' },
                    { text: 'Hecho', assignee_id: caro.userId, done: true },
                    { text: 'De otro', assignee_id: ana.userId },
                    { text: 'Salón', assignee_id: caro.userId, due: '2026-11-02T15:00:00.000Z' },
                ],
            })
        ).checklists[0]!;
        const work = await notifications.myWork(tenantA, caro);
        expect(work.checklist_items.map((i) => [i.text, i.due, i.due_is_datetime])).toEqual([
            ['Salón', '2026-11-02T15:00:00.000Z', true],
            ['Catering', '2026-11-10', false],
            ['Sin fecha', null, false],
        ]);
        expect(work.checklist_items[0]).toMatchObject({ checklist_id: cl.id, checklist_name: 'Logística', record_id: id, record_title: 'Evento', list_slug: 'proyectos' });
        // Un registro que la persona no puede ver no aparece (agente: sólo lo suyo).
        await checklists.updateItem(tenantA, ana, 'proyectos', id, cl.items[0]!.id, { assignee_id: beto.userId });
        expect((await notifications.myWork(tenantA, beto)).checklist_items).toEqual([]);
        // Borrado (papelera): tampoco.
        await recs.remove(tenantA, ana, 'proyectos', id);
        expect((await notifications.myWork(tenantA, caro)).checklist_items).toEqual([]);
    });

    it('convertir un ítem en subtarea: el texto es el título; responsable y fecha pasan a sus campos', async () => {
        const id = await rec('Proyecto X');
        const cl = (await checklists.create(tenantA, ana, 'proyectos', id, { items: [{ text: 'Maquetar', assignee_id: caro.userId, due: '2026-11-20' }, { text: 'Otro' }] }))
            .checklists[0]!;
        const out = await checklists.convertToSubtask(tenantA, ana, 'proyectos', id, cl.items[0]!.id);
        expect(out.record.parent_id).toBe(id);
        expect(out.record.data).toMatchObject({ [k('nombre')]: 'Maquetar', [k('responsable')]: caro.userId, [k('entrega')]: '2026-11-20' });
        expect(out.checklists.checklists[0]!.items.map((i) => i.text)).toEqual(['Otro']);
        expect(await actions(id)).toContain('checklist_item_to_subtask');
        // Una subtarea no puede tener subtareas.
        const sub = (await checklists.create(tenantA, ana, 'proyectos', out.record.id, { items: [{ text: 'Nieto' }] })).checklists[0]!;
        await expect(checklists.convertToSubtask(tenantA, ana, 'proyectos', out.record.id, sub.items[0]!.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('plantillas: validan contra la lista (tipos, campos que se calculan, personas del equipo)', async () => {
        const ok = await templates.create(tenantA, ana.userId, 'proyectos', {
            kind: 'record',
            name: 'Proyecto web',
            content: { values: { [k('estado')]: { mode: 'fixed', value: 'nuevo' }, [k('nombre')]: { mode: 'fixed', value: '' } }, subtasks: [], checklists: [], record_description: null },
        });
        // Un valor vacío no se guarda (no pisaría nada).
        expect(ok.content.values).toEqual({ [k('estado')]: { mode: 'fixed', value: 'nuevo' } });
        const bad = (content: unknown) => templates.create(tenantA, ana.userId, 'proyectos', { kind: 'record', name: 'Mala', content: content as never });
        await expect(bad({ values: { [k('calculado')]: { mode: 'fixed', value: 'x' } } })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bad({ values: { [k('nombre')]: { mode: 'relative_date', date: { days: 1, from_field_id: null } } } })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bad({ values: { [k('estado')]: { mode: 'fixed', value: 'inexistente' } } })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bad({ values: { [k('responsable')]: { mode: 'person', person: { kind: 'user', user_id: clienteId } } } })).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            templates.create(tenantA, ana.userId, 'proyectos', { kind: 'checklist', name: 'Dos', content: { checklists: [{ name: 'a', items: [] }, { name: 'b', items: [] }] } as never }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('alta desde una plantilla: registro, subtareas y checklists en UNA transacción, con fechas y personas resueltas', async () => {
        const tpl = await templates.create(tenantA, ana.userId, 'proyectos', {
            kind: 'record',
            name: 'Proyecto estándar',
            content: {
                values: {
                    [k('estado')]: { mode: 'fixed', value: 'nuevo' },
                    [k('responsable')]: { mode: 'person', person: { kind: 'creator' } },
                    [k('entrega')]: { mode: 'relative_date', date: { days: 5, from_field_id: f.inicio!.id, business_days: true, time: null } },
                },
                subtasks: [
                    { title: 'Kickoff', values: { [k('responsable')]: { mode: 'person', person: { kind: 'field', field_id: f.responsable!.id } } } },
                    { title: 'Diseño', values: {} },
                ],
                checklists: [{ name: 'Arranque', items: [{ text: 'Contrato', assignee: { kind: 'user', user_id: caro.userId }, due: { days: 2, from_field_id: f.inicio!.id } }] }],
                record_description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alcance del proyecto' }] }] },
            } as never,
        });
        const out = await templates.createFromTemplate(tenantA, caro, 'proyectos', {
            template_id: tpl.id,
            // Lo del alta pisa la plantilla.
            data: { [k('nombre')]: 'Cliente Z', [k('inicio')]: '2026-11-13', [k('estado')]: 'curso' },
        });
        expect(out.subtask_ids).toHaveLength(2);
        expect(out.checklist_ids).toHaveLength(1);
        const root = await recs.get(tenantA, ana, 'proyectos', out.record_id);
        // 13-nov (viernes) + 5 hábiles (16 festivo): 23-nov.
        expect(root.data).toMatchObject({ [k('nombre')]: 'Cliente Z', [k('estado')]: 'curso', [k('responsable')]: caro.userId, [k('entrega')]: '2026-11-23' });
        expect(root.has_description).toBe(true);
        expect(root.checklist).toEqual({ done: 0, total: 1 });
        const subs = await recs.list(tenantA, ana, 'proyectos', { parent: out.record_id, limit: 50 } as never);
        expect(new Map(subs.data.map((r) => [r.data[k('nombre')], r.data[k('responsable')] ?? null]))).toEqual(
            new Map<unknown, unknown>([
                ['Kickoff', caro.userId],
                ['Diseño', null],
            ]),
        );
        const cls = await checklists.forRecord(tenantA, ana, 'proyectos', out.record_id);
        expect(cls.checklists[0]!.items[0]).toMatchObject({ text: 'Contrato', assignee_id: caro.userId, due: '2026-11-15' });
        expect(await actions(out.record_id)).toEqual(['record_created', 'record_template_applied']);
        // Las automatizaciones de «se crea un registro» corren por cada uno.
        expect(dispatcher.events.filter((e) => e.trigger === 'record_created').map((e) => e.recordId).sort()).toEqual([out.record_id, ...out.subtask_ids].sort());
        // El aviso del ítem asignado sale (Caro creó el registro y el ítem es suyo: no se avisa a sí misma).
        expect(hubEvents.filter((e) => e.type === 'checklist_assigned')).toHaveLength(0);
    });

    it('el límite del plan cuenta el LOTE entero: si no entra todo, no se crea nada', async () => {
        const tpl = await templates.create(tenantA, ana.userId, 'proyectos', {
            kind: 'record',
            name: 'Con 3 subtareas',
            content: { subtasks: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] } as never,
        });
        await rec('Ya existe');
        billing.recordLimit = async () => ({ limit: 4, plan: 'trial' });
        await expect(templates.createFromTemplate(tenantA, ana, 'proyectos', { template_id: tpl.id, data: { [k('nombre')]: 'Nuevo' } })).rejects.toBeInstanceOf(ForbiddenException);
        const count = await withTenant(pg.db, tenantA, async (tx) => (await tx.select().from(recordsTable).where(eq(recordsTable.tenantId, tenantA))).length);
        expect(count).toBe(1);
        billing.recordLimit = async () => ({ limit: 5, plan: 'trial' });
        const ok = await templates.createFromTemplate(tenantA, ana, 'proyectos', { template_id: tpl.id, data: { [k('nombre')]: 'Nuevo' } });
        expect(ok.subtask_ids).toHaveLength(3);
    });

    it('guardar un registro como plantilla: fechas → relativas a hoy, sin el título; y no se borra si se usa', async () => {
        const hoy = new Date();
        const enUnaSemana = new Date(hoy.getTime() + 7 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const id = await rec('Original', ana, { [k('estado')]: 'curso', [k('entrega')]: enUnaSemana, [k('responsable')]: caro.userId });
        await rec('Hija', ana, {});
        await checklists.create(tenantA, ana, 'proyectos', id, { name: 'Pasos', items: [{ text: 'Uno', assignee_id: caro.userId }] });
        const tpl = await templates.fromRecord(tenantA, ana, 'proyectos', {
            record_id: id,
            name: 'Como Original',
            include: { values: true, subtasks: true, checklists: true, description: false },
        });
        expect(tpl.content.values[k('nombre')]).toBeUndefined();
        expect(tpl.content.values[k('entrega')]).toEqual({ mode: 'relative_date', date: { days: 7, from_field_id: null, business_days: false, time: null } });
        expect(tpl.content.values[k('responsable')]).toEqual({ mode: 'person', person: { kind: 'user', user_id: caro.userId } });
        expect(tpl.content.checklists[0]!.items[0]).toMatchObject({ text: 'Uno', assignee: { kind: 'user', user_id: caro.userId } });
        // Plantilla de checklist desde un checklist.
        const cl = (await checklists.forRecord(tenantA, ana, 'proyectos', id)).checklists[0]!;
        const ctpl = await templates.fromChecklist(tenantA, ana, 'proyectos', { checklist_id: cl.id });
        expect(ctpl).toMatchObject({ kind: 'checklist', name: 'Pasos' });
        // …y aplicarla a otro registro.
        const otro = await rec('Otro');
        const applied = await checklists.create(tenantA, ana, 'proyectos', otro, { template_id: ctpl.id });
        expect(applied.checklists[0]).toMatchObject({ name: 'Pasos', items: [expect.objectContaining({ text: 'Uno', assignee_id: caro.userId })] });
        // En uso por un formulario → 409 con quién la usa.
        await pg.db.insert(forms).values({ tenantId: tenantA, listId: (await lists.get(tenantA, 'proyectos')).id, name: 'Alta web', token: `t-${Date.now()}`, config: { settings: { record_template_id: tpl.id } } });
        await expect(templates.remove(tenantA, ana.userId, 'proyectos', tpl.id)).rejects.toBeInstanceOf(ConflictException);
        await templates.remove(tenantA, ana.userId, 'proyectos', ctpl.id);
        expect((await templates.list(tenantA, 'proyectos')).map((t) => t.name)).toEqual(['Como Original']);
    });

    it('automatizaciones: «se completa un checklist» por nombre → «Crear subtareas desde una plantilla» y «Crear un registro» con plantilla', async () => {
        const tpl = await templates.create(tenantA, ana.userId, 'proyectos', {
            kind: 'record',
            name: 'Entrega',
            content: {
                values: { [k('estado')]: { mode: 'fixed', value: 'curso' } },
                subtasks: [{ title: 'Facturar' }, { title: 'Encuesta' }],
                checklists: [{ name: 'Cierre', items: [{ text: 'Acta', assignee: { kind: 'creator' }, due: null }] }],
            } as never,
        });
        const auto = await autos.create(tenantA, 'proyectos', {
            name: 'Al cerrar QA',
            trigger_type: 'checklist_completed',
            trigger_config: { checklist_mode: 'named', checklist_name: 'qa' },
            actions: [
                { type: 'create_subtasks_from_template', config: { template_id: tpl.id, include_checklists: true } },
                { type: 'create_record', config: { target_list_id: (await lists.get(tenantA, 'proyectos')).id, template_id: tpl.id, values: { nombre: 'Seguimiento de {{nombre}}' } } },
            ],
        });
        const id = await rec('App móvil', caro);
        const qa = (await checklists.create(tenantA, caro, 'proyectos', id, { name: 'QA', items: [{ text: 'Pruebas' }] })).checklists[0]!;
        const otro = (await checklists.create(tenantA, caro, 'proyectos', id, { name: 'Otro', items: [{ text: 'Nada' }] })).checklists[1]!;
        await checklists.updateItem(tenantA, caro, 'proyectos', id, otro.items[0]!.id, { done: true });
        await checklists.updateItem(tenantA, caro, 'proyectos', id, qa.items[0]!.id, { done: true });
        const events = completions();
        expect(events.map((e) => e.checklist?.name)).toEqual(['Otro', 'QA']);
        for (const e of events) await engine.process(e);
        const runs = await withTenant(pg.db, tenantA, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto.id)));
        // Sólo el de «QA» coincide (sin acentos ni mayúsculas).
        expect(runs).toHaveLength(1);
        expect(runs[0]!.status).toBe('success');
        const subs = await recs.list(tenantA, ana, 'proyectos', { parent: id, limit: 50 } as never);
        expect(subs.data.map((r) => r.data[k('nombre')]).sort()).toEqual(['Encuesta', 'Facturar']);
        const cls = await checklists.forRecord(tenantA, ana, 'proyectos', id);
        // «Quien crea el registro» = quien creó ESE registro (Caro).
        expect(cls.checklists.find((c) => c.name === 'Cierre')!.items[0]!.assignee_id).toBe(caro.userId);
        const nuevo = (await recs.list(tenantA, ana, 'proyectos', { limit: 50, sort_dir: 'desc' })).data.find((r) => r.data[k('nombre')] === 'Seguimiento de App móvil')!;
        expect(nuevo.data[k('estado')]).toBe('curso');
        expect(nuevo.subtask_count).toBe(2);
    });

    it('una plantilla de otra lista no sirve, y una de checklist no crea registros', async () => {
        const ctpl = await templates.create(tenantA, ana.userId, 'proyectos', {
            kind: 'checklist',
            name: 'Solo checklist',
            content: { checklists: [{ name: 'Pasos', items: [{ text: 'a' }] }] } as never,
        });
        await expect(templates.createFromTemplate(tenantA, ana, 'proyectos', { template_id: ctpl.id, data: {} })).rejects.toBeInstanceOf(BadRequestException);
        await lists.create(tenantA, { name: 'Otra lista', slug: 'otra-lista' });
        await expect(templates.createFromTemplate(tenantA, ana, 'otra-lista', { template_id: ctpl.id, data: {} })).rejects.toBeInstanceOf(NotFoundException);
        // El viewer no crea registros.
        const rtpl = await templates.create(tenantA, ana.userId, 'proyectos', { kind: 'record', name: 'R', content: { values: {}, subtasks: [], checklists: [], record_description: null } });
        await expect(templates.createFromTemplate(tenantA, vero, 'proyectos', { template_id: rtpl.id, data: {} })).rejects.toBeInstanceOf(ForbiddenException);
        const where = and(eq(recordTemplates.tenantId, tenantA), eq(recordTemplates.kind, 'checklist'));
        expect(await withTenant(pg.db, tenantA, async (tx) => (await tx.select().from(recordTemplates).where(where)).length)).toBe(1);
    });
});

describe('A9 · el «3/8» también viaja en los bundles (vista agrupada, kanban, Gantt)', () => {
    it('toBundleRow lleva el progreso del checklist (y no lo inventa si no hay)', () => {
        const base = { id: 1, list_id: 1, data: { f1: 'A' }, relations: {}, parent_id: null, created_by: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
        const slugs = new Map([['f1', 'nombre']]);
        const withProgress = toBundleRow({ ...base, checklist: { done: 3, total: 8 } } as never, slugs);
        expect(withProgress.checklist).toEqual({ done: 3, total: 8 });
        expect(withProgress.fields).toEqual({ nombre: 'A' });
        expect('checklist' in toBundleRow(base as never, slugs)).toBe(false);
    });
});
