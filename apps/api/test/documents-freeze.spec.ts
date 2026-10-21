import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { buildDocumentStarter, type DocDesign, type Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import type { BillingService } from '../src/billing/billing.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { RecordLayoutDataService } from '../src/dashboards/record-layout-data.service';
import { attachments, documentNumbers, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DocumentsService } from '../src/documents/documents.service';
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

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

/** Un transporte de correo que siempre falla (para revertir la acción). */
class FailingMailTransport implements MailTransport {
    readonly name = 'roto';
    send(_message: MailMessage): Promise<void> {
        return Promise.reject(new Error('SMTP caído'));
    }
}

/** Un almacenamiento que no puede escribir (bucket caído). */
class BrokenStorage extends LocalFileStorage {
    override write(_key: string, _source: Readable): Promise<number> {
        return Promise.reject(new Error('disco lleno'));
    }
}

const admin: Actor = { userId: 1, role: 'admin' };
const manager: Actor = { userId: 1, role: 'manager' };

function filesIn(dir: string): number {
    let n = 0;
    for (const name of readdirSync(dir, { recursive: true }) as string[]) if (statSync(join(dir, name)).isFile()) n++;
    return n;
}

/**
 * v0.1.290 (ADR-S35 fase 3) — cotización/factura con columnas CALCULADAS e
 * IVA, documentos CONGELADOS al emitirlos, «Anular y emitir de nuevo» y la
 * tabla editable de los vinculados en la ficha (datos por `layout-data`).
 */
describe('v0.1.290 — documentos congelados, cotización y tabla editable (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let files: FilesService;
    let docs: DocumentsService;
    let layoutData: RecordLayoutDataService;
    let automations: AutomationsService;
    let failingEngine: AutomationEngine;
    let uploadsDir: string;
    let tenantId: number;
    let otherTenant: number;
    let cotizacionesId: number;
    let f: Record<string, Field>;
    let design: DocDesign;
    let cotId: number;
    let lineIds: number[];
    let env: ReturnType<typeof loadEnv>;
    let audit: AuditService;

    const k = (key: string): string => `f${f[key]!.id}`;
    const nextLabel = async (tplId: number): Promise<string | null> => (await docs.list(tenantId, 'cotizaciones')).find((t) => t.id === tplId)?.next_label ?? null;
    const numbersOf = (tplId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(documentNumbers).where(eq(documentNumbers.templateId, tplId)));

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
        env = loadEnv({ FILES_SIGNING_SECRET: 'test-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        uploadsDir = mkdtempSync(join(tmpdir(), 'imb-freeze-'));
        files = new FilesService(tenantDb, new LocalFileStorage(uploadsDir), env);
        audit = new AuditService(tenantDb);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, audit);
        const aggregate = new AggregateService(tenantDb, lists, fieldsSvc);
        layoutData = new RecordLayoutDataService(tenantDb, lists, fieldsSvc, recs, new DashboardsService(tenantDb, aggregate, recs, fieldsSvc));
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), noHooks, connectors);
        failingEngine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new FailingMailTransport()),
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            docs,
        );

        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        expect(u!.id).toBe(admin.userId);
        // Formato regional de Colombia: punto de miles.
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', settings: { format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' } } }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;

        cotizacionesId = (await lists.create(tenantId, { name: 'Cotizaciones' })).id;
        await lists.create(tenantId, { name: 'Ítems de cotización', slug: 'items' });
        f = {};
        const mk = async (list: string, def: Parameters<FieldsService['create']>[2]): Promise<void> => {
            f[def.slug as string] = await fieldsSvc.create(tenantId, list, def);
        };
        await mk('cotizaciones', { label: 'Cliente', type: 'text', slug: 'cliente' });
        await mk('cotizaciones', { label: 'NIT', type: 'text', slug: 'nit' });
        await mk('cotizaciones', { label: 'Válida hasta', type: 'date', slug: 'vence' });
        await mk('cotizaciones', { label: 'Descuento global', type: 'percent', slug: 'dto_global' });
        await mk('items', { label: 'Descripción', type: 'text', slug: 'detalle' });
        await mk('items', { label: 'Cantidad', type: 'number', slug: 'cant', config: { precision: 2 } });
        await mk('items', { label: 'Precio unitario', type: 'currency', slug: 'precio', config: { currency: 'COP', precision: 0 } });
        await mk('items', { label: 'Descuento', type: 'percent', slug: 'dto' });
        await mk('items', { label: 'Cotización', type: 'relation', slug: 'cotizacion', config: { target_list_id: cotizacionesId } });

        design = buildDocumentStarter('cotizacion', {
            fields: { cliente: 'cliente', cliente_doc: 'nit', validez: 'vence', descuento_global: 'dto_global' },
            items: {
                source: { relation_field_id: f.cotizacion!.id, direction: 'reverse', list_id: f.detalle!.list_id },
                fields: { descripcion: 'detalle', cantidad: 'cant', precio: 'precio', descuento: 'dto' },
            },
            tax: { iva: true, rate: 19 },
            money_decimals: 0,
        }).design;

        const cot = await recs.create(tenantId, admin, 'cotizaciones', {
            data: { [k('cliente')]: 'Beta Ltda.', [k('nit')]: '900.123.456-7', [k('vence')]: '2026-11-30', [k('dto_global')]: 5 },
        });
        cotId = cot.id;
        lineIds = [];
        for (const [detalle, cant, precio, dto] of [
            ['Diseño', 2, 150000, 10],
            ['Hosting', 1.5, 99999, null],
            ['Soporte', 3, 12500, 0],
        ] as const) {
            const r = await recs.create(tenantId, admin, 'items', {
                data: { [k('detalle')]: detalle, [k('cant')]: cant, [k('precio')]: precio, [k('dto')]: dto, [k('cotizacion')]: [cotId] },
            });
            lineIds.push(r.id);
        }
        // Un ítem de OTRA cotización no aparece.
        const otra = await recs.create(tenantId, admin, 'cotizaciones', { data: { [k('cliente')]: 'Gamma' } });
        await recs.create(tenantId, admin, 'items', { data: { [k('detalle')]: 'Ajeno', [k('cant')]: 1, [k('precio')]: 999, [k('cotizacion')]: [otra.id] } });
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('cotización completa: total de cada línea calculado, descuentos, base gravable, IVA sobre la base y total', async () => {
        const rendered = await tenantDb.withTenant(tenantId, (tx) =>
            docs.renderInTx(tx, { tenantId, actor: admin, listId: cotizacionesId, recordId: cotId, design, filename: 'x', mode: 'real' }),
        );
        const rows = rendered.content.items.items!;
        // Columnas dibujadas: Descripción, Cant., Precio unitario, Desc. %, Total (el bruto y el descuento van ocultos).
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r[0])).toEqual(['Diseño', 'Hosting', 'Soporte']);
        expect(rows.map((r) => r[r.length - 1])).toEqual(['$ 270.000', '$ 149.999', '$ 37.500']);
        // El precio unitario con el MISMO formato que el total de la línea (no el del campo).
        expect(rows[0]![2]).toBe('$ 150.000');
        expect(rendered.content.totals).toMatchObject({
            subtotal: '$ 487.499',
            descuentos: '-$ 30.000',
            neto: '$ 457.499',
            descuento_global: '-$ 22.875',
            base: '$ 434.624',
            iva: '$ 82.579',
            total: '$ 517.203',
        });
        expect(rendered.warnings).toEqual([]);

        // Modo variables (el editor): la columna calculada muestra su fórmula.
        const tags = await tenantDb.withTenant(tenantId, (tx) =>
            docs.renderInTx(tx, { tenantId, actor: admin, listId: cotizacionesId, recordId: null, design, filename: 'x', mode: 'tags' }),
        );
        expect(tags.content.items.items![0]!.join(' ')).toMatch(/= Bruto − Descuento %/);
    });

    it('sin IVA (no responsable): el total es la base, sin fila de IVA', async () => {
        const noIva = buildDocumentStarter('factura', {
            fields: { cliente: 'cliente' },
            items: {
                source: { relation_field_id: f.cotizacion!.id, direction: 'reverse', list_id: f.detalle!.list_id },
                fields: { descripcion: 'detalle', cantidad: 'cant', precio: 'precio', descuento: 'dto' },
            },
            tax: { iva: false, rate: 19 },
        }).design;
        const rendered = await tenantDb.withTenant(tenantId, (tx) =>
            docs.renderInTx(tx, { tenantId, actor: admin, listId: cotizacionesId, recordId: cotId, design: noIva, filename: 'x', mode: 'real' }),
        );
        expect(rendered.content.totals).toMatchObject({ subtotal: '$ 487.499', descuentos: '-$ 30.000', total: '$ 457.499' });
        expect(rendered.content.totals.iva).toBeUndefined();
    });

    it('congelar: al emitir se guarda el PDF y desde ahí se entrega ESE aunque cambie el registro (ficha, ver, enlace, portal)', async () => {
        const frozen: DocDesign = { ...design, numbering: { ...design.numbering, enabled: true, prefix: 'COT-', freeze: true } };
        const tpl = await docs.create(tenantId, admin.userId, 'cotizaciones', { name: 'Cotización', filename: 'Cotización {{documento.numero}}', design: frozen, portal_visible: true });
        expect((await docs.list(tenantId, 'cotizaciones')).find((t) => t.id === tpl.id)).toMatchObject({ freezes: true, frozen_count: 0 });

        // Ver no emite ni congela.
        const peek = await docs.viewForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id);
        expect(peek).toMatchObject({ number: 'COT-0001', issued: false, frozen: false });
        expect(await numbersOf(tpl.id)).toHaveLength(0);

        const filesBefore = filesIn(uploadsDir);
        const first = await docs.generateForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id, { record_id: cotId });
        expect(first.number).toBe('COT-0001');
        const [row] = await numbersOf(tpl.id);
        expect(row).toMatchObject({ label: 'COT-0001', frozenBy: admin.userId });
        expect(row!.fileId).toBeGreaterThan(0);
        expect(row!.frozenAt).toBeInstanceOf(Date);
        expect(filesIn(uploadsDir)).toBe(filesBefore + 1);
        const [att] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(attachments).where(eq(attachments.id, row!.fileId!)));
        expect(att).toMatchObject({ mime: 'application/pdf', filename: 'Cotización COT-0001.pdf' });
        const firstBytes = Buffer.from(first.pdf, 'base64');

        // Cambia un precio: el documento emitido NO cambia.
        await recs.update(tenantId, admin, 'items', lineIds[0]!, { data: { [k('precio')]: 175000 } } as never);
        const again = await docs.generateForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id, { record_id: cotId });
        expect(again.number).toBe('COT-0001');
        expect(Buffer.from(again.pdf, 'base64').equals(firstBytes)).toBe(true);
        expect(filesIn(uploadsDir)).toBe(filesBefore + 1);
        const view = await docs.viewForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id);
        expect(view).toMatchObject({ number: 'COT-0001', issued: true, frozen: true });
        expect(Buffer.from(view.pdf, 'base64').equals(firstBytes)).toBe(true);
        const link = new URL(docs.liveLink(tenantId, tpl.id, cotId), 'http://x');
        const viaLink = await docs.renderLiveLink(tpl.id, cotId, tenantId, Number(link.searchParams.get('exp')), link.searchParams.get('sig')!);
        expect(viaLink.buffer.equals(firstBytes)).toBe(true);
        const viaPortal = await docs.renderForPortal(tenantId, cotizacionesId, cotId, tpl.id);
        expect(viaPortal.buffer.equals(firstBytes)).toBe(true);
        expect(viaPortal.frozen).toBe(true);

        // La vista previa del editor nunca congela ni entrega el congelado: arma lo de ahora.
        const preview = await docs.preview(tenantId, admin, 'cotizaciones', { design: frozen, record_id: cotId, mode: 'real', template_id: tpl.id });
        expect(Buffer.from(preview.pdf, 'base64').equals(firstBytes)).toBe(false);
        expect(preview.pages).toBeGreaterThanOrEqual(1);
        expect(await numbersOf(tpl.id)).toHaveLength(1);

        // «Documentos emitidos» y su descarga.
        const issued = await docs.issuedForRecord(tenantId, admin, 'cotizaciones', cotId);
        expect(issued).toHaveLength(1);
        expect(issued[0]).toMatchObject({ label: 'COT-0001', frozen: true, status: 'active', frozen_by_name: 'Ana', template_name: 'Cotización' });
        const pdf = await docs.issuedPdf(tenantId, admin, 'cotizaciones', issued[0]!.id);
        expect(Buffer.from(pdf.pdf, 'base64').equals(firstBytes)).toBe(true);
        expect((await docs.list(tenantId, 'cotizaciones')).find((t) => t.id === tpl.id)?.frozen_count).toBe(1);

        // El PDF congelado no se puede borrar suelto.
        await expect(files.remove(tenantId, row!.fileId!)).rejects.toMatchObject({ response: { code: 'file_is_issued_document' } });
        // Y otra empresa no ve nada (RLS).
        expect(await withTenant(pg.db, otherTenant, (tx) => tx.select().from(documentNumbers))).toEqual([]);
    });

    it('anular y emitir de nuevo: el anterior conserva número y PDF, el nuevo sale con los datos de ahora; sólo admin', async () => {
        const [tplSummary] = (await docs.list(tenantId, 'cotizaciones')).filter((t) => t.freezes);
        const tplId = tplSummary!.id;
        const [current] = (await docs.issuedForRecord(tenantId, admin, 'cotizaciones', cotId)).filter((d) => d.status === 'active');
        const oldBytes = Buffer.from((await docs.issuedPdf(tenantId, admin, 'cotizaciones', current!.id)).pdf, 'base64');

        await expect(docs.reissue(tenantId, manager, 'cotizaciones', current!.id, {})).rejects.toMatchObject({ response: { code: 'admin_only' } });

        const res = await docs.reissue(tenantId, admin, 'cotizaciones', current!.id, { reason: 'Se corrigió el precio' });
        expect(res.voided).toMatchObject({ label: 'COT-0001', status: 'voided', frozen: true, void_reason: 'Se corrigió el precio', voided_by_name: 'Ana' });
        expect(res.issued).toMatchObject({ label: 'COT-0002', status: 'active', frozen: true });
        const newBytes = Buffer.from(res.pdf, 'base64');
        expect(newBytes.equals(oldBytes)).toBe(false);

        // Generar ahora entrega el NUEVO; el anulado se sigue bajando igual que antes.
        const now = await docs.generateForRecord(tenantId, admin, 'cotizaciones', cotId, tplId, { record_id: cotId });
        expect(now.number).toBe('COT-0002');
        expect(Buffer.from(now.pdf, 'base64').equals(newBytes)).toBe(true);
        expect(Buffer.from((await docs.issuedPdf(tenantId, admin, 'cotizaciones', current!.id)).pdf, 'base64').equals(oldBytes)).toBe(true);

        const list = await docs.issuedForRecord(tenantId, admin, 'cotizaciones', cotId);
        expect(list.map((d) => [d.label, d.status])).toEqual([
            ['COT-0002', 'active'],
            ['COT-0001', 'voided'],
        ]);
        expect(await nextLabel(tplId)).toBe('COT-0003');
        // Anular lo ya anulado: 409.
        await expect(docs.reissue(tenantId, admin, 'cotizaciones', current!.id, {})).rejects.toMatchObject({ response: { code: 'already_voided' } });
    });

    it('si guardar el PDF falla (cupo o almacenamiento caído), la emisión falla con el motivo y el número NO se consume', async () => {
        const frozen: DocDesign = { ...design, numbering: { ...design.numbering, enabled: true, prefix: 'FAIL-', freeze: true } };
        const tpl = await docs.create(tenantId, admin.userId, 'cotizaciones', { name: 'Sin cupo', filename: 'x', design: frozen });
        const filesBefore = filesIn(uploadsDir);
        const [attsBefore] = [await withTenant(pg.db, tenantId, (tx) => tx.select().from(attachments))];

        // Cupo del plan agotado.
        const noQuota = { assertCanUpload: () => Promise.reject(new ForbiddenException({ code: 'storage_limit_reached', message: 'Alcanzaste el límite de almacenamiento de tu plan (1 MB)', data: { status: 403 } })) } as unknown as BillingService;
        const docsNoQuota = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, audit, noQuota);
        await expect(docsNoQuota.generateForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id, { record_id: cotId })).rejects.toMatchObject({
            status: 403,
            response: { code: 'document_freeze_failed', message: expect.stringMatching(/límite de almacenamiento.*El número no se usó/) },
        });

        // Almacenamiento que no escribe.
        const brokenFiles = new FilesService(tenantDb, new BrokenStorage(mkdtempSync(join(tmpdir(), 'imb-broken-'))), env);
        const docsBroken = new DocumentsService(tenantDb, lists, fieldsSvc, recs, brokenFiles, audit);
        await expect(docsBroken.generateForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id, { record_id: cotId })).rejects.toMatchObject({
            status: 503,
            response: { code: 'document_freeze_failed', message: expect.stringMatching(/disco lleno/) },
        });

        expect(await numbersOf(tpl.id)).toHaveLength(0);
        expect(await nextLabel(tpl.id)).toBe('FAIL-0001');
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(attachments))).toHaveLength(attsBefore.length);
        expect(filesIn(uploadsDir)).toBe(filesBefore);

        // Y si la transacción del motor revierte DESPUÉS de congelar (el correo
        // que adjunta el PDF no sale), ni el número ni los bytes quedan.
        const auto = await automations.create(tenantId, 'cotizaciones', {
            name: 'Mandar cotización',
            trigger_type: 'record_created',
            actions: [{ type: 'send_email', config: { to: 'cliente@beta.test', subject: 'Tu cotización', body: 'Adjunta.', pdf_templates: [tpl.id] } }],
        });
        await failingEngine.process({ tenantId, listId: cotizacionesId, recordId: cotId, trigger: 'record_created', after: {} });
        expect(await numbersOf(tpl.id)).toHaveLength(0);
        expect(filesIn(uploadsDir)).toBe(filesBefore);
        await automations.remove(tenantId, 'cotizaciones', auto.id);

        // Con todo en orden, el primero sale con el número que había quedado libre.
        const ok = await docs.generateForRecord(tenantId, admin, 'cotizaciones', cotId, tpl.id, { record_id: cotId });
        expect(ok.number).toBe('FAIL-0001');
        expect(filesIn(uploadsDir)).toBe(filesBefore + 1);

        // Borrar la plantilla se lleva sus PDF congelados (fila y bytes).
        await docs.remove(tenantId, admin.userId, 'cotizaciones', tpl.id);
        expect(filesIn(uploadsDir)).toBe(filesBefore);
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(attachments))).toHaveLength(attsBefore.length);
    });

    it('tabla editable en la ficha: los vinculados en orden, su fila de totales, y un ítem nuevo vinculado suma', async () => {
        const block = {
            id: 'items_edit',
            type: 'related' as const,
            title: 'Ítems',
            config: {
                source: { kind: 'related', field_id: f.cotizacion!.id },
                view: 'editable',
                field_ids: [f.detalle!.id, f.cant!.id, f.precio!.id, f.dto!.id],
                editable_field_ids: [f.cant!.id, f.precio!.id],
                total_field_ids: [f.cant!.id, f.precio!.id, f.detalle!.id],
            },
        };
        const read = async () =>
            (await layoutData.data(tenantId, { userId: 1, role: 'admin' }, 'cotizaciones', cotId, { blocks: [block] })).items_edit as {
                rows: Array<{ id: number; data: Record<string, unknown> }>;
                total: number;
                totals: Record<string, number | null>;
            };
        const before = await read();
        // En el orden en que se cargaron (no el más reciente primero).
        expect(before.rows.map((r) => r.id)).toEqual(lineIds);
        // Sólo se suman las numéricas (la descripción no).
        expect(before.totals).toEqual({ [String(f.cant!.id)]: 6.5, [String(f.precio!.id)]: 175000 + 99999 + 12500 });

        // «Agregar ítem»: nace vinculado a la cotización y entra en la tabla y en los totales.
        await recs.create(tenantId, admin, 'items', { data: { [k('detalle')]: 'Capacitación', [k('cant')]: 1, [k('cotizacion')]: [cotId] } });
        const after = await read();
        expect(after.total).toBe(4);
        expect(after.rows[3]!.data[k('detalle')]).toBe('Capacitación');
        expect(after.totals[String(f.cant!.id)]).toBe(7.5);

        // Editar una cantidad cambia la suma (y el PDF de la vista previa).
        await recs.update(tenantId, admin, 'items', lineIds[2]!, { data: { [k('cant')]: 4 } } as never);
        expect((await read()).totals[String(f.cant!.id)]).toBe(8.5);
        const rendered = await tenantDb.withTenant(tenantId, (tx) =>
            docs.renderInTx(tx, { tenantId, actor: admin, listId: cotizacionesId, recordId: cotId, design, filename: 'x', mode: 'real' }),
        );
        expect(rendered.content.items.items!.find((r) => r[0] === 'Soporte')!.at(-1)).toBe('$ 50.000');
        // La línea sin precio queda sin total (no un cero engañoso).
        expect(rendered.content.items.items!.find((r) => r[0] === 'Capacitación')!.at(-1)).toBe('—');

        // Sin elegir qué sumar: la moneda (aquí no hay un total de línea calculado).
        const noChoice = { ...block, id: 'items_default', config: { ...block.config, total_field_ids: undefined } };
        const def = (await layoutData.data(tenantId, { userId: 1, role: 'admin' }, 'cotizaciones', cotId, { blocks: [noChoice] })).items_default as {
            totals: Record<string, number | null>;
        };
        expect(Object.keys(def.totals)).toEqual([String(f.precio!.id)]);
    });

    it('el ítem vinculado de otra empresa no se ve ni se emite nada cruzado', async () => {
        const rows = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(documentNumbers).where(and(eq(documentNumbers.recordId, cotId))));
        expect(rows).toEqual([]);
    });
});
