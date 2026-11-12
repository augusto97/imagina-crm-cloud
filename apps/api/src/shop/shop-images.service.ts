import { Injectable, Optional } from '@nestjs/common';
import { SHOP_IMAGE_WIDTHS, type ShopImageWidth } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { attachments } from '../db/schema';
import { FilesService } from '../files/files.service';
import { readCapped, sniffImageMime } from '../files/image-bytes';
import { ImageProxyService } from '../files/image-proxy';
import { ImageThumbsService } from '../files/image-thumbs.service';
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
 * v0.1.426 — el achicado (sharp, memoria y pedidos simultáneos) se mudó a
 * `ImageThumbsService`, que también arma las miniaturas de los campos de
 * archivos; aquí queda de dónde sale cada foto de la tienda.
 */

export type ShopImageSource = { kind: 'file'; fileId: number } | { kind: 'url'; url: string };

export interface ShopImage {
    bytes: Buffer;
    mime: string;
}

/** Lo más grande que se lee de una foto subida o de afuera. */
const SOURCE_MAX_BYTES = 12 * 1024 * 1024;

export function shopImageWidth(raw: string): ShopImageWidth | null {
    const n = Number(raw);
    return (SHOP_IMAGE_WIDTHS as readonly number[]).includes(n) ? (n as ShopImageWidth) : null;
}

@Injectable()
export class ShopImagesService {
    private readonly thumbs: ImageThumbsService;

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly files: FilesService,
        private readonly proxy: ImageProxyService,
        // Lo provee el módulo de archivos; los specs que arman el servicio a
        // mano no lo pasan y usan uno propio.
        @Optional() thumbs?: ImageThumbsService,
    ) {
        this.thumbs = thumbs ?? new ImageThumbsService(tenantDb, files);
    }

    async thumb(tenantId: number, key: string, source: ShopImageSource, width: ShopImageWidth): Promise<ShopImage | null> {
        return this.thumbs.thumb(`shop:${tenantId}:${key}:${width}`, width, () => this.original(tenantId, source));
    }

    private async original(tenantId: number, source: ShopImageSource): Promise<ShopImage | null> {
        if (source.kind === 'url') {
            try {
                const res = await this.proxy.fetch(source.url);
                const mime = sniffImageMime(res.bytes);
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
        const mime = sniffImageMime(bytes);
        return mime ? { bytes, mime } : null;
    }
}
