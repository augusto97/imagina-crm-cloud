import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DRIVE_BACKUP_ROOT_FOLDER } from '@imagina-base/shared';

/**
 * v0.1.282 (ADR-S43) — Cliente mínimo de Google para las copias del SERVIDOR
 * en Google Drive. No depende de Nest ni de Redis: lo usa el service del
 * panel y, en v0.1.283, el modo recuperación de un servidor recién instalado.
 *
 * - Conexión por "código de dispositivo" (RFC 8628): el operador abre
 *   google.com/device y escribe un código. Sirve sin dominio ni HTTPS.
 * - Permiso `drive.file`: la app sólo ve lo que ella crea. Las copias se
 *   reconocen por `appProperties` (no por el nombre), así un archivo con el
 *   mismo nombre puesto a mano nunca se confunde con una copia.
 * - Subida reanudable por partes de 8 MiB, leída de un stream: un snapshot
 *   de varios GB no se arma en memoria ni se escribe dos veces en disco.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Múltiplo de 256 KiB (lo exige la subida reanudable). */
export const UPLOAD_CHUNK = 8 * 1024 * 1024;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveBackupError extends Error {
    override name = 'DriveBackupError';
    constructor(
        message: string,
        readonly status = 0,
        /** La autorización ya no sirve (revocada o vencida): hay que reconectar. */
        readonly reconnect = false,
    ) {
        super(message);
    }
}

export interface DriveUrls {
    /** `https://oauth2.googleapis.com` (o el falso de los tests). */
    oauth: string;
    /** `https://www.googleapis.com`. */
    api: string;
}

export interface DeviceStart {
    device_code: string;
    user_code: string;
    verification_url: string;
    interval: number;
    expires_in: number;
}

export type DevicePollResult =
    | { state: 'pending'; slowDown: boolean }
    | { state: 'denied' | 'expired'; message: string }
    | { state: 'connected'; access_token: string; refresh_token: string; expires_in: number };

export interface RemoteFile {
    id: string;
    name: string;
    size: number;
    createdTime: string;
    appProperties: Record<string, string>;
}

const trim = (u: string) => u.replace(/\/+$/, '');

async function postForm(url: string, form: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
            signal: AbortSignal.timeout(20_000),
        });
    } catch (err) {
        throw new DriveBackupError(`No se pudo conectar con Google (${err instanceof Error ? err.message : String(err)}).`);
    }
    let json: Record<string, unknown> = {};
    try {
        json = (await res.json()) as Record<string, unknown>;
    } catch {
        // cuerpo vacío
    }
    return { status: res.status, json };
}

function oauthError(json: Record<string, unknown>): string {
    const code = typeof json.error === 'string' ? json.error : '';
    if (code === 'invalid_client') return 'Google no reconoce el ID o el secreto del cliente: revísalos (el cliente debe ser del tipo «TV y dispositivos de entrada limitada»).';
    if (code === 'unauthorized_client') return 'Ese cliente de Google no admite el inicio con código: créalo del tipo «TV y dispositivos de entrada limitada».';
    if (code === 'invalid_scope') return 'Google no permite el acceso a Drive con ese cliente.';
    if (code === 'invalid_grant') return 'Google ya no acepta esta autorización (se revocó o venció): vuelve a conectar el Drive.';
    const desc = typeof json.error_description === 'string' ? json.error_description : '';
    return `Google respondió con un error${code ? ` (${code}${desc ? `: ${desc}` : ''})` : ''}.`;
}

/** Paso 1 del código de dispositivo: Google da el código que escribe el operador. */
export async function deviceStart(urls: DriveUrls, clientId: string): Promise<DeviceStart> {
    const { status, json } = await postForm(`${trim(urls.oauth)}/device/code`, { client_id: clientId, scope: DRIVE_SCOPE });
    if (status !== 200 || typeof json.device_code !== 'string' || typeof json.user_code !== 'string') {
        throw new DriveBackupError(oauthError(json), status);
    }
    return {
        device_code: json.device_code,
        user_code: json.user_code,
        verification_url: String(json.verification_url ?? json.verification_uri ?? 'https://www.google.com/device'),
        interval: Math.max(1, Number(json.interval ?? 5) || 5),
        expires_in: Math.max(60, Number(json.expires_in ?? 1800) || 1800),
    };
}

