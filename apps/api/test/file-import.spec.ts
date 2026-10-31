import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { and, eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiModelCatalogService, type ProviderModel } from '../src/ai/ai-model-catalog.service';
import { AiSettingsService } from '../src/ai/ai-settings.service';
import type { AiClientFactory } from '../src/ai/assistant.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import type { AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { auditLog, fields as fieldsTable, listGroups, lists as listsTable, memberships, records, relations, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { FileImportAiService, quotaKey } from '../src/file-import/file-import-ai.service';
import { mergeOptions } from '../src/file-import/file-import-ai-spec';
import { FileImportService } from '../src/file-import/file-import.service';
import { ListGroupsService } from '../src/lists/list-groups.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
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

function csv(headers: string[], rows: string[][]): string {
    const cell = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const CLIENTS = [
    ['Acme S.A.S.', 'compras@acme.co', '+57 300 111 2233', 'Bogotá'],
    ['Delta Ltda', 'pagos@delta.co', '+57 310 222 3344', 'Medellín'],
    ['Orbe SAS', 'admin@orbe.co', '+57 320 333 4455', 'Cali'],
    ['Nimbo', 'hola@nimbo.co', '+57 315 444 5566', 'Bogotá'],
];
const INVOICE_HEADERS = ['Factura N°', 'Cliente', 'Correo', 'Teléfono', 'Ciudad', 'Fecha', 'Subtotal', 'IVA', 'Total', 'ESTADO', 'País'];
function invoiceRows(n = 24): string[][] {
    const states = ['Pagada', 'PENDIENTE', 'pendiente', 'Vencida', 'Pagada '];
    return Array.from({ length: n }, (_, i) => {
        const c = CLIENTS[i % CLIENTS.length]!;
        const sub = 100000 + i * 1000;
        const iva = Math.round(sub * 0.19);
        return [`FV-${1000 + i}`, c[0]!, c[1]!, c[2]!, c[3]!, `${String((i % 27) + 1).padStart(2, '0')}/0${(i % 9) + 1}/2026`, String(sub), String(iva), String(sub + iva), states[i % states.length]!, 'Colombia'];
    });
}

type Turn = { input: unknown } | { text: string };
function fakeClient(script: Turn[]) {
    const calls: Array<{ model: string; messages: unknown[]; tools: Array<{ name: string }> }> = [];
    const factory: AiClientFactory = () =>
        ({
            messages: {
                stream: (p: (typeof calls)[number]) => {
                    calls.push(JSON.parse(JSON.stringify(p)) as (typeof calls)[number]);
                    const turn = script[calls.length - 1] ?? script[script.length - 1]!;
                    const content =
                        'input' in turn
                            ? [{ type: 'tool_use', id: `tu_${calls.length}`, name: 'submit_import_plan', input: turn.input }]
                            : [{ type: 'text', text: turn.text, citations: null }];
                    const final = {
                        id: `m${calls.length}`,
                        type: 'message',
                        role: 'assistant',
                        model: 'fake',
                        content,
                        stop_reason: 'input' in turn ? 'tool_use' : 'end_turn',
                        stop_sequence: null,
                        usage: { input_tokens: 800, output_tokens: 200 },
                    } as unknown as Message;
                    return { finalMessage: async () => final };
                },
            },
        }) as never;
    return { factory, calls };
}

const MODELS: ProviderModel[] = [
    { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true } } },
    { id: 'claude-haiku-9-0', display_name: 'Claude Haiku 9', created_at: '2030-01-01T00:00:00Z', capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true } } },
];

describe('v0.1.339 — mezclar opciones de la IA sin perder valores', () => {
    it('junta lo que la IA nombra y conserva lo que nadie reclamó', () => {
        const original = [
            { value: 'pagada', label: 'Pagada', aliases: ['Pagada', 'PAGADA'] },
            { value: 'pagado', label: 'Pagado', aliases: ['pagado'] },
            { value: 'pendiente', label: 'Pendiente', aliases: ['PENDIENTE'] },
            { value: 'otro_raro', label: 'Otro raro', aliases: [] },
        ];
        const out = mergeOptions(original, [
            { label: 'Pagada', color: 'green', from: ['Pagada', 'pagado'] },
            { label: 'Pendiente', color: 'amber', from: ['PENDIENTE'] },
        ]);
        expect(out.map((o) => o.label)).toEqual(['Pagada', 'Pendiente', 'Otro raro']);
        expect(out[0]!.aliases).toEqual(expect.arrayContaining(['pagado', 'PAGADA']));
        expect(out[2]!.color).toBeTruthy();
    });
});

