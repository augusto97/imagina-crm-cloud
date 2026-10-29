import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { iconBackgrounds, parsePlatformBrand, PLATFORM_ICON_BASE_KEYS, PLATFORM_ICON_KEYS } from '@imagina-base/shared';
import { PlatformBrandService, pngSize, type BrandStore } from '../src/brand/platform-brand.service';
import { PublicDomainsController } from '../src/domains/domains.controller';
import type { DomainsService } from '../src/domains/domains.service';
import type { FileStorage } from '../src/files/file-storage';
import { buildManifest } from '../src/pwa/manifest';

class MemStore implements BrandStore {
    m = new Map<string, string>();
    async get(k: string) {
        return this.m.get(k) ?? null;
    }
    async set(k: string, v: string) {
        this.m.set(k, v);
        return 'OK';
    }
}

class MemFiles implements FileStorage {
    files = new Map<string, Buffer>();
    async write(key: string, source: Readable): Promise<number> {
        const chunks: Buffer[] = [];
        for await (const c of source) chunks.push(Buffer.from(c as Uint8Array));
        const buf = Buffer.concat(chunks);
        this.files.set(key, buf);
        return buf.length;
    }
    read(key: string): Readable {
        return Readable.from(this.files.get(key)!);
    }
    async delete(key: string): Promise<void> {
        this.files.delete(key);
    }
    async probe(key: string): Promise<boolean> {
        return this.files.has(key);
    }
}

/** Un PNG mínimo válido de `w × h` (sólo la cabecera importa para `pngSize`). */
function png(w: number, h: number): Buffer {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(w, 16);
    buf.writeUInt32BE(h, 20);
    return buf;
}

