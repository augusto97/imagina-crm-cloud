import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocumentStarter, type DocDesign, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { activity, memberships, signatureRequests, signatureSigners, tenants, users } from '../src/db/schema';
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
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { verifyPage } from '../src/signatures/signatures.controller';
import { VERIFY_SCRIPT, verifyCsp, verifyLookupPage } from '../src/signatures/verify-page';
import { inlineScriptHash } from '../src/forms/form-page';
import { buildSignedPdf, constanciaDefinition, pdfPageCount, stampText, winAnsiSafe } from '../src/signatures/signature-pdf';
import { SignaturesService, signatureTokenFor } from '../src/signatures/signatures.service';
import { renderPlainPdfDefinition } from '../src/documents/document-render';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class Mailbox implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
    to(email: string): MailMessage[] {
        return this.sent.filter((m) => m.to === email);
    }
    clear(): void {
        this.sent.length = 0;
    }
}

const admin: Actor = { userId: 1, role: 'admin' };
const viewer: Actor = { userId: 2, role: 'viewer' };

async function onePagePdf(text: string, pages = 1): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`${text} ${i + 1}`, { x: 72, y: 700, size: 18 });
    return Buffer.from(await doc.save());
}

async function signaturePng(): Promise<string> {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path d="M10 70 C 60 10, 110 90, 160 40 S 260 60, 290 30" stroke="#111" stroke-width="5" fill="none"/></svg>');
    const png = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: svg }])
        .png()
        .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
}

function codeOf(m: MailMessage | undefined): string {
    const hit = /^(\d{6}) es tu código/.exec(m?.subject ?? '');
    if (!hit) throw new Error(`sin código en «${m?.subject ?? ''}»`);
    return hit[1]!;
}

function tokenOf(m: MailMessage | undefined): string {
    const hit = /\/firmar\/(\d+-[0-9a-f]{40})/.exec(m?.text ?? '');
    if (!hit) throw new Error('sin enlace en el correo');
    return hit[1]!;
}

/**
 * D6 (v0.1.446, ADR-S107) — firma electrónica: pedir la firma de un PDF (una
 * plantilla de la lista o un PDF del registro), firmar por enlace con código,
 * en orden o en paralelo, rechazar, anular, vencer y recordar; al firmar todos,
 * el PDF sellado con la constancia y lo que pasa en el registro.
 */
