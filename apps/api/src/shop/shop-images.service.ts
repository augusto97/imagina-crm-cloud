import { Injectable, Logger } from '@nestjs/common';
import { SHOP_IMAGE_WIDTHS, type ShopImageWidth } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { imageMimeOf, readCapped } from '../contact-widgets/contact-widgets.service';
import { attachments } from '../db/schema';
import { FilesService } from '../files/files.service';
import { ImageProxyService } from '../files/image-proxy';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * v0.1.412 (ADR-S103) — Las fotos de los productos, en miniatura.
 *
 * Una tienda con 200 fotos de 3 MB sería imposible de abrir en el celular: el
 * servidor sirve cada foto al ancho que pide la página (160, 320, 640, 1200 o 1600)
 * en WebP. La dirección lleva la foto y el ancho, y una foto nunca cambia de
 * contenido (cambiarla cambia el id), así el navegador y Cloudflare la
 * guardan un año.
 *
 * Sólo sirve fotos que están HOY en un producto de esa tienda (lo decide quien
 * llama, con el catálogo en caché): nadie usa la tienda para leer otro archivo
 * de la empresa ni como proxy de imágenes de afuera.
 *
 * Sin `sharp` (un servidor que no lo pudo cargar) se sirve la original si es
 * una imagen chica: la tienda se ve igual, sólo más pesada.
 */

export type ShopImageSource = { kind: 'file'; fileId: number } | { kind: 'url'; url: string };

export interface ShopImage {
    bytes: Buffer;
    mime: string;
}

/** Lo más grande que se lee de una foto subida o de afuera. */
const SOURCE_MAX_BYTES = 12 * 1024 * 1024;
/** Sin `sharp`, la original se sirve sólo si pesa menos que esto. */
const PASSTHROUGH_MAX_BYTES = 3 * 1024 * 1024;
const MEMO_TOTAL_BYTES = 64 * 1024 * 1024;
const MEMO_TTL_MS = 6 * 3600_000;

type SharpFn = (input: Buffer, opts?: Record<string, unknown>) => {
    rotate(): ReturnType<SharpFn>;
    resize(opts: Record<string, unknown>): ReturnType<SharpFn>;
    webp(opts: Record<string, unknown>): ReturnType<SharpFn>;
    toBuffer(): Promise<Buffer>;
};

let sharpLoaded: SharpFn | null | undefined;

/** `sharp` es nativo: si el servidor no lo puede cargar, la tienda sigue andando. */
function loadSharp(log: Logger): SharpFn | null {
    if (sharpLoaded !== undefined) return sharpLoaded;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('sharp') as SharpFn & { default?: SharpFn };
        sharpLoaded = (mod.default ?? mod) as SharpFn;
    } catch (err) {
        log.warn(`No se pudo cargar sharp: las fotos de la tienda se sirven sin achicar (${String(err)}).`);
        sharpLoaded = null;
    }
    return sharpLoaded;
}

export function shopImageWidth(raw: string): ShopImageWidth | null {
    const n = Number(raw);
    return (SHOP_IMAGE_WIDTHS as readonly number[]).includes(n) ? (n as ShopImageWidth) : null;
}

@Injectable()
export class ShopImagesService {
    private readonly logger = new Logger(ShopImagesService.name);
    private readonly memo = new Map<string, { img: ShopImage; at: number }>();
    private memoBytes = 0;
    private readonly loads = new Map<string, Promise<ShopImage | null>>();

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly files: FilesService,
        private readonly proxy: ImageProxyService,
    ) {}

    async thumb(tenantId: number, key: string, source: ShopImageSource, width: ShopImageWidth): Promise<ShopImage | null> {
        const memoKey = `${tenantId}:${key}:${width}`;
        const hit = this.memo.get(memoKey);
        if (hit && Date.now() - hit.at < MEMO_TTL_MS) {
            // Re-insertar: lo usado hace poco queda al final (LRU).
            this.memo.delete(memoKey);
            this.memo.set(memoKey, hit);
            return hit.img;
        }
        let load = this.loads.get(memoKey);
        if (!load) {
            load = this.build(tenantId, source, width).finally(() => this.loads.delete(memoKey));
            this.loads.set(memoKey, load);
        }
        const img = await load;
        if (img) this.remember(memoKey, img);
        return img;
    }

    private remember(key: string, img: ShopImage): void {
        const prev = this.memo.get(key);
        if (prev) {
            this.memoBytes -= prev.img.bytes.length;
            this.memo.delete(key);
        }
        this.memo.set(key, { img, at: Date.now() });
        this.memoBytes += img.bytes.length;
        for (const [k, v] of this.memo) {
            if (this.memoBytes <= MEMO_TOTAL_BYTES) break;
            this.memo.delete(k);
            this.memoBytes -= v.img.bytes.length;
        }
    }

    private async build(tenantId: number, source: ShopImageSource, width: ShopImageWidth): Promise<ShopImage | null> {
        const original = await this.original(tenantId, source);
        if (!original) return null;
        const sharp = loadSharp(this.logger);
        if (!sharp) return original.bytes.length <= PASSTHROUGH_MAX_BYTES ? original : null;
        try {
            const bytes = await sharp(original.bytes, { failOn: 'none', limitInputPixels: 50_000_000 })
                .rotate()
                .resize({ width, withoutEnlargement: true })
                .webp({ quality: width <= 320 ? 72 : 80 })
                .toBuffer();
            return { bytes, mime: 'image/webp' };
        } catch {
            return original.bytes.length <= PASSTHROUGH_MAX_BYTES ? original : null;
        }
    }

    private async original(tenantId: number, source: ShopImageSource): Promise<ShopImage | null> {
        if (source.kind === 'url') {
            try {
                const res = await this.proxy.fetch(source.url);
                const mime = imageMimeOf(res.bytes);
                return mime ? { bytes: res.bytes, mime } : null;
            } catch {
                return null;
            }
        }
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ size: attachments.sizeBytes, storageKey: attachments.storageKey, storageConnectionId: attachments.storageConnectionId })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, source.fileId)))
                .limit(1),
        );
        if (!row || row.size > SOURCE_MAX_BYTES) return null;
        let bytes: Buffer | null;
        try {
            bytes = await readCapped(await this.files.readStream(tenantId, row), SOURCE_MAX_BYTES);
        } catch {
            return null;
        }
        if (!bytes) return null;
        // El tipo sale de los BYTES (nunca del nombre ni de quien lo subió); nada de SVG.
        const mime = imageMimeOf(bytes);
        return mime ? { bytes, mime } : null;
    }
}
