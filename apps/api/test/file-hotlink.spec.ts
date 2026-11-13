import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, Observable } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchContextOf, isCrossSiteEmbed } from '../src/common/hotlink';
import { loadEnv } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { FileBindingInterceptor, sessionBindTag, withFileBinding } from '../src/files/file-binding';
import { LocalFileStorage } from '../src/files/file-storage';
import { MAIL_IMAGE_LOADS_PER_MINUTE, SignedFilesController } from '../src/files/files.controller';
import { FilesService } from '../src/files/files.service';
import type { SessionService } from '../src/auth/session.service';
import { AllowTenantQuery } from '../src/tenancy/allow-tenant-query.decorator';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.427 — Que la app no se use como servidor de imágenes para otros sitios.
 *
 * - Lo que se ve dentro de la app o del portal viaja con una URL ATADA a la
 *   sesión: copiada a otro navegador o a otra página, no abre.
 * - Lo público (la tienda, un formulario) se ve en su página, pero una página
 *   de otro sitio no lo puede usar como su imagen.
 * - Lo de un correo se abre desde cualquier programa de correo, con un tope de
 *   pedidos por minuto y un peso máximo.
 */

/** Sesiones de mentira: las vivas son las del set. */
function fakeSessions(alive: Set<string>): SessionService {
    return { peek: async (t: string) => (alive.has(t) ? { userId: 1 } : null) } as unknown as SessionService;
}

/** Redis en memoria (INCR + EXPIRE): alcanza para el tope por minuto. */
function memRedis() {
    const m = new Map<string, number>();
    return {
        incr: async (k: string) => {
            const n = (m.get(k) ?? 0) + 1;
            m.set(k, n);
            return n;
        },
        expire: async () => 1,
    };
}

function cookiesOf(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (header ?? '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

describe('hotlink: reglas puras', () => {
    const ctx = (h: Record<string, string>) => fetchContextOf({ headers: h, host: 'app.test' });

    it('una página de otro sitio que pide la imagen es «incrustar»; abrir el enlace no', () => {
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'image' }))).toBe(false);
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'image' }))).toBe(false);
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' }))).toBe(false);
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image' }))).toBe(true);
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'empty' }))).toBe(true);
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' }))).toBe(true);
        // Hacer clic en el enlace desde otro sitio (WhatsApp Web, un correo web).
        expect(isCrossSiteEmbed(ctx({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' }))).toBe(false);
    });

    it('sin Fetch Metadata decide el Referer; sin nada es un servidor (proxy de correo) y pasa', () => {
        expect(isCrossSiteEmbed(ctx({ referer: 'https://otro-sitio.com/pagina' }))).toBe(true);
        expect(isCrossSiteEmbed(ctx({ referer: 'https://app.test/lista' }))).toBe(false);
        expect(isCrossSiteEmbed(ctx({}))).toBe(false);
        expect(isCrossSiteEmbed(ctx({ referer: 'android-app://com.whatsapp' }))).toBe(false);
    });
});