describe('D6 — firma electrónica (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let files: FilesService;
    let docs: DocumentsService;
    let svc: SignaturesService;
    let mailbox: Mailbox;
    let tenantId: number;
    let otherTenant: number;
    let f: Record<string, Field>;
    let templateId: number;
    let recordId: number;
    let png: string;
    const k = (key: string): string => `f${f[key]!.id}`;
    const ip = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' };

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, act, new AutomationDispatcher(), new RelationsRepository());
        const env = loadEnv({ FILES_SIGNING_SECRET: 'test-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-sign-'))), env);
        const audit = new AuditService(tenantDb);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, audit);
        mailbox = new Mailbox();
        svc = new SignaturesService(pg.db, tenantDb, lists, fieldsSvc, recs, files, docs, act, audit, redis as never, env, new MailService(env, mailbox), new NotifyHub(), undefined, rt);
        png = await signaturePng();

        await pg.db.insert(users).values([
            { email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Gómez' },
            { email: 'leo@acme.test', passwordHash: 'x', name: 'Leo' },
        ]);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', settings: { branding: { app_name: 'Acme SAS', primary_color: '#0e7490' }, format: { time_format: 'h24' } } }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId: 1, role: 'admin' },
            { tenantId, userId: 2, role: 'viewer' },
        ]);

        await lists.create(tenantId, { name: 'Contratos' });
        f = {};
        const mk = async (def: Parameters<FieldsService['create']>[2]): Promise<void> => {
            f[def.slug as string] = await fieldsSvc.create(tenantId, 'contratos', def);
        };
        await mk({ label: 'Cliente', type: 'text', slug: 'cliente' });
        await mk({ label: 'Contrato firmado', type: 'file', slug: 'contrato' });
        await mk({
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'firmado', label: 'Firmado' }] },
        });
        await mk({ label: 'Firmado el', type: 'date', slug: 'firmado_el' });
        const starter = buildDocumentStarter('cuenta_cobro', { fields: { cliente: 'cliente' } }).design;
        const design: DocDesign = { ...starter, numbering: { ...starter.numbering, enabled: true, prefix: 'CT-', padding: 4, start: 1 } };
        templateId = (await docs.create(tenantId, admin.userId, 'contratos', { name: 'Contrato de servicios', filename: 'Contrato {{documento.numero}}', design })).id;
        recordId = (await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Beta Ltda.', [k('estado')]: 'pendiente' } })).id;
    }, 180_000);

    afterAll(async () => {
        await redis?.quit().catch(() => undefined);
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('piezas puras: sello Windows-1252, constancia y PDF firmado con la constancia al final', async () => {
        expect(winAnsiSafe('Ana Gómez — «firma» 李')).toBe('Ana Gómez — «firma» ?');
        const original = await onePagePdf('Contrato', 2);
        const constancia = await renderPlainPdfDefinition(
            constanciaDefinition({
                title: 'Contrato',
                company: 'Acme',
                code: 'ABCDE-23456',
                documentNumber: 'CT-0001',
                originalSha256: 'a'.repeat(64),
                pages: 2,
                createdAt: '2026-11-18T10:00:00.000Z',
                completedAt: '2026-11-18T11:00:00.000Z',
                requestedBy: 'Ana',
                verifyUrl: 'https://app.test/api/v1/public/sign/verify/ABCDE-23456',
                consentText: 'Acepto.',
                signers: [{ name: 'Ana', email: 'a@x.co', role: 'Cliente', signedAt: '2026-11-18T11:00:00.000Z', ip: '1.2.3.4', userAgent: 'Chrome/1', verifiedBy: 'email', kind: 'drawn', signaturePng: png.split(',')[1]! }],
                formatWhen: (v) => v,
            }),
        );
        const signed = await buildSignedPdf(original, constancia, { stamp: stampText('ABCDE-23456', 'app.test', 1), title: 'Contrato' });
        expect(await pdfPageCount(signed)).toBe(2 + (await pdfPageCount(constancia)));
        await expect(pdfPageCount(Buffer.from('no es un pdf'))).rejects.toThrow(/no es un PDF/);
    });

    it('pedir firma: sólo quien puede editar el registro; valida el «al terminar»', async () => {
        const base = { record_id: recordId, source: { kind: 'template' as const, template_id: templateId }, signers: [{ name: 'Carla', email: 'carla@cliente.co', role: '' }], order: 'parallel' as const, message: '', expires_days: 30, verify: 'email' as const, remind_days: 3, title: '', send_email: true };
        await expect(svc.create(tenantId, viewer, 'contratos', { ...base, on_complete: { save_field_id: null, status_field_id: null, status_value: null, date_field_id: null } })).rejects.toMatchObject({ status: 403 });
        await expect(
            svc.create(tenantId, admin, 'contratos', { ...base, on_complete: { save_field_id: f.cliente!.id, status_field_id: null, status_value: null, date_field_id: null } }),
        ).rejects.toMatchObject({ response: { code: 'invalid_on_complete' } });
        await expect(
            svc.create(tenantId, admin, 'contratos', { ...base, on_complete: { save_field_id: null, status_field_id: f.estado!.id, status_value: 'inexistente', date_field_id: null } }),
        ).rejects.toMatchObject({ response: { code: 'invalid_on_complete' } });
    });

    it('en orden, con código por correo: firma uno, le toca al siguiente, y al terminar queda el PDF firmado', async () => {
        mailbox.clear();
        const dto = await svc.create(tenantId, admin, 'contratos', {
            record_id: recordId,
            source: { kind: 'template', template_id: templateId },
            title: '',
            signers: [
                { name: 'Carla Ruiz', email: 'Carla@Cliente.co', role: 'Cliente' },
                { name: 'Ana Gómez', email: 'ana@acme.test', role: 'Representante legal' },
            ],
            order: 'sequential',
            message: 'Te comparto el contrato.',
            expires_days: 15,
            verify: 'email',
            remind_days: 3,
            on_complete: { save_field_id: f.contrato!.id, status_field_id: f.estado!.id, status_value: 'firmado', date_field_id: f.firmado_el!.id },
            send_email: true,
        });
        expect(dto.status).toBe('pending');
        expect(dto.document_number).toBe('CT-0001');
        expect(dto.title).toBe('Contrato CT-0001');
        expect(dto.signers.map((s) => s.status)).toEqual(['sent', 'waiting']);
        expect(dto.signers[0]!.email).toBe('carla@cliente.co');
        expect(dto.signers[0]!.link).toMatch(/^https:\/\/app\.test\/firmar\//);
        expect(dto.signers[1]!.link).toBeNull();
        expect(dto.original_sha256).toMatch(/^[0-9a-f]{64}$/);

        // Portal: cada persona ve SU parte (por su correo); «Firmar» sólo a quien le toca.
        const portalOf = (email: string) => tenantDb.withTenant(tenantId, (tx) => svc.portalSignaturesInTx(tx, tenantId, recordId, email));
        const [pc] = await portalOf('CARLA@cliente.co');
        expect(pc).toMatchObject({ id: dto.id, status: 'pending', my_status: 'sent', signed_available: false, document_number: 'CT-0001' });
        expect(pc!.sign_url).toMatch(/^https:\/\/app\.test\/firmar\//);
        const [pa] = await portalOf('ana@acme.test');
        expect(pa).toMatchObject({ my_status: 'waiting', sign_url: null });
        expect(await portalOf('otra@persona.co')).toEqual([]);
        expect(await tenantDb.withTenant(tenantId, (tx) => svc.portalSignaturesInTx(tx, tenantId, recordId + 999, 'carla@cliente.co'))).toEqual([]);

        // Sólo le llegó a la primera persona, con el mensaje y su enlace.
        expect(mailbox.to('ana@acme.test')).toHaveLength(0);
        const first = mailbox.to('carla@cliente.co')[0];
        expect(first?.subject).toContain('Tienes un documento para firmar');
        expect(first?.text).toContain('Te comparto el contrato.');
        const t1 = tokenOf(first);

        // Ver: marca «Lo abrió» y no expone el correo entero.
        const view = await svc.publicView(t1, ip);
        expect(view).toMatchObject({ status: 'pending', company: 'Acme SAS', verify: 'email', pages: expect.any(Number) });
        expect(view.signer).toMatchObject({ name: 'Carla Ruiz', email_masked: 'ca***@cliente.co', status: 'viewed' });
        expect(view.others).toEqual([{ name: 'Ana Gómez', role: 'Representante legal', status: 'waiting' }]);
        expect(view.consent_text).toContain('Acme SAS');
        const pdf = await svc.publicDocument(t1, ip);
        expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');

        // La segunda todavía no puede firmar.
        const t2 = signatureTokenFor(svc, { tenantId, id: dto.id, linkVersion: 1 }, dto.signers[1]!.id);
        await expect(svc.sign(t2, { name: 'Ana Gómez', kind: 'drawn', image: png, consent: true }, ip)).rejects.toMatchObject({ response: { code: 'signature_not_due' } });

        // Sin código, código equivocado y código bueno.
        await expect(svc.sign(t1, { name: 'Carla Ruiz', kind: 'drawn', image: png, consent: true }, ip)).rejects.toMatchObject({ response: { code: 'signature_code_expired' } });
        const sent = await svc.requestCode(t1, ip);
        expect(sent).toMatchObject({ sent: true, email_masked: 'ca***@cliente.co' });
        const code = codeOf(mailbox.to('carla@cliente.co').at(-1));
        await expect(svc.sign(t1, { name: 'Carla Ruiz', kind: 'drawn', image: png, consent: true, code: code === '000000' ? '111111' : '000000' }, ip)).rejects.toMatchObject({
            response: { code: 'signature_code_invalid', message: expect.stringContaining('Te quedan 4') },
        });
        // Una firma vacía no vale.
        const blank = (await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()).toString('base64');
        await expect(svc.sign(t1, { name: 'Carla Ruiz', kind: 'drawn', image: `data:image/png;base64,${blank}`, consent: true, code }, ip)).rejects.toMatchObject({ response: { code: 'signature_image_empty' } });
        const r1 = await svc.sign(t1, { name: 'Carla Ruiz', kind: 'drawn', image: png, consent: true, code }, ip);
        expect(r1).toEqual({ status: 'pending', signed_available: false });
        // Ya firmó: el enlace no deja firmar otra vez.
        await expect(svc.sign(t1, { name: 'Carla Ruiz', kind: 'drawn', image: png, consent: true, code }, ip)).rejects.toMatchObject({ status: 410 });

        // Le tocó a la segunda: le llegó su correo.
        const second = mailbox.to('ana@acme.test')[0];
        expect(tokenOf(second)).toBe(t2);
        await svc.requestCode(t2, ip);
        const code2 = codeOf(mailbox.to('ana@acme.test').at(-1));
        mailbox.clear();
        const r2 = await svc.sign(t2, { name: 'Ana María Gómez', kind: 'typed', image: png, consent: true, code: code2 }, ip);
        expect(r2).toEqual({ status: 'completed', signed_available: true });

        // Solicitud firmada: PDF sellado + constancia, con su huella.
        const [done] = await svc.listForRecord(tenantId, admin, 'contratos', recordId);
        expect(done).toMatchObject({ id: dto.id, status: 'completed' });
        expect(done!.signed_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(done!.signers.map((s) => [s.status, s.signed_name])).toEqual([
            ['signed', 'Carla Ruiz'],
            ['signed', 'Ana María Gómez'],
        ]);
        const signedPdf = await svc.download(tenantId, admin, 'contratos', dto.id, 'signed');
        expect(signedPdf.filename).toBe('Contrato CT-0001 - firmado.pdf');
        const original = await svc.download(tenantId, admin, 'contratos', dto.id, 'original');
        expect(await pdfPageCount(signedPdf.buffer)).toBeGreaterThan(await pdfPageCount(original.buffer));
        // La página de firma ahora entrega el firmado.
        expect((await svc.publicDocument(t1, ip)).filename).toBe('Contrato CT-0001 - firmado.pdf');

        // Lo que pasa en el registro.
        const rec = await recs.get(tenantId, admin, 'contratos', recordId);
        expect(rec.data[k('estado')]).toBe('firmado');
        expect(String(rec.data[k('firmado_el')])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(rec.data[k('contrato')]).toContainEqual(expect.any(Number));

        // A las dos personas les llegó el firmado adjunto.
        for (const email of ['carla@cliente.co', 'ana@acme.test']) {
            const m = mailbox.to(email).find((x) => x.subject.startsWith('Documento firmado'));
            expect(m?.attachments?.[0]?.filename).toBe('Contrato CT-0001 - firmado.pdf');
        }

        // Evidencia y actividad.
        const signers = await withTenant(pg.db, tenantId, (tx) => tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, dto.id)));
        for (const s of signers) {
            expect(s).toMatchObject({ ip: '203.0.113.7', verifiedBy: 'email' });
            expect(s.consentText).toContain('Ley 527 de 1999');
            expect(s.signaturePng?.length ?? 0).toBeGreaterThan(100);
        }
        const events = (await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.recordId, recordId))))
            .filter((a) => a.action === 'signature')
            .map((a) => (a.diff as { signature: { event: string } }).signature.event);
        expect(events).toEqual(expect.arrayContaining(['requested', 'viewed', 'signed', 'completed']));

        // Los PDF de la firma no se borran sueltos.
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(signatureRequests).where(eq(signatureRequests.id, dto.id)));
        await expect(files.remove(tenantId, row!.originalFileId)).rejects.toMatchObject({ response: { code: 'file_is_signature_document' } });

        // Verificación pública por el código.
        const info = await svc.verifyInfo(row!.code, ip);
        expect(info).toMatchObject({ found: true, title: 'Contrato CT-0001', status: 'completed', original_sha256: row!.originalSha256 });
        const html = verifyPage(info);
        expect(html).toContain('Ana María Gómez');
        expect(html).toContain(row!.originalSha256);
        expect((await svc.verifyInfo('ZZZZZ-99999', ip)).found).toBe(false);
        expect(verifyPage({ found: false })).toContain('No encontramos esa firma');
        // «Comprobar un archivo»: la página compara en el navegador con las dos huellas.
        expect(html).toContain(`data-original="${row!.originalSha256}"`);
        expect(html).toContain(`data-signed="${row!.signedSha256}"`);
        expect(html).toContain('<script>');
        expect(verifyCsp()).toContain(`script-src '${inlineScriptHash(VERIFY_SCRIPT)}'`);
        expect(verifyLookupPage()).toContain('data-mode="lookup"');

        // Verificar subiendo el PDF: por la huella del firmado o del original.
        expect(await svc.lookupByHash(row!.signedSha256!, ip)).toEqual({ found: true, which: 'signed', code: row!.code, title: 'Contrato CT-0001', company: 'Acme SAS', status: 'completed' });
        expect(await svc.lookupByHash(row!.originalSha256.toUpperCase(), ip)).toMatchObject({ found: true, which: 'original', code: row!.code });
        expect(await svc.lookupByHash('0'.repeat(64), ip)).toEqual({ found: false });
        expect(await svc.lookupByHash('no-es-una-huella', ip)).toEqual({ found: false });

        // Portal: ya firmado, la persona lo baja; alguien ajeno no.
        const [after] = await portalOf('carla@cliente.co');
        expect(after).toMatchObject({ status: 'completed', my_status: 'signed', sign_url: null, signed_available: true });
        const fromPortal = await svc.portalSignedPdf(tenantId, recordId, 'carla@cliente.co', dto.id);
        expect(fromPortal.filename).toBe('Contrato CT-0001 - firmado.pdf');
        expect(fromPortal.buffer.equals(signedPdf.buffer)).toBe(true);
        await expect(svc.portalSignedPdf(tenantId, recordId, 'otra@persona.co', dto.id)).rejects.toMatchObject({ status: 404 });
        await expect(svc.portalSignedPdf(tenantId, recordId + 999, 'carla@cliente.co', dto.id)).rejects.toMatchObject({ status: 404 });

        // Otra empresa no ve nada (RLS).
        expect(await withTenant(pg.db, otherTenant, (tx) => tx.select().from(signatureRequests))).toHaveLength(0);
    });

    it('un enlace alterado o de otra solicitud da el mismo 404', async () => {
        await expect(svc.publicView('1-' + 'a'.repeat(40), ip)).rejects.toMatchObject({ status: 404 });
        await expect(svc.publicView('nada', ip)).rejects.toMatchObject({ status: 404 });
    });

    it('desde un PDF del registro, en paralelo y sin código: rechazar cierra la solicitud', async () => {
        const pdf = await onePagePdf('Anexo');
        const stored = await withTenant(pg.db, tenantId, (tx) => files.storeBufferInTx(tx, tenantId, admin.userId, 'Anexo.pdf', 'application/pdf', pdf));
        const rec = await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Gamma', [k('contrato')]: [stored.id] } });
        // Un PDF que no está en el registro no se puede mandar.
        await expect(
            svc.create(tenantId, admin, 'contratos', {
                record_id: recordId,
                source: { kind: 'file', file_id: stored.id },
                title: '',
                signers: [{ name: 'X', email: 'x@x.co', role: '' }],
                order: 'parallel',
                message: '',
                expires_days: 30,
                verify: 'none',
                remind_days: 0,
                on_complete: { save_field_id: null, status_field_id: null, status_value: null, date_field_id: null },
                send_email: true,
            }),
        ).rejects.toMatchObject({ response: { code: 'signature_file_not_in_record' } });
        const sources = await svc.sources(tenantId, admin, 'contratos', rec.id);
        expect(sources.files).toEqual([expect.objectContaining({ id: stored.id, filename: 'Anexo.pdf', field: 'Contrato firmado' })]);
        expect(sources.templates.map((t) => t.id)).toContain(templateId);

        mailbox.clear();
        const dto = await svc.create(tenantId, admin, 'contratos', {
            record_id: rec.id,
            source: { kind: 'file', file_id: stored.id },
            title: '',
            signers: [
                { name: 'Uno', email: 'uno@x.co', role: '' },
                { name: 'Dos', email: 'dos@x.co', role: '' },
            ],
            order: 'parallel',
            message: '',
            expires_days: 30,
            verify: 'none',
            remind_days: 0,
            on_complete: { save_field_id: null, status_field_id: null, status_value: null, date_field_id: null },
            send_email: true,
        });
        expect(dto.title).toBe('Anexo');
        expect(dto.signers.map((s) => s.status)).toEqual(['sent', 'sent']);
        const tUno = tokenOf(mailbox.to('uno@x.co')[0]);
        const tDos = tokenOf(mailbox.to('dos@x.co')[0]);
        // Sin código: firma directo.
        expect(await svc.sign(tUno, { name: 'Uno Pérez', kind: 'typed', image: png, consent: true }, ip)).toMatchObject({ status: 'pending' });
        mailbox.clear();
        expect(await svc.decline(tDos, { reason: 'Falta una cláusula' }, ip)).toEqual({ status: 'declined' });
        // A quien ya firmó le avisa que no se completó; quien rechazó no recibe nada.
        expect(mailbox.to('uno@x.co')[0]?.subject).toContain('No se completó la firma');
        expect(mailbox.to('dos@x.co')).toHaveLength(0);
        await expect(svc.sign(tDos, { name: 'Dos', kind: 'typed', image: png, consent: true }, ip)).rejects.toMatchObject({ status: 410 });
        const [after] = await svc.listForRecord(tenantId, admin, 'contratos', rec.id);
        expect(after).toMatchObject({ status: 'declined' });
        expect(after!.signers[1]).toMatchObject({ status: 'declined', decline_reason: 'Falta una cláusula' });
    });

    it('anular: los enlaces dejan de servir; vencer y recordar en el barrido', async () => {
        mailbox.clear();
        const mk = () =>
            svc.create(tenantId, admin, 'contratos', {
                record_id: recordId,
                source: { kind: 'template', template_id: templateId },
                title: 'Otrosí',
                signers: [{ name: 'Carla', email: 'carla@cliente.co', role: '' }],
                order: 'parallel',
                message: '',
                expires_days: 30,
                verify: 'email',
                remind_days: 1,
                on_complete: { save_field_id: null, status_field_id: null, status_value: null, date_field_id: null },
                send_email: true,
            });
        const a = await mk();
        // El mismo registro y la misma plantilla: el número ya emitido se reusa.
        expect(a.document_number).toBe('CT-0001');
        const tA = tokenOf(mailbox.to('carla@cliente.co').at(-1));
        expect((await svc.void(tenantId, admin, 'contratos', a.id, { reason: 'Se cambió el precio' })).status).toBe('voided');
        await expect(svc.publicView(tA, ip)).rejects.toMatchObject({ status: 404 });
        expect(mailbox.to('carla@cliente.co').at(-1)?.subject).toContain('Se anuló la solicitud de firma');
        await expect(svc.void(tenantId, admin, 'contratos', a.id, { reason: '' })).rejects.toMatchObject({ status: 409 });

        // Recordatorio: pasó más de un día desde que se envió.
        const b = await mk();
        await withTenant(pg.db, tenantId, (tx) => tx.update(signatureSigners).set({ sentAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(signatureSigners.requestId, b.id)));
        mailbox.clear();
        expect(await svc.tick()).toMatchObject({ reminded: 1 });
        expect(mailbox.to('carla@cliente.co')[0]?.subject).toContain('Recordatorio: falta tu firma');
        // No se repite enseguida.
        expect(await svc.tick()).toMatchObject({ reminded: 0 });

        // Vencida.
        await withTenant(pg.db, tenantId, (tx) => tx.update(signatureRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(signatureRequests.id, b.id)));
        expect(await svc.tick()).toMatchObject({ expired: 1 });
        const list = await svc.listForRecord(tenantId, admin, 'contratos', recordId);
        expect(list.find((x) => x.id === b.id)?.status).toBe('expired');
    });
});