describe('v0.1.327 — marca de la plataforma', () => {
    it('reconoce el PNG por sus bytes y rechaza lo demás', () => {
        expect(pngSize(png(512, 512))).toEqual({ width: 512, height: 512 });
        expect(pngSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
        expect(pngSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
        expect(pngSize(png(0, 10))).toBeNull();
        expect(pngSize(png(9000, 10))).toBeNull();
    });

    it('sube imágenes, guarda la marca, borra las que dejaron de usarse y sirve sólo nombres válidos', async () => {
        const store = new MemStore();
        const files = new MemFiles();
        const svc = new PlatformBrandService(store, files);

        await expect(svc.uploadImage(Readable.from(Buffer.from('GIF89a......................')))).rejects.toMatchObject({
            response: { code: 'brand_image_type' },
        });
        const logo = await svc.uploadImage(Readable.from(png(640, 160)));
        expect(logo).toMatchObject({ width: 640, height: 160 });
        expect(logo.url).toMatch(/^\/api\/v1\/public\/brand\/images\/[a-f0-9]{32}\.png$/);

        const icons = Object.fromEntries(
            await Promise.all(PLATFORM_ICON_KEYS.map(async (k) => [k, (await svc.uploadImage(Readable.from(png(192, 192)))).url])),
        );
        const saved = await svc.update({ app_name: 'Acme Nube', logo_url: logo.url, icons, icon_background: '#000000' });
        expect(saved.app_name).toBe('Acme Nube');
        expect(JSON.parse(store.m.get('platform:brand')!).logo_url).toBe(logo.url);

        // Una URL con el formato correcto pero que no existe no se acepta.
        await expect(
            svc.update({ app_name: 'X', logo_url: '/api/v1/public/brand/images/00000000000000000000000000000000.png' }),
        ).rejects.toMatchObject({ response: { code: 'brand_image_missing' } });

        // Quitar el logo borra su archivo; los íconos siguen.
        const before = files.files.size;
        await svc.update({ ...saved, logo_url: null });
        expect(files.files.size).toBe(before - 1);
        expect(await svc.openImage(logo.url.split('/').pop()!)).toBeNull();
        expect(await svc.openImage(icons.icon_192!.split('/').pop()!)).not.toBeNull();
        expect(await svc.openImage('../../etc/passwd')).toBeNull();
    });

    it('un valor corrupto o un Redis caído no tumban el login', async () => {
        const store = new MemStore();
        store.m.set('platform:brand', '{no es json');
        expect((await new PlatformBrandService(store, new MemFiles()).get()).app_name).toBe('Imagina Base');
        const broken: BrandStore = {
            get: async () => {
                throw new Error('ECONNREFUSED');
            },
            set: async () => 'OK',
        };
        expect((await new PlatformBrandService(broken, new MemFiles()).get()).logo_url).toBeNull();
        // Campo por campo: un ícono roto no se lleva el nombre.
        expect(parsePlatformBrand({ app_name: 'Acme', icons: { icon_192: 'javascript:alert(1)' } })).toMatchObject({ app_name: 'Acme', icons: null });
    });

    it('el boot público trae la marca de la plataforma junto al tenant del dominio', async () => {
        const store = new MemStore();
        const svc = new PlatformBrandService(store, new MemFiles());
        await svc.update({ app_name: 'Acme Nube' });
        const domains = { resolveHost: async () => ({ tenant: null }) } as unknown as DomainsService;
        const ctrl = new PublicDomainsController(domains, svc);
        const boot = await ctrl.boot({ headers: { host: 'app.acme.test' } } as never);
        expect(boot).toMatchObject({ tenant: null, platform: { app_name: 'Acme Nube', logo_url: null, icons: null } });
    });

    it('v0.1.331: el sitio del producto viaja en el boot; sólo https', async () => {
        const store = new MemStore();
        const svc = new PlatformBrandService(store, new MemFiles());
        await svc.update({ app_name: 'Acme Nube', marketing_url: 'https://imagina.cloud/base' });
        const domains = { resolveHost: async () => ({ tenant: null }) } as unknown as DomainsService;
        const boot = await new PublicDomainsController(domains, svc).boot({ headers: { host: 'app.acme.test' } } as never);
        expect(boot.platform.marketing_url).toBe('https://imagina.cloud/base');
        await expect(svc.update({ app_name: 'X', marketing_url: 'http://imagina.cloud/base' })).rejects.toThrow();
        await expect(svc.update({ app_name: 'X', marketing_url: 'javascript:alert(1)' })).rejects.toThrow();
        // Una marca guardada antes (sin el campo) se lee sin él.
        expect(parsePlatformBrand({ app_name: 'Vieja' }).marketing_url).toBeNull();
        expect(parsePlatformBrand({ app_name: 'Vieja', marketing_url: 'ftp://x' }).marketing_url).toBeNull();
    });

    it('manifiesto: en la plataforma usa su nombre e íconos; en el dominio de una empresa, nunca', () => {
        const url = (k: string) => `/api/v1/public/brand/images/${k.padEnd(32, '0').slice(0, 32).replace(/[^a-f0-9]/g, 'a')}.png`;
        const icons = Object.fromEntries(PLATFORM_ICON_KEYS.map((k) => [k, url(k)])) as never;
        const platform = { app_name: 'Acme Nube', icons };
        const own = buildManifest({ tenant: null, platform });
        expect(own.name).toBe('Acme Nube');
        expect(own.icons.map((i) => i.src)).toEqual([url('icon_192'), url('icon_512'), url('maskable_192'), url('maskable_512')]);
        expect(own.shortcuts[0]!.icons[0]!.src).toBe(url('icon_96'));
        const tenant = buildManifest({ tenant: { name: 'Beta', app_name: null, primary_color: null }, platform });
        expect(tenant.name).toBe('Beta');
        expect(tenant.icons[0]!.src).toBe('/pwa/icon-192.png');
        // Sin nada subido: el ícono neutro de fábrica.
        expect(buildManifest({ tenant: null }).icons[0]!.src).toBe('/pwa/icon-192.png');
    });

    it('v0.1.329: en oscuro el manifiesto usa los íconos con fondo oscuro; un juego viejo sin ellos sigue valiendo', () => {
        const url = (k: string) => `/api/v1/public/brand/images/${k.padEnd(32, '0').slice(0, 32).replace(/[^a-f0-9]/g, 'a')}.png`;
        const full = Object.fromEntries(PLATFORM_ICON_KEYS.map((k) => [k, url(k)])) as never;
        const dark = buildManifest({ tenant: null, platform: { app_name: 'Acme', icons: full }, scheme: 'dark' });
        expect(dark.icons.filter((i) => i.purpose === 'maskable').map((i) => i.src)).toEqual([
            url('maskable_dark_192'),
            url('maskable_dark_512'),
        ]);
        const light = buildManifest({ tenant: null, platform: { app_name: 'Acme', icons: full } });
        expect(light.icons.map((i) => i.src)).not.toContain(url('maskable_dark_192'));
        // Guardado antes de v0.1.329: sin los oscuros, se lee igual y cae a los claros.
        const old = Object.fromEntries(PLATFORM_ICON_BASE_KEYS.map((k) => [k, url(k)]));
        const parsed = parsePlatformBrand({ icons: old, icon_background: '#f4f4f5' });
        expect(parsed.icons?.maskable_512).toBe(url('maskable_512'));
        expect(parsed.icon_background_auto).toBe(true);
        const oldDark = buildManifest({ tenant: null, platform: { app_name: 'Acme', icons: parsed.icons }, scheme: 'dark' });
        expect(oldDark.icons[3]!.src).toBe(url('maskable_512'));
    });

    it('v0.1.329: fondo del ícono igual al de la app (blanco / #121212) o el color elegido', () => {
        expect(iconBackgrounds({ icon_background: '#f4f4f5', icon_background_auto: true })).toEqual({ light: '#ffffff', dark: '#121212' });
        expect(iconBackgrounds({ icon_background: '#00c2d8', icon_background_auto: false })).toEqual({ light: '#00c2d8', dark: '#00c2d8' });
    });
});
