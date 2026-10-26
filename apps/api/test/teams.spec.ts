import { BadRequestException, ConflictException } from '@nestjs/common';
import { MY_TEAMS_TOKEN, mostPermissive, parseTeamHandles, teamHandle, type Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { memberships, notifications, records, teamMembers, teams, tenants, users } from '../src/db/schema';
import { withTenant, withUser } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { effectivePermissions } from '../src/lists/list-acl';
import type { MailMessage } from '../src/mail/mail.types';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TeamsService } from '../src/teams/teams.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class NullDispatcher extends AutomationDispatcher {
    override dispatch(_event: TriggerEvent): void {}
}

describe('C1 — equipos (puro)', () => {
    it('manija del nombre para @equipo y lectura de manijas en un comentario', () => {
        expect(teamHandle('Ventas Norte')).toBe('ventas-norte');
        expect(teamHandle('Atención al Cliente ✓')).toBe('atencion-al-cliente');
        expect(parseTeamHandles('Hola @ventas-norte, revisen. Avisen a @ana@acme.test por favor')).toEqual(['ventas-norte']);
        expect(parseTeamHandles('(@soporte) y @soporte.')).toEqual(['soporte']);
    });

    it('varios equipos con acceso: lo más permisivo de cada eje y ocultos sólo si TODOS ocultan', () => {
        const merged = mostPermissive([
            { view: 'own', create: false, edit: 'own', delete: 'none', fields_hidden: ['monto', 'costo'] },
            { view: 'all', create: true, edit: 'none', delete: 'none', fields_hidden: ['costo'] },
        ]);
        expect(merged).toEqual({ view: 'all', create: true, edit: 'own', delete: 'none', fields_hidden: ['costo'] });
        expect(mostPermissive([])).toBeNull();
    });

    it('prioridad: persona > equipo > rol', () => {
        const settings = {
            permissions: {
                permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'own', fields_hidden: [] } },
                users: { '7': { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
                teams: { '3': { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
            },
        };
        // Persona puntual manda aunque su equipo dé más.
        expect(effectivePermissions(settings, { userId: 7, role: 'agent', teamIds: [3] }).view).toBe('none');
        // Sin acceso propio: el del equipo.
        expect(effectivePermissions(settings, { userId: 8, role: 'agent', teamIds: [3] }).view).toBe('all');
        // Sin equipo con acceso: el del rol.
        expect(effectivePermissions(settings, { userId: 9, role: 'agent', teamIds: [4] }).view).toBe('own');
        // admin siempre todo.
        expect(effectivePermissions(settings, { userId: 7, role: 'admin', teamIds: [] }).view).toBe('all');
    });
});

describe('C1 — equipos (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let teamsSvc: TeamsService;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let comments: CommentsService;
    let notif: NotificationsService;
    let agg: AggregateService;
    let tenantId: number;
    let otherTenant: number;
    let ana: number; // admin
    let beto: number; // agent, Ventas
    let caro: number; // agent, Ventas + Soporte
    let dani: number; // agent, sin equipos
    let cliente: number;
    let ventas: number;
    let soporte: number;
    const f: Record<string, Field> = {};
    const sent: MailMessage[] = [];
    const pending: Array<Promise<unknown>> = [];
    const settle = async (): Promise<void> => {
        while (pending.length > 0) await Promise.all(pending.splice(0));
    };
    const key = (s: string): string => `f${f[s]!.id}`;
    const actor = (userId: number, role: Actor['role'], teamIds: number[] = []): Actor => ({ userId, role, teamIds });
    const admin = (): Actor => actor(ana, 'admin');
    const inbox = async (userId: number) =>
        withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId))).orderBy(notifications.id),
        );

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        teamsSvc = new TeamsService(tenantDb, rt, new AuditService(tenantDb));
        const changes = new RecordChangeHub();
        const hub = new NotifyHub();
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new NullDispatcher(),
            new RelationsRepository(),
            undefined,
            changes,
            undefined,
            undefined,
            hub,
        );
        comments = new CommentsService(tenantDb, new CommentsRepository(), lists, recs, rt, hub, teamsSvc);
        notif = new NotificationsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            rt,
            { enqueue: (m: MailMessage) => (sent.push(m), Promise.resolve()) } as never,
            redis as never,
            loadEnv({ APP_BASE_URL: 'https://app.test' }),
            undefined,
            undefined,
            undefined,
            undefined,
            teamsSvc,
        );
        hub.subscribe((e) => void pending.push(notif.onNotify(e)));
        changes.subscribe((c) => void pending.push(notif.onRecordChange(c)));
        agg = new AggregateService(tenantDb, lists, fieldsSvc);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;
        const mk = async (email: string, name: string) =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = await mk('ana@acme.test', 'Ana');
        beto = await mk('beto@acme.test', 'Beto');
        caro = await mk('caro@acme.test', 'Caro');
        dani = await mk('dani@acme.test', 'Dani');
        cliente = await mk('cli@cliente.test', 'Cliente');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana, role: 'admin' },
                { tenantId, userId: beto, role: 'agent' },
                { tenantId, userId: caro, role: 'agent' },
                { tenantId, userId: dani, role: 'agent' },
                { tenantId, userId: cliente, role: 'client' },
            ]),
        );
        ventas = (await teamsSvc.create(tenantId, ana, { name: 'Ventas', color: '#2563eb', icon: 'briefcase', members: [{ user_id: beto, is_lead: true }, { user_id: caro, is_lead: false }] })).id;
        soporte = (await teamsSvc.create(tenantId, ana, { name: 'Soporte', members: [{ user_id: caro, is_lead: false }] })).id;

        await lists.create(tenantId, { name: 'Tickets' });
        f.titulo = await fieldsSvc.create(tenantId, 'tickets', { label: 'Título', type: 'text', slug: 'titulo' });
        f.monto = await fieldsSvc.create(tenantId, 'tickets', { label: 'Monto', type: 'currency', slug: 'monto' });
        f.equipo = await fieldsSvc.create(tenantId, 'tickets', { label: 'Equipo', type: 'team', slug: 'equipo' });
        f.equipos = await fieldsSvc.create(tenantId, 'tickets', { label: 'Equipos', type: 'team', slug: 'equipos', config: { multiple: true } });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        // Los avisos del test anterior corren en segundo plano: que terminen
        // antes de borrar sus registros (si no, `record_follows` choca con la FK).
        await settle();
        sent.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(notifications).where(eq(notifications.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
        });
        await lists.updatePermissions(tenantId, 'tickets', {
            permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'own', fields_hidden: [] } },
            users: {},
            teams: {},
            assignment_field_id: null,
            assignment_team_field_id: null,
        });
    });

    it('CRUD: miembros sólo del equipo de trabajo, nombre único y memberIds()', async () => {
        const list = await teamsSvc.list(tenantId);
        expect(list.map((t) => t.name)).toEqual(['Soporte', 'Ventas']);
        const v = list.find((t) => t.id === ventas)!;
        expect(v.member_count).toBe(2);
        expect(v.members[0]).toMatchObject({ user_id: beto, is_lead: true, name: 'Beto' });

        await expect(teamsSvc.create(tenantId, ana, { name: 'ventas' })).rejects.toBeInstanceOf(ConflictException);
        // Un cliente del portal no puede ser parte de un equipo.
        await expect(teamsSvc.update(tenantId, ana, soporte, { members: [{ user_id: cliente, is_lead: false }] })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        // Ni alguien de otra empresa.
        await expect(teamsSvc.update(tenantId, ana, soporte, { members: [{ user_id: 99999, is_lead: false }] })).rejects.toBeInstanceOf(
            BadRequestException,
        );

        const ids = await withTenant(pg.db, tenantId, (tx) => teamsSvc.memberIds(tx, ventas));
        expect(ids.sort()).toEqual([beto, caro].sort());
        const tmp = await teamsSvc.create(tenantId, ana, { name: 'Temporal', members: [{ user_id: dani, is_lead: false }] });
        await teamsSvc.update(tenantId, ana, tmp.id, { name: 'Temporal 2', members: [] });
        expect((await teamsSvc.get(tenantId, tmp.id)).member_count).toBe(0);
        await teamsSvc.remove(tenantId, ana, tmp.id);
        expect((await teamsSvc.list(tenantId)).some((t) => t.id === tmp.id)).toBe(false);
    });

    it('RLS: otra empresa no ve los equipos; cada persona lee SUS equipos sin empresa activa', async () => {
        const fromOther = await withTenant(pg.db, otherTenant, async (tx) => ({
            t: await tx.select().from(teams),
            m: await tx.select().from(teamMembers),
        }));
        expect(fromOther.t).toHaveLength(0);
        expect(fromOther.m).toHaveLength(0);
        // Insertar en otra empresa con el tenant equivocado: lo frena la policy.
        await expect(
            withTenant(pg.db, otherTenant, (tx) => tx.insert(teams).values({ tenantId, name: 'Intruso' })),
        ).rejects.toThrow();
        // `team_members_self`: sólo las filas propias, en cualquier empresa.
        const mine = await withUser(pg.db, caro, (tx) => tx.select({ teamId: teamMembers.teamId }).from(teamMembers));
        expect(mine.map((r) => r.teamId).sort()).toEqual([ventas, soporte].sort());
        const none = await withUser(pg.db, dani, (tx) => tx.select().from(teamMembers));
        expect(none).toHaveLength(0);
    });

    it('campo «Equipo»: valida que el equipo exista aquí y que sea uno solo sin `multiple`', async () => {
        const r = await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'A', [key('equipo')]: [ventas] } });
        expect(r.data[key('equipo')]).toEqual([ventas]);
        await expect(
            recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'B', [key('equipo')]: [ventas, soporte] } }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(recs.create(tenantId, admin(), 'tickets', { data: { [key('equipo')]: [424242] } })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        const m = await recs.create(tenantId, admin(), 'tickets', { data: { [key('equipos')]: [String(soporte), ventas] } });
        expect(m.data[key('equipos')]).toEqual([soporte, ventas]);
    });

    it('filtra (es / alguno de / uno de MIS equipos), agrupa y ordena por nombre', async () => {
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'v1', [key('equipo')]: [ventas] } });
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 's1', [key('equipo')]: [soporte] } });
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'nada' } });
        const titles = async (tree: unknown, who: Actor = admin()) =>
            (await recs.list(tenantId, who, 'tickets', { limit: 50, sort_dir: 'asc', filter_tree: tree as never })).data
                .map((r) => r.data[key('titulo')])
                .sort();
        const cond = (op: string, value: unknown) => ({ type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.equipo!.id, op, value }] });
        expect(await titles(cond('eq', ventas))).toEqual(['v1']);
        expect(await titles(cond('in', [ventas, soporte]))).toEqual(['s1', 'v1']);
        expect(await titles(cond('is_null', null))).toEqual(['nada']);
        expect(await titles(cond('neq', ventas))).toEqual(['nada', 's1']);
        // «Es uno de mis equipos»: Beto (Ventas) ve v1; Dani (sin equipos) nada.
        expect(await titles(cond('in', [MY_TEAMS_TOKEN]), actor(ana, 'admin', [ventas]))).toEqual(['v1']);
        expect(await titles(cond('in', [MY_TEAMS_TOKEN]), actor(ana, 'admin', []))).toEqual([]);

        const grouped = await agg.run(tenantId, 'tickets', { metric: 'count', group_by_field_id: f.equipo!.id });
        const byKey = Object.fromEntries((grouped.groups ?? []).map((g) => [String(g.group), g.value]));
        expect(byKey).toEqual({ [`[${soporte}]`]: 1, [`[${ventas}]`]: 1, null: 1 });

        const sorted = await recs.list(tenantId, admin(), 'tickets', { limit: 50, sort_dir: 'asc', sort: `field_${f.equipo!.id}:asc` });
        expect(sorted.data.map((r) => r.data[key('titulo')])).toEqual(['s1', 'v1', 'nada']);
    });

    it('ACL por equipo: da acceso a sus personas; el más permisivo entre equipos; «los asignados» por equipo', async () => {
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'de ventas', [key('equipo')]: [ventas], [key('monto')]: 10 } });
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'de soporte', [key('equipo')]: [soporte], [key('monto')]: 20 } });
        const betoA = actor(beto, 'agent', [ventas]);
        const caroA = actor(caro, 'agent', [ventas, soporte]);
        const daniA = actor(dani, 'agent', []);
        const titles = async (who: Actor) =>
            (await recs.list(tenantId, who, 'tickets', { limit: 50, sort_dir: 'asc' })).data.map((r) => r.data[key('titulo')]).sort();
        // Sin acceso por equipo, un agente ve sólo lo suyo (nada).
        expect(await titles(betoA)).toEqual([]);

        await lists.updatePermissions(tenantId, 'tickets', {
            teams: {
                [String(ventas)]: { view: 'all', create: true, edit: 'own', delete: 'none', fields_hidden: ['monto'] },
                [String(soporte)]: { view: 'own', create: false, edit: 'all', delete: 'none', fields_hidden: [] },
            },
        });
        const page = await recs.list(tenantId, betoA, 'tickets', { limit: 50, sort_dir: 'asc' });
        expect(page.data.map((r) => r.data[key('titulo')]).sort()).toEqual(['de soporte', 'de ventas']);
        // Ventas oculta el monto a Beto…
        for (const r of page.data) expect(r.data[key('monto')]).toBeUndefined();
        // …pero Caro está también en Soporte, que no lo oculta: se oculta sólo si TODOS lo ocultan.
        const caroPage = await recs.list(tenantId, caroA, 'tickets', { limit: 50, sort_dir: 'asc' });
        expect(caroPage.data.every((r) => r.data[key('monto')] !== undefined)).toBe(true);
        expect(await titles(daniA)).toEqual([]);
        const doc = await lists.getPermissions(tenantId, 'tickets');
        expect(doc.teams.map((t) => t.name).sort()).toEqual(['Soporte', 'Ventas']);

        // «Los asignados» por un campo «Equipo».
        await lists.updatePermissions(tenantId, 'tickets', {
            teams: {},
            assignment_team_field_id: f.equipo!.id,
            permissions: { agent: { view: 'assigned', create: true, edit: 'assigned', delete: 'none', fields_hidden: [] } },
        });
        expect(await titles(betoA)).toEqual(['de ventas']);
        expect(await titles(caroA)).toEqual(['de soporte', 'de ventas']);
        expect(await titles(daniA)).toEqual([]);
        // Editar lo asignado al equipo: Beto puede; Dani no.
        const [row] = (await recs.list(tenantId, betoA, 'tickets', { limit: 5, sort_dir: 'asc' })).data;
        await recs.update(tenantId, betoA, 'tickets', row!.id, { data: { [key('titulo')]: 'de ventas (ok)' } });
        await expect(recs.update(tenantId, daniA, 'tickets', row!.id, { data: { [key('titulo')]: 'x' } })).rejects.toThrow();
        // El campo de asignación por equipo tiene que ser un campo «Equipo».
        await expect(
            lists.updatePermissions(tenantId, 'tickets', { assignment_team_field_id: f.monto!.id }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // Y no se puede compartir con un equipo de otra empresa.
        await expect(
            lists.updatePermissions(tenantId, 'tickets', { teams: { '987654': { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] } } }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('asignar a un equipo avisa a sus personas que pueden ver el registro (no a quien lo hizo)', async () => {
        // Sólo Ventas ve la lista entera; Soporte no tiene acceso extra.
        await lists.updatePermissions(tenantId, 'tickets', {
            teams: { [String(ventas)]: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
        });
        const r = await recs.create(tenantId, actor(beto, 'agent', [ventas]), 'tickets', { data: { [key('titulo')]: 'Cotizar', [key('equipos')]: [ventas] } });
        await settle();
        // Beto lo hizo: no recibe nada; Caro (Ventas) sí.
        expect(await inbox(beto)).toHaveLength(0);
        const c = await inbox(caro);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ kind: 'team_assigned', recordId: r.id, title: 'Beto asignó «Cotizar» al equipo «Ventas»' });
        // Preferencia por defecto: SIN correo.
        expect(sent).toHaveLength(0);

        // Sumar Soporte: Caro ya recibió… pero es un equipo NUEVO en el registro.
        await recs.update(tenantId, admin(), 'tickets', r.id, { data: { [key('equipos')]: [ventas, soporte] } });
        await settle();
        const c2 = await inbox(caro);
        expect(c2.filter((n) => n.kind === 'team_assigned')).toHaveLength(2);
        expect(c2.at(-1)!.title).toContain('«Soporte»');
        // Repetir el mismo valor no vuelve a avisar.
        await recs.update(tenantId, admin(), 'tickets', r.id, { data: { [key('equipos')]: [ventas, soporte] } });
        await settle();
        expect((await inbox(caro)).filter((n) => n.kind === 'team_assigned')).toHaveLength(2);
    });

    it('@equipo en un comentario y en la descripción avisa a las personas que ven el registro', async () => {
        // Soporte NO ve el registro (agente sin acceso y no lo creó): Caro sí por Ventas.
        await lists.updatePermissions(tenantId, 'tickets', {
            teams: { [String(ventas)]: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
        });
        const r = await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'Cliente molesto' } });
        await settle();
        await comments.create(tenantId, actor(beto, 'agent', [ventas]), 'tickets', r.id, { body: 'Ojo @ventas: lo vemos hoy', kind: 'comment' } as never);
        await settle();
        const c = await inbox(caro);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ kind: 'mention', title: 'Beto mencionó a tu equipo «Ventas» en «Cliente molesto»' });
        // Sin auto-aviso a quien escribe.
        expect((await inbox(beto)).filter((n) => n.kind === 'mention')).toHaveLength(0);

        // Dani está solo en el equipo «Soporte 2» y NO ve el registro: no se entera.
        const s2 = await teamsSvc.create(tenantId, ana, { name: 'Soporte 2', members: [{ user_id: dani, is_lead: false }] });
        await recs.updateDescription(tenantId, admin(), 'tickets', r.id, {
            description: {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Avisar a ' },
                            { type: 'mentionTeam', attrs: { id: s2.id, label: 'Soporte 2' } },
                            { type: 'mentionTeam', attrs: { id: ventas, label: 'Ventas' } },
                        ],
                    },
                ],
            },
        } as never);
        await settle();
        expect(await inbox(dani)).toHaveLength(0);
        const desc = (await inbox(caro)).filter((n) => n.title.includes('descripción'));
        expect(desc).toHaveLength(1);
        // Re-guardar la misma descripción no repite el aviso.
        const again = await recs.getDescription(tenantId, admin(), 'tickets', r.id);
        await recs.updateDescription(tenantId, admin(), 'tickets', r.id, { description: again } as never);
        await settle();
        expect((await inbox(caro)).filter((n) => n.title.includes('descripción'))).toHaveLength(1);
        await teamsSvc.remove(tenantId, ana, s2.id);
    });

    it('«Mi trabajo» → «De mis equipos» con los grupos por fecha (sin lo asignado a mí)', async () => {
        await lists.updatePermissions(tenantId, 'tickets', {
            teams: { [String(ventas)]: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
        });
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'del equipo', [key('equipo')]: [ventas] } });
        await recs.create(tenantId, admin(), 'tickets', { data: { [key('titulo')]: 'de soporte', [key('equipo')]: [soporte] } });
        const work = await notif.myWork(tenantId, actor(beto, 'agent', [ventas]));
        expect(work.teams.map((i) => i.title)).toEqual(['del equipo']);
        expect(work.teams[0]!.team_ids).toEqual([ventas]);
        const sinEquipo = await notif.myWork(tenantId, actor(dani, 'agent', []));
        expect(sinEquipo.teams).toEqual([]);
    });

    it('sacar a alguien del workspace lo saca de sus equipos', async () => {
        const tmp = await teamsSvc.create(tenantId, ana, { name: 'Pasajero', members: [{ user_id: dani, is_lead: false }] });
        await withTenant(pg.db, tenantId, (tx) => teamsSvc.removeUserEverywhere(tx, tenantId, dani));
        expect((await teamsSvc.get(tenantId, tmp.id)).member_count).toBe(0);
        const n = await pg.db.execute(sql`select count(*)::int as n from team_members where user_id = ${dani}`);
        expect((n.rows[0] as { n: number }).n).toBe(0);
        await teamsSvc.remove(tenantId, ana, tmp.id);
    });
});
