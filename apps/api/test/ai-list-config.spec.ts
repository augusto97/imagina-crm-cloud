import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ConversationsStore } from '../src/ai/conversations.store';
import { McpService } from '../src/ai/mcp.service';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { DataTools } from '../src/ai/tools/data-tools';
import { AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { PublicListsService } from '../src/public-lists/public-lists.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { loadEnv } from '../src/config/env';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { listGroups, memberships, tenants, users } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

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

function json(res: unknown): Record<string, unknown> {
    const content = (res as { content: Array<{ type: string; text: string }> }).content;
    return JSON.parse(content[0]!.text) as Record<string, unknown>;
}
const isError = (res: unknown): boolean => Boolean((res as { isError?: boolean }).isError);

/**
 * v0.1.195 — configuración de la lista por el asistente/MCP: portal del
 * cliente, layout de la ficha, y las brechas de la auditoría (editar/
 * pausar/borrar automatizaciones y vistas, borrar lista, mover a carpeta,
 * listar tableros y ejecuciones). Postgres + Redis reales; el MCP se
 * conecta por transporte en memoria con el `Client` del SDK.
 */
describe('Asistente/MCP: portal, ficha y brechas de la auditoría (v0.1.195)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let mcp: McpService;
    let lists: ListsService;
    let fields: FieldsService;
    let views: ViewsService;
    let automations: AutomationsService;
    let connectors: ConnectorsService;
    let dashboards: DashboardsService;
    let tenantId: number;
    let adminId: number;
    let admin: AiToolContext;
    let client: Client;
    let publicLists: PublicListsService;

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps()));
        const plans = new PlansService(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const records = new RecordsService(
            tenantDb, new RecordsRepository(), lists, fields, rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists), new AutomationDispatcher(), new RelationsRepository(),
        );
        dashboards = new DashboardsService(tenantDb, null as never, records, fields);
        const blueprint = new BlueprintService(tenantDb, lists, fields, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        const store = new ProposalsStore(redis);
        const comments = new CommentsService(tenantDb, new CommentsRepository(), lists, records, rt);
        publicLists = new PublicListsService(pg.db, tenantDb, lists, null as never);
        connectors = new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const structure = new StructureTools(tenantDb, lists, fields, views, automations, dashboards, blueprint, store, connectors, comments, publicLists);
        const data = new DataTools(lists, fields, records, new AggregateService(tenantDb, lists, fields), store);
        const registry = new AiToolRegistry();
        structure.registerInto(registry);
        data.registerInto(registry);
        const proposals = new ProposalsService(store, new ConversationsStore(redis), structure, new AuditService(tenantDb), data);
        mcp = new McpService(registry, proposals);

        const [t] = await pg.db.insert(tenants).values({ slug: 'cfg', name: 'Config SA', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [ua] = await pg.db.insert(users).values({ email: 'admin@cfg.local', name: 'Admin', passwordHash: 'x' }).returning();
        adminId = ua!.id;
        await pg.db.insert(memberships).values([{ tenantId, userId: adminId, role: 'admin' }]);
        admin = { tenantId, userId: adminId, role: 'admin' };

        // Clientes (portal) + Facturas (relation → Clientes) + Tickets (campo user).
        const clientes = await lists.create(tenantId, { name: 'Clientes' });
        await fields.create(tenantId, String(clientes.id), { label: 'Nombre', type: 'text', is_required: true });
        await fields.create(tenantId, String(clientes.id), { label: 'Email', type: 'email' });
        await fields.create(tenantId, String(clientes.id), { label: 'Teléfono', type: 'phone' });
        await fields.create(tenantId, String(clientes.id), { label: 'Estado', type: 'select', config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'baja', label: 'Baja' }] } });
        await fields.create(tenantId, String(clientes.id), { label: 'Contrato', type: 'file' });
        const facturas = await lists.create(tenantId, { name: 'Facturas' });
        await fields.create(tenantId, String(facturas.id), { label: 'Número', type: 'text' });
        await fields.create(tenantId, String(facturas.id), { label: 'Monto', type: 'currency', config: { currency: 'USD' } });
        await fields.create(tenantId, String(facturas.id), { label: 'Cliente', type: 'relation', config: { target_list_id: clientes.id } });
        const tickets = await lists.create(tenantId, { name: 'Tickets' });
        await fields.create(tenantId, String(tickets.id), { label: 'Asunto', type: 'text' });
        await fields.create(tenantId, String(tickets.id), { label: 'Responsable', type: 'user' });
        await lists.create(tenantId, { name: 'Gastos' }); // sin vínculo: no debe aparecer como vinculable

        const server = mcp.buildServer(admin, 'full', '0.0.0-test');
        const [clientT, serverT] = InMemoryTransport.createLinkedPair();
        await server.connect(serverT);
        client = new Client({ name: 'spec', version: '0' });
        await client.connect(clientT);
    }, 180_000);

    afterAll(async () => {
        await client?.close();
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    const call = (name: string, args: Record<string, unknown> = {}): Promise<unknown> => client.callTool({ name, arguments: args });
    const apply = async (proposalId: unknown): Promise<Record<string, unknown>> => json(await call('apply_proposal', { proposal_id: proposalId }));

    it('get_list_schema expone portal, layout, publicación y listas vinculables', async () => {
        const schema = json(await call('get_list_schema', { list: 'clientes' }));
        expect(schema.portal).toEqual({ enabled: false, related_lists: [], linkable_lists: [{ slug: 'facturas', name: 'Facturas', via: 'relation' }, { slug: 'tickets', name: 'Tickets', via: 'user' }], template_blocks: [] });
        expect(schema.record_layout).toEqual({ layout: 'classic', template: null, custom_blocks: [] });
        expect(schema.public_sharing).toEqual({ enabled: false, expires_at: null, visible_fields: [] });
        expect((schema.list as { folder: unknown }).folder).toBeNull();
    });

    it('propose_configure_portal: valida contra el esquema real y al aplicar escribe settings.portal + el diseño v3 sin pisar el resto', async () => {
        // Antes: otra configuración en settings que NO debe perderse.
        const before = await lists.get(tenantId, 'clientes');
        await lists.update(tenantId, 'clientes', { settings: { ...before.settings, custom_flag: 'keep-me' } });

        const bad = await call('propose_configure_portal', { list: 'clientes', related_lists: ['gastos'] });
        expect(isError(bad)).toBe(true);
        expect(json(bad).error).toContain('no está vinculada');
        const badField = await call('propose_configure_portal', { list: 'clientes', blocks: [{ type: 'client_data', fields: ['dni'] }] });
        expect(isError(badField)).toBe(true);
        expect(json(badField).error).toContain('«dni» no existe');

        // El vocabulario anterior sigue valiendo: se convierte al diseño v3.
        const proposed = json(await call('propose_configure_portal', {
            list: 'clientes',
            related_lists: ['tickets'],
            blocks: [
                { type: 'hero', title: 'Hola, {{nombre}}' },
                { type: 'client_data', title: 'Tus datos', fields: ['nombre', 'email'] },
                { type: 'editable_form', fields: ['telefono'] },
                { type: 'related_records_table', list: 'facturas', fields: ['numero', 'monto'] },
                { type: 'download_files', field: 'contrato' },
            ],
        }));
        expect(proposed.ok).toBe(true);
        const p = proposed.proposal as { kind: string; destructive: boolean; preview: { changes: Array<{ label: string; to: string }>; blocks: unknown[] } };
        expect(p.kind).toBe('configure_portal');
        expect(p.destructive).toBe(false);
        expect(p.preview.blocks).toHaveLength(5);
        expect(p.preview.changes.find((c) => c.label === 'Portal')?.to).toBe('habilitado');
        expect(p.preview.changes.find((c) => c.label === 'Listas que ve el cliente')?.to).toBe('Tickets');
        expect((await lists.get(tenantId, 'clientes')).settings.portal).toBeUndefined();

        const applied = await apply(proposed.proposal_id);
        expect(applied.applied).toBe(true);
        const after = await lists.get(tenantId, 'clientes');
        type Blk = { type: string; config: Record<string, unknown> };
        const s = after.settings as { portal: { enabled: boolean; related_lists: number[] }; portal_template?: unknown; portal_layout_v3: { pages: Array<{ sections: Array<{ blocks: Blk[][] }> }> }; custom_flag: string };
        expect(s.custom_flag).toBe('keep-me');
        expect(s.portal.enabled).toBe(true);
        const tickets = await lists.get(tenantId, 'tickets');
        expect(s.portal.related_lists).toEqual([tickets.id]);
        expect(s.portal_template).toBeUndefined();
        const blocks = s.portal_layout_v3.pages.flatMap((pg) => pg.sections.flatMap((sec) => sec.blocks.flat()));
        expect(blocks.map((b) => b.type)).toEqual(['heading', 'fields', 'fields', 'related', 'files']);
        expect(blocks[2]!.config.editable).toBe(true);
        expect((blocks[3]!.config.source as { kind: string }).kind).toBe('related');

        // La lectura ahora lo muestra (el diseño, no la plantilla anterior).
        const schema = json(await call('get_list_schema', { list: 'clientes' }));
        const portalSchema = schema.portal as { enabled: boolean; related_lists: string[]; design: Array<{ blocks: string[] }> };
        expect(portalSchema.enabled).toBe(true);
        expect(portalSchema.related_lists).toEqual(['tickets']);
        expect(portalSchema.design[0]!.blocks.join(' ')).toContain('editables por el cliente');

        // Deshabilitar sin tocar el diseño: sólo `portal` cambia.
        const off = json(await call('propose_configure_portal', { list: 'clientes', enabled: false }));
        await apply(off.proposal_id);
        const s2 = (await lists.get(tenantId, 'clientes')).settings as typeof s;
        expect(s2.portal.enabled).toBe(false);
        expect(s2.portal_layout_v3.pages).toHaveLength(1);
        // Sin cambios → error corregible.
        const noop = await call('propose_configure_portal', { list: 'clientes', enabled: false });
        expect(isError(noop)).toBe(true);
    });

    it('propose_configure_portal con `design`: el portal en v3, editables, listas por persona y bloques que no existen en el portal (v0.1.233)', async () => {
        const notInPortal = await call('propose_configure_portal', {
            list: 'clientes',
            design: { pages: [{ name: 'Inicio', sections: [{ columns: [{ blocks: [{ type: 'portal_access' }] }] }] }] },
        });
        expect(isError(notInPortal)).toBe(true);
        expect(json(notInPortal).error).toContain('no existe en el portal');
        const all = await call('propose_configure_portal', {
            list: 'clientes',
            design: { pages: [{ name: 'Inicio', sections: [{ columns: [{ blocks: [{ type: 'chart', from: 'all', kind: 'kpi' }] }] }] }] },
        });
        expect(isError(all)).toBe(true);
        expect(json(all).error).toContain('sólo ve lo suyo');

        const proposed = json(await call('propose_configure_portal', {
            list: 'clientes',
            design: {
                header: { title_field: 'nombre' },
                page: { bg: '#f8fafc', max_width: 960 },
                pages: [
                    {
                        name: 'Inicio',
                        sections: [
                            {
                                columns: [
                                    { blocks: [{ type: 'fields', title: 'Tus datos', fields: ['email', 'telefono'], editable: true }] },
                                    { blocks: [{ type: 'chart', title: 'Facturado', from: 'facturas', kind: 'kpi', metric: 'sum', metric_field: 'monto' }] },
                                ],
                            },
                        ],
                    },
                    // Tickets se vincula al cliente por un campo persona (fuente `list`).
                    { name: 'Soporte', sections: [{ columns: [{ blocks: [{ type: 'related', from: 'tickets' }] }] }] },
                ],
            },
        }));
        expect(proposed.ok).toBe(true);
        const p = proposed.proposal as { destructive: boolean };
        // Ya había un diseño (el del test anterior): pisarlo se marca.
        expect(p.destructive).toBe(true);
        await apply(proposed.proposal_id);
        type Blk = { type: string; config: Record<string, unknown> };
        const v3 = (await lists.get(tenantId, 'clientes')).settings.portal_layout_v3 as {
            page: Record<string, unknown>;
            header: Record<string, unknown>;
            pages: Array<{ name: string; sections: Array<{ columns: number[]; blocks: Blk[][] }> }>;
        };
        expect(v3.page).toEqual({ bg: '#f8fafc', max_width: 960 });
        expect(v3.header.show_meta).toBe(false);
        expect(v3.pages.map((pg) => pg.name)).toEqual(['Inicio', 'Soporte']);
        expect(v3.pages[0]!.sections[0]!.columns).toEqual([6, 6]);
        expect(v3.pages[0]!.sections[0]!.blocks[0]![0]!.config.editable).toBe(true);
        const tickets = await lists.get(tenantId, 'tickets');
        expect(v3.pages[1]!.sections[0]!.blocks[0]![0]!.config.source).toEqual({ kind: 'list', list_id: tickets.id });
    });

    it('propose_configure_record_layout: integrada, personalizada y vuelta al clásico', async () => {
        const deal = json(await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', template: 'deal' }));
        await apply(deal.proposal_id);
        let s = (await lists.get(tenantId, 'clientes')).settings as Record<string, unknown>;
        expect(s.record_layout).toBe('crm');
        expect(s.crm_template_id).toBe('deal');
        expect(s.portal).toBeDefined(); // lo del portal sigue ahí

        const same = await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', template: 'deal' });
        expect(isError(same)).toBe(true);
        const needsCustom = await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', template: 'custom' });
        expect(isError(needsCustom)).toBe(true);
        expect(json(needsCustom).error).toContain('custom');

        const custom = json(await call('propose_configure_record_layout', {
            list: 'clientes',
            layout: 'crm',
            template: 'custom',
            custom: {
                header: { variant: 'compact', status_fields: ['estado'], quick_action_fields: ['email', 'telefono'] },
                groups: [{ label: 'Contacto', fields: ['email', 'telefono'] }],
                sidebar: { file_fields: ['contrato'] },
            },
        }));
        const pv = (custom.proposal as { preview: { blocks: Array<{ type: string; label: string }> } }).preview;
        // nombre (título), estado (header) y contrato (archivos del lateral) ya se ven en otro lado → no hay grupo "Otros datos".
        expect(pv.blocks.map((b) => b.type)).toEqual(['Cabecera', 'Grupo', 'Cifras', 'Archivos', 'Comentarios', 'Actividad']);
        await apply(custom.proposal_id);
        s = (await lists.get(tenantId, 'clientes')).settings as Record<string, unknown>;
        expect(s.crm_template_id).toBe('custom');
        const cfg = s.crm_template_custom as { v: number; header: { title_field_slug: string; status_field_slugs: string[] }; blocks: Array<{ type: string; config: Record<string, unknown> }> };
        expect(cfg.v).toBe(2);
        expect(cfg.header.title_field_slug).toBe('nombre');
        expect(cfg.header.status_field_slugs).toEqual(['estado']);
        expect(cfg.blocks[0]!.type).toBe('header');
        expect(cfg.blocks[1]!.config).toMatchObject({ label: 'Contacto', field_slugs: ['email', 'telefono'] });
        // v0.1.232 — la ficha lee el diseño v3: el custom se guarda ya convertido.
        expect((s.record_layout_v3 as { v: number }).v).toBe(3);
        const schema = json(await call('get_list_schema', { list: 'clientes' }));
        expect(schema.record_layout).toMatchObject({ layout: 'crm', template: 'design' });
        expect(JSON.stringify((schema.record_layout as { design: unknown }).design)).toContain('propiedades «Contacto»');

        const classic = json(await call('propose_configure_record_layout', { list: 'clientes', layout: 'classic' }));
        await apply(classic.proposal_id);
        s = (await lists.get(tenantId, 'clientes')).settings as Record<string, unknown>;
        expect(s.record_layout).toBe('classic');
        expect(s.crm_template_custom).toBeDefined(); // se conserva para volver
    });

    it('propose_configure_record_layout con `design`: ficha v3 con pestañas, formas por tipo y gráficos de vinculados (v0.1.232)', async () => {
        const schema = json(await call('get_list_schema', { list: 'clientes' }));
        expect(schema.linked_lists).toEqual([{ slug: 'facturas', name: 'Facturas', via: 'Cliente', direction: 'esa lista apunta a ésta' }]);

        const design = {
            theme: { preset: 'fresh' },
            header: { chip_fields: ['email'], stages_field: 'estado' },
            pages: [
                {
                    name: 'Resumen',
                    sections: [
                        { columns: [{ blocks: [{ type: 'fields', title: 'Contacto', fields: ['email', 'telefono'] }] }, { blocks: [{ type: 'field', field: 'estado', display: 'stages' }, { type: 'activity' }] }] },
                    ],
                },
                {
                    name: 'Facturas',
                    sections: [
                        {
                            columns: [
                                { blocks: [{ type: 'chart', title: 'Facturas', from: 'facturas', kind: 'kpi' }] },
                                { blocks: [{ type: 'chart', title: 'Facturado', from: 'facturas', kind: 'kpi', metric: 'sum', metric_field: 'monto', prefix: '$' }] },
                            ],
                        },
                        { columns: [{ blocks: [{ type: 'related', from: 'facturas', columns: ['numero', 'monto'], sort: 'monto', sort_dir: 'desc' }] }] },
                    ],
                },
            ],
        };
        const res = json(await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', design }));
        const prop = res.proposal as { destructive: boolean; preview: { blocks: Array<{ type: string }> } };
        expect(prop.destructive).toBe(true); // pisa el diseño que dejó el custom anterior
        expect(prop.preview.blocks.map((b) => b.type)).toEqual(['fields', 'field', 'activity', 'chart', 'chart', 'related']);
        await apply(res.proposal_id);

        const s = (await lists.get(tenantId, 'clientes')).settings as Record<string, unknown>;
        expect(s.record_layout).toBe('crm');
        const v3 = s.record_layout_v3 as { theme: { preset: string }; pages: Array<{ name: string; sections: Array<{ columns: number[]; blocks: Array<Array<{ type: string; config: Record<string, unknown> }>> }> }> };
        expect(v3.theme.preset).toBe('fresh');
        expect(v3.pages.map((p) => p.name)).toEqual(['Resumen', 'Facturas']);
        expect(v3.pages[0]!.sections[0]!.columns).toEqual([6, 6]);
        const facturas = await lists.get(tenantId, 'facturas');
        const fx = await fields.listByListId(tenantId, facturas.id);
        const rel = fx.find((f) => f.slug === 'cliente')!;
        const monto = fx.find((f) => f.slug === 'monto')!;
        const sum = v3.pages[1]!.sections[0]!.blocks[1]![0]!;
        expect(sum.config).toMatchObject({ source: { kind: 'related', field_id: rel.id, direction: 'reverse' }, kind: 'kpi', metric: 'sum', metric_field_id: monto.id, prefix: '$' });
        const table = v3.pages[1]!.sections[1]!.blocks[0]![0]!;
        expect(table.config).toMatchObject({ view: 'table', sort_field_id: monto.id, sort_dir: 'desc' });

        // Errores corregibles: lista no vinculada, gráfico agrupado sin campo, campo inexistente.
        const notLinked = await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', design: { pages: [{ name: 'X', sections: [{ columns: [{ blocks: [{ type: 'chart', from: 'gastos', kind: 'kpi' }] }] }] }] } });
        expect(isError(notLinked)).toBe(true);
        expect(json(notLinked).error).toContain('Vinculables: facturas');
        const noGroup = await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', design: { pages: [{ name: 'X', sections: [{ columns: [{ blocks: [{ type: 'chart', from: 'facturas', kind: 'pie' }] }] }] }] } });
        expect(json(noGroup).error).toContain('group_by');
        const badField = await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', design: { pages: [{ name: 'X', sections: [{ columns: [{ blocks: [{ type: 'field', field: 'nope' }] }] }] }] } });
        expect(json(badField).error).toContain('«nope» no existe');

        // Elegir una integrada saca el diseño (si no, el v3 guardado seguiría mandando).
        const back = json(await call('propose_configure_record_layout', { list: 'clientes', layout: 'crm', template: 'contact' }));
        await apply(back.proposal_id);
        const s2 = (await lists.get(tenantId, 'clientes')).settings as Record<string, unknown>;
        expect(s2.crm_template_id).toBe('contact');
        expect(s2.record_layout_v3).toBeUndefined();
    });

    it('automatizaciones: pausar por nombre, reemplazar acciones con validación de slugs, borrar; y leer ejecuciones', async () => {
        const created = json(await call('propose_create_automation', {
            list: 'clientes',
            name: 'Bienvenida',
            trigger_type: 'record_created',
            actions: [{ type: 'send_email', config: { to: '{{email}}', subject: 'Hola {{nombre}}', body: 'Bienvenido' } }],
        }));
        await apply(created.proposal_id);
        const [auto] = await automations.list(tenantId, 'clientes');
        expect(auto!.is_active).toBe(true);

        const pause = json(await call('propose_update_automation', { list: 'clientes', automation: 'Bienvenida', is_active: false }));
        expect((pause.proposal as { preview: { changes: Array<{ label: string; to: string }> } }).preview.changes).toEqual([{ label: 'Estado', from: 'Activa', to: 'Pausada' }]);
        await apply(pause.proposal_id);
        expect((await automations.get(tenantId, 'clientes', auto!.id)).is_active).toBe(false);

        const badSlug = await call('propose_update_automation', { list: 'clientes', automation: auto!.id, actions: [{ type: 'update_field', config: { values: { inexistente: 'x' } } }] });
        expect(isError(badSlug)).toBe(true);
        expect(json(badSlug).error).toContain('inexistente');

        const replaced = json(await call('propose_update_automation', {
            list: 'clientes',
            automation: auto!.id,
            name: 'Bienvenida v2',
            actions: [{ type: 'update_field', config: { values: { estado: 'activo' } } }],
        }));
        await apply(replaced.proposal_id);
        const updated = await automations.get(tenantId, 'clientes', auto!.id);
        expect(updated.name).toBe('Bienvenida v2');
        expect((updated.actions[0] as { type: string }).type).toBe('update_field');

        const runs = json(await call('list_automation_runs', { list: 'clientes', automation: 'Bienvenida v2' }));
        expect((runs.automation as { id: number }).id).toBe(auto!.id);
        expect(runs.runs).toEqual([]);

        const unknown = await call('propose_delete_automation', { list: 'clientes', automation: 'No existe' });
        expect(isError(unknown)).toBe(true);
        expect(json(unknown).error).toContain('Bienvenida v2');
        const del = json(await call('propose_delete_automation', { list: 'clientes', automation: auto!.id }));
        expect((del.proposal as { destructive: boolean }).destructive).toBe(true);
        await apply(del.proposal_id);
        expect(await automations.list(tenantId, 'clientes')).toEqual([]);
    });

    it('v0.1.242 — una acción que no existe o un conector mal armado no se propone; la tarjeta dice el nombre real', async () => {
        const conn = await connectors.create(admin.tenantId, admin.userId, 'admin', {
            provider: 'http',
            name: 'WhatsApp',
            base_url: 'https://was.example.com',
            auth_type: 'bearer',
            auth_key: '',
            token: 'tok-1234',
            headers: [],
            query_params: [],
            visibility: 'workspace',
            actions: [{
                key: 'send_text',
                label: 'Enviar mensaje de WhatsApp',
                method: 'POST',
                path: '/send',
                content_type: 'form',
                params: [
                    { key: 'recipient', label: 'Número', required: true },
                    { key: 'message', label: 'Mensaje', type: 'long_text', required: true },
                ],
            }],
        } as never);

        // Un tipo inventado: antes se guardaba y el editor lo mostraba como otra acción.
        const invented = await call('propose_create_automation', {
            list: 'clientes', name: 'X', trigger_type: 'record_created',
            actions: [{ type: 'set_field', config: { values: { estado: 'activo' } } }],
        });
        expect(isError(invented)).toBe(true);
        expect(json(invented).error).toMatch(/tipo desconocido «set_field».*update_field/);

        // Conector inexistente, acción inexistente, datos de más y de menos.
        const noConn = await call('propose_create_automation', {
            list: 'clientes', name: 'X', trigger_type: 'record_created',
            actions: [{ type: 'connector_action', config: { connection_id: 999999, action_key: 'send_text', values: {} } }],
        });
        expect(json(noConn).error).toContain(`${conn.id} «WhatsApp»: send_text`);
        const noAction = await call('propose_create_automation', {
            list: 'clientes', name: 'X', trigger_type: 'record_created',
            actions: [{ type: 'connector_action', config: { connection_id: conn.id, action_key: 'update_field', values: {} } }],
        });
        expect(json(noAction).error).toMatch(/no tiene la acción «update_field»/);
        const extra = await call('propose_create_automation', {
            list: 'clientes', name: 'X', trigger_type: 'record_created',
            actions: [{ type: 'connector_action', config: { connection_id: conn.id, action_key: 'send_text', values: { recipient: '1', message: 'm', estado: 'x' } } }],
        });
        expect(json(extra).error).toMatch(/no tiene los datos estado/);
        // También dentro de una rama si/sino.
        const nested = await call('propose_create_automation', {
            list: 'clientes', name: 'X', trigger_type: 'record_created',
            actions: [{ type: 'if_else', config: { condition: [], then_actions: [{ type: 'connector_action', config: { connection_id: conn.id, action_key: 'send_text', values: { recipient: '{{nombre}}' } } }], else_actions: [] } }],
        });
        expect(json(nested).error).toMatch(/le faltan datos obligatorios: message/);

        // Bien armada: la tarjeta nombra la acción y la conexión de verdad.
        const ok = json(await call('propose_create_automation', {
            list: 'clientes', name: 'Avisar', trigger_type: 'record_created',
            actions: [
                { type: 'update_field', config: { values: { estado: 'activo' } } },
                { type: 'connector_action', config: { connection_id: conn.id, action_key: 'send_text', values: { recipient: '+57300', message: 'Hola {{nombre}}' } } },
            ],
        }));
        const preview = (ok.proposal as { preview: { automation: { actions: string[] } } }).preview.automation;
        expect(preview.actions).toEqual(['Actualizar estado', 'Enviar mensaje de WhatsApp (WhatsApp)']);
        await apply(ok.proposal_id);
        const saved = (await automations.list(tenantId, 'clientes')).find((a) => a.name === 'Avisar')!;
        expect((saved.actions as Array<{ type: string }>).map((a) => a.type)).toEqual(['update_field', 'connector_action']);

        // Renombrar una automatización cuya conexión ya no existe no falla por eso.
        await connectors.remove(admin.tenantId, admin.userId, 'admin', conn.id, true);
        const rename = await call('propose_update_automation', { list: 'clientes', automation: saved.id, name: 'Avisar v2' });
        expect(isError(rename)).toBe(false);
        await apply(json(rename).proposal_id);
        await automations.remove(tenantId, 'clientes', saved.id);
    });

    it('v0.1.222 — automatización programada con «Editar en lote» por slug: se guarda con ids y horario', async () => {
        const created = json(await call('propose_create_automation', {
            list: 'clientes',
            name: 'Reactivar cada lunes',
            trigger_type: 'scheduled',
            trigger_config: { frequency: 'weekly', weekday: 1, hour: 8, tz: 'America/Bogota' },
            actions: [{
                type: 'bulk_edit',
                config: {
                    filters: [{ field: 'nombre', op: 'contains', value: 'Acme' }],
                    operations: [{ field: 'estado', op: 'set', value: 'activo' }, { field: 'nombre', op: 'append', text: ' (revisado)' }],
                },
            }],
        }));
        await apply(created.proposal_id);
        const auto = (await automations.list(tenantId, 'clientes')).find((a) => a.name === 'Reactivar cada lunes')!;
        const cfg = (auto.actions[0] as { config: Record<string, unknown> }).config;
        const ops = cfg.operations as Array<{ op: string; field_id: number }>;
        expect(ops.map((o) => o.op)).toEqual(['set', 'append']);
        expect(ops.every((o) => typeof o.field_id === 'number')).toBe(true);
        expect(cfg.filter_tree).toMatchObject({ type: 'group' });
        expect(auto.trigger_config).toMatchObject({ frequency: 'weekly', weekday: 1, hour: 8 });
        // Sin filtro ni all_records: error corregible.
        const noFilter = await call('propose_create_automation', {
            list: 'clientes', name: 'Todo', trigger_type: 'scheduled',
            actions: [{ type: 'bulk_edit', config: { operations: [{ field: 'nombre', op: 'trim' }] } }],
        });
        expect(isError(noFilter)).toBe(true);
        expect(json(noFilter).error).toMatch(/TODA la lista/);
    });

    it('vistas: renombrar, marcar por defecto, reemplazar filtros y borrar', async () => {
        const created = json(await call('propose_create_view', { list: 'clientes', view: { name: 'Activos', type: 'table', filters: [{ field: 'estado', op: 'eq', value: 'activo' }] } }));
        await apply(created.proposal_id);
        const [view] = (await views.list(tenantId, 'clientes')).filter((v) => v.name === 'Activos');
        expect(view).toBeDefined();

        const upd = json(await call('propose_update_view', { list: 'clientes', view: 'Activos', name: 'Clientes activos', is_default: true, config: { filters: [{ field: 'estado', op: 'neq', value: 'baja' }], sort: [{ field: 'nombre', dir: 'asc' }] } }));
        const changes = (upd.proposal as { preview: { changes: Array<{ label: string }> } }).preview.changes.map((c) => c.label);
        expect(changes).toEqual(['Nombre', 'Por defecto', 'Configuración']);
        await apply(upd.proposal_id);
        const after = (await views.list(tenantId, 'clientes')).find((v) => v.id === view!.id)!;
        expect(after.name).toBe('Clientes activos');
        expect(after.is_default).toBe(true);
        expect((after.config as { sort: unknown[] }).sort).toHaveLength(1);

        const badField = await call('propose_update_view', { list: 'clientes', view: view!.id, config: { filters: [{ field: 'nada', op: 'eq', value: 1 }] } });
        expect(isError(badField)).toBe(true);

        const del = json(await call('propose_delete_view', { list: 'clientes', view: view!.id }));
        await apply(del.proposal_id);
        expect((await views.list(tenantId, 'clientes')).some((v) => v.id === view!.id)).toBe(false);
    });

    it('propose_update_list mueve a una carpeta existente (y rechaza una inexistente); list_dashboards lee los tableros', async () => {
        const [g] = await pg.db.insert(listGroups).values({ tenantId, name: 'Comercial', position: 0 }).returning();
        const bad = await call('propose_update_list', { list: 'gastos', folder: 'Inexistente' });
        expect(isError(bad)).toBe(true);
        expect(json(bad).error).toContain('Comercial');
        const move = json(await call('propose_update_list', { list: 'gastos', folder: 'comercial' }));
        await apply(move.proposal_id);
        expect((await lists.get(tenantId, 'gastos')).group_id).toBe(g!.id);
        expect((json(await call('get_list_schema', { list: 'gastos' })).list as { folder: string }).folder).toBe('Comercial');
        const out = json(await call('propose_update_list', { list: 'gastos', folder: null }));
        await apply(out.proposal_id);
        expect((await lists.get(tenantId, 'gastos')).group_id).toBeNull();

        const dash = json(await call('propose_create_dashboard', { name: 'Resumen', widgets: [{ type: 'kpi', title: 'Clientes', list: 'clientes' }] }));
        await apply(dash.proposal_id);
        const listed = json(await call('list_dashboards'));
        expect((listed.dashboards as Array<{ name: string; widgets: Array<{ type: string; list: string }> }>).map((d) => ({ name: d.name, w: d.widgets[0] }))).toEqual([{ name: 'Resumen', w: { type: 'kpi', title: 'Clientes', list: 'clientes' } }]);
    });

    it('propose_delete_list es destructiva, describe lo que se lleva y al aplicar la lista desaparece', async () => {
        const del = json(await call('propose_delete_list', { list: 'gastos' }));
        const p = del.proposal as { destructive: boolean; summary: string; preview: { lists: Array<{ name: string }> } };
        expect(p.destructive).toBe(true);
        expect(p.summary).toContain('No se puede deshacer');
        expect(p.preview.lists[0]!.name).toBe('Gastos');
        await apply(del.proposal_id);
        expect((await lists.list(tenantId)).map((l) => l.slug).sort()).toEqual(['clientes', 'facturas', 'tickets']);
    });

    it('el scope read del MCP incluye las lecturas nuevas y ninguna propose_*', async () => {
        const server = mcp.buildServer(admin, 'read', '0.0.0-test');
        const [clientT, serverT] = InMemoryTransport.createLinkedPair();
        await server.connect(serverT);
        const read = new Client({ name: 'spec', version: '0' });
        await read.connect(clientT);
        const names = (await read.listTools()).tools.map((t) => t.name).sort();
        // v0.1.201 — las lecturas nuevas entran solas: el scope `read` es
        // "todo lo que no propone", no una lista que haya que mantener.
        expect(names).toEqual([
            'aggregate_records', 'get_list_schema', 'list_automation_runs', 'list_dashboards',
            'list_lists', 'list_members', 'list_record_comments', 'query_records',
        ]);
        await read.close();
    });
    /* ── v0.1.201 — últimas brechas: miembros, comentarios, ACL, publicar ── */

    it('list_members devuelve los ids que hacen falta para asignar y compartir', async () => {
        const out = json(await call('list_members'));
        const members = out.members as Array<{ id: number; email: string; role: string }>;
        expect(members.some((m) => m.id === adminId && m.role === 'admin')).toBe(true);
    });

    it('propose_set_list_permissions: por rol y por persona, con validación real', async () => {
        // Un campo que no existe no se puede ocultar.
        const badField = await call('propose_set_list_permissions', {
            list: 'clientes',
            roles: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['no_existe'] } },
        });
        expect(isError(badField)).toBe(true);
        expect(json(badField).error).toContain('«no_existe» no existe');

        // El alcance `assigned` exige un campo de tipo user.
        const badAssign = await call('propose_set_list_permissions', { list: 'clientes', assignment_field_slug: 'estado' });
        expect(isError(badAssign)).toBe(true);
        expect(json(badAssign).error).toContain('tipo user');

        // Sólo se comparte con MIEMBROS de la empresa.
        const intruso = await call('propose_set_list_permissions', {
            list: 'clientes',
            users: [{ user_id: 999_999, view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] }],
        });
        expect(isError(intruso)).toBe(true);
        expect(json(intruso).error).toContain('no es miembro');

        const ok = json(await call('propose_set_list_permissions', {
            list: 'clientes',
            roles: {
                agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['estado'] },
                viewer: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] },
            },
            users: [{ user_id: adminId, view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] }],
        }));
        const prop = ok.proposal as { destructive: boolean; preview: { changes: Array<{ label: string; to: string }> } };
        // Dejar a un rol sin acceso saca gente de golpe: pide confirmación.
        expect(prop.destructive).toBe(true);
        expect(prop.preview.changes.find((c) => c.label === 'Rol agent')?.to).toContain('ve lo propio');
        await apply(ok.proposal_id);

        const doc = await lists.getPermissions(tenantId, 'clientes');
        expect(doc.permissions.agent).toMatchObject({ view: 'own', create: true, fields_hidden: ['estado'] });
        expect(doc.permissions.viewer!.view).toBe('none');
        expect(doc.users.map((u) => u.user_id)).toEqual([adminId]);

        // SEC-31 (v0.1.228): sumar a OTRA persona no le quita el acceso a la
        // que ya estaba; y quitar exige nombrarla.
        const [ub] = await pg.db.insert(users).values({ email: 'bea@cfg.local', name: 'Bea', passwordHash: 'x' }).returning();
        await pg.db.insert(memberships).values({ tenantId, userId: ub!.id, role: 'agent' });
        const add = json(await call('propose_set_list_permissions', {
            list: 'clientes',
            users: [{ user_id: ub!.id, view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] }],
        }));
        await apply(add.proposal_id);
        const after = await lists.getPermissions(tenantId, 'clientes');
        expect(after.users.map((u) => u.user_id).sort()).toEqual([adminId, ub!.id].sort());

        const remove = json(await call('propose_set_list_permissions', { list: 'clientes', remove_users: [adminId] }));
        await apply(remove.proposal_id);
        const final = await lists.getPermissions(tenantId, 'clientes');
        expect(final.users.map((u) => u.user_id)).toEqual([ub!.id]);
    });

    it('SEC-31: aplicar la MISMA propuesta dos veces en paralelo la ejecuta una sola vez', async () => {
        const p = json(await call('propose_create_list', { lists: [{ name: 'Doble aplicación', fields: [{ label: 'Nombre', type: 'text' }] }] }));
        const [a, b] = await Promise.all([
            call('apply_proposal', { proposal_id: p.proposal_id }),
            call('apply_proposal', { proposal_id: p.proposal_id }),
        ]);
        const errors = [a, b].filter((r) => (r as { isError?: boolean }).isError === true);
        expect(errors).toHaveLength(1);
        const all = await lists.list(tenantId);
        expect(all.filter((l) => l.name === 'Doble aplicación')).toHaveLength(1);
    });

    it('propose_configure_public_sharing: publicar exige campos visibles y avisa que expone datos', async () => {
        const sinCampos = await call('propose_configure_public_sharing', { list: 'facturas', enabled: true });
        expect(isError(sinCampos)).toBe(true);
        expect(json(sinCampos).error).toContain('visible_fields');

        const campoMalo = await call('propose_configure_public_sharing', {
            list: 'facturas', enabled: true, visible_fields: ['no_existe'],
        });
        expect(isError(campoMalo)).toBe(true);

        const vistaMala = await call('propose_configure_public_sharing', {
            list: 'facturas', enabled: true, visible_fields: ['numero'], view: 'No existe',
        });
        expect(isError(vistaMala)).toBe(true);
        expect(json(vistaMala).error).toContain('No hay una vista');

        const ok = json(await call('propose_configure_public_sharing', {
            list: 'facturas', enabled: true, visible_fields: ['numero', 'monto'],
            allowed_domains: ['acme.test'], expires_at: '2030-01-01',
        }));
        const prop = ok.proposal as { destructive: boolean; summary: string };
        // Exponer datos al mundo SIEMPRE pide confirmación reforzada.
        expect(prop.destructive).toBe(true);
        expect(prop.summary).toContain('sin cuenta');
        const applied = await apply(ok.proposal_id);
        expect(String((applied.result as { message: string }).message)).toContain('publicada');

        const admin2 = await publicLists.getAdmin(tenantId, 'facturas');
        expect(admin2.enabled).toBe(true);
        expect(admin2.visible_field_slugs).toEqual(['numero', 'monto']);
        expect(admin2.allowed_domains).toEqual(['acme.test']);
        expect(admin2.token).not.toBe('');

        // Despublicar: el enlace deja de funcionar.
        const off = json(await call('propose_configure_public_sharing', { list: 'facturas', enabled: false }));
        await apply(off.proposal_id);
        expect((await publicLists.getAdmin(tenantId, 'facturas')).enabled).toBe(false);
    });
});
