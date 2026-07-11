import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activity, comments, fields, lists, memberships, mentions, records, tenants, users } from '../src/db/schema';
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
        expect(c1).toMatchObject({ kind: 'call', parent_id: null, user_id: ana.userId });

        const reply = await commentsService.create(tenantA, beto, 'clientes', rec.id, {
            body: 'Respuesta',
            kind: 'note',
            parent_id: c1.id,
        });
        expect(reply.parent_id).toBe(c1.id);

        const all = await commentsService.list(tenantA, ana, 'clientes', rec.id);
        expect(all).toHaveLength(2);

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
        await commentsService.remove(tenantA, ana, 'clientes', rec.id, c.id);
        expect(await commentsService.list(tenantA, ana, 'clientes', rec.id)).toHaveLength(0);
    });

    // --- Menciones (@login → tabla mentions + /me/mentions) -----------------

    it('menciones: @email de un miembro crea la mención; self y desconocidos no', async () => {
        const rec = await recordsService.create(tenantA, ana, 'clientes', { data: { [key()]: 'ACME' } });
        await commentsService.create(tenantA, ana, 'clientes', rec.id, {
            kind: 'note',
            body: 'Hola @beto@acme.test mirá esto (cc @ana@acme.test y @nadie@otro.test)',
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
        expect(rows[0]!.snippet).toContain('mirá esto');

        // La campana de beto la ve; la de ana no.
        const feed = await meService.mentions(tenantA, beto.userId, 20);
        expect(feed).toHaveLength(1);
        expect(feed[0]).toMatchObject({ user_id: ana.userId, record_id: rec.id });
        expect((feed[0]!.changes as { snippet: string }).snippet).toContain('mirá esto');
        expect(await meService.mentions(tenantA, ana.userId, 20)).toHaveLength(0);
    });

    it('comentar sobre un record inexistente/ajeno → 404', async () => {
        await expect(
            commentsService.create(tenantA, ana, 'clientes', 999999, { body: 'x', kind: 'note' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
