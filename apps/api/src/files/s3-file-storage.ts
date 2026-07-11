import type { Readable } from 'node:stream';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { FileStorage } from './file-storage';

export interface S3StorageConfig {
    /** Endpoint S3-compatible (Hetzner Object Storage / R2 / MinIO). */
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** true para MinIO/algunos providers (bucket en el path, no el host). */
    forcePathStyle?: boolean;
}

/**
 * Driver S3-compatible de `FileStorage` (ADR-S16, upgrade del driver local).
 * Se activa con `STORAGE_DRIVER=s3` + credenciales por env — los callers
 * (FilesService) no cambian. Streams en ambos sentidos: el upload usa
 * `@aws-sdk/lib-storage` (multipart automático para archivos grandes) y el
 * read devuelve el Body del GetObject como Readable.
 *
 * Nota deliberada: la descarga sigue proxied por el API (misma URL firmada
 * HMAC que el driver local). URLs prefirmadas NATIVAS del bucket (el API
 * fuera del data path) quedan como optimización documentada cuando haya
 * bucket productivo — el shape de `storage_key` ya lo soporta.
 */
export class S3FileStorage implements FileStorage {
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor(config: S3StorageConfig) {
        this.bucket = config.bucket;
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            forcePathStyle: config.forcePathStyle ?? true,
        });
    }

    async write(key: string, source: Readable): Promise<number> {
        const upload = new Upload({
            client: this.client,
            params: { Bucket: this.bucket, Key: key, Body: source },
        });
        await upload.done();
        const head = await this.client.send(
            new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return Number(head.ContentLength ?? 0);
    }

    read(key: string): Readable {
        // Lazy: devolvemos un PassThrough que se conecta al GetObject cuando
        // el caller empieza a consumir (la interfaz es síncrona).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PassThrough } = require('node:stream') as typeof import('node:stream');
        const out = new PassThrough();
        this.client
            .send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
            .then((res) => {
                const body = res.Body as Readable | undefined;
                if (!body) {
                    out.destroy(new Error(`Objeto vacío en S3: ${key}`));
                    return;
                }
                body.pipe(out);
                body.on('error', (err) => out.destroy(err));
            })
            .catch((err: unknown) => out.destroy(err instanceof Error ? err : new Error(String(err))));
        return out;
    }

    async delete(key: string): Promise<void> {
        await this.client
            .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
            .catch(() => undefined);
    }
}
