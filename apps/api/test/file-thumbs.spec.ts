import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import type { Field } from '@imagina-base/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { connections, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage, type PresignableStorage, type TenantStorageResolver } from '../src/files/file-storage';
import { SignedFilesController } from '../src/files/files.controller';
import { FilesService } from '../src/files/files.service';
import { sniffImageMime } from '../src/files/image-bytes';
import { ImageThumbsService } from '../src/files/image-thumbs.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.426 — Miniaturas de los archivos y el campo «Imagen».
 *
 * La tabla mostraba el NOMBRE del archivo; ahora muestra la imagen, pero una
 * tabla con 50 fotos de 4 MB no se puede bajar entera: el servidor las achica
 * (`/files/:id/signed?…&w=`) a WebP. Y un campo «Imagen» (`file` con
 * `only_images`) no acepta un PDF.
 */
const rt = new RealtimeService();

/** Una foto «de verdad»: ruido (no se comprime casi nada), 900×600 (AVIF más chica: codificarla es lento). */
async function photo(format: 'png' | 'avif' = 'png'): Promise<Buffer> {
    const [width, height] = format === 'avif' ? [240, 160] : [900, 600];
    const img = sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } });
    return format === 'avif' ? img.avif({ quality: 50, effort: 0 }).toBuffer() : img.png().toBuffer();
}

