import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
    parsePlatformBrand,
    platformBrandImageUrls,
    type PlatformBrand,
    type PlatformBrandImage,
    type UpdatePlatformBrandInput,
    updatePlatformBrandSchema,
} from '@imagina-base/shared';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage';
import { REDIS } from '../redis/redis.module';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface BrandStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

/** `platform:*` → viaja en el snapshot del servidor (ADR-S20). */
export const PLATFORM_BRAND_KEY = 'platform:brand';
export const BRAND_IMAGE_PATH = '/api/v1/public/brand/images/';
const IMAGE_KEY_PREFIX = 'platform/brand/';
const IMAGE_NAME_RE = /^[a-f0-9]{32}\.png$/;
/** Un logo o un ícono de 512 px en PNG cabe holgado; 2 MB frena lo raro. */
export const MAX_BRAND_IMAGE_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 30_000;

const bad = (code: string, message: string): BadRequestException =>
    new BadRequestException({ code, message, data: { status: 400 } });

/**
 * Ancho y alto de un PNG desde su cabecera IHDR (bytes 16-23). `null` si no
 * es un PNG: el tipo se decide por los BYTES, nunca por el nombre ni por lo
 * que declara el navegador.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
    // El primer chunk tiene que ser IHDR.
    if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0 || width > 4096 || height > 4096) return null;
    return { width, height };
}

/**
 * v0.1.327 — La marca de la plataforma (Plataforma → Marca): nombre de la
 * app, logo y el ícono en todos sus tamaños. Se lee en cada boot público y en
 * cada manifiesto, así que se cachea unos segundos en memoria.
 */
@Injectable()
export class PlatformBrandService {
    private readonly logger = new Logger(PlatformBrandService.name);
    private cache: { at: number; value: PlatformBrand } | null = null;

    constructor(
        @Inject(REDIS) private readonly redis: BrandStore,
        @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    ) {}

    async get(): Promise<PlatformBrand> {
        if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
        const value = await this.read();
        this.cache = { at: Date.now(), value };
        return value;
    }

    async update(input: UpdatePlatformBrandInput): Promise<PlatformBrand> {
        const previous = await this.read();
        const next = updatePlatformBrandSchema.parse(input);
        // Sólo imágenes que existen de verdad (una URL inventada que pase el
        // formato no puede quedar apuntando a la nada).
        for (const url of platformBrandImageUrls(next)) {
            const name = url.slice(BRAND_IMAGE_PATH.length);
            const key = `${IMAGE_KEY_PREFIX}${name}`;
            if (this.storage.probe && !(await this.storage.probe(key))) {
                throw bad('brand_image_missing', 'Una de las imágenes ya no existe: súbela de nuevo');
            }
        }
        await this.redis.set(PLATFORM_BRAND_KEY, JSON.stringify(next));
        this.cache = { at: Date.now(), value: next };
        // Las imágenes que ya no usa nadie se borran (best-effort).
        const keep = new Set(platformBrandImageUrls(next));
        for (const url of platformBrandImageUrls(previous)) {
            if (keep.has(url)) continue;
            const name = url.slice(BRAND_IMAGE_PATH.length);
            await this.storage.delete(`${IMAGE_KEY_PREFIX}${name}`).catch(() => undefined);
        }
        return next;
    }

    /** Guarda un PNG (logo o un tamaño del ícono). Nombre aleatorio: se cachea para siempre. */
    async uploadImage(source: Readable): Promise<PlatformBrandImage> {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of source) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            size += buf.length;
            if (size > MAX_BRAND_IMAGE_BYTES) {
                source.destroy();
                throw bad('file_too_large', 'La imagen supera los 2 MB');
            }
            chunks.push(buf);
        }
        const bytes = Buffer.concat(chunks);
        const dims = pngSize(bytes);
        if (!dims) throw bad('brand_image_type', 'La imagen tiene que ser PNG');
        const name = `${randomBytes(16).toString('hex')}.png`;
        await this.storage.write(`${IMAGE_KEY_PREFIX}${name}`, Readable.from(bytes));
        return { url: `${BRAND_IMAGE_PATH}${name}`, ...dims };
    }

    async openImage(name: string): Promise<Readable | null> {
        if (!IMAGE_NAME_RE.test(name)) return null;
        const key = `${IMAGE_KEY_PREFIX}${name}`;
        if (this.storage.probe && !(await this.storage.probe(key))) return null;
        return this.storage.read(key);
    }

    private async read(): Promise<PlatformBrand> {
        let raw: string | null;
        try {
            raw = await this.redis.get(PLATFORM_BRAND_KEY);
        } catch (err) {
            // La marca no puede tumbar el login: sin Redis, la de fábrica.
            this.logger.warn(`${PLATFORM_BRAND_KEY} no se pudo leer: ${err instanceof Error ? err.message : String(err)}`);
            return parsePlatformBrand({});
        }
        if (!raw) return parsePlatformBrand({});
        try {
            return parsePlatformBrand(JSON.parse(raw));
        } catch {
            this.logger.warn(`${PLATFORM_BRAND_KEY} corrupto, se ignora`);
            return parsePlatformBrand({});
        }
    }
}
