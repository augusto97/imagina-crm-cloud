import { Injectable, Logger } from '@nestjs/common';
import { isImageFileMime } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { attachments } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { FilesService } from './files.service';
import { readCapped, sniffImageMime } from './image-bytes';

/**
 * v0.1.426 — Miniaturas de imágenes (antes vivía sólo en la tienda, v0.1.412).
 *
 * Una tabla con 50 filas de fotos de 4 MB sería imposible de abrir en el
 * celular: el servidor achica cada imagen al ancho que se pide y la entrega en
 * WebP. Lo usan la tienda (fotos de productos) y las miniaturas de los campos
 * de archivos (`/files/:id/signed?…&w=`).
 *
 * - El tipo sale de los BYTES (nunca del nombre ni de quien la subió); SVG,
 *   HEIC o cualquier otra cosa no se achica (quien llama sirve el original).
 * - Una imagen nunca cambia de contenido (cambiarla cambia el id): se guarda
 *   en memoria con un tope de bytes (LRU) y dos pedidos iguales a la vez la
 *   arman una sola vez.
 * - Sin `sharp` (un servidor que no lo pudo cargar) se sirve la original si es
 *   una imagen chica: se ve igual, sólo más pesada.
 */

export interface ImageBytes {
    bytes: Buffer;
    mime: string;
}

/** Lo más grande que se lee de un adjunto para achicarlo (el tope de subida es 20 MB). */
const ATTACHMENT_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
/** Sin `sharp`, la original se sirve sólo si pesa menos que esto. */
const PASSTHROUGH_MAX_BYTES = 3 * 1024 * 1024;
const MEMO_TOTAL_BYTES = 64 * 1024 * 1024;
const MEMO_TTL_MS = 6 * 3600_000;
/** Lo que NO se pudo achicar (no es una imagen, está dañada): no se vuelve a leer por un rato. */
const MISS_TTL_MS = 10 * 60_000;
const MISS_MAX = 2000;
/**
 * Cuántas imágenes se achican a la vez en este proceso. Cada una se lee
 * entera (hasta 25 MB): una tabla con 50 fotos grandes abiertas de golpe no
 * puede pedir 50 a la vez sin llenar la memoria. Lo demás espera su turno.
 */
const MAX_PARALLEL_BUILDS = 3;

type SharpFn = (input: Buffer, opts?: Record<string, unknown>) => {
    rotate(): ReturnType<SharpFn>;
    resize(opts: Record<string, unknown>): ReturnType<SharpFn>;
    webp(opts: Record<string, unknown>): ReturnType<SharpFn>;
    toBuffer(): Promise<Buffer>;
};

let sharpLoaded: SharpFn | null | undefined;

/** `sharp` es nativo: si el servidor no lo puede cargar, todo sigue andando. */
function loadSharp(log: Logger): SharpFn | null {
    if (sharpLoaded !== undefined) return sharpLoaded;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('sharp') as SharpFn & { default?: SharpFn };
        sharpLoaded = (mod.default ?? mod) as SharpFn;
    } catch (err) {
        log.warn(`No se pudo cargar sharp: las imágenes se sirven sin achicar (${String(err)}).`);
        sharpLoaded = null;
    }
    return sharpLoaded;
}

@Injectable()
export class ImageThumbsService {
    private readonly logger = new Logger(ImageThumbsService.name);
    private readonly memo = new Map<string, { img: ImageBytes; at: number }>();
    private memoBytes = 0;
    private readonly misses = new Map<string, number>();
    private readonly loads = new Map<string, Promise<ImageBytes | null>>();
    private building = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly files: FilesService,
    ) {}

    /**
     * La miniatura de `memoKey` a `width` px de ancho. `load` trae la imagen
     * original (ya reconocida por sus bytes) o null si no es una imagen.
     */
    async thumb(
        memoKey: string,
        width: number,
        load: () => Promise<ImageBytes | null>,
        opts: { rememberMiss?: boolean } = {},
    ): Promise<ImageBytes | null> {
        const hit = this.memo.get(memoKey);
        if (hit && Date.now() - hit.at < MEMO_TTL_MS) {
            // Re-insertar: lo usado hace poco queda al final (LRU).
            this.memo.delete(memoKey);
            this.memo.set(memoKey, hit);
            return hit.img;
        }
        const missAt = this.misses.get(memoKey);
        if (missAt !== undefined && Date.now() - missAt < MISS_TTL_MS) return null;
        let pending = this.loads.get(memoKey);
        if (!pending) {
            pending = this.limited(() => this.build(width, load)).finally(() => this.loads.delete(memoKey));
            this.loads.set(memoKey, pending);
        }
        const img = await pending;
        if (img) this.remember(memoKey, img);
        else if (opts.rememberMiss) this.rememberMiss(memoKey);
        return img;
    }

    /**
     * La miniatura de un ADJUNTO de la empresa. Quien llama ya decidió que la
     * persona puede ver ese archivo (URL firmada, catálogo de la tienda). Null
     * si no es una imagen (por su tipo guardado o por sus bytes), si es
     * demasiado grande o si no se pudo leer: quien llama sirve el original.
     */
    async attachmentThumb(tenantId: number, fileId: number, width: number): Promise<ImageBytes | null> {
        return this.thumb(`att:${tenantId}:${fileId}:${width}`, width, () => this.attachmentImage(tenantId, fileId), { rememberMiss: true });
    }

    /** Los bytes de un adjunto que es una imagen de verdad (o null). Esté donde esté guardado. */
    async attachmentImage(tenantId: number, fileId: number, maxBytes = ATTACHMENT_SOURCE_MAX_BYTES): Promise<ImageBytes | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    mime: attachments.mime,
                    size: attachments.sizeBytes,
                    storageKey: attachments.storageKey,
                    storageConnectionId: attachments.storageConnectionId,
                })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, fileId)))
                .limit(1),
        );
        // Lo que no DICE ser una imagen ni se lee (un PDF de 20 MB pedido con
        // `?w=` no cuesta nada); lo que dice serlo se confirma por sus bytes.
        if (!row || !isImageFileMime(row.mime) || row.size > maxBytes) return null;
        let bytes: Buffer | null;
        try {
            // Por `readStream`, no por el enlace directo: también sirve con el
            // almacenamiento propio de la empresa (S3 / Drive, ADR-S36).
            bytes = await readCapped(await this.files.readStream(tenantId, row), maxBytes);
        } catch {
            return null;
        }
        if (!bytes) return null;
        const mime = sniffImageMime(bytes);
        return mime ? { bytes, mime } : null;
    }

    /** Corre `job` cuando hay lugar (ver MAX_PARALLEL_BUILDS). */
    private async limited<T>(job: () => Promise<T>): Promise<T> {
        if (this.building >= MAX_PARALLEL_BUILDS) {
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        } else {
            this.building++;
        }
        try {
            return await job();
        } finally {
            const next = this.waiting.shift();
            // El lugar pasa directo al que espera (el contador no baja).
            if (next) next();
            else this.building--;
        }
    }

    private async build(width: number, load: () => Promise<ImageBytes | null>): Promise<ImageBytes | null> {
        let original: ImageBytes | null;
        try {
            original = await load();
        } catch {
            return null;
        }
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

    private remember(key: string, img: ImageBytes): void {
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

    private rememberMiss(key: string): void {
        this.misses.delete(key);
        this.misses.set(key, Date.now());
        if (this.misses.size > MISS_MAX) {
            const oldest = this.misses.keys().next().value;
            if (oldest !== undefined) this.misses.delete(oldest);
        }
    }
}
