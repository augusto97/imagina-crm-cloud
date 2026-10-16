import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseEmailDesign, renderEmailHtml, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ConversationsStore } from '../src/ai/conversations.store';
import { McpService } from '../src/ai/mcp.service';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { DataTools } from '../src/ai/tools/data-tools';
import { buildDocDesign, buildEmailDesign } from '../src/ai/tools/design-builders';
import { AiToolError, AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { memberships, tenants, users } from '../src/db/schema';
import { DocumentsService } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { PublicListsService } from '../src/public-lists/public-lists.service';
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

const fieldRef = (id: number, slug: string, type: Field['type']): { id: number; slug: string; label: string; type: Field['type'] } => ({ id, slug, label: slug, type });

describe('v0.1.281 — constructores de diseño (puros)', () => {
    const fields = [fieldRef(1, 'nombre', 'text'), fieldRef(2, 'email', 'email'), fieldRef(3, 'total', 'currency'), fieldRef(4, 'estado', 'select')];

    it('correo: ids generados, texto sencillo → árbol, acento de la marca y slugs/variables validados', () => {
        const design = buildEmailDesign(
            {
                blocks: [
                    { type: 'heading', text: 'Hola {{nombre}}', level: 1, background: '#123456', color: '#ffffff' },
                    { type: 'text', text: 'Tu saldo es **{{total|pesos}}**.\n\n- uno\n- dos' },
                    { type: 'columns', columns: [{ blocks: [{ type: 'text', text: '*izq*' }] }, [{ type: 'button', label: 'Pagar', url: 'https://pago.co/{{record.id}}' }]] },
                    { type: 'fields', slugs: ['nombre', 'total'] },
                ],
            },
            { fields, brandColor: '#7c3aed' },
        );
        expect(design.theme.accent).toBe('#7c3aed');
        const ids = [design.blocks[0]!.id, design.blocks[1]!.id];
        expect(new Set(ids).size).toBe(2);
        const text = design.blocks[1]!;
        expect(text.type === 'text' && text.doc?.content?.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
        const cols = design.blocks[2]!;
        expect(cols.type === 'columns' && cols.columns[1]!.blocks[0]!.type).toBe('button');
        // El MISMO render del editor/motor lo dibuja.
        const html = renderEmailHtml(design, { resolve: (t) => t, fieldLabel: (s) => s, fieldValue: () => 'x' });
        expect(html).toContain('<strong');

        const accent = buildEmailDesign({ theme: { accent: '#00aa00' }, blocks: [{ type: 'spacer' }] }, { fields, brandColor: '#7c3aed' });
        expect(accent.theme.accent).toBe('#00aa00');

        expect(() => buildEmailDesign({ blocks: [{ type: 'fields', slugs: ['nope'] }] }, { fields })).toThrow(/no existen: nope/);
        expect(() => buildEmailDesign({ blocks: [{ type: 'text', text: 'Hola {{nadie}}' }] }, { fields })).toThrow(/\{\{nadie\}\}/);
        expect(() => buildEmailDesign({ blocks: [{ type: 'carrusel' }] }, { fields })).toThrow(AiToolError);
    });

    it('documento: la tabla de ítems por slug de la lista vinculada, totales y numeración validados', () => {
        const ctx = {
            fields: [...fields, fieldRef(5, 'numero', 'text')],
            relations: [
                { relation_field_id: 90, relation_slug: 'cuenta', direction: 'reverse' as const, other_list_id: 7, other_list_slug: 'lineas' },
                { relation_field_id: 91, relation_slug: 'cliente', direction: 'forward' as const, other_list_id: 8, other_list_slug: 'clientes' },
                { relation_field_id: 92, relation_slug: 'cliente_2', direction: 'forward' as const, other_list_id: 8, other_list_slug: 'clientes' },
            ],
            otherFields: new Map([
                [7, [fieldRef(70, 'detalle', 'text'), fieldRef(71, 'valor', 'currency')]],
                [8, [fieldRef(80, 'razon', 'text')]],
            ]),
        };
        const design = buildDocDesign(
            {
                numbering: { enabled: true, prefix: 'CC-', save_field: 'numero' },
                blocks: [
                    { type: 'header', title: 'CUENTA DE COBRO', number: 'N.º {{documento.numero}}' },
                    { id: 'tabla', type: 'items', from: 'lineas', columns: [{ slug: 'detalle', width: 'fill' }, { slug: 'valor', align: 'right' }] },
                    {
                        type: 'totals',
                        rows: [
                            { id: 'sub', label: 'Subtotal', source: { kind: 'items_sum', block_id: 'tabla', slug: 'valor' } },
                            { id: 'iva', label: 'IVA', source: { kind: 'percent', of: 'sub', pct: 19 } },
                            { id: 'tot', label: 'Total', source: { kind: 'sum', rows: ['sub', 'iva'] }, emphasis: true },
                        ],
                    },
                    { type: 'text', text: 'Son: {{total|pesos}}' },
                ],
            },
            ctx,
        );
        const items = design.blocks[1]!;
        expect(items.type === 'items' && items.source).toEqual({ relation_field_id: 90, direction: 'reverse', list_id: 7 });

        const base = (blocks: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): unknown => buildDocDesign({ blocks, ...extra }, ctx);
        expect(() => base([{ type: 'items', from: 'gastos', columns: [{ slug: 'x' }] }])).toThrow(/no está vinculada/);
        expect(() => base([{ type: 'items', from: 'clientes', columns: [{ slug: 'razon' }] }])).toThrow(/indica `via`/);
        expect(() => base([{ type: 'items', from: 'clientes', via: 'cliente_2', columns: [{ slug: 'razon' }] }])).not.toThrow();
        expect(() => base([{ type: 'items', from: 'lineas', columns: [{ slug: 'precio' }] }])).toThrow(/no existen en la lista vinculada/);
        expect(() => base([{ type: 'totals', rows: [{ id: 'a', label: 'A', source: { kind: 'items_sum', block_id: 'nada', slug: 'valor' } }] }])).toThrow(/no existe/);
        expect(() => base([{ type: 'totals', rows: [{ id: 'a', label: 'A', source: { kind: 'field', slug: 'estado' } }] }])).toThrow(/no es numérico/);
        expect(() => base([{ type: 'spacer' }], { numbering: { enabled: true, save_field: 'total' } })).toThrow(/campo de texto/);
    });
});

describe('v0.1.281 — correos y PDF diseñados por el asistente/MCP (Postgres + Redis)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let client: Client;
    let docs: DocumentsService;
    let automations: AutomationsService;
    let tenantId: number;
    let admin: AiToolContext;
    let cuentaId: number;

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', FILES_SIGNING_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' });
        const audit = new AuditService(tenantDb);
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const records = new RecordsService(
            tenantDb, new RecordsRepository(), lists, fields, rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists), new AutomationDispatcher(), new RelationsRepository(),
        );
        const dashboards = new DashboardsService(tenantDb, null as never, records, fields);
        const blueprint = new BlueprintService(tenantDb, lists, fields, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        const store = new ProposalsStore(redis);
        const comments = new CommentsService(tenantDb, new CommentsRepository(), lists, records, rt);
        const publicLists = new PublicListsService(pg.db, tenantDb, lists, null as never);
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-ai-docs-'))), env);
        docs = new DocumentsService(tenantDb, lists, fields, records, files, audit);
        const structure = new StructureTools(tenantDb, lists, fields, views, automations, dashboards, blueprint, store, connectors, comments, publicLists, docs);
        const data = new DataTools(lists, fields, records, new AggregateService(tenantDb, lists, fields), store);
        const registry = new AiToolRegistry();
        structure.registerInto(registry);
        data.registerInto(registry);
        const proposals = new ProposalsService(store, new ConversationsStore(redis), structure, audit, data);
        const mcp = new McpService(registry, proposals);

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'dsg', name: 'Diseños SA', plan: 'pro', settings: { branding: { primary_color: '#7c3aed' } } })
            .returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@dsg.local', name: 'Admin', passwordHash: 'x' }).returning();
        await pg.db.insert(memberships).values([{ tenantId, userId: u!.id, role: 'admin' }]);
        admin = { tenantId, userId: u!.id, role: 'admin' };

        const cuentas = await lists.create(tenantId, { name: 'Cuentas' });
        const fCliente = await fields.create(tenantId, 'cuentas', { label: 'Cliente', type: 'text', slug: 'cliente' });
        await fields.create(tenantId, 'cuentas', { label: 'Email', type: 'email', slug: 'email' });
        await fields.create(tenantId, 'cuentas', { label: 'Número', type: 'text', slug: 'numero' });
        await fields.create(tenantId, 'cuentas', { label: 'Total', type: 'currency', slug: 'total', config: { currency: 'COP', precision: 0 } });
        await lists.create(tenantId, { name: 'Líneas' });
        const fDetalle = await fields.create(tenantId, 'lineas', { label: 'Detalle', type: 'text', slug: 'detalle' });
        const fValor = await fields.create(tenantId, 'lineas', { label: 'Valor', type: 'currency', slug: 'valor', config: { currency: 'COP', precision: 0 } });
        const fCuenta = await fields.create(tenantId, 'lineas', { label: 'Cuenta', type: 'relation', slug: 'cuenta', config: { target_list_id: cuentas.id } });
        const actor = { userId: admin.userId, role: 'admin' as const };
        const cuenta = await records.create(tenantId, actor, 'cuentas', { data: { [`f${fCliente.id}`]: 'Beta Ltda.' } });
        cuentaId = cuenta.id;
        for (const [d, v] of [['Diseño', 200000], ['Hosting', 100000]] as const) {
            await records.create(tenantId, actor, 'lineas', { data: { [`f${fDetalle.id}`]: d, [`f${fValor.id}`]: v, [`f${fCuenta.id}`]: [cuentaId] } });
        }

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

    it('las herramientas nuevas están, y el scope de solo lectura sólo ve la de leer', async () => {
        const names = ((await client.listTools()).tools ?? []).map((t) => t.name);
        for (const n of ['get_document_template', 'propose_create_document_template', 'propose_update_document_template', 'propose_delete_document_template']) {
            expect(names).toContain(n);
        }
        const createAuto = (await client.listTools()).tools.find((t) => t.name === 'propose_create_automation')!;
        expect(createAuto.description).toContain('Diseño por BLOQUES del correo');
    });

    it('send_email con `design`: la propuesta lo valida, al aplicar queda el diseño del editor y se lee en formato sencillo', async () => {
        const bad = await call('propose_create_automation', {
            list: 'cuentas',
            name: 'Aviso',
            trigger_type: 'record_created',
            actions: [{ type: 'send_email', config: { to: '{{email}}', subject: 'Hola', design: { blocks: [{ type: 'fields', slugs: ['saldo'] }] } } }],
        });
        expect(isError(bad)).toBe(true);
        expect(json(bad).error).toContain('saldo');

        const res = json(
            await call('propose_create_automation', {
                list: 'cuentas',
                name: 'Cuenta emitida',
                trigger_type: 'record_created',
                actions: [
                    {
                        type: 'send_email',
                        config: {
                            to: '{{email}}',
                            subject: 'Tu cuenta {{numero}}',
                            preheader: 'Total {{total}}',
                            design: {
                                blocks: [
                                    { type: 'heading', text: 'Hola {{cliente}}', level: 1, align: 'center', color: '#ffffff', background: '#7c3aed', padding: 'lg' },
                                    { type: 'text', text: 'Te enviamos tu cuenta por **{{total|pesos}}**.' },
                                    { type: 'fields', slugs: ['numero', 'total'], lines: true },
                                    { type: 'button', label: 'Ver la cuenta', url: 'https://acme.co/c/{{record.id}}' },
                                    { type: 'divider' },
                                    { type: 'text', text: 'Gracias por confiar en nosotros.', size: 'sm', color: '#6b7280' },
                                ],
                            },
                        },
                    },
                ],
            }),
        );
        expect(res.ok).toBe(true);
        const applied = await apply(res.proposal_id);
        expect((applied.result as { message: string }).message).toContain('Cuenta emitida');

        const [auto] = await automations.list(tenantId, 'cuentas');
        const cfg = (auto!.actions[0] as { config: Record<string, unknown> }).config;
        expect(cfg.body_mode).toBe('design');
        expect(cfg.preheader).toBe('Total {{total}}');
        const design = parseEmailDesign(cfg.design)!;
        expect(design.theme.accent).toBe('#7c3aed');
        expect(design.blocks.map((b) => b.type)).toEqual(['heading', 'text', 'fields', 'button', 'divider', 'text']);

        // Lectura: el correo vuelve en el mismo vocabulario (texto sencillo).
        const schema = json(await call('get_list_schema', { list: 'cuentas' }));
        const read = (schema.automations as Array<{ actions: Array<{ config: { design: { blocks: Array<Record<string, unknown>> } } }> }>)[0]!.actions[0]!.config.design;
        expect(read.blocks[1]).toMatchObject({ type: 'text', text: 'Te enviamos tu cuenta por **{{total|pesos}}**.' });
        expect(read.blocks[1]!.doc).toBeUndefined();

        // …y lo leído se puede mandar de vuelta con un cambio.
        read.blocks[0]!.text = 'Buenas, {{cliente}}';
        const upd = json(
            await call('propose_update_automation', {
                list: 'cuentas',
                automation: 'Cuenta emitida',
                actions: [{ type: 'send_email', config: { to: '{{email}}', subject: 'Tu cuenta', design: read } }],
            }),
        );
        await apply(upd.proposal_id);
        const [again] = await automations.list(tenantId, 'cuentas');
        const d2 = parseEmailDesign((again!.actions[0] as { config: Record<string, unknown> }).config.design)!;
        expect(d2.blocks[0]!.type === 'heading' && d2.blocks[0]!.text).toBe('Buenas, {{cliente}}');
        expect(d2.blocks).toHaveLength(6);
    });

    it('plantilla de documento: crear, leer, cambiar y borrar; el PDF se arma con la tabla de los vinculados', async () => {
        const bad = await call('propose_create_document_template', {
            list: 'cuentas',
            name: 'Mala',
            design: { blocks: [{ type: 'items', from: 'gastos', columns: [{ slug: 'detalle' }] }] },
        });
        expect(isError(bad)).toBe(true);
        expect(json(bad).error).toContain('lineas');

        const res = json(
            await call('propose_create_document_template', {
                list: 'cuentas',
                name: 'Cuenta de cobro',
                filename: 'Cuenta {{documento.numero}}',
                design: {
                    numbering: { enabled: true, prefix: 'CC-', padding: 4, save_field: 'numero' },
                    footer: { text: 'Diseños SA · contacto@dsg.co', page_numbers: true },
                    blocks: [
                        { type: 'header', layout: 'split', logo: { kind: 'brand' }, company: 'Diseños SA\nNIT 900.1', title: 'CUENTA DE COBRO', number: 'N.º {{documento.numero}}', date: '{{date.today|larga}}' },
                        { type: 'fields', title: 'Cliente', slugs: ['cliente', 'email'], columns: 2 },
                        { id: 'lineas', type: 'items', from: 'lineas', columns: [{ slug: 'detalle', width: 'fill' }, { slug: 'valor', align: 'right' }] },
                        { type: 'totals', rows: [{ id: 'tot', label: 'Total', source: { kind: 'items_sum', block_id: 'lineas', slug: 'valor' }, emphasis: true }] },
                        { type: 'text', text: 'Son: **{{totales.tot|pesos}}**' },
                        { type: 'signature', signers: [{ name: 'Ana Pérez', detail: 'C.C. 1.234' }] },
                    ],
                },
            }),
        );
        expect(res.ok).toBe(true);
        await apply(res.proposal_id);
        const [summary] = await docs.list(tenantId, 'cuentas');
        expect(summary).toMatchObject({ name: 'Cuenta de cobro', next_label: 'CC-0001' });
        const tpl = await docs.get(tenantId, 'cuentas', summary!.id);
        expect(tpl.design.theme.accent).toBe('#7c3aed');
        const items = tpl.design.blocks.find((b) => b.type === 'items')!;
        expect(items.type === 'items' && items.source?.direction).toBe('reverse');

        // El PDF real: la tabla trae las dos líneas de ESTA cuenta.
        const pdf = await docs.preview(tenantId, { userId: admin.userId, role: 'admin' }, 'cuentas', { design: tpl.design, record_id: cuentaId, mode: 'real' });
        expect(Buffer.from(pdf.pdf, 'base64').subarray(0, 4).toString()).toBe('%PDF');
        expect(pdf.warnings).toEqual([]);

        // Lectura en el vocabulario del modelo.
        const read = json(await call('get_document_template', { list: 'cuentas', template: 'Cuenta de cobro' }));
        const blocks = (read.design as { blocks: Array<Record<string, unknown>> }).blocks;
        expect(blocks.find((b) => b.type === 'items')).toMatchObject({ from: 'lineas', via: 'cuenta' });
        expect(blocks.find((b) => b.type === 'text')).toMatchObject({ text: 'Son: **{{totales.tot|pesos}}**' });

        // Cambio: A4 + portal, mandando la versión completa leída.
        const design = read.design as Record<string, unknown>;
        (design.theme as Record<string, unknown>).page_size = 'a4';
        const upd = json(await call('propose_update_document_template', { list: 'cuentas', template: summary!.id, portal_visible: true, design }));
        expect(upd.ok).toBe(true);
        await apply(upd.proposal_id);
        const after = await docs.get(tenantId, 'cuentas', summary!.id);
        expect(after.design.theme.page_size).toBe('a4');
        expect(after.portal_visible).toBe(true);
        const after2 = after.design.blocks.find((b) => b.type === 'items')!;
        expect(after2.type === 'items' && after2.source).toEqual(items.type === 'items' ? items.source : null);

        // Borrar.
        const del = json(await call('propose_delete_document_template', { list: 'cuentas', template: 'Cuenta de cobro' }));
        await apply(del.proposal_id);
        expect(await docs.list(tenantId, 'cuentas')).toEqual([]);
    });

    it('sin color de marca el acento queda el del editor', async () => {
        await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
        const res = json(
            await call('propose_create_document_template', { list: 'cuentas', name: 'Simple', design: { blocks: [{ type: 'heading', text: 'Recibo' }] } }),
        );
        await apply(res.proposal_id);
        const [s] = await docs.list(tenantId, 'cuentas');
        expect((await docs.get(tenantId, 'cuentas', s!.id)).design.theme.accent).toBe('#0e7490');
    });
});
