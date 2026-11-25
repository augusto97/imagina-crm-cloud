import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocumentStarter, type DocDesign, type Field } from '@imagina-base/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { tenants, users } from '../src/db/schema';
import { DocumentsService } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };

/**
 * v0.1.468 — «Mostrar sólo los ítems que…» en la tabla de ítems de un
 * documento y la plantilla «Estado de cuenta»: el filtro se aplica en SQL,
 * los totales suman sólo lo filtrado, un campo que quien genera no ve no
 * filtra y una regla rota se ignora con un aviso.
 */
describe('v0.1.468 — estado de cuenta: tabla de ítems filtrada (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let docs: DocumentsService;
    let tenantId: number;
    let clientesId: number;
    let f: Record<string, Field>;
    let design: DocDesign;
    let acmeId: number;
    let alDiaId: number;

    const k = (key: string): string => `f${f[key]!.id}`;
    const render = (d: DocDesign, actor: Actor = admin, mode: 'real' | 'tags' = 'real', recordId?: number) =>
        tenantDb.withTenant(tenantId, (tx) =>
            docs.renderInTx(tx, { tenantId, actor, listId: clientesId, recordId: mode === 'real' ? (recordId ?? acmeId) : null, design: d, filename: 'x', mode }),
        );
    const withFilter = (tree: unknown): DocDesign => ({
        ...design,
        blocks: design.blocks.map((b) => (b.type === 'items' ? ({ ...b, filter_tree: tree } as typeof b) : b)),
    });
    const group = (...children: unknown[]) => ({ type: 'group', logic: 'and', children });

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const env = loadEnv({ FILES_SIGNING_SECRET: 'test-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-estado-'))), env);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, new AuditService(tenantDb));

        await pg.db.insert(users).values([
            { email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' },
            { email: 'beto@acme.test', passwordHash: 'x', name: 'Beto' },
        ]);
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'Acme', settings: { format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' } } })
            .returning();
        tenantId = t!.id;

        clientesId = (await lists.create(tenantId, { name: 'Clientes' })).id;
        await lists.create(tenantId, { name: 'Facturas' });
        f = {};
        const mk = async (list: string, def: Parameters<FieldsService['create']>[2]): Promise<void> => {
            f[def.slug as string] = await fieldsSvc.create(tenantId, list, def);
        };
        await mk('clientes', { label: 'Razón social', type: 'text', slug: 'razon' });
        await mk('clientes', { label: 'NIT', type: 'text', slug: 'nit' });
        await mk('facturas', { label: 'Número', type: 'text', slug: 'numero' });
        await mk('facturas', { label: 'Vence', type: 'date', slug: 'vence' });
        await mk('facturas', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: {
                options: [
                    { value: 'pendiente', label: 'Pendiente' },
                    { value: 'pagada', label: 'Pagada' },
                    { value: 'vencida', label: 'Vencida' },
                    { value: 'anulada', label: 'Anulada' },
                ],
            },
        });
        await mk('facturas', { label: 'Valor', type: 'currency', slug: 'valor', config: { currency: 'COP', precision: 0 } });
        await mk('facturas', { label: 'Saldo', type: 'currency', slug: 'saldo', config: { currency: 'COP', precision: 0 } });
        await mk('facturas', { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientesId } });

        const acme = await recs.create(tenantId, admin, 'clientes', { data: { [k('razon')]: 'Acme SAS', [k('nit')]: '900.111.222-3' } });
        acmeId = acme.id;
        const otro = await recs.create(tenantId, admin, 'clientes', { data: { [k('razon')]: 'Otro SAS' } });
        alDiaId = (await recs.create(tenantId, admin, 'clientes', { data: { [k('razon')]: 'Al Día SAS' } })).id;
        for (const [numero, vence, estado, valor, saldo, cliente] of [
            ['F-1', '2026-11-10', 'pendiente', 100000, 100000, acmeId],
            ['F-2', '2026-10-01', 'pagada', 200000, 0, acmeId],
            ['F-3', '2026-09-15', 'vencida', 50000, 50000, acmeId],
            ['F-4', '2026-12-01', 'anulada', 70000, 0, acmeId],
            ['F-5', '2026-12-20', null, 30000, 30000, acmeId],
            ['F-9', '2026-11-01', 'pendiente', 999000, 999000, otro.id],
            ['F-8', '2026-10-20', 'pagada', 120000, 0, alDiaId],
        ] as const) {
            await recs.create(tenantId, admin, 'facturas', {
                data: { [k('numero')]: numero, [k('vence')]: vence, [k('estado')]: estado, [k('valor')]: valor, [k('saldo')]: saldo, [k('cliente')]: [cliente] },
            });
        }

        design = buildDocumentStarter('estado_cuenta', {
            fields: { cliente: 'razon', cliente_doc: 'nit' },
            items: {
                source: { relation_field_id: f.cliente!.id, direction: 'reverse', list_id: f.numero!.list_id },
                fields: { numero: 'numero', vencimiento: 'vence', estado: 'estado', valor: 'valor', saldo: 'saldo' },
                info: { estado: f.estado, saldo: f.saldo },
            },
        }).design;
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('la plantilla trae sólo lo pendiente del cliente, ordenado por vencimiento, y el total pendiente de esas filas', async () => {
        const out = await render(design);
        expect(out.warnings).toEqual([]);
        const rows = out.content.items.items!;
        // F-2 (pagada) y F-4 (anulada) fuera; F-5 sin estado se sigue debiendo; F-9 es de otro cliente.
        expect(rows.map((r) => r[0])).toEqual(['F-3', 'F-1', 'F-5']);
        expect(out.content.totals).toMatchObject({ facturado: '$ 180.000', total: '$ 180.000' });
        // Sin filtro, la misma tabla traería las cinco de Acme.
        const all = await render(withFilter(null));
        expect(all.content.items.items!.map((r) => r[0])).toHaveLength(5);
        expect(all.content.totals.facturado).toBe('$ 450.000');
    });

    it('un cliente al día: la tabla filtrada queda vacía y el total pendiente es $ 0 (no «—»)', async () => {
        const out = await render(design, admin, 'real', alDiaId);
        expect(out.content.items.items).toEqual([]);
        expect(out.content.totals).toMatchObject({ total: '$ 0' });
        // Sin filtro, una tabla sin ítems sigue sin total (no hay nada cargado).
        const none = await render(withFilter(null), admin, 'real', alDiaId);
        expect(none.content.items.items!.map((r) => r[0])).toEqual(['F-8']);
    });

    it('el filtro sigue funcionando si se renombra el campo (va por id)', async () => {
        await fieldsSvc.update(tenantId, 'facturas', String(f.estado!.id), { label: 'Situación', slug: 'situacion' });
        try {
            const out = await render(design);
            expect(out.content.items.items!.map((r) => r[0])).toEqual(['F-3', 'F-1', 'F-5']);
            expect(out.warnings).toEqual([]);
        } finally {
            await fieldsSvc.update(tenantId, 'facturas', String(f.estado!.id), { label: 'Estado', slug: 'estado' });
        }
    });

    it('un campo que quien genera no ve no se puede usar para filtrar (se ignora con aviso)', async () => {
        await lists.updatePermissions(tenantId, 'clientes', {
            permissions: { agent: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });
        await lists.updatePermissions(tenantId, 'facturas', {
            permissions: { agent: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['saldo'] } },
        });
        const bySaldo = withFilter(group({ type: 'condition', field_id: f.saldo!.id, op: 'gt', value: 0 }));
        // Para quien sí ve el saldo, filtra: F-1, F-3 y F-5.
        expect((await render(bySaldo)).content.items.items!).toHaveLength(3);
        // Para el agente, la regla no se aplica (sería un oráculo del saldo).
        const out = await render(bySaldo, agent);
        expect(out.content.items.items!).toHaveLength(5);
        expect(out.warnings.some((w) => /«PENDIENTE DE PAGO».*«Saldo».*no puede ver/.test(w))).toBe(true);
    });

    it('una regla rota se ignora con un aviso y el resto del filtro se aplica; nunca rompe el PDF', async () => {
        const broken = withFilter(
            group(
                { type: 'condition', field_id: f.estado!.id, op: 'nin', value: ['pagada', 'anulada', 'archivada'] },
                { type: 'condition', field_id: 999_999, op: 'eq', value: 'x' }, // un campo borrado
                { type: 'condition', field_id: f.valor!.id, op: 'gt', value: 'mucho' }, // un valor que no sirve
                { type: 'condition', field_id: f.vence!.id, op: 'lt', value: '2026-02-31' }, // una fecha imposible
            ),
        );
        const out = await render(broken);
        expect(out.content.items.items!.map((r) => r[0])).toEqual(['F-3', 'F-1', 'F-5']);
        expect(out.warnings).toHaveLength(4);
        expect(out.warnings.join(' ')).toMatch(/campo que ya no existe/);
        expect(out.warnings.join(' ')).toMatch(/«Valor» no tiene un valor válido/);
        expect(out.warnings.join(' ')).toMatch(/se quitaron opciones que ya no existen/);

        // En el editor (sin registro) los avisos también salen.
        const tags = await render(broken, admin, 'tags');
        expect(tags.warnings).toHaveLength(4);

        // Un árbol mal armado guardado en la plantilla se lee como «sin filtro».
        const tpl = await docs.create(tenantId, admin.userId, 'clientes', {
            name: 'Rara',
            filename: 'x',
            design: withFilter({ type: 'group', logic: 'xor', children: 'nada' }),
            portal_visible: false,
        });
        const saved = await docs.get(tenantId, 'clientes', tpl.id);
        const items = saved.design.blocks.find((b) => b.type === 'items')!;
        expect(items.type === 'items' && items.filter_tree).toBeNull();
        expect((await render(saved.design)).content.items.items!).toHaveLength(5);
    });

    it('filtrar por fecha relativa y por «alguna» de las reglas', async () => {
        const overdue = withFilter({
            type: 'group',
            logic: 'or',
            children: [
                { type: 'condition', field_id: f.estado!.id, op: 'eq', value: 'Vencida' }, // por su etiqueta
                { type: 'condition', field_id: f.numero!.id, op: 'eq', value: 'F-5' },
            ],
        });
        const out = await render(overdue);
        expect(out.content.items.items!.map((r) => r[0])).toEqual(['F-3', 'F-5']);
        expect(out.warnings).toEqual([]);
        const past = await render(withFilter(group({ type: 'condition', field_id: f.vence!.id, op: 'between_relative', value: { from: '2026-09-01', to: '2026-10-31' } })));
        expect(past.content.items.items!.map((r) => r[0])).toEqual(['F-3', 'F-2']);
    });
});