describe('miniaturas de archivos y campo «Imagen» (Postgres real + storage local)', () => {
    let pg: TestPg;
    let files: FilesService;
    let thumbs: ImageThumbsService;
    let controller: SignedFilesController;
    let records: RecordsService;
    let fieldsSvc: FieldsService;
    let tenantId: number;
    let tenantExt: number;
    let connId: number;
    let userId: number;
    let server: Server;
    let base: string;
    let png: Buffer;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const [t] = await pg.db.insert(tenants).values({ slug: 'fotos', name: 'Fotos' }).returning();
        const [te] = await pg.db.insert(tenants).values({ slug: 'bucket', name: 'Con bucket' }).returning();
        tenantId = t!.id;
        tenantExt = te!.id;
        const [u] = await pg.db.insert(users).values({ email: 'foto@fotos.test', passwordHash: 'x', name: 'Fotógrafa' }).returning();
        userId = u!.id;
        const [c] = await withTenant(pg.db, tenantExt, (tx) => tx.insert(connections).values({ tenantId: tenantExt, name: 'Bucket propio' }).returning());
        connId = c!.id;

        // El almacenamiento propio de una empresa (ADR-S36): la descarga
        // completa REDIRIGE al bucket; la miniatura se lee por el servidor.
        const ext = new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-thumbs-ext-'))) as LocalFileStorage & PresignableStorage;
        ext.presignedGet = async () => 'https://bucket.example/objeto?firma';
        const resolver = {
            choice: async (tid: number) => (tid === tenantExt ? connId : null),
            active: async (tid: number) => (tid === tenantExt ? { connectionId: connId, storage: ext } : null),
            forConnection: async () => ext,
        } as unknown as TenantStorageResolver;

        files = new FilesService(
            tenantDb,
            new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-thumbs-'))),
            loadEnv({ FILES_SIGNING_SECRET: 'test-secret' }),
            resolver,
        );
        thumbs = new ImageThumbsService(tenantDb, files);
        controller = new SignedFilesController(files, thumbs);

        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        records = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        await lists.create(tenantId, { name: 'Productos' });

        // Un servidor HTTP real: el controlador escribe sobre la respuesta cruda.
        server = createServer((req, res) => {
            const u = new URL(req.url ?? '/', 'http://x');
            const id = Number(/\/files\/(\d+)\/signed/.exec(u.pathname)?.[1]);
            const q = (k: string) => u.searchParams.get(k) ?? undefined;
            void controller
                .signed({ headers: req.headers } as never, id, { raw: res } as never, q('tenant'), q('exp'), q('sig'), q('preview'), q('dl'), q('w'))
                .catch((err: { status?: number }) => {
                    res.writeHead(err.status ?? 500);
                    res.end();
                });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        png = await photo('png');
    });

    afterAll(async () => {
        server?.close();
        await pg?.stop();
    });

    const upload = (tid: number, name: string, mime: string, bytes: Buffer) => files.upload(tid, userId, name, mime, Readable.from(bytes));
    const get = (path: string) => fetch(`${base}${path}`);
    const withW = (url: string, w: number | string) => `${url.replace(/&w=\d+/, '')}&w=${w}`;

    it('thumb_url sólo para imágenes; la miniatura sale en WebP, al ancho pedido y más liviana', async () => {
        const img = await upload(tenantId, 'producto.png', 'image/png', png);
        const pdf = await upload(tenantId, 'factura.pdf', 'application/pdf', Buffer.from('%PDF-1.4 falso'));
        const svg = await upload(tenantId, 'logo.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
        const resolved = new Map((await files.resolve(tenantId, [img.id, pdf.id, svg.id])).map((d) => [d.id, d]));
        expect(resolved.get(img.id)!.thumb_url).toBe(`${resolved.get(img.id)!.url}&w=320`);
        expect(resolved.get(pdf.id)!.thumb_url).toBeUndefined();
        expect(resolved.get(svg.id)!.thumb_url).toBeUndefined();

        const res = await get(withW(resolved.get(img.id)!.url, 160));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/webp');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('content-security-policy')).toContain('sandbox');
        expect(res.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.length).toBeLessThan(png.length / 10);
        const meta = await sharp(bytes).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBe(160);
        expect(meta.height).toBe(107);
    });

    it('`w` se ignora para lo que no es una imagen, para un ancho fuera de la lista y al descargar', async () => {
        const img = await upload(tenantId, 'otra.png', 'image/png', png);
        const pdf = await upload(tenantId, 'contrato.pdf', 'application/pdf', Buffer.from('%PDF-1.4 contrato'));

        let res = await get(withW(pdf.url, 160));
        expect(res.headers.get('content-type')).toBe('application/pdf');
        expect(await res.text()).toBe('%PDF-1.4 contrato');

        res = await get(withW(img.url, 150));
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);

        res = await get(`${withW(img.url, 160)}&dl=1`);
        expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
        expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);

        // La firma manda igual: con `w` y una firma alterada, 404 opaco.
        res = await get(withW(img.url.replace(/sig=[0-9a-f]+/, 'sig=00'), 160));
        expect(res.status).toBe(404);
    });

    it('un SVG nunca se achica ni se sirve inline (aunque diga ser PNG)', async () => {
        const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
        const svg = await upload(tenantId, 'logo.svg', 'image/svg+xml', evil);
        let res = await get(withW(svg.url, 160));
        expect(res.headers.get('content-type')).not.toContain('svg');
        expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
        expect(res.headers.get('content-security-policy')).toContain('sandbox');
        await res.arrayBuffer();

        // Un SVG que dice ser PNG: los bytes no son de una imagen → no hay miniatura.
        const liar = await upload(tenantId, 'logo.png', 'image/png', evil);
        expect(await thumbs.attachmentThumb(tenantId, liar.id, 160)).toBeNull();
        res = await get(withW(liar.url, 160));
        expect(res.headers.get('content-type')).not.toBe('image/webp');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        await res.arrayBuffer();
    });

    it('AVIF también se achica a WebP', async () => {
        const avif = await photo('avif');
        expect(sniffImageMime(avif)).toBe('image/avif');
        const dto = await upload(tenantId, 'foto.avif', 'image/avif', avif);
        expect(dto.thumb_url).toBeDefined();
        const res = await get(withW(dto.url, 96));
        expect(res.headers.get('content-type')).toBe('image/webp');
        expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(96);
    });

    it('en el almacenamiento propio de la empresa: la descarga redirige al bucket, la miniatura sale del servidor', async () => {
        const dto = await upload(tenantExt, 'catalogo.png', 'image/png', png);
        expect(dto.external).toBe(true);
        let res = await fetch(`${base}${dto.url}`, { redirect: 'manual' });
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('https://bucket.example/objeto?firma');
        res = await get(dto.thumb_url!.replace('&w=320', '&w=160'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/webp');
        expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(160);
    });

    it('un campo «Imagen» rechaza un PDF al crear y al editar, y acepta una imagen', async () => {
        const admin: Actor = { userId, role: 'admin' };
        const foto: Field = await fieldsSvc.create(tenantId, 'productos', { label: 'Foto', type: 'file', slug: 'foto', config: { only_images: true } });
        expect(foto.config).toMatchObject({ only_images: true });
        const adjunto = await fieldsSvc.create(tenantId, 'productos', { label: 'Adjunto', type: 'file', slug: 'adjunto' });
        const key = `f${foto.id}`;
        const pdf = await upload(tenantId, 'ficha.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
        const img = await upload(tenantId, 'ficha.png', 'image/png', png);

        const err = await records.create(tenantId, admin, 'productos', { data: { [key]: [pdf.id] } }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse() as { message: string; data: { errors: Record<string, string> } };
        expect(body.message).toBe('En «Foto» sólo se pueden subir imágenes (PNG, JPG, GIF, WebP o AVIF).');
        expect(body.data.errors.foto).toBe(body.message);

        // Un campo de archivos común sigue aceptando cualquier cosa.
        const rec = await records.create(tenantId, admin, 'productos', { data: { [key]: [img.id], [`f${adjunto.id}`]: [pdf.id] } });
        expect(rec.data[key]).toEqual([img.id]);

        await expect(records.update(tenantId, admin, 'productos', rec.id, { data: { [key]: [img.id, pdf.id] } })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        const other = await upload(tenantId, 'otra-ficha.png', 'image/png', png);
        const upd = await records.update(tenantId, admin, 'productos', rec.id, { data: { [key]: [img.id, other.id] } });
        expect(upd.data[key]).toEqual([img.id, other.id]);
    });
});

describe('miniaturas: un tope de cuántas se achican a la vez', () => {
    it('ocho imágenes distintas pedidas de golpe se arman de a tres; dos pedidos iguales, una vez', async () => {
        const svc = new ImageThumbsService(null as unknown as TenantDb, null as unknown as FilesService);
        const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#336699' } }).png().toBuffer();
        let running = 0;
        let peak = 0;
        let loads = 0;
        const load = async () => {
            loads++;
            running++;
            peak = Math.max(peak, running);
            await new Promise((r) => setTimeout(r, 30));
            running--;
            return { bytes: png, mime: 'image/png' };
        };
        const all = await Promise.all([...Array.from({ length: 8 }, (_, i) => svc.thumb(`k${i}`, 96, load)), svc.thumb('k0', 96, load)]);
        expect(all.every((img) => img?.mime === 'image/webp')).toBe(true);
        expect(peak).toBe(3);
        expect(loads).toBe(8);
    });
});
