import { Readable } from 'node:stream';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { s3ConfigFromCreds, verifyS3 } from '../src/connectors/storage-s3';
import { TenantStorageService } from '../src/connectors/tenant-storage.service';
import { attachments, connections, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { encryptSecret } from '../src/common/secret-box';
import { DRIVE_FOLDER_NAME } from '../src/connectors/storage-drive';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService, type OpenedFile } from '../src/files/files.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { startFakeDrive, type FakeDrive } from './helpers/fake-drive';
import { startFakeS3, type FakeS3 } from './helpers/fake-s3';
import { memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.268 (ADR-S36) — almacenamiento propio de la empresa. El bucket es un
 * S3 mínimo en proceso (no hay imagen de MinIO en CI): lo que se prueba es lo
 * nuestro — dónde va cada archivo, que no cuente para el plan, la descarga
 * directa, la mudanza en los dos sentidos y que nada se pierda en silencio.
 */
const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

const creds = (endpoint: string, over: Record<string, string> = {}) => ({
    secret: 'secreto',
    accessToken: '',
    signingSecret: '',
    fields: { endpoint, region: 'us-east-1', bucket: 'empresa', access_key_id: 'AKIA', path_style: 'true', prefix: '', ...over },
});

describe('config del bucket (puro)', () => {
    it('exige https y no deja apuntar a la red interna', () => {
        expect(s3ConfigFromCreds(creds('http://s3.ejemplo.com'))).toMatchObject({ ok: false });
        expect(s3ConfigFromCreds(creds('https://127.0.0.1:9000'))).toMatchObject({ ok: false });
        expect(s3ConfigFromCreds(creds('https://[::ffff:a9fe:a9fe]'))).toMatchObject({ ok: false });
        expect(s3ConfigFromCreds(creds('https://s3.ejemplo.com/empresa'))).toMatchObject({ ok: false });
        const ok = s3ConfigFromCreds(creds('s3.us-east-005.backblazeb2.com/'));
        expect(ok).toMatchObject({ ok: true, label: 'empresa · s3.us-east-005.backblazeb2.com' });
        if (ok.ok) {
            expect(ok.config.endpoint).toBe('https://s3.us-east-005.backblazeb2.com');
            expect(ok.config.guard).toBe(true);
        }
        // Vacío = Amazon S3.
        expect(s3ConfigFromCreds(creds(''))).toMatchObject({ ok: true, label: 'empresa · Amazon S3' });
        expect(s3ConfigFromCreds(creds('', { bucket: '' }))).toMatchObject({ ok: false, error: 'Falta el bucket.' });
    });
});

describe('almacenamiento propio de la empresa', () => {
    let pg: TestPg;
    let s3: FakeS3;
    let connectors: ConnectorsService;
    let storage: TenantStorageService;
    let files: FilesService;
    let billing: BillingService;
    let uploadsDir: string;
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;
    let connId: number;

    async function drain(f: OpenedFile): Promise<string> {
        if (f.kind === 'redirect') {
            const res = await fetch(f.url);
            expect(res.status).toBe(200);
            return res.text();
        }
        const chunks: Buffer[] = [];
        for await (const c of f.stream) chunks.push(Buffer.from(c as Buffer));
        return Buffer.concat(chunks).toString('utf8');
    }

    beforeAll(async () => {
        pg = await startPostgres();
        s3 = await startFakeS3(['empresa', 'otro']);
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, STORAGE_ALLOW_PRIVATE_HOSTS: 'true', FILES_SIGNING_SECRET: 'x'.repeat(32) });
        const store = memoryOAuthStore();
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, new AuditService(tenantDb), new IntegrationAppsService(store, env));
        storage = new TenantStorageService(pg.db, env, tenantDb, connectors);
        uploadsDir = mkdtempSync(join(tmpdir(), 'imb-ts-'));
        files = new FilesService(tenantDb, new LocalFileStorage(uploadsDir), env, storage);
        const plans = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
    }, 120_000);

    afterAll(async () => {
        await s3?.close();
        await pg?.stop();
    });

    it('verifica la credencial subiendo, leyendo y borrando un archivo', async () => {
        const ok = await verifyS3(creds(s3.endpoint), { allowPrivate: true });
        expect(ok).toMatchObject({ ok: true, label: `empresa · 127.0.0.1` });
        // No deja el archivo de prueba.
        expect([...s3.objects.keys()]).toEqual([]);
        const bad = await verifyS3(creds(s3.endpoint, { bucket: 'no-existe' }), { allowPrivate: true });
        expect(bad.ok).toBe(false);
        expect(bad.error).toMatch(/bucket/i);
    });

    it('conectar: la credencial se prueba antes de guardarse y queda cifrada', async () => {
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 's3', {
                fields: { ...creds(s3.endpoint, { bucket: 'nada' }).fields, secret_access_key: 'secreto' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow();
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 's3', {
            fields: { ...creds(s3.endpoint).fields, secret_access_key: 'secreto' },
            visibility: 'workspace',
        });
        connId = connection.id;
        const cands = await storage.candidates(tenantId);
        expect(cands).toEqual([expect.objectContaining({ id: connId, problem: null, detail: 'empresa · 127.0.0.1' })]);
        // Otra empresa no la ve ni la puede elegir.
        expect(await storage.candidates(otherTenant)).toEqual([]);
        await expect(storage.set(otherTenant, connId)).rejects.toThrow(/no existe/);
    });

    it('lo que se sube va al bucket, no cuenta para el plan y se descarga directo de ahí', async () => {
        const local = await files.upload(tenantId, adminId, 'antes.txt', 'text/plain', Readable.from(Buffer.from('EN-EL-SERVIDOR')));
        expect(local.external).toBe(false);

        await storage.set(tenantId, connId);
        expect(await files.uploadsExternally(tenantId)).toBe(true);
        const ext = await files.upload(tenantId, adminId, 'Cuenta de cobro.pdf', 'application/pdf', Readable.from(Buffer.from('%PDF-EN-EL-BUCKET')));
        expect(ext.external).toBe(true);
        expect([...s3.objects.values()].map((o) => o.body.toString())).toEqual(['%PDF-EN-EL-BUCKET']);
        const [row] = await pg.db.select().from(attachments).where(eq(attachments.id, ext.id));
        expect(row!.storageConnectionId).toBe(connId);

        // El plan sólo cuenta lo del servidor.
        const summary = await billing.summary(tenantId);
        expect(summary.usage.storage_bytes).toBe('EN-EL-SERVIDOR'.length);

        // Descarga: redirección al enlace temporal del bucket, con su nombre.
        const dl = await files.openDownload(tenantId, ext.id);
        expect(dl.kind).toBe('redirect');
        if (dl.kind === 'redirect') {
            const res = await fetch(dl.url);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-disposition')).toContain('Cuenta de cobro.pdf');
            expect(await res.text()).toBe('%PDF-EN-EL-BUCKET');
        }
        // La URL firmada propia (portal, {{pdf.link}}) también lleva ahí.
        const q = new URL(ext.url, 'http://x').searchParams;
        const signed = await files.openSigned(ext.id, tenantId, Number(q.get('exp')), q.get('sig')!);
        expect(await drain(signed)).toBe('%PDF-EN-EL-BUCKET');
        // Lecturas internas (imágenes de un PDF, exportar la empresa).
        const stream = await files.readStream(tenantId, { storageKey: row!.storageKey, storageConnectionId: connId });
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
        expect(Buffer.concat(chunks).toString()).toBe('%PDF-EN-EL-BUCKET');
        // Lo de antes sigue en el servidor y se sirve igual.
        expect(await drain(await files.openDownload(tenantId, local.id))).toBe('EN-EL-SERVIDOR');
    });

    it('bucket caído: la subida FALLA con el motivo, sin caer al servidor en silencio', async () => {
        const before = await pg.db.select().from(attachments);
        s3.down = true;
        try {
            await expect(
                files.upload(tenantId, adminId, 'x.txt', 'text/plain', Readable.from(Buffer.from('x'))),
            ).rejects.toBeInstanceOf(ServiceUnavailableException);
        } finally {
            s3.down = false;
        }
        expect((await pg.db.select().from(attachments)).length).toBe(before.length);
    });

    it('no se puede borrar ni re-apuntar la conexión que tiene los archivos', async () => {
        await expect(connectors.remove(tenantId, adminId, 'admin', connId, true)).rejects.toMatchObject({
            response: { code: 'connection_storage' },
        });
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 's3', {
                connection_id: connId,
                fields: { bucket: 'otro' },
                visibility: 'workspace',
            }),
        ).rejects.toBeInstanceOf(ConflictException);
        // Rotar la clave sí se puede.
        await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 's3', {
            connection_id: connId,
            fields: { secret_access_key: 'secreto-nuevo' },
            visibility: 'workspace',
        });
        await storage.clear(tenantId);
        // Ya no es la elegida, pero todavía guarda archivos.
        await expect(connectors.remove(tenantId, adminId, 'admin', connId, true)).rejects.toMatchObject({
            response: { code: 'connection_storage_files' },
        });
    });

    it('mudanza en los dos sentidos, por tandas, sin perder nada', async () => {
        await storage.set(tenantId, connId);
        const toBucket = await files.moveBatch(tenantId, 'connection', null);
        expect(toBucket).toMatchObject({ moved: 1, failed: [], remaining: 0 });
        // El archivo del servidor se fue del disco.
        expect(readdirSync(join(uploadsDir, `t${tenantId}`))).toEqual([]);
        expect((await billing.summary(tenantId)).usage.storage_bytes).toBe(0);

        // De vuelta: sin lugar en el plan no se mueve (y se dice por qué).
        const full = await files.moveBatch(tenantId, 'platform', 3);
        expect(full.moved).toBe(0);
        expect(full.failed[0]!.error).toMatch(/espacio de tu plan/);

        await storage.clear(tenantId);
        const back = await files.moveBatch(tenantId, 'platform', null);
        expect(back).toMatchObject({ moved: 2, remaining: 0 });
        expect(s3.objects.size).toBe(0);
        const all = await pg.db.select().from(attachments).where(eq(attachments.tenantId, tenantId));
        for (const a of all) expect(await drain(await files.openDownload(tenantId, a.id))).toMatch(/SERVIDOR|BUCKET/);

        // Vacía y sin elegir: ahora sí se borra.
        await connectors.remove(tenantId, adminId, 'admin', connId, true);
    });
});

