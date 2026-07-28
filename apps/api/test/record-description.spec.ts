import { sanitizeRichDoc, type RichDoc } from '@imagina-base/shared';
import { memberships, mentions, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const viewer: Actor = { userId: 2, role: 'viewer' };

const doc = (text: string): RichDoc => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('Descripción del registro (v0.1.133)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let tenantId: number;
    let titleKey: string;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Tareas' });
        const f = await fields_.create(tenantId, 'tareas', {
            label: 'Título',
            type: 'text',
            slug: 'titulo',
        });
        titleKey = `f${f.id}`;
    });

    const create = () => recs.create(tenantId, admin, 'tareas', { data: { [titleKey]: 'Mudanza' } });

    it('round-trip: se guarda, se lee, y el listado sólo dice que existe', async () => {
        const rec = await create();
        // Recién creado no tiene descripción.
        expect(await recs.getDescription(tenantId, admin, 'tareas', rec.id)).toBeNull();

        await recs.updateDescription(tenantId, admin, 'tareas', rec.id, {
            description: doc('Plan de la mudanza'),
        });
        const stored = await recs.getDescription(tenantId, admin, 'tareas', rec.id);
        expect(stored?.content?.[0]?.content?.[0]?.text).toBe('Plan de la mudanza');

        // El LISTADO no arrastra el documento: sólo el indicador.
        const page = await recs.list(tenantId, admin, 'tareas', { limit: 50, sort_dir: 'asc' });
        const row = page.data.find((r) => r.id === rec.id)!;
        expect(row.has_description).toBe(true);
        expect((row as unknown as Record<string, unknown>).description).toBeUndefined();

        // `null` borra y el indicador vuelve a false.
        await recs.updateDescription(tenantId, admin, 'tareas', rec.id, { description: null });
        expect(await recs.getDescription(tenantId, admin, 'tareas', rec.id)).toBeNull();
        const page2 = await recs.list(tenantId, admin, 'tareas', { limit: 50, sort_dir: 'asc' });
        expect(page2.data.find((r) => r.id === rec.id)!.has_description).toBe(false);
    });

    it('lo que se persiste pasa por la whitelist (nada de `javascript:` ni nodos raros)', async () => {
        const rec = await create();
        await recs.updateDescription(tenantId, admin, 'tareas', rec.id, {
            description: {
                type: 'doc',
                content: [
                    { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'click',
                                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                            },
                            {
                                type: 'text',
                                text: ' ok',
                                marks: [{ type: 'link', attrs: { href: 'https://imagina.com' } }],
                            },
                        ],
                    },
                ],
            } as RichDoc,
        });

        const stored = await recs.getDescription(tenantId, admin, 'tareas', rec.id);
        // El nodo desconocido no existe y la marca con esquema peligroso se cayó.
        expect(stored?.content).toHaveLength(1);
        const [malo, bueno] = stored!.content![0]!.content!;
        expect(malo?.marks).toBeUndefined();
        expect(bueno?.marks?.[0]?.attrs?.href).toBe('https://imagina.com');

        // Y en la fila cruda tampoco quedó nada del nodo `script`.
        const [raw] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ d: records.description }).from(records).where(eq(records.id, rec.id)),
        );
        expect(JSON.stringify(raw?.d)).not.toContain('script');
    });

    it('editar la descripción exige permiso de EDICIÓN sobre la fila', async () => {
        const rec = await create();
        // El rol viewer no edita: el registro "no existe" para esa mutación.
        await expect(
            recs.updateDescription(tenantId, viewer, 'tareas', rec.id, { description: doc('hola') }),
        ).rejects.toThrow();
        expect(await recs.getDescription(tenantId, admin, 'tareas', rec.id)).toBeNull();
    });

    it('sanitizeRichDoc: un documento vacío es null (el indicador no miente)', () => {
        expect(sanitizeRichDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
        expect(sanitizeRichDoc({ type: 'paragraph' })).toBeNull();
        expect(sanitizeRichDoc(doc('   '))).toBeNull();
        expect(sanitizeRichDoc(doc('x'))).not.toBeNull();
    });
    // --- Bloques "vivos" (v0.1.134) -----------------------------------------

    it('una mención en la descripción crea la notificación del mencionado', async () => {
        // OJO: el autor tiene que ser un usuario DISTINTO de los mencionados —
        // si no, el primer id de la secuencia coincide con el del actor y la
        // regla de "no auto-mención" se lleva puesta la aserción.
        const [author] = await pg.db
            .insert(users)
            .values({ email: 'author@acme.test', passwordHash: 'x', name: 'Autor' })
            .returning();
        const boss: Actor = { userId: author!.id, role: 'admin' };
        // Dos miembros del workspace + un tercero AJENO (no debe notificarse).
        const [alice] = await pg.db
            .insert(users)
            .values({ email: 'alice@acme.test', passwordHash: 'x', name: 'Alice' })
            .returning();
        const [extern] = await pg.db
            .insert(users)
            .values({ email: 'extern@otra.test', passwordHash: 'x', name: 'Extern' })
            .returning();
        await pg.db.insert(memberships).values({ tenantId, userId: alice!.id, role: 'agent' });

        const rec = await create();
        const withMentions = (): RichDoc => ({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Ojo ' },
                        { type: 'mentionUser', attrs: { id: alice!.id, label: 'Alice' } },
                        { type: 'text', text: ' y ' },
                        { type: 'mentionUser', attrs: { id: extern!.id, label: 'Extern' } },
                        // Auto-mención: no se notifica a uno mismo.
                        { type: 'mentionUser', attrs: { id: boss.userId, label: 'Yo' } },
                    ],
                },
            ],
        });
        await recs.updateDescription(tenantId, boss, 'tareas', rec.id, {
            description: withMentions(),
        });

        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(mentions).where(eq(mentions.recordId, rec.id)),
        );
        expect(rows.map((r) => r.mentionedUserId)).toEqual([alice!.id]);
        expect(rows[0]!.source).toBe('description');
        expect(rows[0]!.commentId).toBeNull();

        // Sacar la mención del documento la saca también de la campana.
        await recs.updateDescription(tenantId, boss, 'tareas', rec.id, { description: doc('sin nadie') });
        const after = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(mentions).where(eq(mentions.recordId, rec.id)),
        );
        expect(after).toHaveLength(0);
    });

    it('los bloques de archivo e imagen conservan su referencia; sin ella se descartan', async () => {
        const rec = await create();
        await recs.updateDescription(tenantId, admin, 'tareas', rec.id, {
            description: {
                type: 'doc',
                content: [
                    { type: 'imageBlock', attrs: { fileId: 7, alt: 'Plano' } },
                    { type: 'fileBlock', attrs: { fileId: 9, name: 'contrato.pdf', size: 2048 } },
                    // Sin fileId ni src: no hay nada que resolver → fuera.
                    { type: 'imageBlock', attrs: { alt: 'huérfana' } },
                    // Una URL externa con esquema peligroso tampoco sobrevive.
                    { type: 'imageBlock', attrs: { src: 'javascript:alert(1)' } },
                ],
            } as RichDoc,
        });
        const stored = await recs.getDescription(tenantId, admin, 'tareas', rec.id);
        expect(stored?.content).toHaveLength(2);
        expect(stored?.content?.[0]).toMatchObject({ type: 'imageBlock', attrs: { fileId: 7 } });
        expect(stored?.content?.[1]).toMatchObject({ type: 'fileBlock', attrs: { fileId: 9 } });
    });
});