describe('v0.1.339 — «Crear desde un archivo» (Postgres + Redis reales, modelo falso)', () => {
    let pg: TestPg;
    let rc: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fields: FieldsService;
    let blueprint: BlueprintService;
    let structure: StructureTools;
    let settings: AiSettingsService;
    let billing: BillingService;
    let audit: AuditService;
    let groups: ListGroupsService;
    let tenantId: number;
    let adminId: number;
    let admin: AiToolContext;

    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AI_API_KEY: '' });

    function services(script: Turn[] = []): { svc: FileImportService; ai: FileImportAiService; calls: ReturnType<typeof fakeClient>['calls'] } {
        const fake = fakeClient(script);
        const ai = new FileImportAiService(settings, audit, redis, fake.factory);
        const svc = new FileImportService(tenantDb, lists, groups, fields, blueprint, structure, billing, new RealtimeService(), audit, ai, redis);
        return { svc, ai, calls: fake.calls };
    }

    beforeAll(async () => {
        [pg, rc] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(rc.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        audit = new AuditService(tenantDb);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const autos = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const dash = new DashboardsService(tenantDb, null as never, null as never, null as never);
        blueprint = new BlueprintService(tenantDb, lists, fields, views, autos, new RecordsRepository(), new RelationsRepository(), billing, rt, dash);
        const catalogs = new AiModelCatalogService(redis, async () => [...MODELS]);
        catalogs.memoMs = 0;
        settings = new AiSettingsService(redis, pg.db, env, catalogs);
        structure = new StructureTools(tenantDb, lists, fields, views, autos, dash, blueprint, new ProposalsStore(redis), connectors, null as never, null as never);
        groups = new ListGroupsService(tenantDb);
        const [a] = await pg.db.insert(users).values([{ email: 'ana@archivo.test', name: 'Ana', passwordHash: 'x' }]).returning();
        adminId = a!.id;
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), rc?.stop()]);
    });

    let n = 0;
    beforeEach(async () => {
        n += 1;
        const [t] = await pg.db.insert(tenants).values({ slug: `archivo-${n}`, name: `Archivo ${n}`, plan: 'pro', status: 'active' }).returning();
        tenantId = t!.id;
        await pg.db.insert(memberships).values([{ tenantId, userId: adminId, role: 'admin' }]);
        admin = { tenantId, userId: adminId, role: 'admin' };
        await redis.flushdb();
        await settings.updatePlatform({ enabled: true, api_key: 'sk-ant-plataforma-0000000000000000', share_platform_key: true, allow_tenant_keys: true });
    });

    const invoiceInput = () => ({ file_name: 'facturacion_octubre.csv', source: 'csv' as const, sheets: [{ name: '', csv: csv(INVOICE_HEADERS, invoiceRows()) }] });

    async function rowsOf(listId: number) {
        return withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
    }
    /** La bitácora se escribe sin esperar (best-effort): se espera a que aparezca. */
    async function auditOf(action: string) {
        for (let i = 0; i < 40; i++) {
            const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), inArray(auditLog.action, [action]))));
            if (rows.length > 0) return rows;
            await new Promise((r) => setTimeout(r, 25));
        }
        return [];
    }
    async function fieldsOf(listId: number) {
        return withTenant(pg.db, tenantId, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.listId, listId)));
    }

    it('analiza y crea: la hoja de facturas y sus clientes en otra lista, vinculados, en una carpeta', async () => {
        const { svc } = services();
        const analysis = await svc.analyze(admin, invoiceInput());
        expect(analysis.ai).toMatchObject({ available: true, remaining: 3 });
        expect(analysis.plan.entities).toHaveLength(1);
        expect(analysis.limit.planned).toBe(24 + 4);
        expect(analysis.sheets[0]!.preview).toHaveLength(5);
        expect(analysis.defaults).toEqual({ currency: 'COP', country: 'CO' });

        const res = await svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, file_name: 'facturacion_octubre.csv', source: 'csv', sheets: invoiceInput().sheets });
        expect(res.lists.map((l) => [l.name, l.records])).toEqual([
            ['Facturacion octubre', 24],
            ['Clientes', 4],
        ]);
        expect(res).toMatchObject({ imported: 28, linked: 24, unmatched_links: 0, left_out: 0, cell_warnings_total: 0 });
        expect(res.group_id).not.toBeNull();
        const [folder] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(listGroups).where(eq(listGroups.id, res.group_id!)));
        expect(folder!.name).toBe('Facturacion octubre');

        const facturas = res.lists[0]!;
        const fs = await fieldsOf(facturas.id);
        const bySlug = new Map(fs.map((f) => [f.slug, f]));
        expect([...bySlug.keys()]).not.toContain('total');
        expect([...bySlug.keys()]).not.toContain('correo');
        expect(bySlug.get('cliente')!.type).toBe('relation');
        expect(bySlug.get('subtotal')).toMatchObject({ type: 'currency' });
        const estado = bySlug.get('estado')!;
        expect((estado.config as { options: Array<{ value: string }> }).options.map((o) => o.value)).toEqual(expect.arrayContaining(['pagada', 'pendiente', 'vencida']));
        const rows = await rowsOf(facturas.id);
        const first = rows.find((r) => r.data[`f${bySlug.get('factura_n')!.id}`] === 'FV-1000')!;
        expect(first.data[`f${bySlug.get('subtotal')!.id}`]).toBe(100000);
        expect(first.data[`f${bySlug.get('fecha')!.id}`]).toBe('2026-01-01');
        expect(first.data[`f${estado.id}`]).toBe('pagada');
        // «PENDIENTE» y «pendiente» cayeron en la misma opción.
        expect(new Set(rows.map((r) => r.data[`f${estado.id}`]))).toEqual(new Set(['pagada', 'pendiente', 'vencida']));

        const clientes = res.lists[1]!;
        const cfs = new Map((await fieldsOf(clientes.id)).map((f) => [f.slug, f]));
        const crows = await rowsOf(clientes.id);
        const acme = crows.find((r) => r.data[`f${cfs.get('nombre')!.id}`] === 'Acme S.A.S.')!;
        expect(acme.data[`f${cfs.get('correo')!.id}`]).toBe('compras@acme.co');
        const links = await withTenant(pg.db, tenantId, (tx) => tx.select().from(relations).where(and(eq(relations.fieldId, bySlug.get('cliente')!.id), eq(relations.targetRecordId, acme.id))));
        expect(links).toHaveLength(6);

        const logs = await auditOf('file_import.apply');
        expect(logs[0]!.meta).toMatchObject({ records: 28, linked: 24, ai_used: false });

        // No se crea dos veces.
        await expect(svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, file_name: 'x.csv', source: 'csv', sheets: invoiceInput().sheets })).rejects.toMatchObject({
            response: { code: 'file_import_already_applied' },
        });
    });

    it('duplicados, celdas que no entran y nombres que ya existen', async () => {
        await lists.create(tenantId, { name: 'Contactos' });
        const { svc } = services();
        const rows = [
            ['Ana Gómez', 'ana@x.co', '15/03/2026'],
            ['Beto Ruiz', 'no-es-un-correo', '16/03/2026'],
            ['Ana Gómez', 'ana@x.co', '15/03/2026'],
            ['Carla Díaz', 'carla@x.co', '31/02/2026'],
            ['Dani Paz', 'dani@x.co', '17/03/2026'],
        ];
        const input = { file_name: 'contactos.csv', source: 'csv' as const, sheets: [{ name: '', csv: csv(['Nombre', 'Email', 'Alta'], rows) }] };
        const analysis = await svc.analyze(admin, input);
        const list = analysis.plan.lists[0]!;
        expect(list.skip_duplicates).toBe(true);
        expect(list.fields.map((f) => f.type)).toEqual(['text', 'email', 'date']);
        const res = await svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, ...input });
        expect(res.lists[0]!.name).toBe('Contactos 2');
        expect(res).toMatchObject({ imported: 4, skipped_duplicates: 1 });
        // El correo malo y la fecha imposible se informan por celda; las filas entran igual.
        expect(res.cell_warnings.map((w) => [w.row, w.field])).toEqual(expect.arrayContaining([[3, 'Email'], [5, 'Alta']]));
        expect((await rowsOf(res.lists[0]!.id)).length).toBe(4);
    });

    it('dos hojas: la columna que nombra registros de la otra hoja queda vinculada', async () => {
        const { svc } = services();
        const cRows = CLIENTS.map((c) => [c[0]!, c[1]!]).concat([['Zeta SAS', 'z@zeta.co']]);
        const pRows = Array.from({ length: 12 }, (_, i) => [`P-${i + 1}`, cRows[i % cRows.length]![0]!.toUpperCase(), String(50000 + i)]);
        pRows.push(['P-99', 'Desconocido SAS', '1']);
        const input = {
            file_name: 'ventas.xlsx',
            source: 'xlsx' as const,
            sheets: [
                { name: 'Clientes', csv: csv(['Nombre', 'Email'], cRows) },
                { name: 'Pedidos', csv: csv(['Pedido', 'Cliente', 'Valor'], pRows) },
            ],
        };
        const analysis = await svc.analyze(admin, input);
        expect(analysis.plan.links).toHaveLength(1);
        const res = await svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, ...input });
        expect(res.lists.map((l) => l.name)).toEqual(['Clientes', 'Pedidos']);
        expect(res.linked).toBe(12);
        expect(res.unmatched_links).toBe(1);
        expect(res.warnings.join(' ')).toMatch(/Desconocido SAS/);
    });

    it('el límite del plan: sin elegir, se rechaza; eligiendo, entran los primeros', async () => {
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        const { svc } = services();
        const big = Array.from({ length: 600 }, (_, i) => [`Item ${i}`, String(i)]);
        const input = { file_name: 'items.csv', source: 'csv' as const, sheets: [{ name: '', csv: csv(['Nombre', 'Cantidad'], big) }] };
        const analysis = await svc.analyze(admin, input);
        expect(analysis.limit.remaining).toBe(500);
        expect(analysis.limit.planned).toBe(600);
        await expect(svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, ...input })).rejects.toMatchObject({ response: { code: 'plan_limit_reached' } });
        const res = await svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, ...input, max_records: 500 });
        expect(res).toMatchObject({ imported: 500, left_out: 100 });
    });

    it('un archivo distinto del analizado se rechaza; un plan con errores también', async () => {
        const { svc } = services();
        const analysis = await svc.analyze(admin, invoiceInput());
        const other = { ...invoiceInput(), sheets: [{ name: '', csv: csv(INVOICE_HEADERS, invoiceRows(10)) }] };
        await expect(svc.apply(admin, { analysis_id: analysis.id, plan: analysis.plan, ...other })).rejects.toMatchObject({ response: { code: 'file_import_changed' } });
        const plan = structuredClone(analysis.plan);
        plan.lists[0]!.fields.find((f) => f.column === plan.lists[0]!.title_column)!.include = false;
        await expect(svc.apply(admin, { analysis_id: analysis.id, plan, ...invoiceInput() })).rejects.toMatchObject({ response: { code: 'file_import_invalid_plan' } });
        const lst = await withTenant(pg.db, tenantId, (tx) => tx.select().from(listsTable).where(eq(listsTable.tenantId, tenantId)));
        expect(lst).toHaveLength(0);
    });

    it('la IA afina el borrador con un resumen protegido, usa el cupo propio y lo devuelve si falla', async () => {
        await settings.updatePlatform({ import_ai_monthly: 2 });
        const out = {
            kind: 'invoices',
            summary: 'Facturas de octubre con sus clientes en otra lista.',
            lists: [{ sheet: 0, name: 'Facturas' }],
            columns: [
                { sheet: 0, column: 0, label: 'Número de factura' },
                {
                    sheet: 0,
                    column: 9,
                    options: [
                        { label: 'Pagada', color: 'green', from: ['Pagada', 'Pagada '] },
                        { label: 'Pendiente', color: 'amber', from: ['PENDIENTE', 'pendiente'] },
                        { label: 'Vencida', color: 'red', from: ['Vencida'] },
                    ],
                },
                { sheet: 0, column: 7, include: false, reason: 'El IVA se puede calcular.' },
                { sheet: 0, column: 40, label: 'No existe' },
            ],
            entities: [{ sheet: 0, key_column: 1, include: true, name: 'Clientes' }],
            links: [],
        };
        const { svc, ai, calls } = services([{ input: { kind: 'no-existe' } }, { input: out }]);
        const analysis = await svc.analyze(admin, invoiceInput());
        await ai.start(admin, analysis.id);
        await ai.settle(analysis.id);
        const job = await ai.get(tenantId, adminId, analysis.id);
        expect(job.state).toBe('done');
        expect(job.plan!.ai_used).toBe(true);
        expect(job.plan!.lists[0]!.name).toBe('Facturas');
        const f0 = job.plan!.lists[0]!.fields[0]!;
        expect(f0).toMatchObject({ label: 'Número de factura', slug: 'numero_de_factura', ai: true });
        expect(job.plan!.lists[0]!.fields[7]!.include).toBe(false);
        expect(calls).toHaveLength(2);
        expect(calls[0]!.model).toBe('claude-haiku-9-0');
        // El resumen protegido: ni correos, ni teléfonos, ni nombres de clientes.
        const sent = JSON.stringify(calls[0]!.messages);
        expect(sent).not.toMatch(/acme\.co|300 111|Acme S\.A\.S\.|FV-1000/);
        expect(sent).toContain('[correo]');
        expect(sent).toContain('PENDIENTE'); // las categorías sí viajan
        expect(Number(await redis.get(quotaKey(tenantId)))).toBe(1);

        // Dos clics no gastan dos lugares; el plan de la IA se crea igual que el borrador.
        await ai.start(admin, analysis.id);
        expect(Number(await redis.get(quotaKey(tenantId)))).toBe(1);
        const res = await svc.apply(admin, { analysis_id: analysis.id, plan: job.plan!, ...invoiceInput() });
        expect(res.lists[0]!.name).toBe('Facturas');
        const logs = await auditOf('file_import.ai_request');
        expect(logs[0]!.meta).toMatchObject({ consent: true, key: 'platform' });

        // Una respuesta que no sirve dos veces: error claro y el cupo se devuelve.
        const bad = services([{ text: 'no sé' }]);
        const a2 = await bad.svc.analyze(admin, invoiceInput());
        await bad.ai.start(admin, a2.id);
        await bad.ai.settle(a2.id);
        expect(await bad.ai.get(tenantId, adminId, a2.id)).toMatchObject({ state: 'error', error: { code: 'invalid_plan' } });
        expect(Number(await redis.get(quotaKey(tenantId)))).toBe(1);

        // Cupo agotado: dice por qué y sugiere la clave propia.
        await redis.set(quotaKey(tenantId), '2');
        const a3 = await bad.svc.analyze(admin, invoiceInput());
        expect(a3.ai).toMatchObject({ available: false, remaining: 0 });
        await expect(bad.ai.start(admin, a3.id)).rejects.toMatchObject({ response: { code: 'file_import_ai_quota' } });
    });

    it('sin el módulo de IA del plan igual se puede (cupo propio); con 0 en la plataforma, no', async () => {
        const { svc } = services();
        await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
        const a = await svc.analyze(admin, invoiceInput());
        expect(a.ai.available).toBe(true);
        await settings.updatePlatform({ import_ai_monthly: 0 });
        const b = await svc.analyze(admin, invoiceInput());
        expect(b.ai).toMatchObject({ available: false, reason: expect.stringMatching(/no está activado/) });
        // Un agente sin «usar el asistente» no la ve.
        const agent = { tenantId, userId: adminId, role: 'viewer' as const };
        expect((await services().ai.availability(agent)).available).toBe(false);
        const all = await pg.db.select().from(memberships).where(eq(memberships.tenantId, tenantId));
        expect(all).toHaveLength(1);
    });
});
