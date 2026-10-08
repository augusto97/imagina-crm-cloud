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

/** Lo que se pide al armar un enlace temporal de descarga. */
export interface PresignOptions {
    ttlSeconds: number;
    contentType: string;
    contentDisposition: string;
}

/**
 * Un storage que puede entregar el archivo DIRECTO (v0.1.268): un enlace
 * temporal del proveedor, así la descarga no pasa por el servidor.
 */
export interface PresignableStorage extends FileStorage {
    presignedGet?(key: string, opts: PresignOptions): Promise<string>;
}

/**
 * v0.1.268 (ADR-S36) — almacenamiento propio de la empresa. Lo provee el
 * módulo de conectores (las credenciales viven en una conexión de
 * Integraciones); el de archivos sólo conoce esta interfaz, así no hay ciclo.
 */
export interface TenantStorageResolver {
    /** La conexión elegida en Ajustes → Almacenamiento, o null (= la plataforma). */
    choice(tenantId: number): Promise<number | null>;
    /** La elegida con su driver listo. Lanza con el motivo si no se puede usar. */
    active(tenantId: number): Promise<{ connectionId: number; storage: PresignableStorage } | null>;
    /** La de una conexión puntual (donde quedó un archivo). Lanza con el motivo si no se puede usar. */
    forConnection(tenantId: number, connectionId: number): Promise<PresignableStorage>;
    /** Las conexiones que se pueden elegir. */
    candidates(tenantId: number): Promise<StorageChoiceCandidate[]>;
    set(tenantId: number, connectionId: number): Promise<{ name: string }>;
    clear(tenantId: number): Promise<void>;
    names(tenantId: number, ids: number[]): Promise<Map<number, string>>;
}

export interface StorageChoiceCandidate {
    id: number;
    name: string;
    integration: string;
    detail: string | null;
    problem: string | null;
}

export const TENANT_STORAGE = Symbol('TENANT_STORAGE');
