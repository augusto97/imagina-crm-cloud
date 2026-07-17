import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';

/**
 * Interfaz de storage de archivos (ADR-S16). Hoy: driver LOCAL en disco
 * (VPS único, STANDALONE §2). Upgrade previsto sin tocar callers: driver
 * S3-compatible con URLs prefirmadas (Hetzner/R2) cuando haya bucket.
 */
export interface FileStorage {
    /** Persiste el stream y devuelve el tamaño en bytes. */
    write(key: string, source: Readable): Promise<number>;
    read(key: string): Readable;
    delete(key: string): Promise<void>;
    /**
     * ¿Existen los bytes? Opcional (el driver S3 no lo implementa — un HEAD
     * extra por request no paga). Lo usan las descargas para responder 404
     * RÁPIDO cuando el archivo se perdió (ej. uploads huérfanos de releases
     * viejos) en vez de fallar a mitad de stream y colgar la request hasta
     * el 504 del proxy.
     */
    probe?(key: string): Promise<boolean>;
}

/**
 * Driver local: los bytes viven bajo `baseDir` (default `./data/uploads`,
 * configurable por `UPLOADS_DIR`). La clave se normaliza y se valida que
 * quede DENTRO del baseDir — jamás path traversal aunque la clave venga
 * corrupta de la DB.
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
    constructor(private readonly baseDir: string) {}

    private resolve(key: string): string {
        const full = normalize(join(this.baseDir, key));
        const base = normalize(this.baseDir + sep);
        if (!full.startsWith(base)) {
            throw new Error(`Clave de storage fuera del directorio base: ${key}`);
        }
        return full;
    }

    async write(key: string, source: Readable): Promise<number> {
        const path = this.resolve(key);
        await mkdir(dirname(path), { recursive: true });
        await pipeline(source, createWriteStream(path, { flags: 'wx' }));
        const info = await stat(path);
        return info.size;
    }

    read(key: string): Readable {
        return createReadStream(this.resolve(key));
    }

    async probe(key: string): Promise<boolean> {
        try {
            await stat(this.resolve(key));
            return true;
        } catch {
            return false;
        }
    }

    async delete(key: string): Promise<void> {
        await rm(this.resolve(key), { force: true });
    }
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
