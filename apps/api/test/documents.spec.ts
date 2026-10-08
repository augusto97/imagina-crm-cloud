import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocumentStarter, type DocDesign, type DocTotalRow, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { attachments, documentTemplates, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { computeTotalRows } from '../src/documents/document-totals';
import { DocumentsService, resolveDocTemplate, sanitizeFilename, type DocTagContext } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

const admin: Actor = { userId: 1, role: 'admin' };

describe('v0.1.266 — documentos PDF (puro)', () => {
    const ctx = (over: Partial<DocTagContext> = {}): DocTagContext => ({
        recordId: 42,
        today: '2026-10-08',
        tenantName: 'Acme',
        raw: (s) => ({ valor: 1250000, cliente: 'Beta Ltda.', fecha: '2026-01-31' })[s],
        format: (s, v) => (s === 'valor' ? `$ ${Number(v).toLocaleString('es-CO')}` : String(v ?? '')),
        hasField: (s) => ['valor', 'cliente', 'fecha'].includes(s),
        field: (s) => ({ type: s === 'valor' ? 'currency' : s === 'fecha' ? 'date' : 'text', config: {} }),
        totals: (id) => (id === 'total' ? 1250000 : undefined),
        money: (n) => `$ ${n.toLocaleString('es-CO')}`,
        dateFormat: (ymd) => ymd.split('-').reverse().join('/'),
        ...over,
    });

    it('variables legibles por defecto, |value crudo, en letras y fechas largas', () => {
        expect(resolveDocTemplate('{{cliente}} debe {{valor}}', ctx())).toBe('Beta Ltda. debe $ 1.250.000');
        expect(resolveDocTemplate('{{valor|value}}', ctx())).toBe('1250000');
        expect(resolveDocTemplate('Son: {{totales.total|pesos|mayusculas}}', ctx())).toBe('Son: UN MILLÓN DOSCIENTOS CINCUENTA MIL PESOS');
        expect(resolveDocTemplate('Medellín, {{date.today|larga}}', ctx())).toBe('Medellín, 8 de octubre de 2026');
        expect(resolveDocTemplate('{{fecha|+1m}}', ctx())).toBe('28/02/2026');
        expect(resolveDocTemplate('N.º {{record.id}} · {{empresa.nombre}} · {{no_existe}}', ctx())).toBe('N.º 42 · Acme · ');
    });

    it('totales: porcentajes, sumas con restas y filas que se referencian en cualquier orden, sin ciclos', () => {
        const rows: DocTotalRow[] = [
            { id: 'total', label: 'Total', emphasis: true, source: { kind: 'sum', rows: ['sub', 'iva'], minus: ['rete'] } },
            { id: 'sub', label: 'Subtotal', emphasis: false, source: { kind: 'items_sum', block_id: 'items', slug: 'valor' } },
            { id: 'iva', label: 'IVA 19 %', emphasis: false, source: { kind: 'percent', of: 'sub', pct: 19 } },
            { id: 'rete', label: 'Retención', emphasis: false, source: { kind: 'percent', of: 'sub', pct: 4 } },
            { id: 'loop', label: 'Ciclo', emphasis: false, source: { kind: 'percent', of: 'loop', pct: 10 } },
        ] as DocTotalRow[];
        const out = computeTotalRows(rows, {
            itemsSum: () => 1000,
            fieldNumber: () => null,
            resolve: (t) => t,
        });
        const by = Object.fromEntries(out.map((r) => [r.id, r.num]));
        expect(by).toEqual({ total: 1150, sub: 1000, iva: 190, rete: 40, loop: null });
    });

    it('el nombre del archivo no rompe el sistema de archivos ni termina en punto', () => {
        expect(sanitizeFilename('Cuenta 7 - Beta Ltda.')).toBe('Cuenta 7 - Beta Ltda.pdf');
        expect(sanitizeFilename('../../etc/pass<wd>')).not.toMatch(/[/<>]/);
    });
});

describe('v0.1.266 — documentos PDF (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let docs: DocumentsService;
    let automations: AutomationsService;
    let engine: AutomationEngine;
    let mailbox: CapturingMailTransport;
    let tenantId: number;
    let otherTenant: number;
    let cobrosId: number;
    let itemsId: number;
    let f: Record<string, Field>;
    let design: DocDesign;
    let cobroId: number;

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
        const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-docs-')));
        const files = new FilesService(tenantDb, storage, env);
        const audit = new AuditService(tenantDb);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, storage, audit);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), noHooks, connectors);
        mailbox = new CapturingMailTransport();
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), mailbox),
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            docs,
        );

        // El actor existe de verdad (FK de attachments.created_by): base nueva → id 1.
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        expect(u!.id).toBe(admin.userId);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;

        cobrosId = (await lists.create(tenantId, { name: 'Cobros' })).id;
        itemsId = (await lists.create(tenantId, { name: 'Ítems' })).id;
        f = {};
        f.cliente = await fieldsSvc.create(tenantId, 'cobros', { label: 'Cliente', type: 'text', slug: 'cliente' });
        f.nit = await fieldsSvc.create(tenantId, 'cobros', { label: 'NIT', type: 'text', slug: 'nit' });
        f.documento = await fieldsSvc.create(tenantId, 'cobros', { label: 'Documento', type: 'file', slug: 'documento' });
        f.detalle = await fieldsSvc.create(tenantId, 'items', { label: 'Detalle', type: 'text', slug: 'detalle' });
        f.cantidad = await fieldsSvc.create(tenantId, 'items', { label: 'Cantidad', type: 'number', slug: 'cantidad' });
        f.valor = await fieldsSvc.create(tenantId, 'items', { label: 'Valor', type: 'currency', slug: 'valor', config: { currency: 'COP', precision: 0 } });
        f.cuenta = await fieldsSvc.create(tenantId, 'items', { label: 'Cuenta', type: 'relation', slug: 'cuenta', config: { target_list_id: cobrosId } });

        design = buildDocumentStarter('cuenta_cobro_detalle', {
            fields: { cliente: 'cliente', cliente_doc: 'nit' },
            items: {
                source: { relation_field_id: f.cuenta!.id, direction: 'reverse', list_id: itemsId },
                fields: { descripcion: 'detalle', cantidad: 'cantidad', total: 'valor' },
            },
        }).design;

        const cobro = await recs.create(tenantId, admin, 'cobros', { data: { [`f${f.cliente!.id}`]: 'Beta Ltda.', [`f${f.nit!.id}`]: '900.123.456-7' } });
        cobroId = cobro.id;
        for (const [detalle, valor] of [['Diseño', 200000], ['Hosting', 100000], ['Soporte', 50000]] as const) {
            await recs.create(tenantId, admin, 'items', {
                data: { [`f${f.detalle!.id}`]: detalle, [`f${f.cantidad!.id}`]: 1, [`f${f.valor!.id}`]: valor, [`f${f.cuenta!.id}`]: [cobroId] },
            });
        }
        // Un ítem de OTRA cuenta no aparece.
        const otra = await recs.create(tenantId, admin, 'cobros', { data: { [`f${f.cliente!.id}`]: 'Gamma' } });
        await recs.create(tenantId, admin, 'items', { data: { [`f${f.detalle!.id}`]: 'Ajeno', [`f${f.valor!.id}`]: 999, [`f${f.cuenta!.id}`]: [otra.id] } });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('plantillas: alta, listado, diseño inválido rechazado y aisladas por empresa (RLS)', async () => {
        const tpl = await docs.create(tenantId, admin.userId, 'cobros', { name: 'Cuenta de cobro', filename: 'Cuenta {{record.id}} - {{cliente}}', design });
        const list = await docs.list(tenantId, 'cobros');
        expect(list.map((t) => t.id)).toContain(tpl.id);
        expect(list.find((t) => t.id === tpl.id)).toMatchObject({ page_size: 'letter' });

        await expect(
            docs.create(tenantId, admin.userId, 'cobros', { name: 'Roto', filename: 'x', design: { blocks: [{ id: 'z', type: 'nope' }] } as never }),
        ).rejects.toMatchObject({ response: { code: 'invalid_document_design' } });

        const seenByOther = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(documentTemplates));
        expect(seenByOther).toEqual([]);
        await docs.remove(tenantId, admin.userId, 'cobros', tpl.id);
    });

    it('vista previa: una página, regiones por bloque, ítems SÓLO de esta cuenta y totales sumados', async () => {
        const prev = await docs.preview(tenantId, admin, 'cobros', { design, record_id: cobroId, mode: 'real' });
        expect(Buffer.from(prev.pdf, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
        expect(prev.pages).toBe(1);
        expect(prev.record_id).toBe(cobroId);
        expect(prev.warnings).toEqual([]);
        const ids = prev.regions.map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining(design.blocks.map((b) => b.id)));
        // El último bloque (la firma) termina donde termina, no en el pie de la hoja.
        const last = prev.regions.filter((r) => r.id === design.blocks[design.blocks.length - 1]!.id);
        expect(last).toHaveLength(1);
        expect(last[0]!.h).toBeLessThan(160);

        const rendered = await tenantDb.withTenant(tenantId, (tx) =>
            docs.renderInTx(tx, { tenantId, actor: admin, listId: cobrosId, recordId: cobroId, design, filename: 'x', mode: 'real' }),
        );
        const rows = Object.values(rendered.content.items)[0]!;
        expect(rows.map((r) => r.find((c) => /Diseño|Hosting|Soporte|Ajeno/.test(c)))).toEqual(['Diseño', 'Hosting', 'Soporte']);
        expect(Object.values(rendered.content.totals).join(' ')).toMatch(/350[.,]000/);

        const tags = await docs.preview(tenantId, admin, 'cobros', { design, mode: 'tags' });
        expect(tags.pages).toBeGreaterThanOrEqual(1);
    });

    it('generar desde la ficha: descarga, guarda en un campo Archivo, y rechaza un campo que no lo es', async () => {
        const tpl = await docs.create(tenantId, admin.userId, 'cobros', { name: 'Cuenta', filename: 'Cuenta {{record.id}} - {{cliente}}', design });
        const plain = await docs.generateForRecord(tenantId, admin, 'cobros', cobroId, tpl.id, { record_id: cobroId });
        expect(plain.filename).toBe(`Cuenta ${cobroId} - Beta Ltda.pdf`);
        expect(plain.file_id).toBeNull();

        const saved = await docs.generateForRecord(tenantId, admin, 'cobros', cobroId, tpl.id, {
            record_id: cobroId,
            save_field: 'documento',
            save_mode: 'append',
        });
        expect(saved.file_id).toBeGreaterThan(0);
        expect(saved.url).toMatch(/\/api\/v1\/files\/\d+\/signed/);
        const rec = await recs.get(tenantId, admin, 'cobros', cobroId);
        expect(rec.data[`f${f.documento!.id}`]).toEqual([saved.file_id]);

        await expect(
            docs.generateForRecord(tenantId, admin, 'cobros', cobroId, tpl.id, { record_id: cobroId, save_field: 'nit' }),
        ).rejects.toMatchObject({ response: { code: 'invalid_save_field' } });
        await expect(docs.generateForRecord(tenantId, admin, 'cobros', cobroId, 999999, { record_id: cobroId })).rejects.toThrow();
        await expect(docs.generateForRecord(tenantId, admin, 'cobros', 999999, tpl.id, { record_id: 999999 })).rejects.toThrow();
    });

    it('automatización: «Generar un PDF» lo guarda y «Enviar email» lo adjunta con {{pdf.link}}; borrar la plantilla en uso → 409', async () => {
        const tpl = await docs.create(tenantId, admin.userId, 'cobros', { name: 'Cuenta auto', filename: 'Cuenta {{record.id}}', design });
        const auto = await automations.create(tenantId, 'cobros', {
            name: 'Mandar cuenta',
            trigger_type: 'record_created',
            actions: [
                { type: 'generate_pdf', config: { document_template_id: tpl.id, save_field: 'documento' } },
                {
                    type: 'send_email',
                    config: { to: 'cliente@beta.test', subject: 'Tu cuenta {{record.id}}', body: 'Descargala: {{pdf.link}}', pdf_templates: [tpl.id] },
                },
            ],
        });

        const nuevo = await recs.create(tenantId, admin, 'cobros', { data: { [`f${f.cliente!.id}`]: 'Delta' } });
        mailbox.sent.length = 0;
        await engine.process({ tenantId, listId: cobrosId, recordId: nuevo.id, trigger: 'record_created', after: { [`f${f.cliente!.id}`]: 'Delta' } });

        expect(mailbox.sent).toHaveLength(1);
        const msg = mailbox.sent[0]!;
        expect(msg.attachments).toHaveLength(1);
        expect(msg.attachments![0]).toMatchObject({ filename: `Cuenta ${nuevo.id}.pdf`, contentType: 'application/pdf' });
        expect(Buffer.from(msg.attachments![0]!.contentBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
        expect(msg.text ?? msg.html ?? '').toMatch(/https:\/\/app\.test\/api\/v1\/files\/\d+\/signed/);

        const after = await recs.get(tenantId, admin, 'cobros', nuevo.id);
        const ids = after.data[`f${f.documento!.id}`] as number[];
        expect(ids).toHaveLength(1);
        // Lo guardó el sistema (sin persona).
        const [att] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(attachments).where(eq(attachments.id, ids[0]!)));
        expect(att!.createdBy).toBeNull();

        await expect(docs.remove(tenantId, admin.userId, 'cobros', tpl.id)).rejects.toMatchObject({
            response: { code: 'document_template_in_use' },
        });
        await automations.remove(tenantId, 'cobros', auto.id);
        await docs.remove(tenantId, admin.userId, 'cobros', tpl.id);
    });

    it('una plantilla de OTRA lista no se puede usar desde ésta', async () => {
        const tplItems = await docs.create(tenantId, admin.userId, 'items', { name: 'De ítems', filename: 'x', design });
        await expect(docs.generateForRecord(tenantId, admin, 'cobros', cobroId, tplItems.id, { record_id: cobroId })).rejects.toThrow();
        const count = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, itemsId)));
        expect(count.length).toBe(4);
    });
});
