import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activity, commentReactions, comments, fields, lists, memberships, mentions, recordFollows, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { CommentsService } from '../src/comments/comments.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

describe('Comments + Activity (Postgres real + RLS)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let activityService: ActivityService;
    let commentsService: CommentsService;
    let meService: MeService;
    let tenantA: number;
    let tenantB: number;
    let ana: Actor;
    let beto: Actor;
    let fieldId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        activityService = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            activityService,
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        commentsService = new CommentsService(
            tenantDb,
            new CommentsRepository(),
            listsService,
            recordsService,
            rt,
        );

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const [ua] = await pg.db
            .insert(users)
            .values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' })
            .returning();
        const [ub] = await pg.db
            .insert(users)
            .values({ email: 'beto@acme.test', passwordHash: 'x', name: 'Beto' })
            .returning();
        ana = { userId: ua!.id, role: 'admin' };
        beto = { userId: ub!.id, role: 'admin' };
        // Miembros del workspace A — el matching de menciones exige membership.
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([
                { userId: ana.userId, tenantId: tenantA, role: 'admin' },
                { userId: beto.userId, tenantId: tenantA, role: 'admin' },
            ]),
        );
        meService = new MeService(pg.db, tenantDb, new MeRepository());
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(comments).where(eq(comments.tenantId, t));
                await tx.delete(activity).where(eq(activity.tenantId, t));
                await tx.delete(records).where(eq(records.tenantId, t));
                await tx.delete(fields).where(eq(fields.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        await listsService.create(tenantA, { name: 'Clientes' });
        const f = await fieldsService.create(tenantA, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        fieldId = f.id;
    });

    const key = () => `f${fieldId}`;

    // --- Activity ---
    it('crear un record loguea record_created con diff', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'ACME' } });
        const log = await activityService.list(tenantA, 'clientes', { recordId: rec.id });
        expect(log.data).toHaveLength(1);
        expect(log.data[0]).toMatchObject({ action: 'record_created', record_id: rec.id, user_id: ana.userId });
        expect(log.data[0]!.diff[key()]).toEqual({ from: null, to: 'ACME' });
    });

    it('actualizar loguea record_updated con diff de lo que cambió', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'ACME' } });
        await recordsService.update(tenantA, ana, 'clientes', rec.id, { data: { [key()]: 'ACME2' } });
        const log = await activityService.list(tenantA, 'clientes', { recordId: rec.id });
        // desc por id → el update primero.
        expect(log.data[0]).toMatchObject({ action: 'record_updated' });
        expect(log.data[0]!.diff[key()]).toEqual({ from: 'ACME', to: 'ACME2' });
        // v0.1.149 — el feed dice QUIÉN lo hizo, no "usuario #2".
        expect(log.data[0]!.user_name).toBe('Ana');
    });

    it('borrar loguea record_deleted', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        await recordsService.remove(tenantA, ana, 'clientes', rec.id);
        const log = await activityService.list(tenantA, 'clientes', {});
        expect(log.data.map((a) => a.action)).toEqual(['record_deleted', 'record_created']);
    });

    it('activity respeta RLS por tenant', async () => {
        await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        await listsService.create(tenantB, { name: 'Clientes' });
        const other = await activityService.list(tenantB, 'clientes', {});
        expect(other.data).toHaveLength(0);
    });

    // --- Comments ---
    it('crear, listar, threading y validación de parent', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        const c1 = await commentsService.create(tenantA, ana, 'clientes', rec.id, {
            body: 'Primer contacto',
            kind: 'call',
        });
        expect(c1).toMatchObject({ kind: 'call', parent_id: null, user_id: ana.userId, user_name: 'Ana' });

        const reply = await commentsService.create(tenantA, beto, 'clientes', rec.id, {
            body: 'Respuesta',
            kind: 'note',
            parent_id: c1.id,
        });
        expect(reply.parent_id).toBe(c1.id);

        const all = await commentsService.list(tenantA, ana, 'clientes', rec.id);
        expect(all).toHaveLength(2);
        // El nombre del autor viaja en el DTO: la ficha no dice "Usuario #2".
        expect(all.map((c) => c.user_name)).toEqual(['Ana', 'Beto']);

        // parent de otro record → 400.
        const rec2 = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'Y' } });
        await expect(
            commentsService.create(tenantA, ana, 'clientes', rec2.id, {
                body: 'z',
                kind: 'note',
                parent_id: c1.id,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sólo el autor edita/borra su comentario', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        const c = await commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'mío', kind: 'note' });

        await expect(
            commentsService.update(tenantA, beto, 'clientes', rec.id, c.id, { body: 'hack' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            commentsService.remove(tenantA, beto, 'clientes', rec.id, c.id),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const updated = await commentsService.update(tenantA, ana, 'clientes', rec.id, c.id, { body: 'editado' });
        expect(updated.body).toBe('editado');
        expect(updated.user_name).toBe('Ana');
        await commentsService.remove(tenantA, ana, 'clientes', rec.id, c.id);
        expect(await commentsService.list(tenantA, ana, 'clientes', rec.id)).toHaveLength(0);
    });

    // --- Menciones (@login → tabla mentions + /me/mentions) -----------------

    it('menciones: @email de un miembro crea la mención; self y desconocidos no', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'ACME' } });
        await commentsService.create(tenantA, ana, 'clientes', rec.id, {
            kind: 'note',
            body: 'Hola @beto@acme.test mira esto (cc @ana@acme.test y @nadie@otro.test)',
        });
        const rows = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(mentions).where(eq(mentions.tenantId, tenantA)),
        );
        // Solo beto: la auto-mención de ana se excluye y el email desconocido
        // no matchea ningún miembro.
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            mentionedUserId: beto.userId,
            authorUserId: ana.userId,
            recordId: rec.id,
        });
        expect(rows[0]!.snippet).toContain('mira esto');

        // La campana de beto la ve; la de ana no.
        const feed = await meService.mentions(tenantA, beto.userId, 20);
        expect(feed).toHaveLength(1);
        expect(feed[0]).toMatchObject({ user_id: ana.userId, record_id: rec.id });
        expect((feed[0]!.changes as { snippet: string }).snippet).toContain('mira esto');
        expect(await meService.mentions(tenantA, ana.userId, 20)).toHaveLength(0);
    });

    it('comentar te pone a seguir el registro EN EL MISMO tx (el botón «Seguir» lo ve al toque)', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'Seguido' } });
        const follows = () =>
            withTenant(pg.db, tenantA, (tx) =>
                tx.select().from(recordFollows).where(and(eq(recordFollows.tenantId, tenantA), eq(recordFollows.recordId, rec.id))),
            );
        expect(await follows()).toHaveLength(0);
        // Sin NotifyHub (el hub corre en segundo plano): igual queda siguiendo.
        await commentsService.create(tenantA, beto, 'clientes', rec.id, { body: 'Ojo con esto', kind: 'note' });
        const rows = await follows();
        expect(rows.map((r) => r.userId)).toEqual([beto.userId]);
        // Un segundo comentario no duplica.
        await commentsService.create(tenantA, beto, 'clientes', rec.id, { body: 'Y esto', kind: 'note' });
        expect(await follows()).toHaveLength(1);
    });

    // --- v0.1.291: historial por campo ---------------------------------------

    it('historial de UN campo: más nuevo primero, paginado por cursor', async () => {
        const otro = await fieldsService.create(tenantA, 'clientes', { label: 'Ciudad', type: 'text', slug: 'ciudad' });
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'A', [`f${otro.id}`]: 'Bogotá' } });
        await recordsService.update(tenantA, beto, 'clientes', rec.id, { data: { [key()]: 'B' } });
        // Un cambio de OTRO campo no aparece en el historial de éste.
        await recordsService.update(tenantA, beto, 'clientes', rec.id, { data: { [`f${otro.id}`]: 'Cali' } });
        await recordsService.update(tenantA, ana, 'clientes', rec.id, { data: { [key()]: 'C' } });
        const viewer = { role: 'admin' as const, userId: ana.userId };
        const p1 = await activityService.fieldHistory(tenantA, 'clientes', rec.id, fieldId, { limit: 2, viewer });
        expect(p1.data.map((e) => [e.from, e.to])).toEqual([['B', 'C'], ['A', 'B']]);
        expect(p1.data[1]).toMatchObject({ user_id: beto.userId, user_name: 'Beto', action: 'record_updated' });
        expect(p1.meta.next_cursor).not.toBeNull();
        const p2 = await activityService.fieldHistory(tenantA, 'clientes', rec.id, fieldId, { limit: 2, cursor: Number(p1.meta.next_cursor), viewer });
        expect(p2.data.map((e) => [e.action, e.from, e.to])).toEqual([['record_created', null, 'A']]);
        expect(p2.meta.next_cursor).toBeNull();
    });

    it('historial: campo oculto para el rol, registro fuera de su alcance o campo de otra lista → 404', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'A' } });
        // El agente sólo ve lo suyo (por defecto): el registro de Ana no.
        await expect(
            activityService.fieldHistory(tenantA, 'clientes', rec.id, fieldId, { viewer: { role: 'agent', userId: beto.userId } }),
        ).rejects.toBeInstanceOf(NotFoundException);
        // Campo oculto para el manager → 404 aunque vea el registro.
        const l = await listsService.get(tenantA, 'clientes');
        await listsService.update(tenantA, 'clientes', {
            settings: { ...l.settings, permissions: { permissions: { manager: { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: ['nombre'] } } } },
        });
        await expect(
            activityService.fieldHistory(tenantA, 'clientes', rec.id, fieldId, { viewer: { role: 'manager', userId: beto.userId } }),
        ).rejects.toBeInstanceOf(NotFoundException);
        await listsService.create(tenantA, { name: 'Otra' });
        const ajeno = await fieldsService.create(tenantA, 'otra', { label: 'X', type: 'text', slug: 'x' });
        await expect(
            activityService.fieldHistory(tenantA, 'clientes', rec.id, ajeno.id, { viewer: { role: 'admin', userId: ana.userId } }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    // --- v0.1.291: reacciones e hilos ---------------------------------------

    it('reacciones: toggle por persona, contador y quiénes; RLS por empresa', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        const c = await commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'Listo', kind: 'note' });
        await commentsService.toggleReaction(tenantA, ana, 'clientes', rec.id, c.id, '🎉');
        await commentsService.toggleReaction(tenantA, beto, 'clientes', rec.id, c.id, '👍');
        const r = await commentsService.toggleReaction(tenantA, ana, 'clientes', rec.id, c.id, '👍');
        // En el orden del set curado (👍 antes que 🎉), con quiénes.
        expect(r.reactions.map((x) => [x.emoji, x.count, x.user_names])).toEqual([
            ['👍', 2, ['Beto', 'Ana']],
            ['🎉', 1, ['Ana']],
        ]);
        // Poner otra vez la misma la quita.
        const r2 = await commentsService.toggleReaction(tenantA, beto, 'clientes', rec.id, c.id, '👍');
        expect(r2.reactions.find((x) => x.emoji === '👍')).toMatchObject({ count: 1, user_ids: [ana.userId] });
        const listed = await commentsService.list(tenantA, ana, 'clientes', rec.id);
        expect(listed[0]!.reactions.map((x) => x.emoji)).toEqual(['👍', '🎉']);
        // RLS: otra empresa no ve ninguna fila.
        const fromB = await withTenant(pg.db, tenantB, (tx) => tx.select().from(commentReactions));
        expect(fromB).toHaveLength(0);
        const fromA = await withTenant(pg.db, tenantA, (tx) => tx.select().from(commentReactions));
        expect(fromA).toHaveLength(2);
        // Un comentario borrado no recibe reacciones.
        await commentsService.remove(tenantA, ana, 'clientes', rec.id, c.id);
        await expect(commentsService.toggleReaction(tenantA, ana, 'clientes', rec.id, c.id, '🔥')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hilos: un nivel, la respuesta hereda la visibilidad del raíz y la cambia con él', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        const root = await commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'Interno', kind: 'note' });
        // Pedir «client» en una respuesta a un raíz interno no lo hace visible.
        const r1 = await commentsService.create(tenantA, beto, 'clientes', rec.id, { body: 'R1', kind: 'note', parent_id: root.id, visibility: 'client' });
        expect(r1).toMatchObject({ parent_id: root.id, visibility: 'internal' });
        // Responder a una respuesta cuelga del MISMO raíz.
        const r2 = await commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'R2', kind: 'note', parent_id: r1.id });
        expect(r2.parent_id).toBe(root.id);
        // Cambiar la visibilidad de una respuesta → 400; la del raíz arrastra a las respuestas.
        await expect(
            commentsService.update(tenantA, beto, 'clientes', rec.id, r1.id, { visibility: 'client' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await commentsService.update(tenantA, ana, 'clientes', rec.id, root.id, { visibility: 'client' });
        const all = await commentsService.list(tenantA, ana, 'clientes', rec.id);
        expect(all.map((c) => c.visibility)).toEqual(['client', 'client', 'client']);
    });

    it('borrar un raíz con respuestas deja «Comentario eliminado»; sin respuestas, desaparece', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'X' } });
        const root = await commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'Raíz', kind: 'note', metadata: { kind: 'call', duration_minutes: 5 } });
        const reply = await commentsService.create(tenantA, beto, 'clientes', rec.id, { body: 'Respuesta', kind: 'note', parent_id: root.id });
        await commentsService.toggleReaction(tenantA, beto, 'clientes', rec.id, root.id, '👍');
        await commentsService.remove(tenantA, ana, 'clientes', rec.id, root.id);
        let all = await commentsService.list(tenantA, ana, 'clientes', rec.id);
        expect(all.map((c) => [c.id, c.deleted, c.body])).toEqual([
            [root.id, true, ''],
            [reply.id, false, 'Respuesta'],
        ]);
        // El marcador no filtra lo que decía ni sus reacciones.
        expect(all[0]!.metadata).toEqual({});
        expect(all[0]!.reactions).toEqual([]);
        // El hilo sigue vivo: se le puede responder.
        const more = await commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'Sigo', kind: 'note', parent_id: root.id });
        expect(more.parent_id).toBe(root.id);
        // Sin respuestas vivas el raíz desaparece (y ya no se le responde).
        await commentsService.remove(tenantA, beto, 'clientes', rec.id, reply.id);
        await commentsService.remove(tenantA, ana, 'clientes', rec.id, more.id);
        all = await commentsService.list(tenantA, ana, 'clientes', rec.id);
        expect(all).toHaveLength(0);
        await expect(
            commentsService.create(tenantA, ana, 'clientes', rec.id, { body: 'x', kind: 'note', parent_id: root.id }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('comentar sobre un record inexistente/ajeno → 404', async () => {
        await expect(
            commentsService.create(tenantA, ana, 'clientes', 999999, { body: 'x', kind: 'note' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
