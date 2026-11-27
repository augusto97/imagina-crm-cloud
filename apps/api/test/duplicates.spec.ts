import { ConflictException } from '@nestjs/common';
import { duplicateKey, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import {
    activity,
    auditLog,
    bulkEdits,
    comments,
    fields,
    lists,
    recordDependencies,
    recordDuplicateDismissals,
    recordFollows,
    records,
    relations,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DuplicatesService, duplicateKeyExpr } from '../src/duplicates/duplicates.service';
import { RecordMergeService } from '../src/duplicates/record-merge.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/**
 * A14 (v0.1.445, ADR-S106) — Duplicados y fusionar, con Postgres real: las
 * reglas sugeridas, la MISMA clave en JS y en SQL, los grupos con el acceso de
 * quien mira, «no son duplicados», fusionar moviendo lo que colgaba de los
 * otros, y deshacer.
 */
describe('duplicados y fusionar (v0.1.445)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let dups: DuplicatesService;
    let merger: RecordMergeService;
    let history: BulkHistoryService;
    let tenantId: number;
    let admin: Actor;
    let agent: Actor;
    let f: Record<string, Field>;
    let clientesId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const audit = new AuditService(tenantDb);
        history = new BulkHistoryService(tenantDb, listsService, recs, rt, audit);
        dups = new DuplicatesService(tenantDb, recs, audit, rt);
        merger = new RecordMergeService(tenantDb, recs, history, audit);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        const [u1, u2] = await pg.db
            .insert(users)
            .values([
                { email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Admin' },
                { email: 'beto@acme.test', passwordHash: 'x', name: 'Beto Agente' },
            ])
            .returning();
        admin = { userId: u1!.id, role: 'admin' };
        agent = { userId: u2!.id, role: 'agent' };
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(recordDuplicateDismissals).where(eq(recordDuplicateDismissals.tenantId, tenantId));
            await tx.delete(recordDependencies).where(eq(recordDependencies.tenantId, tenantId));
            await tx.delete(recordFollows).where(eq(recordFollows.tenantId, tenantId));
            await tx.delete(comments).where(eq(comments.tenantId, tenantId));
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(bulkEdits).where(eq(bulkEdits.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.execute(sql`UPDATE records SET parent_id = NULL WHERE tenant_id = ${tenantId}`);
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        // v0.1.475 — una lista en blanco nace sin el aviso de duplicados; la de
        // clientes lo enciende (como la plantilla de contactos).
        clientesId = (await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes', features: { duplicates: true } })).id;
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Correo', type: 'email', slug: 'correo' },
            { label: 'Teléfono', type: 'phone', slug: 'telefono', config: { default_country: 'CO' } },
            { label: 'NIT', type: 'text', slug: 'nit' },
            { label: 'Ciudad', type: 'text', slug: 'ciudad' },
            { label: 'Código', type: 'text', slug: 'codigo_interno', is_unique: true },
            {
                label: 'Etiquetas',
                type: 'multi_select',
                slug: 'etiquetas',
                config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'mayorista', label: 'Mayorista' }, { value: 'nuevo', label: 'Nuevo' }] },
            },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }] },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'clientes', d);
        await listsService.create(tenantId, { name: 'Oportunidades', slug: 'oportunidades' });
        f.cliente = await fieldsService.create(tenantId, 'oportunidades', { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientesId } });
    });

    const k = (slug: string) => `f${f[slug]!.id}`;
    const create = (data: Record<string, unknown>, who: Actor = admin, list = 'clientes') => {
        const out: Record<string, unknown> = {};
        for (const [slug, v] of Object.entries(data)) out[k(slug)] = v;
        return recs.create(tenantId, who, list, { data: out });
    };
    const rowOf = async (id: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.id, id)))))[0]!;

    it('sugiere las reglas (correo, teléfono, documento) y la clave es la MISMA en JS y en SQL', async () => {
        const s = await dups.settings(tenantId, admin, 'clientes');
        expect(s).toMatchObject({ enabled: true, warn_on_create: true, custom: false });
        expect(s.rules).toEqual([[f.correo!.id], [f.telefono!.id], [f.nit!.id], [f.codigo_interno!.id]]);

        // Paridad: lo que el panel calcula en SQL es lo que el alta calcula en JS.
        const samples: Array<[string, unknown]> = [
            ['nombre', '  José   Ñandú-Pérez S.A.  '],
            ['nombre', 'ÁRBOL & Cía.'],
            ['correo', 'Ventas@ACME.co'],
            ['telefono', '+57 (300) 111-2233'],
            ['telefono', '12-34'],
        ];
        for (const [slug, value] of samples) {
            const r = await create({ [slug]: value });
            const res = await withTenant(pg.db, tenantId, (tx) =>
                tx.execute(sql`SELECT coalesce(${duplicateKeyExpr(f[slug]!)}, '') AS k FROM ${records} WHERE ${records.id} = ${r.id}`),
            );
            const sqlKey = (res.rows as Array<{ k: string }>)[0]!.k;
            // Lo guardado (ya normalizado por el validador) da la misma clave que lo escrito.
            expect(sqlKey, `${slug} = ${JSON.stringify(value)}`).toBe(duplicateKey(f[slug]!.type, r.data[k(slug)]));
            expect(sqlKey, `${slug} = ${JSON.stringify(value)}`).toBe(duplicateKey(f[slug]!.type, value));
        }
        // Y los tipos que no escribe el validador como texto libre, directo en la fila.
        const raw: Array<[Pick<Field, 'id' | 'type'>, unknown, string]> = [
            [{ id: 900001, type: 'url' }, 'HTTPS://www.Acme.co/', 'acme.co'],
            [{ id: 900002, type: 'number' }, 1500, '1500'],
            [{ id: 900003, type: 'number' }, 1500.5, '1500.5'],
            [{ id: 900004, type: 'date' }, '2026-10-05', '2026-10-05'],
            [{ id: 900005, type: 'select' }, ' Activo ', 'activo'],
            [{ id: 900006, type: 'email' }, ' Ventas@ACME.co ', 'ventas@acme.co'],
        ];
        for (const [field, value, expected] of raw) {
            const res = await withTenant(pg.db, tenantId, (tx) =>
                tx.execute(sql`SELECT coalesce(${duplicateKeyExpr(field)}, '') AS k FROM (SELECT ${JSON.stringify({ [`f${field.id}`]: value })}::jsonb AS data) AS records`),
            );
            expect((res.rows as Array<{ k: string }>)[0]!.k).toBe(expected);
            expect(duplicateKey(field.type, value)).toBe(expected);
        }
    });

    it('agrupa por cualquier regla (correo O teléfono une a tres), avisa al crear y «no son duplicados» los separa', async () => {
        const a = await create({ nombre: 'Acme S.A.', correo: 'ventas@acme.co', telefono: '+57 300 111 2233' });
        const b = await create({ nombre: 'ACME SA', correo: 'VENTAS@acme.co' });
        const c = await create({ nombre: 'Beta', telefono: '3001112233' });
        await create({ nombre: 'Gamma', correo: 'g@gamma.co' });
        const e = await create({ nombre: 'Delta', nit: '900123456-7' });
        const g = await create({ nombre: 'Delta Ltda', nit: '900123456 - 7' });

        const page = await dups.groups(tenantId, admin, 'clientes');
        expect(page.total).toBe(2);
        expect(page.groups[0]!.ids).toEqual([a.id, b.id, c.id]);
        expect(page.groups[0]!.matched).toEqual(['Correo', 'Teléfono']);
        expect(page.groups[0]!.records.map((r) => r.title)).toEqual(['Acme S.A.', 'ACME SA', 'Beta']);
        expect(page.groups[1]).toMatchObject({ ids: [e.id, g.id], matched: ['NIT'] });

        // Alta: lo que se escribe (por slug) y en qué coincide.
        const hits = await dups.check(tenantId, admin, 'clientes', { correo: 'Ventas@Acme.CO', nombre: 'Otro' }, { purpose: 'create' });
        expect(hits.map((h) => h.id)).toEqual([a.id, b.id]);
        expect(hits[0]!.matched).toEqual(['Correo']);
        // Una variable vacía nunca busca «vacío».
        expect(await dups.check(tenantId, admin, 'clientes', { correo: '', telefono: '12' }, { purpose: 'create' })).toEqual([]);
        // Ficha: no se compara consigo mismo.
        expect((await dups.forRecord(tenantId, admin, 'clientes', a.id)).map((h) => h.id)).toEqual([b.id, c.id]);

        // «No son duplicados»: el par deja de aparecer, también en la ficha.
        expect(await dups.dismiss(tenantId, admin, 'clientes', [e.id, g.id])).toEqual({ pairs: 1 });
        const after = await dups.groups(tenantId, admin, 'clientes');
        expect(after.total).toBe(1);
        expect(await dups.forRecord(tenantId, admin, 'clientes', e.id)).toEqual([]);

        // Avisar al crear apagado: el alta no pregunta; la ficha y el panel siguen.
        const s = await dups.updateSettings(tenantId, admin, 'clientes', { warn_on_create: false });
        expect(s.warn_on_create).toBe(false);
        expect(await dups.check(tenantId, admin, 'clientes', { correo: 'ventas@acme.co' }, { purpose: 'create' })).toEqual([]);
        expect((await dups.forRecord(tenantId, admin, 'clientes', b.id)).length).toBeGreaterThan(0);

        // Reglas propias: «Nombre + Ciudad»; un campo que no sirve se rechaza con el motivo.
        await expect(dups.updateSettings(tenantId, admin, 'clientes', { rules: [{ fields: [f.etiquetas!.id] }] })).rejects.toMatchObject({
            response: { code: 'duplicate_rule_type' },
        });
        const custom = await dups.updateSettings(tenantId, admin, 'clientes', { rules: [{ fields: [f.nombre!.id, f.ciudad!.id] }] });
        expect(custom).toMatchObject({ custom: true, rules: [[f.nombre!.id, f.ciudad!.id]] });
        expect((await dups.groups(tenantId, admin, 'clientes')).total).toBe(0);
        const reset = await dups.updateSettings(tenantId, admin, 'clientes', { rules: null });
        expect(reset.custom).toBe(false);
        expect(reset.rules.length).toBe(4);
        const [log] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, 'list.duplicates')).limit(1));
        expect(log).toBeTruthy();
    });

    it('con el acceso de quien mira: el agente sólo ve los suyos y una regla con un campo oculto no se aplica', async () => {
        await create({ nombre: 'Acme', correo: 'ventas@acme.co' });
        await create({ nombre: 'Acme bis', correo: 'ventas@acme.co' });
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({ settings: { permissions: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'own', fields_hidden: ['nit'] } } } } })
                .where(eq(lists.id, clientesId)),
        );
        const mine1 = await create({ nombre: 'Beta', telefono: '3001112233' }, agent);
        const mine2 = await create({ nombre: 'Beta 2', telefono: '300 111 2233' }, agent);
        const page = await dups.groups(tenantId, agent, 'clientes');
        expect(page.groups.map((g) => g.ids)).toEqual([[mine1.id, mine2.id]]);
        expect(page.groups[0]!.matched).toEqual(['Teléfono']);
        expect(page.hidden_rules).toBe(1);
        // El aviso al crear tampoco revela registros que no ve.
        expect(await dups.check(tenantId, agent, 'clientes', { correo: 'ventas@acme.co' }, { purpose: 'create' })).toEqual([]);
        // El admin ve los dos grupos.
        expect((await dups.groups(tenantId, admin, 'clientes')).total).toBe(2);
    });

    it('fusiona: valores elegidos o juntos, mueve comentarios, vínculos, subtareas y seguidores, y deshacer lo devuelve todo', async () => {
        const a = await create({ nombre: 'Acme', correo: 'ventas@acme.co', etiquetas: ['vip'], estado: 'activo' });
        const b = await create({ nombre: 'Acme Colombia S.A.S.', correo: 'ventas@acme.co', etiquetas: ['mayorista'], codigo_interno: 'C-77', ciudad: 'Bogotá' });
        const c = await create({ nombre: 'ACME', correo: 'VENTAS@acme.co', etiquetas: ['vip', 'nuevo'] });
        const sub = await recs.create(tenantId, admin, 'clientes', { data: { [k('nombre')]: 'Sede norte' }, parent_id: c.id });
        const opp = await recs.create(tenantId, admin, 'oportunidades', { data: { [`f${f.cliente!.id}`]: [b.id] } });
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.insert(comments).values({ tenantId, listId: clientesId, recordId: b.id, userId: admin.userId, body: 'Llamó ayer' });
            await tx.insert(recordFollows).values({ tenantId, userId: agent.userId, listId: clientesId, recordId: b.id });
            await tx.insert(recordFollows).values({ tenantId, userId: admin.userId, listId: clientesId, recordId: a.id });
            await tx.insert(recordFollows).values({ tenantId, userId: admin.userId, listId: clientesId, recordId: b.id });
        });

        const preview = await merger.preview(tenantId, admin, 'clientes', a.id, [b.id, c.id]);
        expect(preview.blockers).toEqual([]);
        const nombre = preview.fields.find((x) => x.field_id === f.nombre!.id)!;
        expect(nombre).toMatchObject({ values: ['Acme', 'Acme Colombia S.A.S.', 'ACME'], differs: true, can_union: false });
        expect(preview.fields.find((x) => x.field_id === f.etiquetas!.id)).toMatchObject({ can_union: true });
        // Lo vacío del que queda se completa solo con lo de otro.
        expect(preview.fields.find((x) => x.field_id === f.ciudad!.id)!.suggested).toBe(b.id);
        expect(Object.fromEntries(preview.moves.map((m) => [m.key, m.count]))).toMatchObject({ comments: 1, relations_in: 1, subtasks: 1, follows: 1 });

        const result = await merger.merge(tenantId, admin, 'clientes', {
            primary_id: a.id,
            duplicate_ids: [b.id, c.id],
            choices: { [String(f.nombre!.id)]: b.id, [String(f.etiquetas!.id)]: 'union', [String(f.codigo_interno!.id)]: b.id },
        });
        expect(result.merged_ids).toEqual([b.id, c.id]);
        expect(result.edit_id).toBeTypeOf('number');

        const kept = await recs.get(tenantId, admin, 'clientes', a.id);
        expect(kept.data[k('nombre')]).toBe('Acme Colombia S.A.S.');
        expect(kept.data[k('etiquetas')]).toEqual(['vip', 'mayorista', 'nuevo']);
        expect(kept.data[k('ciudad')]).toBe('Bogotá');
        // «Sin repetidos»: el código pasa al que queda sin chocar con el que se fue.
        expect(kept.data[k('codigo_interno')]).toBe('C-77');
        expect((await rowOf(b.id)).deletedAt).not.toBeNull();
        expect((await rowOf(c.id)).deletedAt).not.toBeNull();
        expect((await rowOf(sub.id)).parentId).toBe(a.id);
        const oppNow = await recs.get(tenantId, admin, 'oportunidades', opp.id);
        expect(oppNow.relations?.[`f${f.cliente!.id}`]).toEqual([a.id]);
        await withTenant(pg.db, tenantId, async (tx) => {
            const cm = await tx.select().from(comments).where(eq(comments.tenantId, tenantId));
            expect(cm.map((x) => x.recordId)).toEqual([a.id]);
            const fl = await tx.select().from(recordFollows).where(and(eq(recordFollows.tenantId, tenantId), eq(recordFollows.recordId, a.id)));
            expect(fl.map((x) => x.userId).sort()).toEqual([admin.userId, agent.userId].sort());
            const act = await tx.select().from(activity).where(and(eq(activity.tenantId, tenantId), eq(activity.action, 'record_merged')));
            expect(act.map((x) => x.recordId).sort()).toEqual([a.id, b.id, c.id].sort());
        });
        // Ya no son duplicados: el grupo desapareció.
        expect((await dups.groups(tenantId, admin, 'clientes')).total).toBe(0);

        // Deshacer: todo vuelve.
        const logs = await history.list(tenantId, admin, 'clientes');
        expect(logs[0]).toMatchObject({ kind: 'merge', can_revert: true });
        const rp = await history.revertPreview(tenantId, admin, 'clientes', result.edit_id!);
        expect(rp.conflicts).toEqual([]);
        expect(rp.item_ids.length).toBe(3);
        const rr = await history.revertApply(tenantId, admin, 'clientes', result.edit_id!, rp.item_ids, false);
        expect(rr).toMatchObject({ reverted: 3, conflicts: 0, failed: [] });
        const back = await recs.get(tenantId, admin, 'clientes', a.id);
        expect(back.data[k('nombre')]).toBe('Acme');
        expect(back.data[k('etiquetas')]).toEqual(['vip']);
        expect(back.data[k('codigo_interno')] ?? null).toBeNull();
        expect((await rowOf(b.id)).deletedAt).toBeNull();
        expect((await rowOf(c.id)).deletedAt).toBeNull();
        expect((await rowOf(sub.id)).parentId).toBe(c.id);
        expect((await recs.get(tenantId, admin, 'oportunidades', opp.id)).relations?.[`f${f.cliente!.id}`]).toEqual([b.id]);
        await withTenant(pg.db, tenantId, async (tx) => {
            const cm = await tx.select().from(comments).where(eq(comments.tenantId, tenantId));
            expect(cm.map((x) => x.recordId)).toEqual([b.id]);
            const fa = await tx.select().from(recordFollows).where(and(eq(recordFollows.tenantId, tenantId), eq(recordFollows.recordId, a.id)));
            expect(fa.map((x) => x.userId)).toEqual([admin.userId]);
        });
        expect((await dups.groups(tenantId, admin, 'clientes')).total).toBe(1);
    });

    it('no fusiona lo que no corresponde: subtareas, sin permiso de borrar, nada elegido; y una dependencia que formaría un círculo se queda', async () => {
        const a = await create({ nombre: 'Acme', correo: 'x@acme.co' });
        const b = await create({ nombre: 'Acme 2', correo: 'x@acme.co' });
        const sub = await recs.create(tenantId, admin, 'clientes', { data: { [k('nombre')]: 'Sede' }, parent_id: a.id });
        const p1 = await merger.preview(tenantId, admin, 'clientes', a.id, [sub.id]);
        expect(p1.blockers.join(' ')).toContain('subtareas');
        await expect(merger.merge(tenantId, admin, 'clientes', { primary_id: a.id, duplicate_ids: [sub.id] })).rejects.toBeInstanceOf(ConflictException);
        await expect(merger.preview(tenantId, admin, 'clientes', a.id, [a.id])).rejects.toMatchObject({ response: { code: 'merge_nothing' } });

        // Un agente que puede editar lo suyo pero no borrar.
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({ settings: { permissions: { permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } } } } })
                .where(eq(lists.id, clientesId)),
        );
        const p2 = await merger.preview(tenantId, agent, 'clientes', a.id, [b.id]);
        expect(p2.blockers.join(' ')).toContain('No puedes borrar');
        await withTenant(pg.db, tenantId, (tx) => tx.update(lists).set({ settings: {} }).where(eq(lists.id, clientesId)));

        // B bloquea a A: al fusionar B en A sería A→A. Se queda con B y se avisa.
        const other = await create({ nombre: 'Otro' });
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(recordDependencies).values([
                { tenantId, blockerListId: clientesId, blockerRecordId: b.id, blockedListId: clientesId, blockedRecordId: a.id },
                { tenantId, blockerListId: clientesId, blockerRecordId: b.id, blockedListId: clientesId, blockedRecordId: other.id },
            ]),
        );
        const res = await merger.merge(tenantId, admin, 'clientes', { primary_id: a.id, duplicate_ids: [b.id] });
        expect(res.warnings.join(' ')).toContain('círculo');
        const deps = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(recordDependencies).where(eq(recordDependencies.tenantId, tenantId)),
        );
        const byBlocked = new Map(deps.map((d) => [d.blockedRecordId, d.blockerRecordId]));
        expect(byBlocked.get(other.id)).toBe(a.id);
        expect(byBlocked.get(a.id)).toBe(b.id);
    });
});
