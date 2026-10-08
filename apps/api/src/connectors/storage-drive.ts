import { randomBytes } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import type { PresignableStorage } from '../files/file-storage';

/**
 * v0.1.269 (ADR-S36) — Google Drive como almacenamiento propio de la empresa.
 *
 * Con el permiso `drive.file` la app SÓLO ve lo que ella crea: una carpeta
 * «Imagina Base» (se encuentra o se crea la primera vez y se recuerda en la
 * conexión) y los archivos de adentro. Drive asigna su propio id a cada
 * archivo, así que la clave guardada es `gdrive:<id>` (ver `writeKeyed`).
 *
 * Drive no tiene enlaces prefirmados como S3: la descarga pasa por el
 * servidor con el token de la empresa (streaming, sin tocar el disco).
 */
export const DRIVE_FOLDER_NAME = 'Imagina Base';
const KEY_PREFIX = 'gdrive:';
/** Tope de lo que se sube en un pedido (multipart se arma en memoria). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export class DriveStorageError extends Error {
    override name = 'DriveStorageError';
    constructor(
        message: string,
        readonly status = 0,
    ) {
        super(message);
    }
}

export interface DriveStorageOptions {
    /** `https://www.googleapis.com` (o el falso de los tests). */
    apiBase: string;
    /** Token VIGENTE (lo renueva el servicio de conectores). */
    token: () => Promise<string>;
    /** La carpeta recordada en la conexión (o null si todavía no hay). */
    folderId: string | null;
    /** Recordar la carpeta creada/encontrada. */
    saveFolder: (id: string) => Promise<void>;
}

export class GoogleDriveStorage implements PresignableStorage {
    private folder: string | null;
    private folderPending: Promise<string> | null = null;

    constructor(private readonly opts: DriveStorageOptions) {
        this.folder = opts.folderId;
    }

    // ── FileStorage ─────────────────────────────────────────────────────

    async write(key: string, source: Readable): Promise<number> {
        return (await this.writeKeyed(key, source)).size;
    }

    async writeKeyed(key: string, source: Readable, displayName?: string): Promise<{ size: number; key: string }> {
        const body = await readAll(source);
        const name = (displayName ?? '').trim() || key.split('/').pop() || key;
        let folder = await this.ensureFolder();
        let res = await this.upload(name, folder, key, body);
        // La carpeta se borró (o se movió a la papelera) desde el Drive: se
        // crea de nuevo y se reintenta una vez.
        if (res.status === 404) {
            this.folder = null;
            folder = await this.ensureFolder(true);
            res = await this.upload(name, folder, key, body);
        }
        if (!res.ok) throw await driveError(res, 'guardar el archivo');
        const json = (await res.json()) as { id?: string; size?: string };
        if (!json.id) throw new DriveStorageError('Google Drive no devolvió el archivo guardado.');
        return { size: Number(json.size ?? body.length) || body.length, key: `${KEY_PREFIX}${json.id}` };
    }

    read(key: string): Readable {
        const out = new PassThrough();
        void (async () => {
            const res = await this.call('GET', `/drive/v3/files/${encodeURIComponent(fileId(key))}?alt=media`);
            if (!res.ok || !res.body) throw await driveError(res, 'leer el archivo');
            const body = Readable.fromWeb(res.body as never);
            body.on('error', (err) => out.destroy(err));
            body.pipe(out);
        })().catch((err: unknown) => out.destroy(err instanceof Error ? err : new Error(String(err))));
        return out;
    }

    async probe(key: string): Promise<boolean> {
        const res = await this.call('GET', `/drive/v3/files/${encodeURIComponent(fileId(key))}?fields=id,trashed`);
        if (res.status === 404) return false;
        if (!res.ok) throw await driveError(res, 'consultar el archivo');
        const json = (await res.json()) as { trashed?: boolean };
        return json.trashed !== true;
    }

    async delete(key: string): Promise<void> {
        const res = await this.call('DELETE', `/drive/v3/files/${encodeURIComponent(fileId(key))}`);
        if (!res.ok && res.status !== 404) throw await driveError(res, 'borrar el archivo');
    }

