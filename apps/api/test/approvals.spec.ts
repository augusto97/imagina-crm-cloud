import { ConflictException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { customRoleKey, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    activity,
    approvalDecisions,
    approvalFlows,
    approvalRequests,
    automationRuns,
    automations,
    customRoles,
    fields as fieldsTable,
    lists as listsTable,
    memberships,
    records as recordsTable,
    tenants,
    teamMembers,
    teams as teamsTable,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ApprovalHub } from '../src/approvals/approval-hub';
import { approvalFlowRefs, withoutApprovalFlowRefs } from '../src/approvals/approval-refs';
import { ApprovalsRepository } from '../src/approvals/approvals.repository';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationWaitsService } from '../src/automations/automation-waits.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import { notificationEmail } from '../src/notifications/notification-text';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { emptyMaps, remapJson } from '../src/platform/tenant-transfer.remap';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { TeamsService } from '../src/teams/teams.service';
import { connectTeamApprovers } from '../src/teams/teams.module';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class NullMail implements MailTransport {
    readonly name = 'null';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

class MemoryHooks implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

interface Delivered {
    kind: string;
    users: number[];
    title: string;
    actions: string[];
}

/**
 * C5 — Aprobaciones: flujos por lista, solicitudes por registro y decisiones,
 * con Postgres real y RLS. Cubre el ciclo completo (pedir → paso 1 por campo
 * Persona → paso 2 por rol con «todos») y lo que el servidor SIEMPRE
 * re-chequea (aprobador en vivo, el paso que se vio, autoaprobación, motivo),
 * la concurrencia, la papelera, el campo derivado «Aprobación» y las
 * automatizaciones (disparador, «Pedir aprobación» y «Esperar aprobación»).
 */
describe('Aprobaciones (Postgres real + RLS)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let approvals: ApprovalsService;
    let aggregate: AggregateService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let waits: AutomationWaitsService;
    let hub: ApprovalHub;
    const delivered: Delivered[] = [];
    const dispatched: TriggerEvent[] = [];
    let tenantA: number;
    let tenantB: number;
    let ana: Actor; // admin, pide
    let jefe: Actor; // agente, jefe del gasto
    let otroJefe: Actor;
    let m1: Actor; // managers
    let m2: Actor;
    let vera: Actor; // viewer
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const dispatcher = new AutomationDispatcher();
        // Lo que se despacha queda a mano: el test lo corre con el motor.
        dispatcher.setQueue({
            add: (name: string, data: unknown) => {
                if (name === 'event') dispatched.push(data as TriggerEvent);
                return Promise.resolve();
            },
        } as never);
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activitySvc, dispatcher, new RelationsRepository());
        const notifications = {
            deliver: (_t: number, kind: string, userIds: number[], p: { title: string; mail?: { actions: Array<{ label: string }> } }) => {
                delivered.push({ kind, users: [...userIds].sort((a, b) => a - b), title: p.title, actions: (p.mail?.actions ?? []).map((a) => a.label) });
                return Promise.resolve();
            },
        } as unknown as NotificationsService;
        hub = new ApprovalHub();
        approvals = new ApprovalsService(
            tenantDb,
            new ApprovalsRepository(),
            lists,
            fieldsSvc,
            recs,
            activitySvc,
            rt,
            new AuditService(tenantDb),
            notifications,
            dispatcher,
            hub,
        );
        aggregate = new AggregateService(tenantDb, lists, fieldsSvc);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const tz = new TenantTimeZones(tenantDb);
        const moduleRef = {
            get: (cls: unknown) => (cls === RecordsService ? recs : cls === ApprovalsService ? approvals : null),
        };
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NullMail()),
            connectors,
            undefined,
            dispatcher,
            undefined,
            undefined,
            tz,
            undefined,
            undefined,
            moduleRef as never,
        );
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            lists,
            new AutomationScheduler(),
            new MemoryHooks(),
            connectors,
            tz,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            engine,
        );
        // Sin cola: las reanudaciones corren en el acto; la aprobación resuelta las despierta.
        waits = new AutomationWaitsService(pg.db, tenantDb, engine, new AutomationDispatcher(), undefined, tz, undefined, hub);
        waits.onModuleInit();

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'enterprise' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        jefe = { userId: await mk('jefe@acme.test', 'Jorge Jefe'), role: 'agent' };
        otroJefe = { userId: await mk('otro@acme.test', 'Olga Otra'), role: 'agent' };
        m1 = { userId: await mk('m1@acme.test', 'Marta'), role: 'manager' };
        m2 = { userId: await mk('m2@acme.test', 'Mario'), role: 'manager' };
        vera = { userId: await mk('vera@acme.test', 'Vera'), role: 'viewer' };
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([ana, jefe, otroJefe, m1, m2, vera].map((a) => ({ tenantId: tenantA, userId: a.userId, role: a.role }))),
        );
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        delivered.length = 0;
        dispatched.length = 0;
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.delete(approvalDecisions).where(eq(approvalDecisions.tenantId, tenantA));
            await tx.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantA));
            await tx.delete(approvalFlows).where(eq(approvalFlows.tenantId, tenantA));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantA));
            await tx.delete(automations).where(eq(automations.tenantId, tenantA));
            await tx.delete(activity).where(eq(activity.tenantId, tenantA));
            await tx.delete(recordsTable).where(eq(recordsTable.tenantId, tenantA));
            await tx.delete(fieldsTable).where(eq(fieldsTable.tenantId, tenantA));
            await tx.delete(listsTable).where(eq(listsTable.tenantId, tenantA));
        });
        await lists.create(tenantA, { name: 'Gastos', slug: 'gastos' });
        f = {};
        for (const d of [
            { label: 'Concepto', type: 'text', slug: 'concepto' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            { label: 'Jefe', type: 'user', slug: 'jefe' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: {
                    options: [
                        { value: 'pendiente', label: 'Pendiente' },
                        { value: 'aprobado', label: 'Aprobado' },
                        { value: 'rechazado', label: 'Rechazado' },
                    ],
                },
            },
        ] as CreateFieldInput[]) {
            f[d.slug!] = await fieldsSvc.create(tenantA, 'gastos', d);
        }
        // Los agentes (jefes) ven todos los gastos; editan sólo lo suyo.
        const l = await lists.get(tenantA, 'gastos');
        await lists.update(tenantA, 'gastos', {
            settings: { ...l.settings, permissions: { permissions: { agent: { view: 'all', create: true, edit: 'own', delete: 'none', fields_hidden: [] } } } },
        });
    });

    const k = (slug: string) => `f${f[slug]!.id}`;
    const twoSteps = (extra: Record<string, unknown> = {}) => ({
        steps: [
            { id: 's1', name: 'Jefe directo', approver: { type: 'field' as const, approver_field_id: f.jefe!.id }, mode: 'any' as const },
            { id: 's2', name: 'Finanzas', approver: { type: 'role' as const, role: 'manager' }, mode: 'all' as const },
        ],
        on_approve: [{ field_id: f.estado!.id, value: 'aprobado' }],
        on_reject: [{ field_id: f.estado!.id, value: 'rechazado' }],
        ...extra,
    });
    const gasto = async (concepto: string, jefeId = jefe.userId) =>
        recs.create(tenantA, ana, 'gastos', { data: { [k('concepto')]: concepto, [k('monto')]: 1_500_000, [k('jefe')]: jefeId, [k('estado')]: 'pendiente' } });

    async function expectCode(p: Promise<unknown>, cls: new (...a: never[]) => Error, code: string): Promise<void> {
        const err = await p.then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(cls);
        expect(((err as { getResponse: () => { code?: string } }).getResponse()).code).toBe(code);
    }

    it('flujo de dos pasos: campo Persona → rol con «todos aprueban» → campos puestos, avisos y actividad', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Gasto > $1M', config: twoSteps(), add_status_field: true });
        const statusField = (await fieldsSvc.listByListId(tenantA, (await lists.get(tenantA, 'gastos')).id)).find((x) => x.type === 'approval')!;
        expect(statusField.label).toBe('Aprobación: Gasto > $1M');
        expect((statusField.config as { approval_flow_id: number }).approval_flow_id).toBe(flow.id);

        const g = await gasto('Portátil');
        const req = await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id, note: 'Urgente' });
        expect(req.status).toBe('pending');
        expect(req.current_step).toBe(0);
        // Aviso SOLO al jefe del registro, con los botones del correo.
        expect(delivered).toEqual([expect.objectContaining({ kind: 'approval', users: [jefe.userId], actions: ['Aprobar', 'Rechazar', 'Abrir el registro'] })]);
        // Pedir otra vez mientras está pendiente → 409.
        await expectCode(approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id }), ConflictException, 'approval_pending');

        // Indicador en la fila + campo derivado «pendiente».
        const row = await recs.get(tenantA, ana, 'gastos', g.id);
        expect(row.approval_pending).toBe(1);
        expect(row.data[`f${statusField.id}`]).toBe('pending');

        // Mi trabajo del jefe; un manager todavía no (paso 1).
        expect((await approvals.myApprovals(tenantA, jefe)).pending.map((p) => p.id)).toEqual([req.id]);
        expect((await approvals.myApprovals(tenantA, m1)).pending).toHaveLength(0);
        // Ni un manager ni la viewer deciden el paso 1; tampoco quien pidió.
        await expectCode(approvals.decide(tenantA, m1, req.id, { decision: 'approve', step: 0 }), ForbiddenException, 'approval_not_approver');
        await expectCode(approvals.decide(tenantA, vera, req.id, { decision: 'approve', step: 0 }), ForbiddenException, 'approval_not_approver');
        // Rechazar exige motivo.
        await expectCode(approvals.decide(tenantA, jefe, req.id, { decision: 'reject', step: 0 }), BadRequestException, 'approval_reason_required');

        delivered.length = 0;
        const r1 = await approvals.decide(tenantA, jefe, req.id, { decision: 'approve', step: 0 });
        expect(r1.request.current_step).toBe(1);
        expect(r1.message).toMatch(/paso 1 de 2/);
        // El paso 2 avisa a los DOS managers.
        expect(delivered).toEqual([expect.objectContaining({ users: [m1.userId, m2.userId].sort((a, b) => a - b) })]);
        // Un doble clic sobre el paso 1 no aprueba el 2.
        await expectCode(approvals.decide(tenantA, jefe, req.id, { decision: 'approve', step: 0 }), ConflictException, 'approval_step_changed');

        const r2 = await approvals.decide(tenantA, m1, req.id, { decision: 'approve', step: 1 });
        expect(r2.request.status).toBe('pending'); // falta Mario
        await expectCode(approvals.decide(tenantA, m1, req.id, { decision: 'approve', step: 1 }), ConflictException, 'approval_already_decided');
        delivered.length = 0;
        const r3 = await approvals.decide(tenantA, m2, req.id, { decision: 'approve', step: 1 });
        expect(r3.request.status).toBe('approved');
        // Campos del flujo, aviso a quien pidió y evento para el disparador.
        const after = await recs.get(tenantA, ana, 'gastos', g.id);
        expect(after.data[k('estado')]).toBe('aprobado');
        expect(after.data[`f${statusField.id}`]).toBe('approved');
        expect(after.approval_pending).toBe(0);
        expect(delivered).toEqual([expect.objectContaining({ kind: 'approval', users: [ana.userId] })]);
        expect(dispatched.find((e) => e.trigger === 'approval_resolved')?.approval).toMatchObject({ resultado: 'aprobada', flow_name: 'Gasto > $1M', decidio: 'Mario' });

        const logs = await withTenant(pg.db, tenantA, (tx) => tx.select().from(activity).where(eq(activity.action, 'approval')));
        const events = logs.map((l) => (l.diff as { approval: { event: string } }).approval.event);
        expect(events).toEqual(expect.arrayContaining(['requested', 'approved_step', 'approved']));
        // Historial: quien decidió cada paso.
        const hist = await approvals.recordApprovals(tenantA, ana, 'gastos', g.id);
        expect(hist.requests[0]!.decisions.map((d) => d.user_name)).toEqual(['Jorge Jefe', 'Marta', 'Mario']);
    });

    it('C1 — «Un equipo» aprueba: sus personas EN VIVO, con acceso por equipo, nombre en el paso y equipo de otra empresa rechazado', async () => {
        const teamsSvc = new TeamsService(tenantDb, new RealtimeService(), new AuditService(tenantDb));
        connectTeamApprovers(approvals, teamsSvc);
        try {
            await withTenant(pg.db, tenantA, async (tx) => {
                await tx.delete(teamMembers).where(eq(teamMembers.tenantId, tenantA));
                await tx.delete(teamsTable).where(eq(teamsTable.tenantId, tenantA));
            });
            // Finanzas: Vera (lectora) y Marta. Vera NO ve los gastos por su rol…
            const finanzas = await teamsSvc.create(tenantA, ana.userId, { name: 'Finanzas', members: [{ user_id: vera.userId, is_lead: false }, { user_id: m1.userId, is_lead: false }] });
            const l = await lists.get(tenantA, 'gastos');
            const perms = (l.settings as { permissions: Record<string, unknown> }).permissions;
            await lists.update(tenantA, 'gastos', {
                settings: {
                    ...l.settings,
                    permissions: {
                        ...perms,
                        permissions: { ...(perms.permissions as object), viewer: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
                        // …pero el EQUIPO tiene acceso a la lista: eso alcanza para aprobar.
                        teams: { [String(finanzas.id)]: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
                    },
                },
            });
            const flow = await approvals.createFlow(tenantA, ana, 'gastos', {
                name: 'Por Finanzas',
                config: { steps: [{ id: 's1', approver: { type: 'team', team_id: finanzas.id }, mode: 'all' }] },
            });
            const g = await gasto('Servidor');
            const req = await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id });
            expect(delivered).toEqual([expect.objectContaining({ kind: 'approval', users: [m1.userId, vera.userId].sort((a, b) => a - b) })]);
            const hist = await approvals.recordApprovals(tenantA, ana, 'gastos', g.id);
            expect(hist.requests[0]!.steps[0]!.approver_label).toBe('Equipo: Finanzas');
            expect(hist.requests[0]!.steps[0]!.approvers.map((a) => a.id).sort((a, b) => a - b)).toEqual([m1.userId, vera.userId].sort((a, b) => a - b));
            // Vera decide CON sus equipos (acceso por equipo); Mario no es del equipo.
            const veraT = { ...vera, teamIds: [finanzas.id] };
            expect((await approvals.myApprovals(tenantA, veraT)).pending.map((p) => p.id)).toEqual([req.id]);
            await expectCode(approvals.decide(tenantA, m2, req.id, { decision: 'approve', step: 0 }), ForbiddenException, 'approval_not_approver');
            await approvals.decide(tenantA, veraT, req.id, { decision: 'approve', step: 0 });
            // En vivo: sacar a Marta del equipo la saca de los aprobadores.
            await teamsSvc.update(tenantA, ana.userId, finanzas.id, { members: [{ user_id: vera.userId, is_lead: false }] });
            await expectCode(approvals.decide(tenantA, m1, req.id, { decision: 'approve', step: 0 }), ForbiddenException, 'approval_not_approver');
            const now = await approvals.recordApprovals(tenantA, ana, 'gastos', g.id);
            expect(now.requests[0]!.steps[0]!.approvers.map((a) => a.id)).toEqual([vera.userId]);

            // Un equipo que no es de la empresa (u otro id inventado) no se guarda.
            const otroEquipo = await new TeamsService(tenantDb, new RealtimeService(), new AuditService(tenantDb)).create(tenantB, 0, { name: 'Ajeno' });
            await expectCode(
                approvals.createFlow(tenantA, ana, 'gastos', { name: 'Ajeno', config: { steps: [{ id: 's1', approver: { type: 'team', team_id: otroEquipo.id } }] } }),
                BadRequestException,
                'invalid_approval_flow',
            );
        } finally {
            approvals.setTeamMembersResolver(async () => []);
        }
    });

    it('C2/C3 — un rol propio aprueba como su rol base y con SU fila en la lista; un invitado nunca aprueba', async () => {
        const [rol] = await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(customRoles).values({ tenantId: tenantA, name: 'Contaduría', baseRole: 'viewer', capabilities: ['access_admin', 'view_records'] }).returning(),
        );
        const mkU = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        const carla: Actor = { userId: await mkU('carla@acme.test', 'Carla Contadora'), role: 'viewer', customRoleId: rol!.id, capabilities: ['access_admin', 'view_records'] };
        const gina: Actor = { userId: await mkU('gina@afuera.test', 'Gina Invitada'), role: 'guest' };
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([
                { tenantId: tenantA, userId: carla.userId, role: 'viewer', customRoleId: rol!.id },
                { tenantId: tenantA, userId: gina.userId, role: 'guest' },
            ]),
        );
        try {
            // Lectores sin acceso a los gastos, salvo el rol propio; la lista compartida con Gina.
            const l = await lists.get(tenantA, 'gastos');
            const perms = (l.settings as { permissions: { permissions: Record<string, unknown> } }).permissions;
            const all = { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
            await lists.update(tenantA, 'gastos', {
                settings: {
                    ...l.settings,
                    permissions: {
                        ...perms,
                        permissions: { ...perms.permissions, viewer: { ...all, view: 'none' }, [customRoleKey(rol!.id)]: all },
                        users: { [String(gina.userId)]: all },
                    },
                },
            });

            // «Por rol: lector» → Carla (rol propio con base lector) sí; Vera (lectora sin acceso) no.
            const porRol = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Por lectores', config: { steps: [{ id: 's1', approver: { type: 'role', role: 'viewer' }, mode: 'any' }] } });
            const g1 = await gasto('Licencias');
            const r1 = await approvals.request(tenantA, ana, 'gastos', g1.id, { flow_id: porRol.id });
            expect(delivered).toEqual([expect.objectContaining({ kind: 'approval', users: [carla.userId] })]);
            const hist = await approvals.recordApprovals(tenantA, ana, 'gastos', g1.id);
            expect(hist.requests[0]!.steps[0]!.approvers.map((a) => a.id)).toEqual([carla.userId]);
            // Vera no ve el registro: 404 opaco. Gina lo ve (lista compartida) pero no decide.
            await expectCode(approvals.decide(tenantA, vera, r1.id, { decision: 'approve', step: 0 }), NotFoundException, 'approval_not_found');
            await expectCode(approvals.decide(tenantA, gina, r1.id, { decision: 'approve', step: 0 }), ForbiddenException, 'approval_not_approver');
            expect((await approvals.myApprovals(tenantA, gina)).pending).toHaveLength(0);
            expect((await approvals.decide(tenantA, carla, r1.id, { decision: 'approve', step: 0 })).request.status).toBe('approved');

            // Nombrar a la invitada como aprobadora no se guarda, y no aparece para elegir.
            const err = await approvals
                .createFlow(tenantA, ana, 'gastos', { name: 'A mano', config: { steps: [{ id: 's1', approver: { type: 'users', approver_user_ids: [gina.userId, carla.userId] } }] } })
                .then(() => null, (e: unknown) => e as BadRequestException);
            expect(err).toBeInstanceOf(BadRequestException);
            expect((err!.getResponse() as { message: string }).message).toMatch(/invitadas de afuera no aprueban/);
            expect((await approvals.memberDirectory(tenantA)).map((m) => m.id)).not.toContain(gina.userId);
            const aMano = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'A mano', config: { steps: [{ id: 's1', approver: { type: 'users', approver_user_ids: [carla.userId] } }] } });

            // Pedir exige poder editar con las capacidades EFECTIVAS: un manager con un rol propio sin «editar» no pide.
            const g3 = await gasto('Monitor');
            await expectCode(
                approvals.request(tenantA, { ...m1, capabilities: ['access_admin', 'view_records'] }, 'gastos', g3.id, { flow_id: aMano.id }),
                ForbiddenException,
                'approval_forbidden',
            );
        } finally {
            await withTenant(pg.db, tenantA, async (tx) => {
                await tx.delete(memberships).where(and(eq(memberships.tenantId, tenantA), inArray(memberships.userId, [carla.userId, gina.userId])));
                await tx.delete(customRoles).where(eq(customRoles.tenantId, tenantA));
            });
        }
    });

    it('el campo «Aprobación» filtra, ordena y agrupa por el estado (subconsulta, sin N+1)', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Simple', config: { steps: [{ id: 's1', approver: { type: 'users', approver_user_ids: [m1.userId] } }] }, add_status_field: true });
        const fieldId = (await fieldsSvc.listByListId(tenantA, (await lists.get(tenantA, 'gastos')).id)).find((x) => x.type === 'approval')!.id;
        const a = await gasto('A');
        const b = await gasto('B');
        await gasto('C (sin pedir)');
        const ra = await approvals.request(tenantA, ana, 'gastos', a.id, { flow_id: flow.id });
        await approvals.request(tenantA, ana, 'gastos', b.id, { flow_id: flow.id });
        await approvals.decide(tenantA, m1, ra.id, { decision: 'approve', step: 0 });

        const tree = (op: string, value?: unknown) => ({ type: 'group' as const, logic: 'and' as const, children: [{ type: 'condition' as const, field_id: fieldId, op: op as never, value }] });
        const pend = await recs.list(tenantA, ana, 'gastos', { limit: 50, sort_dir: 'asc', filter_tree: tree('eq', 'pending') });
        expect(pend.data.map((r) => r.id)).toEqual([b.id]);
        const none = await recs.list(tenantA, ana, 'gastos', { limit: 50, sort_dir: 'asc', filter_tree: tree('is_null') });
        expect(none.data).toHaveLength(1);
        const some = await recs.list(tenantA, ana, 'gastos', { limit: 50, sort_dir: 'asc', filter_tree: tree('in', ['pending', 'approved']) });
        expect(some.data).toHaveLength(2);
        // Orden del catálogo: pendiente → aprobada → (sin pedir al final).
        const sorted = await recs.list(tenantA, ana, 'gastos', { limit: 50, sort_dir: 'asc', sort: `field_${fieldId}:asc` });
        expect(sorted.data.map((r) => r.data[`f${fieldId}`])).toEqual(['pending', 'approved', null]);
        const grouped = await aggregate.run(tenantA, 'gastos', { metric: 'count', group_by_field_id: fieldId });
        const counts = Object.fromEntries((grouped.groups ?? []).map((g) => [String(g.group), g.value]));
        expect(counts).toMatchObject({ pending: 1, approved: 1, null: 1 });
        // Nadie escribe el campo a mano: el valor se ignora (lo calcula el servidor).
        const touched = await recs.update(tenantA, ana, 'gastos', a.id, { data: { [`f${fieldId}`]: 'rejected' } }).catch(() => null);
        if (touched) expect(touched.data[`f${fieldId}`]).toBe('approved');
        expect((await recs.get(tenantA, ana, 'gastos', a.id)).data[`f${fieldId}`]).toBe('approved');
    });

    it('el aprobador se resuelve EN VIVO: cambiar el campo Persona cambia quién decide; nadie se autoaprueba', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Por jefe', config: { steps: [{ id: 's1', approver: { type: 'field', approver_field_id: f.jefe!.id } }] } });
        const g = await gasto('Viaje');
        const req = await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id });
        await recs.update(tenantA, ana, 'gastos', g.id, { data: { [k('jefe')]: otroJefe.userId } });
        await expectCode(approvals.decide(tenantA, jefe, req.id, { decision: 'approve', step: 0 }), ForbiddenException, 'approval_not_approver');
        expect((await approvals.myApprovals(tenantA, otroJefe)).pending).toHaveLength(1);
        await approvals.decide(tenantA, otroJefe, req.id, { decision: 'approve', step: 0 });

        // Quien pide se pone de jefe: no se aprueba solo (salvo que el flujo lo permita).
        const g2 = await gasto('Mío', ana.userId);
        await expectCode(approvals.request(tenantA, ana, 'gastos', g2.id, { flow_id: flow.id }), BadRequestException, 'approval_no_approvers');
        await approvals.updateFlow(tenantA, ana, 'gastos', flow.id, { config: { steps: [{ id: 's1', approver: { type: 'field', approver_field_id: f.jefe!.id } }], self_approval: true } });
        const r2 = await approvals.request(tenantA, ana, 'gastos', g2.id, { flow_id: flow.id });
        expect((await approvals.decide(tenantA, ana, r2.id, { decision: 'approve', step: 0 })).request.status).toBe('approved');
    });

    it('rechazar pone los campos y cierra; devolver deja pedir otra vez; sólo quien pidió (o un admin) cancela', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Gasto', config: twoSteps() });
        const g = await gasto('Monitor');
        const req = await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id });
        const rej = await approvals.decide(tenantA, jefe, req.id, { decision: 'reject', step: 0, reason: 'Falta la factura' });
        expect(rej.request.status).toBe('rejected');
        expect(rej.request.reason).toBe('Falta la factura');
        expect((await recs.get(tenantA, ana, 'gastos', g.id)).data[k('estado')]).toBe('rechazado');
        // Sin «se puede pedir otra vez»: un rechazo es final.
        await expectCode(approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id }), ConflictException, 'approval_rejected_final');

        const g2 = await gasto('Silla');
        const r2 = await approvals.request(tenantA, ana, 'gastos', g2.id, { flow_id: flow.id });
        await approvals.decide(tenantA, jefe, r2.id, { decision: 'return', step: 0, reason: 'Adjunta la cotización' });
        const again = await approvals.request(tenantA, ana, 'gastos', g2.id, { flow_id: flow.id });
        expect(again.status).toBe('pending');
        // El campo «Aprobación» muestra la ÚLTIMA solicitud (la nueva pendiente),
        // no la devuelta: regresión del alias `id` en el DISTINCT ON.
        const anyFlow = await fieldsSvc.create(tenantA, 'gastos', { label: 'Aprobación', type: 'approval', config: {} } as CreateFieldInput);
        const shown = await recs.get(tenantA, ana, 'gastos', g2.id);
        expect(shown.data[`f${anyFlow.id}`]).toBe('pending');
        expect(shown.approval_pending).toBe(1);
        // El jefe no la pidió: no la cancela; Ana sí.
        await expectCode(approvals.cancel(tenantA, jefe, again.id, {}), ForbiddenException, 'approval_cancel_forbidden');
        expect((await approvals.cancel(tenantA, ana, again.id, { reason: 'Ya no hace falta' })).request.status).toBe('cancelled');
        // El disparador no avisa a quien canceló, pero sí despacha el evento.
        expect(dispatched.filter((e) => e.trigger === 'approval_resolved').map((e) => e.approval?.resultado)).toEqual(['rechazada', 'devuelta', 'cancelada']);
    });

    it('«cualquiera aprueba» con dos decisiones a la vez: avanza UNA vez y la otra recibe 409', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', {
            name: 'Managers',
            config: {
                steps: [
                    { id: 'a', approver: { type: 'role', role: 'manager' }, mode: 'any' },
                    { id: 'b', approver: { type: 'users', approver_user_ids: [ana.userId] } },
                ],
                self_approval: true,
            },
        });
        const g = await gasto('Servidor');
        const req = await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id });
        const results = await Promise.allSettled([
            approvals.decide(tenantA, m1, req.id, { decision: 'approve', step: 0 }),
            approvals.decide(tenantA, m2, req.id, { decision: 'approve', step: 0 }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(failed.reason).toBeInstanceOf(ConflictException);
        const after = await approvals.getRequest(tenantA, ana, req.id);
        expect(after.request.current_step).toBe(1);
        expect(after.request.decisions).toHaveLength(1);
    });

    it('papelera: borrar el registro cancela sus pendientes; restaurarlo no las revive', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Gasto', config: twoSteps() });
        const g = await gasto('Proyector');
        const req = await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id });
        await recs.remove(tenantA, ana, 'gastos', g.id);
        const [row] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(approvalRequests).where(eq(approvalRequests.id, req.id)));
        expect(row!.status).toBe('cancelled');
        expect(row!.reason).toMatch(/papelera/);
        expect((await approvals.myApprovals(tenantA, jefe)).pending).toHaveLength(0);
        await withTenant(pg.db, tenantA, (tx) => tx.update(recordsTable).set({ deletedAt: null }).where(eq(recordsTable.id, g.id)));
        const [still] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(approvalRequests).where(eq(approvalRequests.id, req.id)));
        expect(still!.status).toBe('cancelled');
        // Se puede volver a pedir.
        expect((await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id })).status).toBe('pending');
    });

    it('validación del flujo, borrar un flujo en uso y RLS por empresa', async () => {
        // Aprobador por un campo que no es Persona / una persona que no es del equipo.
        await expectCode(
            approvals.createFlow(tenantA, ana, 'gastos', { name: 'Malo', config: { steps: [{ id: 's', approver: { type: 'field', approver_field_id: f.concepto!.id } }] } }),
            BadRequestException,
            'invalid_approval_flow',
        );
        await expectCode(
            approvals.createFlow(tenantA, ana, 'gastos', { name: 'Malo', config: { steps: [{ id: 's', approver: { type: 'users', approver_user_ids: [999_999] } }] } }),
            BadRequestException,
            'invalid_approval_flow',
        );
        await expectCode(
            approvals.createFlow(tenantA, ana, 'gastos', {
                name: 'Malo',
                config: { steps: [{ id: 's', approver: { type: 'role', role: 'manager' } }], on_approve: [{ field_id: f.estado!.id, value: 'inexistente' }] },
            }),
            BadRequestException,
            'invalid_approval_flow',
        );
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Gasto', config: twoSteps() });
        const auto = await autos.create(tenantA, 'gastos', {
            name: 'Pedir al crear',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [{ type: 'request_approval', config: { approval_flow_id: flow.id } }],
        });
        await expectCode(approvals.deleteFlow(tenantA, ana, 'gastos', flow.id), ConflictException, 'approval_flow_in_use');
        // Un flujo de OTRA lista no se puede referenciar.
        await lists.create(tenantA, { name: 'Otra lista', slug: 'otra-lista' });
        await expectCode(
            autos.create(tenantA, 'otra-lista', { name: 'x', trigger_type: 'record_created', trigger_config: {}, actions: [{ type: 'request_approval', config: { approval_flow_id: flow.id } }] }),
            BadRequestException,
            'invalid_approval_flow_ref',
        );
        await autos.remove(tenantA, 'gastos', auto.id);
        const g = await gasto('Algo');
        await approvals.request(tenantA, ana, 'gastos', g.id, { flow_id: flow.id });
        await approvals.deleteFlow(tenantA, ana, 'gastos', flow.id);
        const [req] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(approvalRequests));
        expect(req!.status).toBe('cancelled');
        expect(req!.flowId).toBeNull();

        // RLS: otra empresa no ve flujos, solicitudes ni decisiones.
        await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Visible sólo en A', config: twoSteps() });
        expect(await withTenant(pg.db, tenantB, (tx) => tx.select().from(approvalFlows))).toHaveLength(0);
        expect(await withTenant(pg.db, tenantB, (tx) => tx.select().from(approvalRequests))).toHaveLength(0);
        expect(await withTenant(pg.db, tenantB, (tx) => tx.select().from(approvalDecisions))).toHaveLength(0);
        // Y no puede insertar en nombre de otra.
        const listId = (await lists.get(tenantA, 'gastos')).id;
        await expect(
            withTenant(pg.db, tenantB, (tx) => tx.insert(approvalFlows).values({ tenantId: tenantA, listId, name: 'intruso', config: {} })),
        ).rejects.toThrow();
    });

    it('automatizaciones: «Pedir aprobación» → «Esperar aprobación» → la decisión la despierta y el si/sino sigue por el resultado', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Gasto', config: { steps: [{ id: 's1', approver: { type: 'users', approver_user_ids: [m1.userId] } }] } });
        const auto = await autos.create(tenantA, 'gastos', {
            name: 'Aprobación de gastos',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                { type: 'request_approval', config: { approval_flow_id: flow.id, note: 'Gasto de {{monto}}' } },
                { type: 'wait_approval', config: { approval_flow_id: flow.id, timeout_days: 3 } },
                {
                    type: 'if_else',
                    config: {
                        condition: [{ field: 'aprobacion.resultado', op: 'eq', value: 'aprobada' }],
                        then_actions: [{ type: 'update_field', config: { values: { concepto: 'OK por {{aprobacion.decidio}}' } } }],
                        else_actions: [{ type: 'update_field', config: { values: { concepto: 'NO: {{aprobacion.motivo}}' } } }],
                    },
                },
            ],
        });
        const g = await gasto('Monitor');
        await engine.process({ tenantId: tenantA, listId: g.list_id, recordId: g.id, trigger: 'record_created', after: g.data });
        const [run] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto.id)));
        expect(run!.status).toBe('waiting');
        const pending = await approvals.myApprovals(tenantA, m1);
        expect(pending.pending).toHaveLength(1);
        expect(pending.pending[0]!.note).toMatch(/^Gasto de 1500000/);

        // Decidir despierta a la corrida al instante (el hub), sin esperar al reloj.
        await approvals.decide(tenantA, m1, pending.pending[0]!.id, { decision: 'approve', step: 0 });
        await new Promise((r) => setTimeout(r, 300));
        const [done] = await withTenant(pg.db, tenantA, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto.id)));
        expect(done!.status).toBe('success');
        expect((await recs.get(tenantA, ana, 'gastos', g.id)).data[k('concepto')]).toBe('OK por Marta');

        // Un rechazo va por la rama «no».
        const g2 = await gasto('Otro');
        await engine.process({ tenantId: tenantA, listId: g2.list_id, recordId: g2.id, trigger: 'record_created', after: g2.data });
        const p2 = (await approvals.myApprovals(tenantA, m1)).pending[0]!;
        await approvals.decide(tenantA, m1, p2.id, { decision: 'reject', step: 0, reason: 'Sin presupuesto' });
        await new Promise((r) => setTimeout(r, 300));
        expect((await recs.get(tenantA, ana, 'gastos', g2.id)).data[k('concepto')]).toBe('NO: Sin presupuesto');
    });

    it('«Esperar aprobación» con tope de días sigue como «vencida»; el disparador filtra por flujo y resultado; «Probar» simula', async () => {
        const flow = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Gasto', config: { steps: [{ id: 's1', approver: { type: 'users', approver_user_ids: [m1.userId] } }] } });
        const otro = await approvals.createFlow(tenantA, ana, 'gastos', { name: 'Otro', config: { steps: [{ id: 's1', approver: { type: 'users', approver_user_ids: [m1.userId] } }] } });
        const auto = await autos.create(tenantA, 'gastos', {
            name: 'Con tope',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                { type: 'request_approval', config: { approval_flow_id: flow.id } },
                { type: 'wait_approval', config: { timeout_days: 2 } },
                { type: 'update_field', config: { values: { concepto: 'Resultado: {{aprobacion.resultado}}' } } },
            ],
        });
        const g = await gasto('Tope');
        await engine.process({ tenantId: tenantA, listId: g.list_id, recordId: g.id, trigger: 'record_created', after: g.data });
        // Viaja en el tiempo: el tope ya pasó.
        await pg.db.execute(sql`update automation_runs set resume_at = now() - interval '1 second',
            resume_state = jsonb_set(resume_state, '{approval_wait,deadline}', to_jsonb((now() - interval '1 minute')::text))
            where automation_id = ${auto.id} and status = 'waiting'`);
        expect(await waits.tick()).toBe(1);
        expect((await recs.get(tenantA, ana, 'gastos', g.id)).data[k('concepto')]).toBe('Resultado: vencida');

        // Disparador: sólo el flujo «Gasto» y sólo rechazos.
        const trig = await autos.create(tenantA, 'gastos', {
            name: 'Al rechazar',
            trigger_type: 'approval_resolved',
            trigger_config: { approval_flow_id: flow.id, results: ['rejected'] },
            actions: [{ type: 'update_field', config: { values: { concepto: '{{aprobacion.flujo}} {{aprobacion.resultado}}: {{aprobacion.motivo}}' } } }],
        });
        const g2 = await gasto('Disparo');
        const r1 = await approvals.request(tenantA, ana, 'gastos', g2.id, { flow_id: otro.id });
        await approvals.decide(tenantA, m1, r1.id, { decision: 'reject', step: 0, reason: 'x' });
        const r2 = await approvals.request(tenantA, ana, 'gastos', g2.id, { flow_id: flow.id });
        await approvals.decide(tenantA, m1, r2.id, { decision: 'reject', step: 0, reason: 'caro' });
        for (const ev of dispatched.filter((e) => e.trigger === 'approval_resolved')) await engine.process(ev);
        const trigRuns = await withTenant(pg.db, tenantA, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, trig.id)));
        expect(trigRuns).toHaveLength(1);
        expect((await recs.get(tenantA, ana, 'gastos', g2.id)).data[k('concepto')]).toBe('Gasto rechazada: caro');

        // «Probar» elige la rama según el resultado simulado, sin pedir nada de verdad.
        const before = await withTenant(pg.db, tenantA, (tx) => tx.select().from(approvalRequests));
        const test = await autos.testRun(tenantA, 'gastos', {
            trigger_type: 'record_created',
            trigger_config: {},
            record_id: g2.id,
            real_steps: [],
            approval_result: 'rechazada',
            actions: [
                { type: 'request_approval', config: { approval_flow_id: flow.id } },
                { type: 'wait_approval', config: {} },
                {
                    type: 'if_else',
                    config: {
                        condition: [{ field: 'aprobacion.resultado', op: 'eq', value: 'aprobada' }],
                        then_actions: [{ type: 'update_field', config: { values: { concepto: 'sí' } } }],
                        else_actions: [{ type: 'update_field', config: { values: { concepto: 'no' } } }],
                    },
                },
            ],
        });
        const text = JSON.stringify(test.steps);
        expect(text).toMatch(/Pediría la aprobación/);
        expect(text).toMatch(/Rechazada/);
        expect(await withTenant(pg.db, tenantA, (tx) => tx.select().from(approvalRequests))).toHaveLength(before.length);
    });

    it('referencias a flujos: recorrido de automatizaciones, re-mapeo al migrar y plantillas sin flujos', () => {
        const input = {
            trigger_type: 'approval_resolved',
            trigger_config: { approval_flow_id: 7 },
            actions: [
                { type: 'request_approval', config: { approval_flow_id: 8 } },
                { type: 'if_else', config: { then_actions: [{ type: 'wait_approval', config: { approval_flow_id: 9 } }], else_actions: [] } },
            ],
        };
        expect(approvalFlowRefs(input).sort()).toEqual([7, 8, 9]);
        const maps = emptyMaps();
        maps.approval_flow.set(8, 80);
        maps.user.set(3, 30);
        maps.field.set(5, 50);
        expect(
            remapJson(
                {
                    approval_flow_id: 8,
                    steps: [
                        { approver: { type: 'users', approver_user_ids: [3, 4] } },
                        { approver: { type: 'field', approver_field_id: 5 } },
                    ],
                    on_approve: [{ field_id: 5, value: 'x' }],
                },
                maps,
            ),
        ).toEqual({
            approval_flow_id: 80,
            steps: [{ approver: { type: 'users', approver_user_ids: [30] } }, { approver: { type: 'field', approver_field_id: 50 } }],
            on_approve: [{ field_id: 50, value: 'x' }],
        });
        expect(withoutApprovalFlowRefs(input).actions[0]).toEqual({ type: 'request_approval', config: { approval_flow_id: null } });
    });

    it('el correo del aviso lleva Aprobar / Rechazar A LA APP (rutas con sesión, sin token) y todo escapado', () => {
        const m = notificationEmail({
            company: 'Acme',
            title: 'Ana pidió tu aprobación: «<b>Monitor</b>»',
            body: 'Es para diseño',
            link: 'https://acme.test/#/lists/gastos/records/9',
            settingsLink: 'https://acme.test/#/settings?s=avisos',
            actions: [
                { label: 'Aprobar', link: 'https://acme.test/#/approvals/12?d=approve', tone: 'primary' },
                { label: 'Rechazar', link: 'https://acme.test/#/approvals/12?d=reject', tone: 'danger' },
            ],
        });
        expect(m.html).toContain('href="https://acme.test/#/approvals/12?d=approve"');
        expect(m.html).toContain('href="https://acme.test/#/approvals/12?d=reject"');
        expect(m.html).not.toContain('<b>Monitor</b>');
        expect(m.text).toContain('Aprobar: https://acme.test/#/approvals/12?d=approve');
        expect(m.text).toContain('Rechazar: https://acme.test/#/approvals/12?d=reject');
        // Sin el botón «Abrir» único cuando hay acciones.
        expect(m.text).not.toContain('Abrir: ');
    });
});
