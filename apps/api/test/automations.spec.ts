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
import { RelationsRepository } from '../src/records/relations.repository';
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
            new RelationsRepository(),
        );
        automationsService = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsService, new AutomationScheduler());
        mailbox = new CapturingMailTransport();
        const mail = new MailService(loadEnv(), mailbox);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
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

    it('v0.1.110 — incoming_webhook: token al guardar, payload en condiciones/merge tags y create_record', async () => {
        const auto = await automationsService.create(tenantId, 'deals', {
            name: 'Alta por formulario externo',
            trigger_type: 'incoming_webhook',
            trigger_config: { field_filters: [{ field: 'monto', op: 'gte', value: 1000 }] },
            actions: [
                {
                    type: 'create_record',
                    config: {
                        target_list: listId,
                        // monto: slug del payload; nota: mezcla payload.* y slug
                        values: { monto: '{{monto}}', estado: 'nueva' },
                    },
                },
                {
                    type: 'call_webhook',
                    // Sin URL → skipped (no importa acá; probamos que el run corre).
                    config: {},
                },
            ],
        });

        // El token se genera al crear y queda en el trigger_config + el mapeo.
        const token = (auto.trigger_config as { webhook_token?: string }).webhook_token;
        expect(typeof token).toBe('string');
        expect((token ?? '').length).toBeGreaterThanOrEqual(16);
        const hook = await automationsService.resolveHookToken(token!);
        expect(hook).toMatchObject({ tenantId, automationId: auto.id });
        expect(await automationsService.resolveHookToken('tok_inexistente_123456')).toBeNull();

        // Payload que CUMPLE el filtro → crea el registro con el monto.
        await engine.runWebhook(tenantId, auto.id, { monto: 2500, extra: { origen: 'landing' } });
        // Payload que NO cumple → ni run ni registro.
        await engine.runWebhook(tenantId, auto.id, { monto: 10 });

        const recs = await recordsService.list(tenantId, admin, 'deals', { limit: 50, sort_dir: 'asc' });
        expect(recs.data).toHaveLength(1);
        expect(recs.data[0]!.data[key('monto')]).toBe(2500);
        expect(recs.data[0]!.data[key('estado')]).toBe('nueva');

        const runs = await automationsService.runsById(tenantId, auto.id, {});
        expect(runs.data).toHaveLength(1);
        expect(runs.data[0]!.status).toBe('success');

        // Guardar de nuevo CONSERVANDO el token no rota la URL…
        const updated = await automationsService.update(tenantId, 'deals', auto.id, {
            trigger_config: { webhook_token: token },
        });
        expect((updated.trigger_config as { webhook_token?: string }).webhook_token).toBe(token);
        // …y guardar SIN token (regenerar) crea uno nuevo y revoca el viejo.
        const rotated = await automationsService.update(tenantId, 'deals', auto.id, {
            trigger_config: {},
        });
        const newToken = (rotated.trigger_config as { webhook_token?: string }).webhook_token;
        expect(newToken).toBeDefined();
        expect(newToken).not.toBe(token);
        expect(await automationsService.resolveHookToken(token!)).toBeNull();
        expect(await automationsService.resolveHookToken(newToken!)).toMatchObject({ automationId: auto.id });
    });

    it('condición por acción en shape {slug,op,value} (lo que emite el ConditionEditor): guarda y filtra', async () => {
        // El schema rechazaba `slug` (exigía `field`) → "Datos inválidos" al
        // guardar cualquier condición desde la UI, aunque el evaluador acepta
        // ambos desde siempre. Regresión en la capa Zod (el pipe del
        // controller): el shape de la UI debe parsear.
        const { createAutomationSchema } = await import('@imagina-base/shared');
        expect(
            createAutomationSchema.safeParse({
                name: 'x',
                trigger_type: 'record_created',
                actions: [
                    { type: 'update_field', config: {}, condition: [{ slug: 'monto', op: 'gte', value: 1 }] },
                ],
            }).success,
        ).toBe(true);
        // Sin campo alguno → sigue rechazando.
        expect(
            createAutomationSchema.safeParse({
                name: 'x',
                trigger_type: 'record_created',
                actions: [{ type: 'update_field', config: {}, condition: [{ op: 'eq', value: 1 }] }],
            }).success,
        ).toBe(false);

        await automationsService.create(tenantId, 'deals', {
            name: 'Marcar VIP solo grandes',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'update_field',
                    config: { values: { estado: 'vip' } },
                    condition: [{ slug: 'monto', op: 'gte', value: 1000 }],
                },
            ],
        });

        // Deal chico: la condición NO cumple → el campo queda igual.
        const chico = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 100, [key('estado')]: 'nueva' },
        });
        await engine.process({
            tenantId, listId, recordId: chico.id, trigger: 'record_created',
            after: { [key('monto')]: 100, [key('estado')]: 'nueva' },
        });
        expect((await recordsService.get(tenantId, admin, 'deals', chico.id)).data[key('estado')]).toBe('nueva');

        // Deal grande: cumple → vip.
        const grande = await recordsService.create(tenantId, admin, 'deals', {
            data: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });
        await engine.process({
            tenantId, listId, recordId: grande.id, trigger: 'record_created',
            after: { [key('monto')]: 5000, [key('estado')]: 'nueva' },
        });
        expect((await recordsService.get(tenantId, admin, 'deals', grande.id)).data[key('estado')]).toBe('vip');
    });

    it('create_record cross-list: slugs del DESTINO, coerción por validador, relation al trigger y skip tolerante', async () => {
        // Lista Facturas: cliente (texto), monto (currency), estado (select),
        // deal (relation → Deals). El caso de uso de facturación recurrente.
        await listsService.create(tenantId, { name: 'Facturas' });
        const cliente = await fieldsService.create(tenantId, 'facturas', { label: 'Cliente', type: 'text', slug: 'cliente' });
        const monto = await fieldsService.create(tenantId, 'facturas', { label: 'Monto', type: 'currency', slug: 'monto' });
        const estadoF = await fieldsService.create(tenantId, 'facturas', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] },
        });
        const dealRel = await fieldsService.create(tenantId, 'facturas', {
            label: 'Deal',
            type: 'relation',
            slug: 'deal',
            config: { target_list_id: listId },
        });
        const nota = await fieldsService.create(tenantId, 'facturas', { label: 'Nota', type: 'text', slug: 'nota' });

        await automationsService.create(tenantId, 'deals', {
            name: 'Generar factura',
            trigger_type: 'record_updated',
            actions: [
                {
                    type: 'create_record',
                    config: {
                        target_list: (await listsService.get(tenantId, 'facturas')).id,
                        values: {
                            // Slugs de la lista DESTINO (no f{id}) + merge tags del trigger.
                            cliente: 'Deal {{estado}}',
                            monto: '{{monto}}', // merge tag → string "5000" → coerción a número
                            estado: 'pendiente',
                            deal: '{{record.id}}', // relation → vínculo al record del trigger
                            inexistente: 'x', // campo que no existe → skip con nota
                            // {{before.slug}} = valor previo al cambio (el "período"
                            // en facturación recurrente); {{date.today}} = día del disparo.
                            nota: 'Antes: {{before.monto}} | Hoy: {{date.today}}',
                        },
                    },
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
            trigger: 'record_updated',
            before: { [key('monto')]: 4000, [key('estado')]: 'vip' },
            after: { [key('monto')]: 5000, [key('estado')]: 'vip' },
        });

        const facturas = await recordsService.list(tenantId, admin, 'facturas', { limit: 10, sort_dir: 'asc' });
        expect(facturas.data).toHaveLength(1);
        const factura = facturas.data[0]!;
        expect(factura.data[`f${cliente.id}`]).toBe('Deal vip');
        expect(factura.data[`f${monto.id}`]).toBe(5000); // número real, no string
        expect(factura.data[`f${estadoF.id}`]).toBe('pendiente');
        expect(factura.data[`f${dealRel.id}`]).toBeUndefined(); // relation NO vive en el JSONB
        expect(factura.relations?.[`f${dealRel.id}`]).toEqual([rec.id]); // vínculo real
        const hoy = new Date().toISOString().slice(0, 10);
        expect(factura.data[`f${nota.id}`]).toBe(`Antes: 4000 | Hoy: ${hoy}`);
        const runs = await automationsService.runsById(tenantId, await firstAutomationId(), {});
        expect(runs.data[0]!.status).toBe('success');
        expect(runs.data[0]!.actions_log[0]!.message).toContain('inexistente');
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

    it('due_date_reached: acepta due_field (la clave de la UI) y evalúa field_filters al disparar', async () => {
        const vence = await fieldsService.create(tenantId, 'deals', { label: 'Emitida', type: 'datetime', slug: 'emitida' });
        // Recordatorio a los 20 días SI sigue "nueva" (la secuencia de mora
        // del caso de facturación). Config EXACTA que emite la UI:
        // due_field por slug + offset positivo + field_filters.
        const auto = await automationsService.create(tenantId, 'deals', {
            name: 'Recordatorio 20d impagas',
            trigger_type: 'due_date_reached',
            trigger_config: {
                due_field: 'emitida',
                offset_minutes: 20 * 1440,
                field_filters: [{ slug: 'estado', op: 'eq', value: 'nueva' }],
            },
            actions: [{ type: 'update_field', config: { values: { estado: 'vip' } } }],
        });

        // Emitida hace 30 días y sigue "nueva" → dispara.
        const impaga = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2020-01-01T00:00:00.000Z', [key('estado')]: 'nueva' },
        });
        // Emitida hace 30 días pero ya "vip" (≈pagada) → NO dispara y NO
        // registra run (si vuelve a cumplir más adelante, dispararía).
        const pagada = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2020-01-01T00:00:00.000Z', [key('estado')]: 'vip' },
        });
        // Emitida hace poco (< 20 días) → fuera de la ventana.
        const reciente = await recordsService.create(tenantId, admin, 'deals', {
            data: { [`f${vence.id}`]: '2999-01-01T00:00:00.000Z', [key('estado')]: 'nueva' },
        });

        await engine.runDueDate(tenantId, auto.id);
        const runs = await automationsService.runsById(tenantId, auto.id, {});
        expect(runs.data.map((r) => r.record_id)).toEqual([impaga.id]);
        expect((await recordsService.get(tenantId, admin, 'deals', pagada.id)).data[key('estado')]).toBe('vip');
        expect((await recordsService.get(tenantId, admin, 'deals', reciente.id)).data[key('estado')]).toBe('nueva');
    });

    async function firstAutomationId(): Promise<number> {
        const list = await automationsService.list(tenantId, 'deals');
        return list[0]!.id;
    }
});
