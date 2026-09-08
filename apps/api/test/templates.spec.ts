import { NotFoundException } from '@nestjs/common';
import { tokenizeFieldRefs, resolveFieldRefs, tokenizeListRefs, resolveListRefs } from '@imagina-base/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { automationHooks, records, relations, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { SYSTEM_TEMPLATES } from '../src/templates/system-catalog';
import { TemplatesService } from '../src/templates/templates.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

class FakeHookStore implements HookCaptureStore {
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

const rt = new RealtimeService();

describe('Tokens del blueprint (puros)', () => {
    it('id ↔ slug en cualquier clave *_field_id / *_field_ids / inputs', () => {
        const idToSlug = new Map([[10, 'estado'], [11, 'monto']]);
        const cfg = {
            title_field_id: 10,
            sort: [{ field_id: 11, dir: 'asc' }],
            kanban_meta_field_ids: [10, 11, 99],
            inputs: [10, 11],
            other_id: 10,
        };
        const tokens = tokenizeFieldRefs(cfg, idToSlug, ['inputs']) as Record<string, unknown>;
        expect(tokens.title_field_id).toEqual({ $field: 'estado' });
        expect(tokens.sort).toEqual([{ field_id: { $field: 'monto' }, dir: 'asc' }]);
        // 99 no está en el mapa: se conserva (puede ser de otra lista).
        expect(tokens.kanban_meta_field_ids).toEqual([{ $field: 'estado' }, { $field: 'monto' }, 99]);
        expect(tokens.inputs).toEqual([{ $field: 'estado' }, { $field: 'monto' }]);
        // Una clave que no termina en field_id no se toca.
        expect(tokens.other_id).toBe(10);

        const back = resolveFieldRefs(tokens, new Map([['estado', 20], ['monto', 21]])) as Record<string, unknown>;
        expect(back.title_field_id).toBe(20);
        expect(back.kanban_meta_field_ids).toEqual([20, 21, 99]);
        // Un slug que no existe en el destino se descarta, no queda roto.
        const broken = resolveFieldRefs({ title_field_id: { $field: 'nope' }, ids: [{ $field: 'nope' }, 5] }, new Map());
        expect(broken).toEqual({ title_field_id: null, ids: [5] });
    });

    it('list_id / target_list_id del pack → $list y vuelta', () => {
        const t = tokenizeListRefs({ target_list_id: 7, list_id: '7', other: 7 }, new Map([[7, 'clientes']])) as Record<string, unknown>;
        expect(t).toEqual({ target_list_id: { $list: 'clientes' }, list_id: { $list: 'clientes' }, other: 7 });
        expect(resolveListRefs(t, new Map([['clientes', 70]]))).toEqual({ target_list_id: 70, list_id: 70, other: 7 });
    });

    it('el catálogo del sistema es válido y toda referencia apunta a algo que existe', () => {
        expect(SYSTEM_TEMPLATES.length).toBeGreaterThanOrEqual(6);
        for (const t of SYSTEM_TEMPLATES) {
            const keys = new Set(t.blueprint.lists.map((l) => l.key));
            for (const l of t.blueprint.lists) {
                const slugs = new Set(l.fields.map((f) => f.slug));
                const json = JSON.stringify([l.settings, l.views, l.automations, l.fields.map((f) => f.config)]);
                for (const m of json.matchAll(/"\$field":"([^"]+)"/g)) {
                    expect(slugs.has(m[1]!), `${t.key}/${l.key}: campo ${m[1]}`).toBe(true);
                }
                for (const m of json.matchAll(/"\$list":"([^"]+)"/g)) {
                    expect(keys.has(m[1]!), `${t.key}: lista ${m[1]}`).toBe(true);
                }
                for (const r of l.records) {
                    for (const slug of Object.keys(r.data)) {
                        expect(slugs.has(slug), `${t.key}/${l.key}: registro con campo ${slug}`).toBe(true);
                    }
                }
            }
        }
    });
});