/** Paso 2: ¿el operador ya autorizó? (se pregunta cada `interval` segundos). */
export async function devicePoll(urls: DriveUrls, clientId: string, clientSecret: string, deviceCode: string): Promise<DevicePollResult> {
    const { status, json } = await postForm(`${trim(urls.oauth)}/token`, {
        client_id: clientId,
        client_secret: clientSecret,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (status === 200 && typeof json.access_token === 'string') {
        if (typeof json.refresh_token !== 'string') {
            throw new DriveBackupError('Google no entregó una autorización permanente (falta el refresh token). Vuelve a intentarlo.');
        }
        return { state: 'connected', access_token: json.access_token, refresh_token: json.refresh_token, expires_in: Number(json.expires_in ?? 3600) || 3600 };
    }
    const code = typeof json.error === 'string' ? json.error : '';
    if (code === 'authorization_pending') return { state: 'pending', slowDown: false };
    if (code === 'slow_down') return { state: 'pending', slowDown: true };
    if (code === 'access_denied') return { state: 'denied', message: 'Se canceló el permiso en Google. Puedes volver a intentarlo.' };
    if (code === 'expired_token') return { state: 'expired', message: 'El código venció sin que se autorizara. Pide uno nuevo.' };
    throw new DriveBackupError(oauthError(json), status);
}

/** Un token de acceso nuevo a partir de la autorización guardada. */
export async function refreshAccessToken(
    urls: DriveUrls,
    clientId: string,
    clientSecret: string,
    refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
    const { status, json } = await postForm(`${trim(urls.oauth)}/token`, {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });
    if (status === 200 && typeof json.access_token === 'string') {
        return { access_token: json.access_token, expires_in: Number(json.expires_in ?? 3600) || 3600 };
    }
    throw new DriveBackupError(oauthError(json), status, json.error === 'invalid_grant' || json.error === 'invalid_client');
}

/** Best-effort: al desconectar, que Google también olvide la autorización. */
export async function revokeToken(urls: DriveUrls, token: string): Promise<void> {
    await postForm(`${trim(urls.oauth)}/revoke`, { token }).catch(() => undefined);
}

/** Escapa un valor para meterlo entre comillas en un query de Drive. */
function q(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class DriveBackupClient {
    constructor(
        private readonly urls: DriveUrls,
        /** Token de acceso vigente (lo renueva quien construye el cliente). */
        private readonly token: () => Promise<string>,
    ) {}

    async accountEmail(): Promise<string | null> {
        const res = await this.call('GET', '/drive/v3/about?fields=user(emailAddress)');
        if (!res.ok) throw await driveError(res, 'leer la cuenta');
        const json = (await res.json()) as { user?: { emailAddress?: string } };
        return json.user?.emailAddress ?? null;
    }

    /** La carpeta raíz de las copias (se encuentra por propiedad o se crea). */
    async ensureRootFolder(): Promise<string> {
        const found = await this.findOne(`appProperties has { key='imagina_backups' and value='root' } and mimeType='${FOLDER_MIME}' and trashed=false`);
        if (found) return found;
        return this.createFolder(DRIVE_BACKUP_ROOT_FOLDER, null, { imagina_backups: 'root' });
    }

    /** La subcarpeta de UN servidor (instancia) dentro de la raíz. */
    async ensureInstanceFolder(rootId: string, instance: string): Promise<string> {
        const found = await this.findOne(
            `appProperties has { key='imagina_backups' and value='instance' } and appProperties has { key='imagina_instance' and value='${q(instance)}' } and '${q(rootId)}' in parents and trashed=false`,
        );
        if (found) return found;
        return this.createFolder(instance, rootId, { imagina_backups: 'instance', imagina_instance: instance });
    }

    /**
     * v0.1.284 — La subcarpeta de las empresas exportadas (ADR-S23), al lado de
     * las de cada servidor: una empresa se lleva de un servidor a otro.
     */
    async ensureTransfersFolder(rootId: string): Promise<string> {
        const found = await this.findOne(
            `appProperties has { key='imagina_backups' and value='transfers' } and '${q(rootId)}' in parents and trashed=false`,
        );
        if (found) return found;
        return this.createFolder('Empresas exportadas', rootId, { imagina_backups: 'transfers' });
    }

    /** Todas las copias del Drive (de cualquier servidor), más nuevas primero. */
    async listSnapshots(): Promise<RemoteFile[]> {
        return this.listByKind('snapshot');
    }

    /** v0.1.284 — Archivos de un tipo (`snapshot` | `tenant_transfer`), más nuevos primero. */
    async listByKind(kind: 'snapshot' | 'tenant_transfer'): Promise<RemoteFile[]> {
        const out: RemoteFile[] = [];
        let pageToken = '';
        for (let page = 0; page < 50; page++) {
            const query = encodeURIComponent(`appProperties has { key='imagina_backups' and value='${kind}' } and trashed=false`);
            const res = await this.call(
                'GET',
                `/drive/v3/files?q=${query}&spaces=drive&pageSize=100&orderBy=createdTime desc&fields=nextPageToken,files(id,name,size,createdTime,appProperties)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
            );
            if (!res.ok) throw await driveError(res, 'listar las copias');
            const json = (await res.json()) as { nextPageToken?: string; files?: Array<Partial<RemoteFile> & { size?: string }> };
            for (const f of json.files ?? []) {
                if (!f.id || !f.name) continue;
                out.push({ id: f.id, name: f.name, size: Number(f.size ?? 0) || 0, createdTime: f.createdTime ?? '', appProperties: f.appProperties ?? {} });
            }
            if (!json.nextPageToken) break;
            pageToken = json.nextPageToken;
        }
        return out.sort((a, b) => (b.appProperties.imagina_created_at ?? b.createdTime).localeCompare(a.appProperties.imagina_created_at ?? a.createdTime));
    }

    async getFile(id: string): Promise<RemoteFile | null> {
        const res = await this.call('GET', `/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,createdTime,appProperties,trashed`);
        if (res.status === 404) return null;
        if (!res.ok) throw await driveError(res, 'leer la copia');
        const f = (await res.json()) as Partial<RemoteFile> & { size?: string; trashed?: boolean };
        if (!f.id || f.trashed) return null;
        return { id: f.id, name: f.name ?? '', size: Number(f.size ?? 0) || 0, createdTime: f.createdTime ?? '', appProperties: f.appProperties ?? {} };
    }

    async deleteFile(id: string): Promise<void> {
        const res = await this.call('DELETE', `/drive/v3/files/${encodeURIComponent(id)}`);
        if (!res.ok && res.status !== 404) throw await driveError(res, 'borrar la copia');
    }

    /**
     * Sube un stream con la subida REANUDABLE: se abre una sesión y se mandan
     * partes de 8 MiB; si una parte falla (red, 5xx) se pregunta a Google
     * cuánto recibió y se sigue desde ahí. El total no se conoce hasta el
     * final (el cifrado va en paralelo), así que las partes van con `/*`.
     */
    async uploadStream(
        source: Readable,
        meta: { name: string; parent: string; appProperties: Record<string, string> },
        onProgress?: (bytes: number) => void,
    ): Promise<{ id: string; size: number }> {
        const init = await this.call('POST', '/upload/drive/v3/files?uploadType=resumable&fields=id,size', {
            headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream' },
            body: JSON.stringify({ name: meta.name, parents: [meta.parent], appProperties: meta.appProperties, mimeType: 'application/octet-stream' }),
        });
        if (!init.ok) throw await driveError(init, 'empezar la subida');
        const session = init.headers.get('location');
        if (!session) throw new DriveBackupError('Google no devolvió la sesión de subida.');

        let sent = 0;
        let pending = Buffer.alloc(0);
        let result: { id: string; size: number } | null = null;

        const sendPart = async (part: Buffer, final: boolean): Promise<void> => {
            const start = sent;
            let offset = 0; // bytes de `part` que Google ya tiene
            for (let attempt = 0; attempt < 6; attempt++) {
                const body = part.subarray(offset);
                const first = start + offset;
                const last = start + part.length - 1;
                const total = final ? String(start + part.length) : '*';
                let res: Response | null = null;
                try {
                    res = await fetch(session, {
                        method: 'PUT',
                        headers: {
                            authorization: `Bearer ${await this.token()}`,
                            'content-range': body.length > 0 ? `bytes ${first}-${last}/${total}` : `bytes */${total}`,
                        },
                        body: body.length > 0 ? body : undefined,
                        signal: AbortSignal.timeout(300_000),
                    });
                } catch {
                    res = null;
                }
                if (res && (res.status === 200 || res.status === 201)) {
                    const json = (await res.json().catch(() => ({}))) as { id?: string; size?: string };
                    if (!json.id) throw new DriveBackupError('Google no devolvió el archivo subido.');
                    result = { id: json.id, size: Number(json.size ?? start + part.length) || start + part.length };
                    sent = start + part.length;
                    return;
                }
                if (res && res.status === 308) {
                    const got = rangeEnd(res.headers.get('range'));
                    // Google confirma hasta `got`: lo que falte de la parte, se reenvía.
                    if (got >= last) {
                        sent = start + part.length;
                        return;
                    }
                    offset = Math.max(0, got + 1 - start);
                    if (attempt > 0) await sleep(500 * attempt);
                    continue;
                }
                if (res && res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
                    throw await driveError(res, 'subir la copia');
                }
                // Red caída o 5xx/429: se pregunta cuánto llegó y se reintenta.
                await sleep(1000 * (attempt + 1));
                const st = await this.uploadStatus(session);
                if (st.done) {
                    result = st.done;
                    sent = start + part.length;
                    return;
                }
                offset = Math.max(0, Math.min(part.length, st.received - start));
            }
            throw new DriveBackupError('La subida a Google Drive se cortó varias veces seguidas. Prueba de nuevo más tarde.');
        };

        for await (const chunk of source) {
            pending = pending.length === 0 ? Buffer.from(chunk as Buffer) : Buffer.concat([pending, chunk as Buffer]);
            // Estrictamente MÁS de una parte: así siempre queda algo para la
            // parte final (que es la que lleva el total).
            while (pending.length > UPLOAD_CHUNK) {
                const part = pending.subarray(0, UPLOAD_CHUNK);
                pending = pending.subarray(UPLOAD_CHUNK);
                await sendPart(Buffer.from(part), false);
                onProgress?.(sent);
            }
        }
        await sendPart(pending, true);
        onProgress?.(sent);
        if (!result) throw new DriveBackupError('La subida terminó sin confirmación de Google.');
        return result;
    }

    /** Baja una copia a disco (streaming). */
    async download(id: string, dest: string, onProgress?: (bytes: number) => void): Promise<number> {
        const res = await this.call('GET', `/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {}, 3_600_000);
        if (!res.ok || !res.body) throw await driveError(res, 'bajar la copia');
        let bytes = 0;
        const body = Readable.fromWeb(res.body as never);
        body.on('data', (c: Buffer) => {
            bytes += c.length;
            onProgress?.(bytes);
        });
        await pipeline(body, createWriteStream(dest, { mode: 0o600 }));
        return bytes;
    }

    // ── internos ────────────────────────────────────────────────────────

    private async uploadStatus(session: string): Promise<{ received: number; done: { id: string; size: number } | null }> {
        try {
            const res = await fetch(session, {
                method: 'PUT',
                headers: { authorization: `Bearer ${await this.token()}`, 'content-range': 'bytes */*' },
                signal: AbortSignal.timeout(60_000),
            });
            if (res.status === 200 || res.status === 201) {
                const json = (await res.json().catch(() => ({}))) as { id?: string; size?: string };
                if (json.id) return { received: Number(json.size ?? 0), done: { id: json.id, size: Number(json.size ?? 0) } };
            }
            if (res.status === 308) return { received: rangeEnd(res.headers.get('range')) + 1, done: null };
            if (res.status === 404 || res.status === 410) throw new DriveBackupError('La sesión de subida venció: vuelve a subir la copia.', res.status);
        } catch (err) {
            if (err instanceof DriveBackupError) throw err;
        }
        return { received: -1, done: null };
    }

    private async findOne(query: string): Promise<string | null> {
        const res = await this.call('GET', `/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=1&fields=files(id)`);
        if (!res.ok) throw await driveError(res, 'buscar la carpeta de copias');
        const json = (await res.json()) as { files?: Array<{ id: string }> };
        return json.files?.[0]?.id ?? null;
    }

    private async createFolder(name: string, parent: string | null, appProperties: Record<string, string>): Promise<string> {
        const res = await this.call('POST', '/drive/v3/files?fields=id', {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties, ...(parent ? { parents: [parent] } : {}) }),
        });
        if (!res.ok) throw await driveError(res, 'crear la carpeta de copias');
        const id = ((await res.json()) as { id?: string }).id;
        if (!id) throw new DriveBackupError('Google Drive no devolvió la carpeta creada.');
        return id;
    }

    private async call(
        method: string,
        path: string,
        init: { headers?: Record<string, string>; body?: string } = {},
        timeoutMs = 60_000,
    ): Promise<Response> {
        const token = await this.token();
        try {
            return await fetch(`${trim(this.urls.api)}${path}`, {
                method,
                headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
                body: init.body,
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (err) {
            throw new DriveBackupError(`No se pudo conectar con Google Drive (${err instanceof Error ? err.message : String(err)}).`);
        }
    }
}

/** `bytes=0-1234` → 1234; sin cabecera (nada recibido) → -1. */
export function rangeEnd(header: string | null): number {
    const m = /bytes=\d+-(\d+)/.exec(header ?? '');
    return m ? Number(m[1]) : -1;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** El error de Google, en lenguaje claro y con lo que hay que hacer. */
async function driveError(res: Response, what: string): Promise<DriveBackupError> {
    let reason = '';
    let message = '';
    try {
        const json = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
        reason = json.error?.errors?.[0]?.reason ?? '';
        message = json.error?.message ?? '';
    } catch {
        // cuerpo vacío
    }
    if (res.status === 401) return new DriveBackupError('Google rechazó el acceso al Drive: vuelve a conectarlo.', 401, true);
    if (reason === 'storageQuotaExceeded') {
        return new DriveBackupError('El Google Drive está lleno: libera espacio, amplía el plan de Google o guarda menos copias.', 403);
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || res.status === 429) {
        return new DriveBackupError('Google Drive pidió esperar (demasiados pedidos seguidos). Prueba de nuevo en un momento.', 429);
    }
    if (res.status === 403) {
        return new DriveBackupError(`Google no dejó ${what}${message ? ` (${message})` : ''}. Revisa que la Google Drive API esté habilitada en el proyecto.`, 403);
    }
    if (res.status === 404) return new DriveBackupError('La copia ya no está en el Google Drive (¿se borró desde ahí?).', 404);
    return new DriveBackupError(`Google Drive no pudo ${what} (${res.status}${message ? `: ${message}` : ''}).`, res.status);
}