    /** Sube, lee y borra un archivo chiquito: la cuenta sirve para guardar o no. */
    async selfTest(): Promise<void> {
        const text = 'Imagina Base: prueba de escritura. Se borra sola.';
        const stored = await this.writeKeyed(`.imagina-check-${randomBytes(6).toString('hex')}.txt`, Readable.from(Buffer.from(text)));
        try {
            const back = await readAll(this.read(stored.key));
            if (back.toString('utf8') !== text) throw new DriveStorageError('El archivo de prueba volvió distinto.');
        } finally {
            await this.delete(stored.key).catch(() => undefined);
        }
    }

    // ── Internos ────────────────────────────────────────────────────────

    private async ensureFolder(force = false): Promise<string> {
        if (this.folder && !force) return this.folder;
        if (!this.folderPending) {
            this.folderPending = this.findOrCreateFolder().finally(() => {
                this.folderPending = null;
            });
        }
        const id = await this.folderPending;
        this.folder = id;
        return id;
    }

    private async findOrCreateFolder(): Promise<string> {
        const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`;
        const found = await this.call('GET', `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&pageSize=1`);
        if (!found.ok) throw await driveError(found, 'buscar la carpeta');
        const list = (await found.json()) as { files?: Array<{ id: string }> };
        let id = list.files?.[0]?.id ?? null;
        if (!id) {
            const created = await this.call('POST', '/drive/v3/files?fields=id', {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
            });
            if (!created.ok) throw await driveError(created, 'crear la carpeta');
            id = ((await created.json()) as { id?: string }).id ?? null;
            if (!id) throw new DriveStorageError('Google Drive no devolvió la carpeta creada.');
        }
        await this.opts.saveFolder(id).catch(() => undefined);
        return id;
    }

    private async upload(name: string, folder: string, key: string, body: Buffer): Promise<Response> {
        const boundary = `imagina-${randomBytes(12).toString('hex')}`;
        const meta = JSON.stringify({ name, parents: [folder], appProperties: { imagina_key: key.slice(0, 120) } });
        const payload = Buffer.concat([
            Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`),
            body,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        return this.call('POST', '/upload/drive/v3/files?uploadType=multipart&fields=id,size', {
            headers: { 'content-type': `multipart/related; boundary=${boundary}` },
            body: payload,
        });
    }

    private async call(method: string, path: string, init: { headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Response> {
        const token = await this.opts.token();
        try {
            return await fetch(`${this.opts.apiBase.replace(/\/+$/, '')}${path}`, {
                method,
                headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
                body: init.body as never,
                signal: AbortSignal.timeout(120_000),
            });
        } catch (err) {
            throw new DriveStorageError(`No se pudo conectar con Google Drive (${err instanceof Error ? err.message : String(err)}).`);
        }
    }
}

function fileId(key: string): string {
    if (!key.startsWith(KEY_PREFIX)) throw new DriveStorageError('Ese archivo no está guardado en Google Drive.');
    return key.slice(KEY_PREFIX.length);
}

async function readAll(source: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of source) {
        const b = Buffer.from(c as Buffer);
        size += b.length;
        if (size > MAX_UPLOAD_BYTES) throw new DriveStorageError('El archivo supera los 100 MB que se pueden guardar en Google Drive de una vez.');
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}

/** El error de Google, en criollo y con lo que hay que hacer. */
async function driveError(res: Response, what: string): Promise<DriveStorageError> {
    let reason = '';
    let message = '';
    try {
        const json = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
        reason = json.error?.errors?.[0]?.reason ?? '';
        message = json.error?.message ?? '';
    } catch {
        // cuerpo vacío o no-JSON
    }
    if (res.status === 401) {
        return new DriveStorageError('Google rechazó el acceso al Drive: reconectá la cuenta en Ajustes → Integraciones.', 401);
    }
    if (reason === 'storageQuotaExceeded') {
        return new DriveStorageError('El Google Drive de la empresa está lleno: liberá espacio o ampliá el plan de Google.', 403);
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || res.status === 429) {
        return new DriveStorageError('Google Drive pidió esperar (demasiados pedidos seguidos). Probá de nuevo en un momento.', 429);
    }
    if (res.status === 403) {
        return new DriveStorageError(
            `Google no dejó ${what}${message ? ` (${message})` : ''}. Revisá que la Drive API esté habilitada y reconectá la cuenta.`,
            403,
        );
    }
    if (res.status === 404) return new DriveStorageError('El archivo ya no está en el Google Drive (¿se borró desde ahí?).', 404);
    return new DriveStorageError(`Google Drive no pudo ${what} (${res.status}${message ? `: ${message}` : ''}).`, res.status);
}