describe('almacenamiento en Google Drive (v0.1.269)', () => {
    let pg: TestPg;
    let drive: FakeDrive;
    let connectors: ConnectorsService;
    let storage: TenantStorageService;
    let files: FilesService;
    let billing: BillingService;
    let tenantId: number;
    let adminId: number;
    let driveId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        drive = await startFakeDrive();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, FILES_SIGNING_SECRET: 'x'.repeat(32), GOOGLE_DRIVE_API_URL: drive.apiBase });
        const store = memoryOAuthStore();
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, new AuditService(tenantDb), new IntegrationAppsService(store, env));
        storage = new TenantStorageService(pg.db, env, tenantDb, connectors);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-gd-'))), env, storage);
        const plans = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        adminId = u!.id;
        const [c] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: 'google_drive',
                    name: 'Google Drive · ana@acme.test',
                    authType: 'oauth2',
                    visibility: 'workspace',
                    ownerUserId: adminId,
                    config: { account_label: 'ana@acme.test', oauth_state: { expiresAt: Date.now() + 3600_000, scope: '', error: null } },
                    secrets: { access_token: encryptSecret(drive.token, KEY), refresh_token: encryptSecret('r', KEY) },
                })
                .returning({ id: connections.id }),
        );
        driveId = c!.id;
    }, 120_000);

    afterAll(async () => {
        await drive?.close();
        await pg?.stop();
    });

    async function text(f: OpenedFile): Promise<string> {
        expect(f.kind).toBe('stream'); // Drive no tiene enlaces prefirmados: pasa por el servidor.
        if (f.kind !== 'stream') return '';
        const chunks: Buffer[] = [];
        for await (const c of f.stream) chunks.push(Buffer.from(c as Buffer));
        return Buffer.concat(chunks).toString();
    }

    it('un token que Google rechaza no se puede elegir (y se dice qué hacer)', async () => {
        const good = drive.token;
        drive.token = 'otro';
        try {
            await expect(storage.set(tenantId, driveId)).rejects.toMatchObject({
                response: { code: 'storage_not_ready', message: expect.stringMatching(/reconectá/) },
            });
        } finally {
            drive.token = good;
        }
    });

    it('elegirlo crea la carpeta «Imagina Base», prueba un archivo y la recuerda', async () => {
        const cands = await storage.candidates(tenantId);
        expect(cands).toEqual([expect.objectContaining({ id: driveId, integration: 'google_drive', detail: 'ana@acme.test', problem: null })]);
        await storage.set(tenantId, driveId);
        const folders = [...drive.files.entries()].filter(([, f]) => f.folder);
        expect(folders.map(([, f]) => f.name)).toEqual([DRIVE_FOLDER_NAME]);
        // El archivo de prueba no quedó.
        expect([...drive.files.values()].filter((f) => !f.folder)).toEqual([]);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, driveId)));
        expect((row!.config as Record<string, unknown>).storage_folder_id).toBe(folders[0]![0]);
    });

    it('lo que se sube va a la carpeta del Drive, no cuenta para el plan y se descarga por el servidor', async () => {
        const dto = await files.upload(tenantId, adminId, 'Contrato.pdf', 'application/pdf', Readable.from(Buffer.from('%PDF-EN-DRIVE')));
        expect(dto.external).toBe(true);
        const [att] = await pg.db.select().from(attachments).where(eq(attachments.id, dto.id));
        expect(att!.storageKey).toMatch(/^gdrive:file_/);
        const inDrive = drive.files.get(att!.storageKey.slice('gdrive:'.length))!;
        expect(inDrive.body.toString()).toBe('%PDF-EN-DRIVE');
        // En la carpeta se ve con su nombre real, no con la clave interna.
        expect(inDrive.name).toBe('Contrato.pdf');
        expect(drive.files.get(inDrive.parents[0]!)!.name).toBe(DRIVE_FOLDER_NAME);
        expect(await text(await files.openDownload(tenantId, dto.id))).toBe('%PDF-EN-DRIVE');
        expect((await billing.summary(tenantId)).usage.storage_bytes).toBe(0);
    });

    it('si borraron la carpeta desde el Drive, se crea de nuevo; Drive lleno → falla con el motivo', async () => {
        for (const [id, f] of drive.files) if (f.folder) drive.files.delete(id);
        const dto = await files.upload(tenantId, adminId, 'otro.txt', 'text/plain', Readable.from(Buffer.from('DE NUEVO')));
        expect(await text(await files.openDownload(tenantId, dto.id))).toBe('DE NUEVO');
        drive.full = true;
        try {
            await expect(files.upload(tenantId, adminId, 'x.txt', 'text/plain', Readable.from(Buffer.from('x')))).rejects.toMatchObject({
                response: { code: 'storage_unavailable', message: expect.stringMatching(/Drive de la empresa está lleno/) },
            });
        } finally {
            drive.full = false;
        }
    });

    it('mudanza Drive ↔ servidor con su propia clave, y la conexión con archivos no se borra', async () => {
        const local = await (async () => {
            await storage.clear(tenantId);
            return files.upload(tenantId, adminId, 'local.txt', 'text/plain', Readable.from(Buffer.from('LOCAL')));
        })();
        await storage.set(tenantId, driveId);
        const up = await files.moveBatch(tenantId, 'connection', null);
        expect(up).toMatchObject({ moved: 1, failed: [], remaining: 0 });
        const [moved] = await pg.db.select().from(attachments).where(eq(attachments.id, local.id));
        expect(moved!.storageKey).toMatch(/^gdrive:/);
        expect(await text(await files.openDownload(tenantId, local.id))).toBe('LOCAL');

        await expect(connectors.remove(tenantId, adminId, 'admin', driveId, true)).rejects.toMatchObject({ response: { code: 'connection_storage' } });
        await expect(connectors.disconnectOAuth(tenantId, adminId, 'admin', driveId)).rejects.toMatchObject({ response: { code: 'connection_storage' } });

        await storage.clear(tenantId);
        const back = await files.moveBatch(tenantId, 'platform', null);
        expect(back).toMatchObject({ moved: 3, remaining: 0 });
        const rows = await pg.db.select().from(attachments).where(eq(attachments.tenantId, tenantId));
        for (const r of rows) {
            expect(r.storageConnectionId).toBeNull();
            expect(r.storageKey).toMatch(new RegExp(`^t${tenantId}/${r.id}\\.`));
        }
        expect([...drive.files.values()].filter((f) => !f.folder)).toEqual([]);
        await connectors.remove(tenantId, adminId, 'admin', driveId, true);
    });
});
