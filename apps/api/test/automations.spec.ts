import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { automationRuns, automations, fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { loadEnv } from '../src/config/env';
import { TenantDb } from '../src/tenancy/tenant-db.service';

/** Transporte de correo que captura los mensajes en memoria (para asserts). */
class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

describe('AutomationEngine (Postgres real) — modelo flexible', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let automationsService: AutomationsService;
    let engine: AutomationEngine;
    let mailbox: CapturingMailTransport;
    let tenantId: number;
    let listId: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            activity,
            new AutomationDispatcher(),
        );
        automationsService = new AutomationsService(tenantDb, new AutomationsRepository(), listsService, new AutomationScheduler());
        mailbox = new CapturingMailTransport();
        const mail = new MailService(loadEnv(), mailbox);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            mail,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        const list = await listsService.create(tenantId, { name: 'Deals' });
        listId = list.id;
        const defs: CreateFieldInput[] = [
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'nueva', label: 'Nueva' }, { value: 'vip', label: 'VIP' }] },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'deals', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;

    it('update_field: deal grande (field_filters) → marca VIP; run success con log', async () => {
        await automationsService.create(tenantId, 'deals', {
            name: 'Marcar VIP',
            trigger_type: 'record_created',
            trigger_config: { field_filters: [{ field: 'monto', op: 'gte', value: 1000 }] },
            actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });

        const updated = await recordsService.get(tenantId, admin, 'deals', rec.id);
        expect(updated.data[key('estado')]).toBe('vip');

        const runs = await automationsService.runsById(tenantId, await firstAutomationId(), {});
        expect(runs.data[0]).toMatchObject({ status: 'success', record_id: rec.id });
        expect(runs.data[0]!.actions_log.map((l) => l.action)).toContain('update_field');
    });

    it('send_email: encola el correo con merge tags resueltos', async () => {
        mailbox.sent.length = 0;
        await automationsService.create(tenantId, 'deals', {
            name: 'Avisar VIP',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'send_email',
                    config: { to: 'ventas@acme.test', subject: 'Deal {{estado}}', body: 'Monto: {{monto}}' },
                },
            ],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 5000, [key('estado')]: 'vip' },
        });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 5000, [key('estado')]: 'vip' },
        });

        expect(mailbox.sent).toHaveLength(1);
        expect(mailbox.sent[0]).toMatchObject({ to: 'ventas@acme.test', subject: 'Deal vip', text: 'Monto: 5000' });
    });

    // SEC-08: en email HTML, los valores de registro interpolados se escapan
    // (el dato puede venir de un cliente del portal / import) → no inyectan JS.
    it('send_email HTML: escapa los merge tags interpolados', async () => {
        mailbox.sent.length = 0;
        const nombre = await fieldsService.create(tenantId, 'deals', {
            label: 'Nombre',
            type: 'text',
            slug: 'nombre',
        });
        await automationsService.create(tenantId, 'deals', {
            name: 'Bienvenida HTML',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: 'ventas@acme.test',
                        subject: 'Hola',
                        is_html: true,
                        body: '<p>Hola {{nombre}}</p>',
                    },
                },
            ],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${nombre.id}`]: '<script>alert(1)</script>' },
        });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [`f${nombre.id}`]: '<script>alert(1)</script>' },
        });

        expect(mailbox.sent).toHaveLength(1);
        const html = mailbox.sent[0]?.html ?? '';
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
        // El template del admin sí conserva su HTML.
        expect(html).toContain('<p>Hola');
    });

    it('field_filters no cumplido → trigger no matchea, no corre ni loguea', async () => {
        await automationsService.create(tenantId, 'deals', {
            name: 'Sólo grandes',
            trigger_type: 'record_created',
            trigger_config: { field_filters: [{ field: 'monto', op: 'gte', value: 1000 }] },
            actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 100, [key('estado')]: 'nueva' },
        });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 100, [key('estado')]: 'nueva' },
        });

        expect((await recordsService.get(tenantId, admin, 'deals', rec.id)).data[key('estado')]).toBe('nueva');
        const runs = await automationsService.runsById(tenantId, await firstAutomationId(), {});
        expect(runs.data).toHaveLength(0);
    });

    it('condición por acción no cumplida → acción skipped (el run corre igual)', async () => {
        await automationsService.create(tenantId, 'deals', {
            name: 'Condición por acción',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'update_field',
                    config: { values: { estado: 'vip' } },
                    condition: [{ field: 'monto', op: 'gte', value: 1000 }],
                },
            ],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 100, [key('estado')]: 'nueva' },
        });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 100, [key('estado')]: 'nueva' },
        });

        expect((await recordsService.get(tenantId, admin, 'deals', rec.id)).data[key('estado')]).toBe('nueva');
        const runs = await automationsService.runsById(tenantId, await firstAutomationId(), {});
        expect(runs.data[0]!.actions_log[0]).toMatchObject({ action: 'update_field', status: 'skipped' });
    });

    it('if_else: rama then/else según condición', async () => {
        await automationsService.create(tenantId, 'deals', {
            name: 'Ramas',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'if_else',
                    config: {
                        condition: [{ field: 'monto', op: 'gte', value: 1000 }],
                        then_actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
                        else_actions: [{ type: 'update_field', config: { values: { estado: 'nueva' } } }],
                    },
                },
            ],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });

        expect((await recordsService.get(tenantId, admin, 'deals', rec.id)).data[key('estado')]).toBe('vip');
        const runs = await automationsService.runsById(tenantId, await firstAutomationId(), {});
        expect(runs.data[0]!.actions_log.map((l) => l.action)).toEqual(['if_else', 'update_field']);
    });

    it('create_record: la automatización crea un registro en otra lista', async () => {
        const tareas = await listsService.create(tenantId, { name: 'Tareas' });
        const titulo = await fieldsService.create(tenantId, 'tareas', { label: 'Titulo', type: 'text', slug: 'titulo' });

        await automationsService.create(tenantId, 'deals', {
            name: 'Crear tarea de follow-up',
            trigger_type: 'record_created',
            actions: [
                { type: 'create_record', config: { target_list: tareas.id, values: { [`f${titulo.id}`]: 'Follow-up' } } },
            ],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', { data: { [key('monto')]: 10 } });
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 10 },
        });

        const tareasRecords = await recordsService.list(tenantId, admin, 'tareas', { limit: 50, sort_dir: 'asc' });
        expect(tareasRecords.data).toHaveLength(1);
        expect(tareasRecords.data[0]!.data[`f${titulo.id}`]).toBe('Follow-up');
    });

    it('scheduled: runScheduled ejecuta acciones sin record (create_record)', async () => {
        const tareas = await listsService.create(tenantId, { name: 'Diario' });
        const titulo = await fieldsService.create(tenantId, 'diario', { label: 'T', type: 'text', slug: 't' });
        const auto = await automationsService.create(tenantId, 'deals', {
            name: 'Resumen diario',
            trigger_type: 'scheduled',
            trigger_config: { cron: '0 9 * * *' },
            actions: [{ type: 'create_record', config: { target_list: tareas.id, values: { [`f${titulo.id}`]: 'Resumen' } } }],
        });

        await engine.runScheduled(tenantId, auto.id);

        const diario = await recordsService.list(tenantId, admin, 'diario', { limit: 10, sort_dir: 'asc' });
        expect(diario.data).toHaveLength(1);
        const runs = await automationsService.runsById(tenantId, auto.id, {});
        expect(runs.data[0]).toMatchObject({ status: 'success', record_id: null });
    });

    it('due_date_reached: dispara para records vencidos y no re-dispara (dedup por runs)', async () => {
        const vence = await fieldsService.create(tenantId, 'deals', { label: 'Vence', type: 'datetime', slug: 'vence' });
        const auto = await automationsService.create(tenantId, 'deals', {
            name: 'Marcar vencidos',
            trigger_type: 'due_date_reached',
            trigger_config: { field_id: vence.id, offset_minutes: 0 },
            actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
        });

        const past = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2020-01-01T00:00:00.000Z', [key('estado')]: 'nueva' },
        });
        const future = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2999-01-01T00:00:00.000Z', [key('estado')]: 'nueva' },
        });

        await engine.runDueDate(tenantId, auto.id);
        expect((await recordsService.get(tenantId, admin, 'deals', past.id)).data[key('estado')]).toBe('vip');
        expect((await recordsService.get(tenantId, admin, 'deals', future.id)).data[key('estado')]).toBe('nueva');

        await engine.runDueDate(tenantId, auto.id);
        const runs = await automationsService.runsById(tenantId, auto.id, {});
        expect(runs.data.filter((r) => r.record_id === past.id)).toHaveLength(1);
    });

    async function firstAutomationId(): Promise<number> {
        const list = await automationsService.list(tenantId, 'deals');
        return list[0]!.id;
    }
});
