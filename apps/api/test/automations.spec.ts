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

describe('AutomationEngine (Postgres real)', () => {
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
        // MailService sin onModuleInit → sin cola Redis → enqueue cae a sendNow,
        // que llama al transporte capturador (asertamos el correo directamente).
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

    it('update_field: al crear un deal grande, la automatización lo marca VIP', async () => {
        await automationsService.create(tenantId, 'deals', {
            name: 'Marcar VIP',
            trigger: { type: 'record_created' },
            condition: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: f.monto!.id, op: 'gte', value: 1000 }],
            },
            actions: [{ type: 'update_field', field_id: f.estado!.id, value: 'vip' }],
        });

        const rec = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });

        // El engine corre lo que normalmente encolaría el dispatcher.
        await engine.process({
            tenantId,
            listId,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });

        const updated = await recordsService.get(tenantId, admin, 'deals', rec.id);
        expect(updated.data[key('estado')]).toBe('vip');

        const runs = await automationsService.runs(tenantId, 'deals', await firstAutomationId(), {});
        expect(runs.data[0]).toMatchObject({ status: 'success', record_id: rec.id });
        expect(runs.data[0]!.logs.join(' ')).toContain('update_field');
    });

    it('send_email: encola (envía) el correo con merge tags resueltos', async () => {
        mailbox.sent.length = 0;
        await automationsService.create(tenantId, 'deals', {
            name: 'Avisar VIP',
            trigger: { type: 'record_created' },
            actions: [
                {
                    type: 'send_email',
                    to: 'ventas@acme.test',
                    subject: 'Deal {{estado}}',
                    body: 'Monto: {{monto}}',
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
        expect(mailbox.sent[0]).toMatchObject({
            to: 'ventas@acme.test',
            subject: 'Deal vip',
            text: 'Monto: 5000',
        });
    });

    it('condición no cumplida → run skipped, sin cambios', async () => {
        await automationsService.create(tenantId, 'deals', {
            name: 'Sólo grandes',
            trigger: { type: 'record_created' },
            condition: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: f.monto!.id, op: 'gte', value: 1000 }],
            },
            actions: [{ type: 'update_field', field_id: f.estado!.id, value: 'vip' }],
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
        const runs = await automationsService.runs(tenantId, 'deals', await firstAutomationId(), {});
        expect(runs.data[0]!.status).toBe('skipped');
    });

    it('create_record: la automatización crea un registro en otra lista', async () => {
        const tareas = await listsService.create(tenantId, { name: 'Tareas' });
        const titulo = await fieldsService.create(tenantId, 'tareas', { label: 'Titulo', type: 'text', slug: 'titulo' });

        await automationsService.create(tenantId, 'deals', {
            name: 'Crear tarea de follow-up',
            trigger: { type: 'record_created' },
            actions: [{ type: 'create_record', list_id: tareas.id, data: { [`f${titulo.id}`]: 'Follow-up' } }],
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
            trigger: { type: 'scheduled', cron: '0 9 * * *' },
            actions: [{ type: 'create_record', list_id: tareas.id, data: { [`f${titulo.id}`]: 'Resumen' } }],
        });

        await engine.runScheduled(tenantId, auto.id);

        const diario = await recordsService.list(tenantId, admin, 'diario', { limit: 10, sort_dir: 'asc' });
        expect(diario.data).toHaveLength(1);
        const runs = await automationsService.runs(tenantId, 'deals', auto.id, {});
        expect(runs.data[0]).toMatchObject({ status: 'success', record_id: null });
    });

    it('due_date_reached: dispara para records vencidos y no re-dispara (dedup por runs)', async () => {
        const vence = await fieldsService.create(tenantId, 'deals', { label: 'Vence', type: 'datetime', slug: 'vence' });
        const auto = await automationsService.create(tenantId, 'deals', {
            name: 'Marcar vencidos',
            trigger: { type: 'due_date_reached', field_id: vence.id, offset_minutes: 0 },
            actions: [{ type: 'update_field', field_id: f.estado!.id, value: 'vip' }],
        });

        // Uno vencido (ayer) y uno futuro (mañana).
        const past = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2020-01-01T00:00:00.000Z', [key('estado')]: 'nueva' },
        });
        const future = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2999-01-01T00:00:00.000Z', [key('estado')]: 'nueva' },
        });

        await engine.runDueDate(tenantId, auto.id);
        expect((await recordsService.get(tenantId, admin, 'deals', past.id)).data[key('estado')]).toBe('vip');
        expect((await recordsService.get(tenantId, admin, 'deals', future.id)).data[key('estado')]).toBe('nueva');

        // Segunda corrida: no vuelve a disparar sobre el ya procesado.
        await engine.runDueDate(tenantId, auto.id);
        const runs = await automationsService.runs(tenantId, 'deals', auto.id, {});
        expect(runs.data.filter((r) => r.record_id === past.id)).toHaveLength(1);
    });

    async function firstAutomationId(): Promise<number> {
        const list = await automationsService.list(tenantId, 'deals');
        return list[0]!.id;
    }
});
