import {
    dueBucket,
    isDoneOptionLabel,
    pickDueField,
    pickStatusField,
    readNotificationPrefs,
    type Field,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { memberships, notifications, recordFollows, records, reminders, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import type { MailMessage } from '../src/mail/mail.types';
import { changeSummary, digestEmail, newlyAssigned, notificationEmail, notificationTitle } from '../src/notifications/notification-text';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class NullDispatcher extends AutomationDispatcher {
    override dispatch(_event: TriggerEvent): void {}
}

const estadoField = {
    id: 3,
    label: 'Estado',
    type: 'select',
    config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'curso', label: 'En curso' }] },
};

describe('v0.1.276 — avisos (puro)', () => {
    it('títulos en criollo, con o sin persona', () => {
        expect(notificationTitle('assigned', { actorName: 'Ana', recordTitle: 'Propuesta' })).toBe('Ana te asignó «Propuesta»');
        expect(notificationTitle('assigned', { actorName: null, recordTitle: 'Propuesta' })).toBe('Una automatización te asignó «Propuesta»');
        expect(notificationTitle('mention', { actorName: 'Ana', recordTitle: '', source: 'description' })).toBe(
            'Ana te mencionó en la descripción de «Sin título»',
        );
        expect(notificationTitle('reminder', { actorName: null, recordTitle: 'X' })).toBe('Recordatorio: «X»');
    });

    it('resumen de cambios: etiquetas de opciones, personas y «y N más»', () => {
        const fields = [
            { id: 1, label: 'Título', type: 'text' },
            { id: 2, label: 'Responsable', type: 'user' },
            estadoField,
            { id: 4, label: 'Notas', type: 'long_text' },
            { id: 5, label: 'A', type: 'number' },
            { id: 6, label: 'B', type: 'number' },
        ];
        const names = new Map([[7, 'Beto']]);
        const out = changeSummary(fields, { f3: 'pendiente', f2: null, f5: 1, f6: 1 }, { f3: 'curso', f2: 7, f4: 'largo', f5: 2, f6: 3 }, names);
        expect(out.fieldIds).toEqual([2, 3, 4, 5, 6]);
        expect(out.text).toBe('Responsable: vacío → Beto · Estado: Pendiente → En curso · Notas · A: 1 → 2 · y 1 más');
        expect(changeSummary(fields, { f3: 'pendiente' }, { f3: 'pendiente' }, names).fieldIds).toEqual([]);
    });

    it('asignaciones nuevas: sólo el que cambió y no vacío', () => {
        expect(newlyAssigned([2, 8], { f2: 5 }, { f2: 7, f8: 5 })).toEqual([7, 5]);
        expect(newlyAssigned([2], { f2: 7 }, { f2: 7 })).toEqual([]);
        expect(newlyAssigned([2], { f2: 7 }, { f2: null })).toEqual([]);
    });

    it('vencimiento, estado y «terminado» por nombre', () => {
        const fs = [
            { id: 1, slug: 'creado', label: 'Creado', type: 'date' },
            { id: 2, slug: 'fecha_entrega', label: 'Fecha de entrega', type: 'date' },
            { id: 3, slug: 'prioridad', label: 'Prioridad', type: 'select' },
            { id: 4, slug: 'estado', label: 'Estado', type: 'select' },
        ];
        expect(pickDueField(fs)?.id).toBe(2);
        expect(pickStatusField(fs)?.id).toBe(4);
        expect(isDoneOptionLabel('Completada')).toBe(true);
        expect(isDoneOptionLabel('Pagada')).toBe(true);
        expect(isDoneOptionLabel('En curso')).toBe(false);
        expect(dueBucket('2026-10-08', '2026-10-09', '2026-10-15')).toBe('overdue');
        expect(dueBucket('2026-10-09T15:00:00Z', '2026-10-09', '2026-10-15')).toBe('today');
        expect(dueBucket('2026-10-12', '2026-10-09', '2026-10-15')).toBe('week');
        expect(dueBucket('2026-11-01', '2026-10-09', '2026-10-15')).toBe('later');
        expect(dueBucket(null, '2026-10-09', '2026-10-15')).toBe('none');
    });

    it('preferencias: valores por defecto y basura tolerada', () => {
        const p = readNotificationPrefs(undefined);
        expect(p.email).toEqual({ mention: true, assigned: true, comment: false, update: false, reminder: true });
        expect(p.digest).toBe('off');
        expect(readNotificationPrefs({ digest: 'semanal' }).digest).toBe('off');
    });

    it('correos: todo escapado', () => {
        const m = notificationEmail({ company: 'Acme', title: '<b>x</b>', body: '<script>', link: 'https://a/#/x', settingsLink: 'https://a/#/s' });
        expect(m.html).not.toContain('<script>');
        expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
        const d = digestEmail({ company: 'Acme', dateLabel: 'jueves', unread: [], unreadTotal: 0, overdue: [{ title: '<i>', detail: '' }], today: [], link: 'https://a', settingsLink: 'https://a' });
        expect(d.html).toContain('&lt;i&gt;');
        expect(d.subject).toBe('Tu resumen de Acme · jueves');
    });
});

