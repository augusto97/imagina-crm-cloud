import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    attachments,
    automationMatches,
    automationRuns,
    automations,
    fields,
    lists,
    memberships,
    notifications,
    plans,
    records,
    relations,
    teamMembers,
    teams,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { translateExtraActions, translateExtraTrigger } from '../src/ai/tools/automation-extras-ai';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class NoMail implements MailTransport {
    readonly name = 'none';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(1),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

type LogEntry = { action: string; status: string; message: string; details?: Record<string, unknown> };
type Job = { name: string; data: Record<string, unknown> };

/**
 * v0.1.455 — «Cuando un registro empieza a cumplir una condición», «Cuando se
 * sube un archivo», «Avisar en la app», «Asignar por turno» y «Copiar a otra
 * lista», con Postgres y Redis reales.
 */
describe('Automatizaciones: condición, archivos, avisos, turnos y copias (v0.1.455)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let jobs: Job[];
    let tenantId: number;
    let otherTenant: number;
    let admin: Actor;
    const ids: Record<string, number> = {};
    let t: Record<string, Field>;
    let tareasId: number;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        jobs = [];
        const dispatcher = new AutomationDispatcher(undefined, pg.db);
        dispatcher.setQueue({ add: (name: string, data: unknown) => (jobs.push({ name, data: data as Record<string, unknown> }), Promise.resolve()) } as never);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        const plansSvc = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansSvc, new EmailQuotaService(pg.db, plansSvc), new TenantSmtpService(pg.db, env));
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            dispatcher,
            new RelationsRepository(),
            undefined,
            undefined,
            billing,
        );
        const notificationsSvc = new NotificationsService(
            pg.db,
            tenantDb,
            listsService,
            fieldsService,
            recs,
            rt,
            { enqueue: () => Promise.resolve() } as never,
            redis as never,
            env,
        );
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NoMail()),
            connectors,
            undefined,
            dispatcher,
            undefined,
            undefined,
            undefined,
            { fileLink: (_t: number, id: number) => `https://app.test/f/${id}` } as never,
            undefined,
            { get: (cls: unknown) => (cls === NotificationsService ? notificationsSvc : recs) } as never,
            undefined,
            redis as never,
        );
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            noHooks,
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            dispatcher,
            undefined,
            engine,
            new AuditService(tenantDb),
        );
        const [tn] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantId = tn!.id;
        const [other] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'enterprise' }).returning();
        otherTenant = other!.id;
        const people: Array<[string, string, 'admin' | 'manager' | 'agent' | 'viewer' | 'client' | 'guest', boolean]> = [
            ['ana', 'Ana Ruiz', 'admin', false],
            ['beto', 'Beto Gil', 'agent', false],
            ['caro', 'Caro Paz', 'viewer', false],
            ['dani', 'Dani Sol', 'manager', false],
            ['eve', 'Eve Mar', 'manager', true],
            ['cli', 'Cliente Uno', 'client', false],
        ];
        for (const [key, name, role, disabled] of people) {
            const [u] = await pg.db
                .insert(users)
                .values({ email: `${key}@acme.test`, passwordHash: 'x', name, ...(disabled ? { disabledAt: new Date() } : {}) })
                .returning();
            ids[key] = u!.id;
            await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role }));
        }
        admin = { userId: ids.ana!, role: 'admin' };
        await pg.db.insert(plans).values({ slug: 'mini455', name: 'Mini', maxRecords: 1 }).onConflictDoNothing();
    });

    afterAll(async () => {
        await redis?.quit().catch(() => undefined);
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        jobs.length = 0;
        await pg.db.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantId));
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(notifications).where(eq(notifications.tenantId, tenantId));
            await tx.delete(automationMatches).where(eq(automationMatches.tenantId, tenantId));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
            await tx.delete(teamMembers).where(eq(teamMembers.tenantId, tenantId));
            await tx.delete(teams).where(eq(teams.tenantId, tenantId));
        });
        tareasId = (await listsService.create(tenantId, { name: 'Tareas', slug: 'tareas' })).id;
        const defs: CreateFieldInput[] = [
            { label: 'Título', type: 'text', slug: 'titulo' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: {
                    options: [
                        { value: 'normal', label: 'Normal' },
                        { value: 'urgente', label: 'Urgente' },
                        { value: 'hecho', label: 'Hecho' },
                    ],
                },
            },
            { label: 'Vence', type: 'date', slug: 'vence' },
            { label: 'Responsable', type: 'user', slug: 'responsable' },
            { label: 'Nota', type: 'long_text', slug: 'nota' },
            { label: 'Archivos', type: 'file', slug: 'archivos' },
        ];
        t = {};
        for (const d of defs) t[d.slug!] = await fieldsService.create(tenantId, 'tareas', d);
    });

    const k = (slug: string) => `f${t[slug]!.id}`;
    const runsOf = async (automationId: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)))).sort((a, b) => a.id - b.id);
    const matchesOf = async (automationId: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationMatches).where(eq(automationMatches.automationId, automationId)))).map((m) => m.recordId).sort((a, b) => a - b);
    const get = (id: number) => recs.get(tenantId, admin, 'tareas', id);
    /** Corre lo que encoló el dispatcher (eventos y tandas), hasta que no quede nada. */
    const drain = async (): Promise<void> => {
        for (let round = 0; round < 30; round++) {
            await new Promise((r) => setTimeout(r, 40));
            if (jobs.length === 0) return;
            for (const j of jobs.splice(0)) {
                if (j.name === 'scheduled-batch') {
                    await engine.runScheduledBatch(Number(j.data.tenantId), Number(j.data.automationId), j.data.recordIds as number[]);
                } else if (j.name === 'event') {
                    await engine.process(j.data as unknown as TriggerEvent);
                }
            }
        }
    };
    const urgent = { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 0, op: 'eq', value: 'urgente' }] };
    const urgentTree = () => ({ ...urgent, children: [{ ...urgent.children[0]!, field_id: t.estado!.id }] });
    const create = (data: Record<string, unknown>, by: Actor = admin) => recs.create(tenantId, by, 'tareas', { data });
    const update = (id: number, data: Record<string, unknown>, by: Actor = admin) => recs.update(tenantId, by, 'tareas', id, { data });
    const rawPatch = (id: number, patch: Record<string, unknown>) =>
        withTenant(pg.db, tenantId, async (tx) => {
            const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, id));
            await tx
                .update(records)
                .set({ data: { ...(row!.data as Record<string, unknown>), ...patch } })
                .where(eq(records.id, id));
        });
    const ymd = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it('«empieza a cumplir»: dispara al ENTRAR por una edición, no otra vez mientras la cumple, sí al salir y volver; la línea de base no dispara', async () => {
        const before = await create({ [k('titulo')]: 'Ya urgente', [k('estado')]: 'urgente' });
        await drain();
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Urgentes',
            trigger_type: 'record_matches',
            trigger_config: { match_filter: urgentTree() },
            actions: [{ type: 'update_field', config: { values: { nota: 'Entró {{titulo}}' } } }] as never,
        });
        // La línea de base: lo que YA la cumplía queda anotado, sin disparar.
        expect(await matchesOf(auto.id)).toEqual([before.id]);
        await update(before.id, { [k('titulo')]: 'Ya urgente (editado)' });
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(0);

        const r = await create({ [k('titulo')]: 'Tarea A', [k('estado')]: 'normal' });
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(0);
        await update(r.id, { [k('estado')]: 'urgente' });
        await drain();
        let runs = await runsOf(auto.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.status).toBe('success');
        expect((await get(r.id)).data[k('nota')]).toBe('Entró Tarea A');
        // Sigue cumpliéndola: ni la propia acción ni otra edición la vuelven a disparar.
        await update(r.id, { [k('titulo')]: 'Tarea A2' });
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(1);
        // Sale…
        await update(r.id, { [k('estado')]: 'normal' });
        await drain();
        expect(await matchesOf(auto.id)).toEqual([before.id]);
        // …y vuelve a entrar: dispara otra vez.
        await update(r.id, { [k('estado')]: 'urgente' });
        await drain();
        runs = await runsOf(auto.id);
        expect(runs).toHaveLength(2);
        expect(await matchesOf(auto.id)).toEqual([before.id, r.id].sort((a, b) => a - b));
    });

    it('«empieza a cumplir»: al crear ya cumpliéndola dispara (o no, si se apaga); dos eventos a la vez no disparan dos veces', async () => {
        const onCreate = await autos.create(tenantId, 'tareas', {
            name: 'Al crear',
            trigger_type: 'record_matches',
            trigger_config: { match_filter: urgentTree() },
            actions: [{ type: 'update_field', config: { values: { nota: 'sí' } } }] as never,
        });
        const noCreate = await autos.create(tenantId, 'tareas', {
            name: 'Sin crear',
            trigger_type: 'record_matches',
            trigger_config: { match_filter: urgentTree(), match_on_create: false },
            actions: [{ type: 'update_field', config: { values: { titulo: 'cambiado' } } }] as never,
        });
        const r = await create({ [k('titulo')]: 'Nace urgente', [k('estado')]: 'urgente' });
        await drain();
        expect(await runsOf(onCreate.id)).toHaveLength(1);
        expect(await runsOf(noCreate.id)).toHaveLength(0);
        // La de «sin crear» igual la anotó: editarla no la dispara.
        expect(await matchesOf(noCreate.id)).toEqual([r.id]);

        // Dos eventos simultáneos por la misma entrada: una sola corrida.
        const s = await create({ [k('titulo')]: 'Doble', [k('estado')]: 'normal' });
        await drain();
        await rawPatch(s.id, { [k('estado')]: 'urgente' });
        const ev = (): TriggerEvent => ({
            tenantId,
            listId: tareasId,
            recordId: s.id,
            trigger: 'record_updated',
            before: { [k('estado')]: 'normal' },
            after: { [k('titulo')]: 'Doble', [k('estado')]: 'urgente' },
        });
        await Promise.all([engine.process(ev()), engine.process(ev()), engine.process(ev())]);
        const runs = (await runsOf(onCreate.id)).filter((x) => x.recordId === s.id);
        expect(runs).toHaveLength(1);
    });

    it('«empieza a cumplir»: la revisión periódica dispara a los que entraron por el paso del tiempo y saca a los que salieron', async () => {
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Vencidas',
            trigger_type: 'record_matches',
            trigger_config: { match_filter: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: t.vence!.id, op: 'between_relative', value: 'before_today' }] } },
            actions: [{ type: 'update_field', config: { values: { nota: 'Vencida' } } }] as never,
        });
        const a = await create({ [k('titulo')]: 'A', [k('vence')]: ymd(5) });
        const b = await create({ [k('titulo')]: 'B', [k('vence')]: ymd(-2) });
        await drain();
        expect((await runsOf(auto.id)).map((r) => r.recordId)).toEqual([b.id]);
        // Pasa el tiempo (sin que nadie edite): A vence y B se reprograma a futuro.
        await rawPatch(a.id, { [k('vence')]: ymd(-1) });
        await rawPatch(b.id, { [k('vence')]: ymd(10) });
        await engine.runMatchScan(tenantId, auto.id);
        await drain();
        expect((await runsOf(auto.id)).map((r) => r.recordId)).toEqual([b.id, a.id]);
        expect((await get(a.id)).data[k('nota')]).toBe('Vencida');
        expect(await matchesOf(auto.id)).toEqual([a.id]);
        // Una revisión más no repite nada.
        await engine.runMatchScan(tenantId, auto.id);
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(2);

        // Cambiar la condición vuelve a armar la línea de base sin disparar.
        await autos.update(tenantId, 'tareas', auto.id, {
            trigger_config: { match_filter: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: t.vence!.id, op: 'is_not_null' }] } },
        } as never);
        expect(await matchesOf(auto.id)).toEqual([a.id, b.id].sort((x, y) => x - y));
        await engine.runMatchScan(tenantId, auto.id);
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(2);
    });

    it('«Cuando se sube un archivo»: sólo lo nuevo del tipo elegido, con sus variables', async () => {
        const [png, pdf] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(attachments)
                .values([
                    { tenantId, filename: 'foto.png', mime: 'image/png', sizeBytes: 2048, storageKey: 'k/foto.png' },
                    { tenantId, filename: 'factura.pdf', mime: 'application/pdf', sizeBytes: 245_000, storageKey: 'k/factura.pdf' },
                ])
                .returning(),
        );
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'PDF',
            trigger_type: 'file_added',
            trigger_config: { file_field_id: t.archivos!.id, file_kind: 'pdf' },
            actions: [
                {
                    type: 'update_field',
                    config: { values: { nota: '{{archivo.nombre}} · {{archivo.tipo}} · {{archivo.tamano}} · {{archivo.campo}} · {{archivo.cantidad}} · {{archivo.enlace}}' } },
                },
            ] as never,
        });
        const r = await create({ [k('titulo')]: 'Con archivos' });
        await drain();
        await update(r.id, { [k('archivos')]: [png!.id] });
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(0);
        await update(r.id, { [k('archivos')]: [png!.id, pdf!.id] });
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(1);
        const nota = String((await get(r.id)).data[k('nota')]);
        expect(nota).toContain('factura.pdf · PDF · ');
        expect(nota).toContain(' · Archivos · 1 · ');
        expect(nota).toContain(`https://app.test/f/${pdf!.id}`);
        // Otro cambio (sin archivo nuevo) no dispara.
        await update(r.id, { [k('titulo')]: 'Sin archivo nuevo' });
        await drain();
        expect(await runsOf(auto.id)).toHaveLength(1);
    });

    it('«Avisar en la app»: sólo a quien puede ver el registro, nunca a un cliente del portal, sin los campos ocultos', async () => {
        // El lector (caro) no ve «Nota».
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({
                    settings: {
                        permissions: {
                            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['nota'] } },
                            assignment_field_id: null,
                            users: {},
                            teams: {},
                        },
                    },
                })
                .where(eq(lists.id, tareasId)),
        );
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Avisar',
            trigger_type: 'record_updated',
            trigger_config: { changed_fields: ['estado'] },
            actions: [
                {
                    type: 'notify_in_app',
                    config: {
                        title: 'Urgente: {{titulo}}',
                        message: 'Nota: {{nota}}',
                        notify_user_ids: [ids.beto, ids.caro, ids.cli],
                        person_field_ids: [t.responsable!.id],
                        include_actor: true,
                    },
                },
            ] as never,
        });
        const r = await create({ [k('titulo')]: 'Caja', [k('nota')]: 'secreto', [k('responsable')]: ids.dani });
        await drain();
        await update(r.id, { [k('estado')]: 'urgente' });
        await drain();
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const inbox = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.kind, 'automation'))),
        );
        const to = new Set(inbox.map((n) => n.userId));
        expect(to).toEqual(new Set([ids.ana, ids.caro, ids.dani]));
        const forCaro = inbox.find((n) => n.userId === ids.caro)!;
        expect(forCaro.title).toBe('Urgente: Caja');
        expect(String(forCaro.body)).not.toContain('secreto');
        expect(String(inbox.find((n) => n.userId === ids.dani)!.body)).toContain('secreto');
        expect(forCaro.recordId).toBe(r.id);
        const log = run!.actionsLog as LogEntry[];
        expect(log[0]!.message).toContain('Avisó a');
        expect(log[0]!.message).toContain('no lo recibieron');
    });

    it('«Asignar por turno»: reparte entre quienes pueden ver y editar, salta al resto; «a quien tenga menos abiertos» cuenta como «Mi trabajo»', async () => {
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Turnos',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                { type: 'assign_round_robin', config: { person_field_id: t.responsable!.id, assignee_user_ids: [ids.beto, ids.ana, ids.caro, ids.dani, ids.eve] } },
                { type: 'update_field', config: { values: { nota: 'Para {{asignado.nombre}} <{{asignado.email}}>' } } },
            ] as never,
        });
        const made: number[] = [];
        for (let i = 0; i < 4; i++) made.push((await create({ [k('titulo')]: `T${i}` })).id);
        await drain();
        const who = await Promise.all(made.map(async (id) => (await get(id)).data[k('responsable')]));
        expect(who).toEqual([ids.ana, ids.dani, ids.ana, ids.dani]);
        expect((await get(made[1]!)).data[k('nota')]).toBe('Para Dani Sol <dani@acme.test>');
        const runs = await runsOf(auto.id);
        expect((runs[0]!.actionsLog as LogEntry[])[0]!.message).toContain('Se saltó a 3 persona(s)');
        // Ya tiene a alguien: no se cambia.
        const pre = await create({ [k('titulo')]: 'Asignada', [k('responsable')]: ids.dani });
        await drain();
        expect((await get(pre.id)).data[k('responsable')]).toBe(ids.dani);

        // Menos abiertos, entre las personas de un equipo.
        await autos.update(tenantId, 'tareas', auto.id, { is_active: false } as never);
        const [team] = await withTenant(pg.db, tenantId, (tx) => tx.insert(teams).values({ tenantId, name: 'Soporte' }).returning());
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(teamMembers).values([
                { tenantId, teamId: team!.id, userId: ids.dani! },
                { tenantId, teamId: team!.id, userId: ids.ana! },
            ]),
        );
        await withTenant(pg.db, tenantId, (tx) => tx.delete(records).where(eq(records.tenantId, tenantId)));
        // Dani: 2 abiertas. Ana: 1 abierta y 3 hechas (no cuentan).
        for (const [who2, estado] of [
            [ids.dani, 'normal'],
            [ids.dani, 'urgente'],
            [ids.ana, 'normal'],
            [ids.ana, 'hecho'],
            [ids.ana, 'hecho'],
            [ids.ana, 'hecho'],
        ] as const) {
            await create({ [k('titulo')]: 'x', [k('responsable')]: who2, [k('estado')]: estado });
        }
        await drain();
        const least = await autos.create(tenantId, 'tareas', {
            name: 'Menos abiertos',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [{ type: 'assign_round_robin', config: { person_field_id: t.responsable!.id, team_id: team!.id, assign_mode: 'least_open' } }] as never,
        });
        const n = await create({ [k('titulo')]: 'Nueva' });
        await drain();
        expect((await get(n.id)).data[k('responsable')]).toBe(ids.ana);
        const [lr] = await runsOf(least.id);
        expect((lr!.actionsLog as LogEntry[])[0]!.message).toContain('la que menos');
    });

    it('«Copiar a otra lista»: los campos del mismo nombre, valores a mano, el vínculo con el original y el límite del plan', async () => {
        const proyectosId = (await listsService.create(tenantId, { name: 'Proyectos', slug: 'proyectos' })).id;
        const p: Record<string, Field> = {};
        const pDefs: CreateFieldInput[] = [
            { label: 'Título', type: 'text', slug: 'nombre' },
            { label: 'Estado', type: 'select', slug: 'fase', config: { options: [{ value: 'n', label: 'Normal' }, { value: 'u', label: 'Urgente' }] } },
            { label: 'Vence', type: 'date', slug: 'entrega' },
            { label: 'Archivos', type: 'file', slug: 'adjuntos' },
            { label: 'Origen', type: 'text', slug: 'origen' },
            { label: 'Tarea', type: 'relation', slug: 'tarea', config: { target_list_id: tareasId } },
        ];
        for (const d of pDefs) p[d.slug!] = await fieldsService.create(tenantId, 'proyectos', d);
        const [doc] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(attachments).values({ tenantId, filename: 'plano.pdf', mime: 'application/pdf', sizeBytes: 10, storageKey: 'k/plano.pdf' }).returning(),
        );
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'Copiar',
            trigger_type: 'record_updated',
            trigger_config: { changed_fields: ['estado'] },
            actions: [
                { type: 'copy_record', config: { target_list_id: proyectosId, link_field_id: p.tarea!.id, values: { origen: '{{titulo}} (#{{record.id}})' } } },
                { type: 'update_field', config: { values: { nota: 'Copia #{{respuestas.copia.id}} en {{respuestas.copia.lista}}' } } },
            ] as never,
        });
        const r = await create({ [k('titulo')]: 'Obra', [k('vence')]: '2026-12-01', [k('archivos')]: [doc!.id] });
        await drain();
        await update(r.id, { [k('estado')]: 'urgente' });
        await drain();
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        const [copy] = (await recs.list(tenantId, admin, 'proyectos', { limit: 10, sort_dir: 'asc' })).data;
        expect(copy!.data[`f${p.nombre!.id}`]).toBe('Obra');
        expect(copy!.data[`f${p.fase!.id}`]).toBe('u');
        expect(copy!.data[`f${p.entrega!.id}`]).toBe('2026-12-01');
        expect(copy!.data[`f${p.adjuntos!.id}`]).toEqual([doc!.id]);
        expect(copy!.data[`f${p.origen!.id}`]).toBe(`Obra (#${r.id})`);
        expect(copy!.relations?.[`f${p.tarea!.id}`]).toEqual([r.id]);
        expect((await get(r.id)).data[k('nota')]).toBe(`Copia #${copy!.id} en Proyectos`);

        // Con el plan lleno, la copia falla con el motivo y no crea nada.
        await pg.db.update(tenants).set({ plan: 'mini455' }).where(eq(tenants.id, tenantId));
        await update(r.id, { [k('estado')]: 'normal' });
        await drain();
        const all = await runsOf(auto.id);
        expect(all).toHaveLength(2);
        expect(all[1]!.status).toBe('failed');
        expect((all[1]!.actionsLog as LogEntry[])[0]!.message).toContain('límite');
        expect((await recs.list(tenantId, admin, 'proyectos', { limit: 10, sort_dir: 'asc' })).data).toHaveLength(1);
    });

    it('«Probar»: dice a quién avisaría, a quién asignaría y qué copiaría, sin escribir nada', async () => {
        const destinoId = (await listsService.create(tenantId, { name: 'Destino', slug: 'destino' })).id;
        await fieldsService.create(tenantId, 'destino', { label: 'Título', type: 'text', slug: 'titulo' });
        const r = await create({ [k('titulo')]: 'Prueba', [k('estado')]: 'urgente' });
        await drain();
        const res = await autos.testRun(
            tenantId,
            'tareas',
            {
                trigger_type: 'record_matches',
                trigger_config: { match_filter: urgentTree() },
                actions: [
                    { type: 'notify_in_app', config: { title: 'Hola {{titulo}}', notify_user_ids: [ids.caro] } },
                    { type: 'assign_round_robin', config: { person_field_id: t.responsable!.id, assignee_user_ids: [ids.dani] } },
                    { type: 'copy_record', config: { target_list_id: destinoId } },
                ] as never,
                record_id: r.id,
                real_steps: [],
            },
            admin,
        );
        expect(res.trigger.matches).toBe(true);
        const steps = res.steps as unknown as LogEntry[];
        expect(steps.find((s) => s.action === 'notify_in_app')!.message).toContain('Le avisaría a Caro Paz');
        expect(steps.find((s) => s.action === 'assign_round_robin')!.message).toContain('Asignaría «Responsable» a Dani Sol');
        expect(steps.find((s) => s.action === 'copy_record')!.message).toContain('Copiaría el registro a «Destino»');
        const inbox = await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, tenantId)));
        expect(inbox).toHaveLength(0);
        expect((await get(r.id)).data[k('responsable')]).toBeUndefined();
        expect((await recs.list(tenantId, admin, 'destino', { limit: 10, sort_dir: 'asc' })).data).toHaveLength(0);
        // Uno que no la cumple, lo dice.
        const n = await create({ [k('titulo')]: 'Normal', [k('estado')]: 'normal' });
        const res2 = await autos.testRun(
            tenantId,
            'tareas',
            { trigger_type: 'record_matches', trigger_config: { match_filter: urgentTree() }, actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }] as never, record_id: n.id, real_steps: [] },
            admin,
        );
        expect(res2.trigger.matches).toBe(false);
        expect(res2.trigger.message).toContain('no cumple la condición');
    });

    it('al guardar: «empieza a cumplir» exige una condición y las acciones nuevas, sus datos', async () => {
        await expect(
            autos.create(tenantId, 'tareas', { name: 'Sin condición', trigger_type: 'record_matches', trigger_config: {}, actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }] as never }),
        ).rejects.toThrow();
        await expect(
            autos.create(tenantId, 'tareas', { name: 'Sin a quién', trigger_type: 'record_created', trigger_config: {}, actions: [{ type: 'notify_in_app', config: { title: 'Hola' } }] as never }),
        ).rejects.toThrow();
        await expect(
            autos.create(tenantId, 'tareas', { name: 'Sin lista', trigger_type: 'record_created', trigger_config: {}, actions: [{ type: 'copy_record', config: {} }] as never }),
        ).rejects.toThrow();
    });

    it('asistente/MCP: traduce por slug y nombre, y explica lo que no cierra', async () => {
        const fs = Object.values(t);
        const cfg: Record<string, unknown> = { match_filters: [{ field: 'estado', op: 'eq', value: 'Urgente' }] };
        translateExtraTrigger('record_matches', cfg, fs, 'Tareas');
        expect(cfg.match_filter).toMatchObject({ type: 'group', children: [{ field_id: t.estado!.id, op: 'eq', value: 'urgente' }] });
        expect(cfg.match_filters).toBeUndefined();
        expect(() => translateExtraTrigger('record_matches', {}, fs, 'Tareas')).toThrow(/al menos una condición/);
        const fc: Record<string, unknown> = { file_field: 'archivos', file_kind: 'pdf' };
        translateExtraTrigger('file_added', fc, fs, 'Tareas');
        expect(fc).toEqual({ file_field_id: t.archivos!.id, file_kind: 'pdf' });
        expect(() => translateExtraTrigger('file_added', { file_field: 'titulo' }, fs, 'Tareas')).toThrow(/no es un campo de archivos/);

        const ctx = {
            listId: tareasId,
            listName: 'Tareas',
            fields: fs,
            lists: [{ id: tareasId, slug: 'tareas', name: 'Tareas' }],
            fieldsOf: () => Promise.resolve(fs),
            teams: [{ id: 77, name: 'Ventas' }],
        };
        const actions: Array<{ type: string; config: Record<string, unknown> }> = [
            { type: 'notify_in_app', config: { title: 'Hola', person_fields: ['responsable'], teams: ['ventas'], users: [ids.caro] } },
            { type: 'assign_round_robin', config: { person_field: 'responsable', team: 'Ventas', assign_mode: 'least_open' } },
            { type: 'copy_record', config: { list: 'tareas', values: { titulo: '{{titulo}}' } } },
        ];
        await translateExtraActions(actions, ctx);
        expect(actions[0]!.config).toEqual({ title: 'Hola', person_field_ids: [t.responsable!.id], notify_team_ids: [77], notify_user_ids: [ids.caro] });
        expect(actions[1]!.config).toEqual({ person_field_id: t.responsable!.id, team_id: 77, assign_mode: 'least_open' });
        expect(actions[2]!.config).toEqual({ target_list_id: tareasId, values: { titulo: '{{titulo}}' } });
        await expect(translateExtraActions([{ type: 'copy_record', config: { list: 'tareas', values: { no_existe: 'x' } } }], ctx)).rejects.toThrow(/no_existe/);
        await expect(translateExtraActions([{ type: 'assign_round_robin', config: { person_field: 'titulo', team: 'Ventas' } }], ctx)).rejects.toThrow(/no es un campo Persona/);
        await expect(translateExtraActions([{ type: 'notify_in_app', config: { title: 'x', teams: ['Nadie'] } }], ctx)).rejects.toThrow(/no existe/);
    });

    it('RLS: el estado de «empieza a cumplir» es de cada empresa', async () => {
        const auto = await autos.create(tenantId, 'tareas', {
            name: 'RLS',
            trigger_type: 'record_matches',
            trigger_config: { match_filter: urgentTree() },
            actions: [{ type: 'update_field', config: { values: { nota: 'x' } } }] as never,
        });
        const r = await create({ [k('titulo')]: 'A', [k('estado')]: 'urgente' });
        await drain();
        expect(await matchesOf(auto.id)).toEqual([r.id]);
        const seen = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(automationMatches));
        expect(seen).toHaveLength(0);
        await expect(
            withTenant(pg.db, otherTenant, (tx) => tx.insert(automationMatches).values({ tenantId, automationId: auto.id, recordId: r.id })),
        ).rejects.toThrow();
    });
});
