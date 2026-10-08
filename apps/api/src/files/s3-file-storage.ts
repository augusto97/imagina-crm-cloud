import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { guardedLookup } from '../common/safe-fetch';
import type { PresignOptions, PresignableStorage } from './file-storage';

export interface S3StorageConfig {
    /** Endpoint S3-compatible (Backblaze / R2 / Wasabi / MinIO). Vacío = Amazon S3. */
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** true para MinIO/algunos providers (bucket en el path, no el host). */
    forcePathStyle?: boolean;
    /** Carpeta dentro del bucket (v0.1.268): se antepone a cada clave. */
    prefix?: string;
    /**
     * v0.1.268 (ADR-S36) — el bucket de una EMPRESA: la dirección la escribió
     * alguien de afuera, así que la conexión pasa por el guard anti-SSRF (no
     * puede apuntar a la red interna del servidor). El de la plataforma (por
     * env) lo eligió el operador y no lo necesita.
     */
    guard?: boolean;
}

/**
 * Driver S3-compatible de `FileStorage` (ADR-S16, upgrade del driver local;
 * v0.1.268 también el bucket propio de cada empresa, ADR-S36). Streams en
 * ambos sentidos: el upload usa `@aws-sdk/lib-storage` (multipart automático
 * para archivos grandes) y el read devuelve el Body del GetObject.
 *
 * `presignedGet` (v0.1.268): la descarga sale DIRECTO del bucket con un enlace
 * temporal — ni disco ni ancho de banda del servidor. La URL firmada propia
 * (`/files/:id/signed`) sigue siendo la que viaja en la app y redirige a ésta.
 */
export class S3FileStorage implements PresignableStorage {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly prefix: string;

    constructor(config: S3StorageConfig) {
        this.bucket = config.bucket;
        this.prefix = normalizePrefix(config.prefix ?? '');
        const endpoint = config.endpoint.trim();
        const opts: S3ClientConfig = {
            region: config.region.trim() || 'us-east-1',
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            forcePathStyle: config.forcePathStyle ?? (endpoint !== ''),
            // Sin reintentos infinitos ante un bucket caído: el error tiene que
            // llegar a la persona en segundos.
            maxAttempts: 2,
        };
        if (endpoint !== '') {
            // Desde la 3.729 el SDK manda checksums CRC32 en cada PutObject
            // (cuerpo «aws-chunked» con trailer). Backblaze, Wasabi, MinIO
            // viejos y varios más lo rechazan: con un endpoint propio se
            // mandan sólo cuando la operación lo exige, como antes.
            opts.requestChecksumCalculation = 'WHEN_REQUIRED';
            opts.responseChecksumValidation = 'WHEN_REQUIRED';
        }
        if (endpoint !== '') opts.endpoint = endpoint;
        if (config.guard) {
            opts.requestHandler = new NodeHttpHandler({
                connectionTimeout: 10_000,
                requestTimeout: 120_000,
                httpsAgent: new https.Agent({ keepAlive: true, lookup: guardedLookup as never }),
                httpAgent: new http.Agent({ keepAlive: true, lookup: guardedLookup as never }),
            });
        }
        this.client = new S3Client(opts);
    }

    private full(key: string): string {
        return `${this.prefix}${key}`;
    }

    async write(key: string, source: Readable): Promise<number> {
        const upload = new Upload({
            client: this.client,
            params: { Bucket: this.bucket, Key: this.full(key), Body: source },
        });
        await upload.done();
        const head = await this.client.send(
            new HeadObjectCommand({ Bucket: this.bucket, Key: this.full(key) }),
        );
        return Number(head.ContentLength ?? 0);
    }

    read(key: string): Readable {
        // Lazy: devolvemos un PassThrough que se conecta al GetObject cuando
        // el caller empieza a consumir (la interfaz es síncrona).
        const out = new PassThrough();
        this.client
            .send(new GetObjectCommand({ Bucket: this.bucket, Key: this.full(key) }))
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
            .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.full(key) }))
            .catch(() => undefined);
    }

    async presignedGet(key: string, opts: PresignOptions): Promise<string> {
        return getSignedUrl(
            this.client,
            new GetObjectCommand({
                Bucket: this.bucket,
                Key: this.full(key),
                ResponseContentType: opts.contentType,
                ResponseContentDisposition: opts.contentDisposition,
            }),
            { expiresIn: Math.max(60, Math.min(opts.ttlSeconds, 7 * 24 * 3600)) },
        );
    }

    /**
     * Prueba de punta a punta (al conectar): sube, lee y borra un archivo
     * chiquito. Si cualquiera de los tres falla, la credencial no sirve para
     * guardar archivos — mejor saberlo antes de que falle una subida real.
     */
    async selfTest(): Promise<void> {
        const key = `.imagina-check-${randomBytes(6).toString('hex')}.txt`;
        const body = 'Imagina Base: prueba de escritura. Se borra sola.';
        await this.client.send(
            new PutObjectCommand({ Bucket: this.bucket, Key: this.full(key), Body: body, ContentType: 'text/plain' }),
        );
        try {
            const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.full(key) }));
            const text = await streamToString(res.Body as Readable | undefined);
            if (text !== body) throw new Error('El archivo de prueba volvió distinto.');
        } finally {
            await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.full(key) }));
        }
    }
}

/** `"imagina"` → `"imagina/"`; sin barras al principio ni `..`. */
export function normalizePrefix(raw: string): string {
    const parts = raw
        .split('/')
        .map((p) => p.trim())
        .filter((p) => p !== '' && p !== '.' && p !== '..');
    return parts.length ? `${parts.join('/')}/` : '';
}

async function streamToString(body: Readable | undefined): Promise<string> {
    if (!body) return '';
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Traduce los errores del SDK de S3 a algo que se pueda leer en la interfaz
 * (v0.1.268). El mensaje original va entre comillas para el diagnóstico.
 */
export function describeS3Error(err: unknown): string {
    const e = err as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const code = e?.name ?? e?.Code ?? '';
    const status = e?.$metadata?.httpStatusCode ?? 0;
    const raw = (e?.message ?? String(err)).slice(0, 200);
    if (/SSRF/.test(raw)) return 'Esa dirección apunta a una red interna: usá la dirección pública de tu proveedor.';
    if (code === 'NoSuchBucket' || status === 404) return `El bucket no existe en esa dirección o región (${raw}).`;
    if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || code === 'InvalidToken') {
        return 'El proveedor rechazó la clave: revisá el ID de la clave y la clave secreta.';
    }
    if (code === 'AccessDenied' || status === 403) {
        return 'La clave no tiene permiso sobre ese bucket: necesita leer, escribir y borrar.';
    }
    if (code === 'PermanentRedirect' || code === 'AuthorizationHeaderMalformed' || code === 'IllegalLocationConstraintException') {
        return `La región no coincide con la del bucket (${raw}).`;
    }
    if (/ENOTFOUND|EAI_AGAIN/.test(raw)) return 'No se encontró esa dirección: revisá el endpoint.';
    if (/ECONNREFUSED|ETIMEDOUT|timeout|socket hang up/i.test(raw)) return `No se pudo conectar con el servicio (${raw}).`;
    return raw || 'Error desconocido del proveedor de almacenamiento.';
}

export { Readable };