describe('Duplicar listas y plantillas (Postgres real, v0.1.166)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let viewsService: ViewsService;
    let automationsService: AutomationsService;
    let templates: TemplatesService;
    let tenantA: number;
    let tenantB: number;
    let actor: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        viewsService = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);
        automationsService = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            new FakeHookStore(),
        );
        const plans = new PlansService(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const billing = new BillingService(
            tenantDb,
            plans,
            new EmailQuotaService(pg.db, plans),
            new TenantSmtpService(pg.db, env),
        );
        const blueprints = new BlueprintService(
            tenantDb,
            listsService,
            fieldsService,
            viewsService,
            automationsService,
            new RecordsRepository(),
            new RelationsRepository(),
            billing,
            rt,
        );
        templates = new TemplatesService(tenantDb, listsService, blueprints, new AuditService(tenantDb));
        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'pro' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex', plan: 'pro' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        // `created_by` de las plantillas y la bitácora apuntan a un usuario
        // real (FK): sin fila en `users` el insert rebota.
        const [u] = await pg.db
            .insert(users)
            .values({ email: `tpl-${Date.now()}@test.local`, passwordHash: 'x', name: 'Tomás Plantillas' })
            .returning();
        actor = u!.id;
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('duplicar copia campos, vistas, automatizaciones, ajustes y registros con los ids RE-MAPEADOS', async () => {
        const src = await listsService.create(tenantA, { name: 'Tareas', icon: 'clipboard', color: 'amber' });
        const titulo = await fieldsService.create(tenantA, String(src.id), { label: 'Título', type: 'text' });
        const estado = await fieldsService.create(tenantA, String(src.id), {
            label: 'Estado',
            type: 'select',
            config: { options: [{ value: 'a', label: 'A', color: 'sky' }] },
        });
        const horas = await fieldsService.create(tenantA, String(src.id), { label: 'Horas', type: 'number' });
        const doble = await fieldsService.create(tenantA, String(src.id), {
            label: 'Doble',
            type: 'computed',
            config: { operation: 'sum', inputs: [horas.id, horas.id] },
        });
        await listsService.update(tenantA, String(src.id), {
            settings: { title_field_id: titulo.id, permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['horas'] } } },
        });
        await viewsService.create(tenantA, String(src.id), {
            name: 'Kanban',
            type: 'kanban',
            config: { group_by_field_id: estado.id, kanban_meta_field_ids: [horas.id] },
        });
        await automationsService.create(tenantA, String(src.id), {
            name: 'Hook',
            trigger_type: 'incoming_webhook',
            trigger_config: {},
            actions: [{ type: 'update_field', config: { values: { estado: 'a' } } }],
        });
        const [hook] = await pg.db.select().from(automationHooks);
        expect(hook?.token).toBeTruthy();
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.insert(records).values({
                tenantId: tenantA,
                listId: src.id,
                data: { [`f${titulo.id}`]: 'Primera', [`f${horas.id}`]: 3 },
                createdBy: actor,
            });
        });

        const { lists: created, warnings } = await templates.duplicate(tenantA, actor, String(src.id), {
            name: 'Tareas (copia)',
            include: { views: true, automations: true, settings: true, records: true },
        });
        expect(warnings).toEqual([]);
        const copy = created[0]!;
        expect(copy.id).not.toBe(src.id);
        expect(copy.name).toBe('Tareas (copia)');
        expect(copy.icon).toBe('clipboard');

        const cf = await fieldsService.listByListId(tenantA, copy.id);
        const bySlug = new Map(cf.map((f) => [f.slug, f]));
        expect([...bySlug.keys()].sort()).toEqual(['doble', 'estado', 'horas', 'titulo']);
        // Los ids son NUEVOS y el computed apunta a los nuevos.
        expect(bySlug.get('horas')!.id).not.toBe(horas.id);
        expect(bySlug.get('doble')!.config).toEqual({ operation: 'sum', inputs: [bySlug.get('horas')!.id, bySlug.get('horas')!.id] });
        expect(bySlug.get('doble')!.id).not.toBe(doble.id);

        const copied = await listsService.get(tenantA, String(copy.id));
        expect(copied.settings.title_field_id).toBe(bySlug.get('titulo')!.id);
        expect((copied.settings.permissions as Record<string, { fields_hidden: string[] }>).agent?.fields_hidden).toEqual(['horas']);

        const [view] = await viewsService.list(tenantA, String(copy.id));
        expect(view!.config.group_by_field_id).toBe(bySlug.get('estado')!.id);
        expect(view!.config.kanban_meta_field_ids).toEqual([bySlug.get('horas')!.id]);

        const [auto] = await automationsService.list(tenantA, String(copy.id));
        expect(auto!.name).toBe('Hook');
        // El token del webhook NO se copia: la copia recibe uno propio.
        const hooks = await pg.db.select().from(automationHooks);
        expect(hooks).toHaveLength(2);
        expect(new Set(hooks.map((h) => h.token)).size).toBe(2);

        const rows = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(records).where(and(eq(records.listId, copy.id), isNull(records.deletedAt))),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.data).toEqual({ [`f${bySlug.get('titulo')!.id}`]: 'Primera', [`f${bySlug.get('horas')!.id}`]: 3 });
    });

    it('duplicar SIN registros ni automatizaciones respeta la elección', async () => {
        const src = await listsService.create(tenantA, { name: 'Solo estructura' });
        const t = await fieldsService.create(tenantA, String(src.id), { label: 'T', type: 'text' });
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.insert(records).values({ tenantId: tenantA, listId: src.id, data: { [`f${t.id}`]: 'x' }, createdBy: actor });
        });
        await automationsService.create(tenantA, String(src.id), {
            name: 'A',
            trigger_type: 'record_created',
            actions: [{ type: 'update_field', config: { values: {} } }],
        });
        const { lists: created } = await templates.duplicate(tenantA, actor, String(src.id), {
            include: { views: false, automations: false, settings: false, records: false },
        });
        const copy = created[0]!;
        expect(copy.name).toBe('Solo estructura (copia)');
        expect(await fieldsService.listByListId(tenantA, copy.id)).toHaveLength(1);
        expect(await automationsService.list(tenantA, String(copy.id))).toHaveLength(0);
        const rows = await withTenant(pg.db, tenantA, (tx) => tx.select().from(records).where(eq(records.listId, copy.id)));
        expect(rows).toHaveLength(0);
    });

    it('la publicación pública NO viaja: la copia nace sin publicar', async () => {
        const src = await listsService.create(tenantA, { name: 'Pública' });
        await fieldsService.create(tenantA, String(src.id), { label: 'N', type: 'text' });
        await listsService.update(tenantA, String(src.id), {
            settings: { public: { enabled: true, token: 'abc', visible_field_slugs: ['n'] }, other: 'ok' },
        });
        const { lists: created } = await templates.duplicate(tenantA, actor, String(src.id), { include: { views: true, automations: true, settings: true, records: false } });
        const copied = await listsService.get(tenantA, String(created[0]!.id));
        expect(copied.settings.public).toBeUndefined();
        expect(copied.settings.other).toBe('ok');
    });

    it('guardar como plantilla → aparece en la galería junto a las del sistema → aplicar crea la lista → borrar', async () => {
        const src = await listsService.create(tenantA, { name: 'Leads', icon: 'target', color: 'violet' });
        await fieldsService.create(tenantA, String(src.id), { label: 'Nombre', type: 'text' });
        await fieldsService.create(tenantA, String(src.id), { label: 'Etapa', type: 'select', config: { options: [] } });

        const tpl = await templates.create(tenantA, actor, {
            list_id: src.id,
            name: 'Mi pipeline',
            description: 'Como lo uso yo',
            category: 'ventas',
            include: { views: true, automations: true, settings: true, records: false },
        });
        expect(tpl.source).toBe('workspace');
        expect(tpl.icon).toBe('target');
        expect(tpl.lists[0]!.fields.map((f) => f.label)).toEqual(['Nombre', 'Etapa']);

        const all = await templates.listAll(tenantA);
        expect(all.find((t) => t.id === tpl.id)?.name).toBe('Mi pipeline');
        expect(all.filter((t) => t.source === 'system').length).toBe(SYSTEM_TEMPLATES.length);
        // La plantilla del workspace de ACME no la ve Globex.
        expect((await templates.listAll(tenantB)).some((t) => t.id === tpl.id)).toBe(false);

        const { lists: applied } = await templates.apply(tenantA, actor, tpl.id, { name: 'Leads Q4', include_records: true });
        expect(applied[0]!.name).toBe('Leads Q4');
        expect((await fieldsService.listByListId(tenantA, applied[0]!.id)).map((f) => f.slug)).toEqual(['nombre', 'etapa']);

        await templates.remove(tenantA, actor, tpl.id);
        await expect(templates.get(tenantA, tpl.id)).rejects.toThrow(NotFoundException);
        await expect(templates.remove(tenantA, actor, 'sys:crm-clientes')).rejects.toThrow();
    });

    it('una plantilla del sistema con DOS listas materializa la relación y los registros vinculados', async () => {
        const { lists: created, warnings } = await templates.apply(tenantB, actor, 'sys:facturacion', {
            include_records: true,
        });
        expect(warnings).toEqual([]);
        expect(created.map((l) => l.name)).toEqual(['Clientes', 'Facturas']);
        const [clientes, facturas] = created;
        const ff = await fieldsService.listByListId(tenantB, facturas!.id);
        const rel = ff.find((f) => f.slug === 'cliente')!;
        expect(rel.type).toBe('relation');
        expect(rel.config.target_list_id).toBe(clientes!.id);

        const facturasRows = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records).where(eq(records.listId, facturas!.id)));
        expect(facturasRows).toHaveLength(2);
        const links = await withTenant(pg.db, tenantB, (tx) => tx.select().from(relations).where(eq(relations.fieldId, rel.id)));
        expect(links).toHaveLength(2);
        const clientesRows = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records).where(eq(records.listId, clientes!.id)));
        expect(clientesRows.map((r) => r.id).sort()).toEqual(links.map((l) => l.targetRecordId).sort());

        // La automatización "Marcar vencida" quedó con el trigger sobre el slug.
        const [auto] = await automationsService.list(tenantB, String(facturas!.id));
        expect(auto!.trigger_config.due_field).toBe('vencimiento');
    });

    it('aplicar sin registros deja la lista vacía; las subtareas de muestra conservan su padre', async () => {
        const empty = await templates.apply(tenantB, actor, 'sys:proyectos-tareas', { include_records: false, name: 'Vacía' });
        const none = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records).where(eq(records.listId, empty.lists[0]!.id)));
        expect(none).toHaveLength(0);

        const full = await templates.apply(tenantB, actor, 'sys:proyectos-tareas', { include_records: true });
        const rows = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records).where(eq(records.listId, full.lists[0]!.id)));
        expect(rows).toHaveLength(4);
        const children = rows.filter((r) => r.parentId !== null);
        expect(children).toHaveLength(2);
        const parent = rows.find((r) => r.id === children[0]!.parentId)!;
        expect(Object.values(parent.data)).toContain('Lanzamiento del sitio');
    });
});