describe('v0.1.276 — avisos (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let svc: NotificationsService;
    let recs: RecordsService;
    let comments: CommentsService;
    let tenantId: number;
    let otherTenant: number;
    let listId: number;
    let ana: number;
    let beto: number;
    let caro: number;
    let cliente: number;
    const f: Record<string, Field> = {};
    const sent: MailMessage[] = [];
    const pending: Array<Promise<unknown>> = [];
    const settle = async (): Promise<void> => {
        while (pending.length > 0) await Promise.all(pending.splice(0));
    };
    type A = { userId: number; role: 'admin' | 'manager' | 'agent' };
    const admin = (): A => ({ userId: ana, role: 'admin' });
    const manager = (): A => ({ userId: beto, role: 'manager' });
    const inbox = async (userId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId))).orderBy(notifications.id));

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
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
        comments = new CommentsService(tenantDb, new CommentsRepository(), lists, recs, rt, hub);
        const mail = { enqueue: (m: MailMessage) => (sent.push(m), Promise.resolve()) };
        svc = new NotificationsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            rt,
            mail as never,
            redis as never,
            loadEnv({ APP_BASE_URL: 'https://app.test' }),
        );
        // Los oyentes reales corren en segundo plano: en el test se esperan.
        hub.subscribe((e) => void pending.push(svc.onNotify(e)));
        changes.subscribe((c) => void pending.push(svc.onRecordChange(c)));

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;
        const mk = async (email: string, name: string) =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = await mk('ana@acme.test', 'Ana');
        beto = await mk('beto@acme.test', 'Beto');
        caro = await mk('caro@acme.test', 'Caro');
        cliente = await mk('cli@cliente.test', 'Cliente');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana, role: 'admin' },
                { tenantId, userId: beto, role: 'manager' },
                { tenantId, userId: caro, role: 'agent' },
                { tenantId, userId: cliente, role: 'client' },
            ]),
        );
        listId = (await lists.create(tenantId, { name: 'Tareas' })).id;
        f.titulo = await fieldsSvc.create(tenantId, 'tareas', { label: 'Título', type: 'text', slug: 'titulo' });
        f.resp = await fieldsSvc.create(tenantId, 'tareas', { label: 'Responsable', type: 'user', slug: 'responsable' });
        f.estado = await fieldsSvc.create(tenantId, 'tareas', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: {
                options: [
                    { value: 'pendiente', label: 'Pendiente' },
                    { value: 'curso', label: 'En curso' },
                    { value: 'hecha', label: 'Completada' },
                ],
            },
        });
        f.vence = await fieldsSvc.create(tenantId, 'tareas', { label: 'Vence', type: 'date', slug: 'vence' });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        sent.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(notifications).where(eq(notifications.tenantId, tenantId));
            await tx.delete(recordFollows).where(eq(recordFollows.tenantId, tenantId));
            await tx.delete(reminders).where(eq(reminders.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
            await tx.update(memberships).set({ settings: {} }).where(eq(memberships.tenantId, tenantId));
        });
    });

    const create = async (data: Record<string, unknown>, actor = admin()) => {
        const r = await recs.create(tenantId, actor, 'tareas', { data });
        await settle();
        return r.id;
    };
    const update = async (id: number, data: Record<string, unknown>, actor = manager()) => {
        await recs.update(tenantId, actor, 'tareas', id, { data });
        await settle();
    };

    it('asignar avisa (y manda el correo); quien lo hace no se entera de lo suyo', async () => {
        const id = await create({ [`f${f.titulo!.id}`]: 'Preparar propuesta', [`f${f.resp!.id}`]: beto, [`f${f.estado!.id}`]: 'pendiente' });
        const b = await inbox(beto);
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({ kind: 'assigned', title: 'Ana te asignó «Preparar propuesta»', recordId: id, actorId: ana });
        expect(await inbox(ana)).toHaveLength(0);
        // Correo en el momento (asignado está encendido por defecto).
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ tenantId, to: 'beto@acme.test', subject: 'Ana te asignó «Preparar propuesta»' });
        expect(sent[0]!.html).toContain(`https://app.test/#/lists/tareas/records/${id}`);
        // Los dos quedan siguiendo el registro.
        expect((await svc.followState(tenantId, ana, id)).followers).toBe(2);
    });

    it('un cambio avisa a quien sigue, con el detalle; varios seguidos se juntan en uno', async () => {
        const id = await create({ [`f${f.titulo!.id}`]: 'Llamar a Acme', [`f${f.resp!.id}`]: beto, [`f${f.estado!.id}`]: 'pendiente' });
        await update(id, { [`f${f.estado!.id}`]: 'curso' });
        let a = await inbox(ana);
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ kind: 'update', title: 'Beto cambió «Llamar a Acme»', body: 'Estado: Pendiente → En curso' });
        // Beto no se avisa a sí mismo.
        expect((await inbox(beto)).filter((n) => n.kind === 'update')).toHaveLength(0);
        await update(id, { [`f${f.vence!.id}`]: '2026-10-20' });
        a = await inbox(ana);
        expect(a).toHaveLength(1);
        expect(a[0]!.body).toBe('Vence: vacío → 2026-10-20');
        // «cambió» no manda correo por defecto.
        expect(sent.filter((m) => m.to === 'ana@acme.test')).toHaveLength(0);
    });

    it('comentarios: mención directa, seguidores y nadie que no pueda ver el registro', async () => {
        const id = await create({ [`f${f.titulo!.id}`]: 'Cotización', [`f${f.resp!.id}`]: beto });
        await comments.create(tenantId, admin(), 'tareas', id, { body: 'Mirá esto @caro@acme.test y @cli@cliente.test', kind: 'note' });
        await settle();
        // Beto sigue el registro → «comentó».
        expect((await inbox(beto)).map((n) => n.kind)).toEqual(['assigned', 'comment']);
        // Caro (agente) no ve registros ajenos y el cliente es sólo portal.
        expect(await inbox(caro)).toHaveLength(0);
        expect(await inbox(cliente)).toHaveLength(0);
        await comments.create(tenantId, admin(), 'tareas', id, { body: '@beto@acme.test ¿lo ves hoy?', kind: 'note' });
        await settle();
        const kinds = (await inbox(beto)).map((n) => n.kind);
        expect(kinds).toEqual(['assigned', 'comment', 'mention']);
        expect((await inbox(beto)).at(-1)!.body).toBe('@beto@acme.test ¿lo ves hoy?');
    });

    it('bandeja: página, sin leer, marcar leídos y aislamiento entre empresas', async () => {
        const id = await create({ [`f${f.titulo!.id}`]: 'A', [`f${f.resp!.id}`]: beto });
        await update(id, { [`f${f.estado!.id}`]: 'curso' }, admin());
        const page = await svc.list(tenantId, beto, { limit: 30, unread: false });
        expect(page.unread).toBe(2);
        expect(page.items[0]).toMatchObject({ list_slug: 'tareas', list_name: 'Tareas', actor_name: 'Ana' });
        expect((await svc.markRead(tenantId, beto, { ids: [page.items[0]!.id] })).unread).toBe(1);
        expect((await svc.markRead(tenantId, beto, { all: true })).unread).toBe(0);
        const other = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(notifications));
        expect(other).toHaveLength(0);
    });

    it('preferencias: apagar el correo de asignaciones; tope de correos por hora', async () => {
        await svc.setPrefs(tenantId, beto, { email: { assigned: false } });
        expect((await svc.getPrefs(tenantId, beto)).email).toMatchObject({ assigned: false, mention: true });
        await create({ [`f${f.titulo!.id}`]: 'Sin correo', [`f${f.resp!.id}`]: beto });
        expect(sent).toHaveLength(0);
        expect(await inbox(beto)).toHaveLength(1);
        await svc.setPrefs(tenantId, beto, { email: { assigned: true } });
        for (let i = 0; i < 12; i++) await create({ [`f${f.titulo!.id}`]: `T${i}`, [`f${f.resp!.id}`]: beto });
        expect(sent).toHaveLength(10);
    });

    it('recordatorios: suenan una sola vez y avisan con el registro', async () => {
        const id = await create({ [`f${f.titulo!.id}`]: 'Renovar dominio' });
        const r = await svc.createReminder(tenantId, admin(), {
            list_id: listId,
            record_id: id,
            remind_at: new Date(Date.now() - 1000).toISOString(),
            note: 'Ver precio',
        });
        expect(r).toMatchObject({ record_title: 'Renovar dominio', list_slug: 'tareas', note: 'Ver precio' });
        await svc.createReminder(tenantId, admin(), { remind_at: new Date(Date.now() + 3_600_000).toISOString(), note: 'Después' });
        expect(await svc.reminderTick()).toBe(1);
        expect(await svc.reminderTick()).toBe(0);
        const a = await inbox(ana);
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ kind: 'reminder', title: 'Recordatorio: «Renovar dominio»', body: 'Ver precio' });
        expect(sent.some((m) => m.to === 'ana@acme.test')).toBe(true);
        // De otra persona: no se ve ni se toca.
        await expect(svc.removeReminder(tenantId, beto, r.id)).rejects.toThrow();
        await expect(
            svc.createReminder(tenantId, { userId: caro, role: 'agent' }, { list_id: listId, record_id: id, remind_at: new Date().toISOString(), note: '' }),
        ).rejects.toThrow();
    });

    it('«Mi trabajo»: lo asignado sin lo terminado, ordenado por vencimiento, y lo que sigue', async () => {
        const a = await create({ [`f${f.titulo!.id}`]: 'Tarde', [`f${f.resp!.id}`]: beto, [`f${f.vence!.id}`]: '2026-10-30' });
        const b = await create({ [`f${f.titulo!.id}`]: 'Pronto', [`f${f.resp!.id}`]: beto, [`f${f.vence!.id}`]: '2026-10-10', [`f${f.estado!.id}`]: 'curso' });
        await create({ [`f${f.titulo!.id}`]: 'Lista', [`f${f.resp!.id}`]: beto, [`f${f.estado!.id}`]: 'hecha' });
        await create({ [`f${f.titulo!.id}`]: 'De Ana' });
        const work = await svc.myWork(tenantId, manager());
        expect(work.assigned.map((i) => i.record_id)).toEqual([b, a]);
        expect(work.assigned[0]).toMatchObject({ title: 'Pronto', due: '2026-10-10', due_label: 'Vence', status_label: 'En curso', list_slug: 'tareas' });
        expect(work.lists_with_assignee).toBe(1);
        // Sigue lo que le asignaron (incluida la terminada).
        expect(work.following).toHaveLength(3);
    });

    it('resumen diario: a su hora, una vez por día, y nada si no hay nada', async () => {
        const now = new Date();
        await svc.setPrefs(tenantId, beto, { digest: 'daily', digest_hour: now.getUTCHours(), digest_days: [0, 1, 2, 3, 4, 5, 6] });
        await svc.setPrefs(tenantId, caro, { digest: 'daily', digest_hour: now.getUTCHours(), digest_days: [0, 1, 2, 3, 4, 5, 6] });
        await create({ [`f${f.titulo!.id}`]: 'Vencida', [`f${f.resp!.id}`]: beto, [`f${f.vence!.id}`]: '2020-01-01' });
        sent.length = 0;
        expect(await svc.digestTick(now)).toBe(1);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.to).toBe('beto@acme.test');
        expect(sent[0]!.text).toContain('Vencido');
        expect(sent[0]!.text).toContain('Vencida');
        expect(await svc.digestTick(now)).toBe(0);
    });
});