describe('URLs de archivos atadas a la sesión y freno a otros sitios (Postgres real + storage local)', () => {
    let pg: TestPg;
    let files: FilesService;
    let controller: SignedFilesController;
    let tenantId: number;
    let userId: number;
    let server: Server;
    let base: string;
    const alive = new Set(['tok-ana', 'tok-portal']);

    beforeAll(async () => {
        pg = await startPostgres();
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        userId = u!.id;
        await pg.db.insert(memberships).values({ tenantId, userId, role: 'admin' });
        files = new FilesService(
            new TenantDb(pg.db),
            new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-hotlink-'))),
            loadEnv({ FILES_SIGNING_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' }),
        );
        controller = new SignedFilesController(files, undefined, fakeSessions(alive), memRedis() as never);
        server = createServer((req, res) => {
            const u = new URL(req.url ?? '/', 'http://x');
            const id = Number(/\/files\/(\d+)\/signed/.exec(u.pathname)?.[1]);
            const q = (k: string) => u.searchParams.get(k) ?? undefined;
            const fake = { headers: req.headers, cookies: cookiesOf(req.headers.cookie), host: 'app.test' };
            void controller
                .signed(fake as never, id, { raw: res } as never, q('tenant'), q('exp'), q('sig'), q('preview'), q('dl'), q('w'), q('b'))
                .catch((err: { status?: number }) => {
                    res.writeHead(err.status ?? 500);
                    res.end();
                });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        server?.close();
        await pg?.stop();
    });

    const upload = (name: string, mime: string, bytes: Buffer) => files.upload(tenantId, userId, name, mime, Readable.from(bytes));
    const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers });
    const IMG = { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'image' };
    const OTHER_SITE = { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image' };

    it('dentro de un pedido con sesión la URL queda atada a esa sesión; fuera, no', async () => {
        const f = await upload('foto.png', 'image/png', Buffer.from('png falso'));
        const loose = files.signedUrl(tenantId, f.id, 3600);
        expect(loose).not.toContain('&b=');
        const bound = withFileBinding('tok-ana', () => files.signedUrl(tenantId, f.id, 3600));
        expect(bound).toContain(`&b=${sessionBindTag('tok-ana')}`);
        // La de un correo dura mucho: sale de la app, nunca se ata.
        expect(withFileBinding('tok-ana', () => files.signedUrl(tenantId, f.id, 30 * 24 * 3600))).not.toContain('&b=');
        expect(withFileBinding('tok-ana', () => files.signedUrl(tenantId, f.id, 3600, { bind: null }))).not.toContain('&b=');
        // La etiqueta no deja deducir la sesión.
        expect(sessionBindTag('tok-ana')).not.toContain('tok-ana');
    });

    it('la URL atada sólo abre con esa sesión viva: copiada a otro navegador, 404', async () => {
        const f = await upload('ficha.png', 'image/png', Buffer.from('bytes'));
        const url = withFileBinding('tok-ana', () => files.signedUrl(tenantId, f.id, 3600));
        expect((await get(url, IMG)).status).toBe(404); // sin cookie
        expect((await get(url, { ...IMG, cookie: 'imbase_session=otra' })).status).toBe(404);
        const ok = await get(url, { ...IMG, cookie: 'imbase_session=tok-ana' });
        expect(ok.status).toBe(200);
        expect(ok.headers.get('cross-origin-resource-policy')).toBe('same-site');
        expect(ok.headers.get('cache-control')).toContain('private');
        // Sacarle la etiqueta (para usarla sin sesión) rompe la firma.
        expect((await get(url.replace(/&b=[^&]+/, ''), IMG)).status).toBe(404);
        // Cerrar la sesión deja de servir sus URLs.
        alive.delete('tok-ana');
        expect((await get(url, { ...IMG, cookie: 'imbase_session=tok-ana' })).status).toBe(404);
        alive.add('tok-ana');
        // La del portal viaja en su propia cookie.
        const portal = withFileBinding('tok-portal', () => files.signedUrl(tenantId, f.id, 86_400));
        expect((await get(portal, { ...IMG, cookie: 'imbase_portal=tok-portal' })).status).toBe(200);
        expect((await get(portal, IMG)).status).toBe(404);
    });

    it('una URL pública se ve en su página; otro sitio no la puede usar como su imagen', async () => {
        const f = await upload('producto.png', 'image/png', Buffer.from('foto'));
        const url = files.signedUrl(tenantId, f.id, 3600);
        const same = await get(url, IMG);
        expect(same.status).toBe(200);
        expect(same.headers.get('cross-origin-resource-policy')).toBe('same-site');
        const other = await get(url, OTHER_SITE);
        expect(other.status).toBe(403);
        expect(other.headers.get('cache-control')).toBe('no-store');
        // Abrir el enlace (clic desde otro sitio) sí.
        expect((await get(url, { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' })).status).toBe(200);
        // Navegador viejo sin Fetch Metadata: decide el Referer.
        expect((await get(url, { referer: 'https://otro-sitio.com/' })).status).toBe(403);
        expect((await get(url, { referer: 'https://app.test/tienda' })).status).toBe(200);
    });

    it('la imagen de un correo se abre desde cualquier lado, con un tope por minuto', async () => {
        const f = await upload('logo.png', 'image/png', Buffer.from('logo'));
        const url = await files.publicImageUrl(tenantId, f.id);
        expect(url.startsWith('https://app.test/api/v1/files/')).toBe(true);
        const path = url.replace('https://app.test', '');
        // Un proxy de correo (sin Fetch Metadata) no cuenta para el tope.
        for (let i = 0; i < 3; i++) expect((await get(path)).status).toBe(200);
        const first = await get(path, OTHER_SITE);
        expect(first.status).toBe(200);
        expect(first.headers.get('cross-origin-resource-policy')).toBeNull();
        expect(first.headers.get('cache-control')).toMatch(/max-age=31536000/);
        for (let i = 1; i < MAIL_IMAGE_LOADS_PER_MINUTE; i++) await get(path, OTHER_SITE);
        const over = await get(path, OTHER_SITE);
        expect(over.status).toBe(429);
        expect(over.headers.get('cache-control')).toBe('no-store');
        // El proxy sigue pasando.
        expect((await get(path)).status).toBe(200);
    });

    it('una imagen de correo de más de 3 MB se rechaza con el motivo', async () => {
        const big = await upload('enorme.png', 'image/png', Buffer.alloc(3 * 1024 * 1024 + 10, 7));
        await expect(files.publicImageUrl(tenantId, big.id)).rejects.toMatchObject({ response: { code: 'email_image_too_large' } });
    });

    it('el interceptor ata las URLs que arma el controlador a la sesión del pedido', async () => {
        const f = await upload('x.png', 'image/png', Buffer.from('x'));
        const ctx = (token?: string) =>
            ({ switchToHttp: () => ({ getRequest: () => ({ sessionToken: token }) }) }) as unknown as ExecutionContext;
        const handler = { handle: () => new Observable<string>((s) => void Promise.resolve().then(() => { s.next(files.signedUrl(tenantId, f.id, 3600)); s.complete(); })) };
        const interceptor = new FileBindingInterceptor();
        expect(await lastValueFrom(interceptor.intercept(ctx('tok-ana'), handler) as Observable<string>)).toContain(`&b=${sessionBindTag('tok-ana')}`);
        expect(await lastValueFrom(interceptor.intercept(ctx(undefined), handler) as Observable<string>)).not.toContain('&b=');
    });

    it('la empresa puede venir en ?t= sólo en las lecturas marcadas (una <img> no manda el header)', async () => {
        class Probe {
            @AllowTenantQuery()
            view(): void {}
            other(): void {}
        }
        const guard = new TenantGuard(new TenantDb(pg.db), new Reflector());
        const run = (handler: () => void, method = 'GET') => {
            const req = { method, headers: {}, query: { t: String(tenantId) }, authUserId: userId } as unknown as Record<string, unknown>;
            const ctx = {
                switchToHttp: () => ({ getRequest: () => req }),
                getHandler: () => handler,
                getClass: () => Probe,
            } as unknown as ExecutionContext;
            return guard.canActivate(ctx).then(() => req);
        };
        const req = await run(Probe.prototype.view);
        expect((req.tenant as { tenantId: number }).tenantId).toBe(tenantId);
        await expect(run(Probe.prototype.other)).rejects.toThrow(/X-Tenant-Id/);
        await expect(run(Probe.prototype.view, 'POST')).rejects.toThrow(/X-Tenant-Id/);
    });
});
