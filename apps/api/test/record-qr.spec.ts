import { jsonbKeyForField, type Field } from '@imagina-base/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { applyMergeTags } from '../src/automations/merge-tags';
import { loadEnv } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { renderPdfDefinition } from '../src/documents/document-render';
import { resolveDocTemplate } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { configureQrRuntime, qrImageUrl, recordLinkFor, recordTokenValue } from '../src/qr/qr-runtime';
import { signQrToken, verifyQrToken } from '../src/qr/qr-token';
import { QrService } from '../src/qr/qr.service';
import { RecordLabelsService, buildLabelsDefinition, type LabelItem } from '../src/qr/record-labels.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const SECRET = 'secreto-de-prueba';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Páginas de un PDF de pdfmake (cada `/Type /Page` que no es `/Pages`). */
function pageCount(pdf: Buffer): number {
    return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

describe('v0.1.344 — el QR de los registros (piezas puras)', () => {
    it('el token firma el contenido: alterado, inventado o reescrito no vale', () => {
        const token = signQrToken('https://base.test/lists/productos/records/42', SECRET)!;
        expect(verifyQrToken(token, SECRET)).toBe('https://base.test/lists/productos/records/42');
        expect(verifyQrToken(token, 'otro-secreto')).toBeNull();
        const [body, sig] = token.split('.');
        const otro = Buffer.from('https://phishing.test', 'utf8').toString('base64url');
        expect(verifyQrToken(`${otro}.${sig}`, SECRET)).toBeNull();
        expect(verifyQrToken(`${body}.${'A'.repeat(22)}`, SECRET)).toBeNull();
        expect(verifyQrToken('no-es-un-token', SECRET)).toBeNull();
        expect(signQrToken('', SECRET)).toBeNull();
        expect(signQrToken('x'.repeat(1001), SECRET)).toBeNull();
    });

    it('{{campo|qr}}, {{registro.enlace}} y {{registro.qr}} salen como la imagen y el enlace', async () => {
        configureQrRuntime(null);
        expect(qrImageUrl('SKU-1')).toBe('');
        configureQrRuntime({ imageBase: 'https://base.test/', secret: SECRET, linkBase: async () => 'https://crm.acme.co' });
        const link = await recordLinkFor(1, 'entradas', 7);
        expect(link).toBe('https://crm.acme.co/lists/entradas/records/7');

        const values: Record<string, unknown> = { boleta: 'BOL-0007', vacio: '' };
        const fv = (t: string): unknown => recordTokenValue(t, link) ?? values[t];
        const out = applyMergeTags('Tu entrada {{boleta}}: {{boleta|qr}} · {{registro.enlace}} · {{registro.qr}} · {{vacio|qr}}.', fv, 7);
        const [, codeUrl, , linkUrl] = out.match(/Tu entrada BOL-0007: (\S+) · (\S+) · (\S+) · \./)!.slice(0, 4) as string[];
        expect(codeUrl).toMatch(/^https:\/\/base\.test\/api\/v1\/public\/qr\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\.png$/);
        expect(verifyQrToken(codeUrl!.split('/qr/')[1]!.replace(/\.png$/, ''), SECRET)).toBe('BOL-0007');
        expect(out).toContain(' · https://crm.acme.co/lists/entradas/records/7 · ');
        expect(verifyQrToken(linkUrl!.split('/qr/')[1]!.replace(/\.png$/, ''), SECRET)).toBe(link);
        // En un PDF, {{registro.enlace}} es el contenido de un bloque QR (pdfmake lo dibuja).
        const doc = resolveDocTemplate('{{registro.enlace}}', {
            recordId: 7,
            today: '2026-11-02',
            tenantName: 'Acme',
            raw: () => undefined,
            format: () => '',
            hasField: () => false,
            field: () => undefined,
            totals: () => null,
            money: () => '',
            dateFormat: (d) => d,
            recordLink: link,
        });
        expect(doc).toBe(link);
    });

    it('el PDF de etiquetas reparte por hoja, salta las usadas y una por página en rollo', async () => {
        const items: LabelItem[] = Array.from({ length: 35 }, (_, i) => ({
            qr: `https://base.test/lists/productos/records/${i + 1}`,
            title: `Producto con un nombre bastante largo número ${i + 1}`,
            lines: ['COP 25.000', 'Bodega 2'],
            code: `SKU-${i + 1}`,
        }));
        // Carta de 30: 35 etiquetas = 2 hojas; saltando 28, 35 + 28 = 63 → 3 hojas.
        expect(pageCount(await renderPdfDefinition(buildLabelsDefinition('letter_30', items)))).toBe(2);
        expect(pageCount(await renderPdfDefinition(buildLabelsDefinition('letter_30', items, 28)))).toBe(3);
        expect(pageCount(await renderPdfDefinition(buildLabelsDefinition('roll_50x30', items.slice(0, 4), 3)))).toBe(4);
        const def = buildLabelsDefinition('a4_21', items.slice(0, 2)) as { content: Array<Record<string, unknown>> };
        const qrs = def.content.filter((n) => 'qr' in n);
        expect(qrs).toHaveLength(2);
        expect(qrs[0]).toMatchObject({ qr: items[0]!.qr, eccLevel: 'M' });
    });
});

describe('v0.1.344 — QR de la ficha y etiquetas con el acceso de cada uno', () => {
    let pg: TestPg;
    let qr: QrService;
    let labels: RecordLabelsService;
    let recs: RecordsService;
    let tenantId: number;
    const admin: Actor = { userId: 0, role: 'admin' };
    const agent: Actor = { userId: 0, role: 'agent' };
    const f: Record<string, Field> = {};
    const ids: number[] = [];
    let agentRecord = 0;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fields,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const env = loadEnv({ APP_BASE_URL: 'https://base.test', FILES_SIGNING_SECRET: 'firma-de-test' });
        qr = new QrService(env, recs, fields, lists);
        labels = new RecordLabelsService(tenantDb, recs, fields, lists);

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'tienda', name: 'Tienda', plan: 'enterprise', settings: { format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24', timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@tienda.co', name: 'Admin', passwordHash: 'x' }).returning();
        const [b] = await pg.db.insert(users).values({ email: 'vendedor@tienda.co', name: 'Vendedor', passwordHash: 'x' }).returning();
        admin.userId = a!.id;
        agent.userId = b!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { userId: admin.userId, tenantId, role: 'admin' },
                { userId: agent.userId, tenantId, role: 'agent' },
            ]),
        );
        await lists.create(tenantId, { name: 'Productos' });
        const mk = async (slug: string, label: string, type: string, config: Record<string, unknown> = {}) => {
            f[slug] = await fields.create(tenantId, 'productos', { label, type, slug, config } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('sku', 'SKU', 'text');
        await mk('precio', 'Precio', 'currency', { currency: 'COP', precision: 0 });
        for (let i = 1; i <= 5; i++) {
            const r = await recs.create(tenantId, admin, 'productos', {
                data: { [jsonbKeyForField(f.nombre!.id)]: `Taza ${i}`, [jsonbKeyForField(f.sku!.id)]: `SKU-${i}`, [jsonbKeyForField(f.precio!.id)]: 25000 * i },
            });
            ids.push(r.id);
        }
        const mine = await recs.create(tenantId, agent, 'productos', { data: { [jsonbKeyForField(f.nombre!.id)]: 'La del vendedor', [jsonbKeyForField(f.sku!.id)]: 'VEN-1' } });
        agentRecord = mine.id;
    });

    afterAll(async () => {
        configureQrRuntime(null);
        await pg?.stop();
    });

    it('la ficha trae el enlace, su QR y el del SKU; la imagen es un PNG y un token falso no', async () => {
        const info = await qr.forRecord(tenantId, admin, 'productos', ids[0]!);
        expect(info.title).toBe('Taza 1');
        expect(info.link).toBe(`https://base.test/lists/productos/records/${ids[0]}`);
        expect(info.code).toMatchObject({ field_id: f.sku!.id, field_label: 'SKU', value: 'SKU-1' });
        const token = info.link_qr_url.split('/qr/')[1]!.replace(/\.png$/, '');
        const png = await qr.png(token, 200);
        expect(png!.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(await qr.png(`${token.slice(0, -2)}xx`)).toBeNull();
        // Un registro fuera del alcance del vendedor no le da su QR.
        await expect(qr.forRecord(tenantId, agent, 'productos', ids[0]!)).rejects.toMatchObject({ status: 404 });
        expect((await qr.forRecord(tenantId, agent, 'productos', agentRecord)).title).toBe('La del vendedor');
    });

    it('las etiquetas salen en el orden de la selección, con el precio legible y sólo lo que cada uno ve', async () => {
        const order = [ids[2]!, ids[0]!, ids[1]!];
        const out = await labels.pdf(tenantId, admin, 'productos', {
            target: { ids: order },
            preset: 'letter_30',
            content: 'field',
            code_field_id: null,
            field_ids: [f.precio!.id],
            show_title: true,
            show_code: true,
            skip: 0,
        });
        expect(out.count).toBe(3);
        expect(out.filename).toBe('Etiquetas - Productos.pdf');
        expect(out.buffer.subarray(0, 4).toString()).toBe('%PDF');
        expect(pageCount(out.buffer)).toBe(1);

        // Todo lo que muestra la vista: el admin, 6; el vendedor, sólo el suyo.
        const all = { target: { include_subtasks: false }, preset: 'a4_21' as const, content: 'link' as const, code_field_id: null, field_ids: [], show_title: true, show_code: true, skip: 0 };
        expect((await labels.pdf(tenantId, admin, 'productos', all)).count).toBe(6);
        expect((await labels.pdf(tenantId, agent, 'productos', all)).count).toBe(1);
        // Pedir por id lo ajeno no lo imprime.
        await expect(labels.pdf(tenantId, agent, 'productos', { ...all, target: { ids: [ids[0]!] } })).rejects.toMatchObject({ response: { code: 'labels_empty' } });
    });
});
