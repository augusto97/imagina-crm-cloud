import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * v0.1.282 — Google falso para las copias del servidor: OAuth por código de
 * dispositivo + lo justo de Drive v3 (carpetas, búsqueda por appProperties,
 * subida reanudable por partes, descarga y borrado).
 */
export interface FakeFile {
    id: string;
    name: string;
    mimeType: string;
    parents: string[];
    appProperties: Record<string, string>;
    createdTime: string;
    data: Buffer;
    trashed: boolean;
}

export interface FakeGoogle {
    url: string;
    files: Map<string, FakeFile>;
    /** Cuántas veces preguntó el token del código de dispositivo. */
    devicePolls: number;
    /** Respuestas "pendiente" antes de autorizar. */
    pendingPolls: number;
    /** La autorización guardada dejó de valer (invalid_grant). */
    revoked: boolean;
    /** Hacer fallar con 503 la parte N de la próxima subida (1-based). */
    failPart: number | null;
    revokeCalls: number;
    close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
}

function meta(f: FakeFile) {
    return { id: f.id, name: f.name, size: String(f.data.length), createdTime: f.createdTime, appProperties: f.appProperties, trashed: f.trashed };
}

/** Lo justo del lenguaje de búsqueda de Drive que usa el cliente. */
function matches(f: FakeFile, q: string): boolean {
    if (f.trashed && /trashed=false/.test(q)) return false;
    for (const m of q.matchAll(/appProperties has \{ key='([^']+)' and value='((?:\\'|[^'])*)' \}/g)) {
        if (f.appProperties[m[1]!] !== m[2]!.replace(/\\'/g, "'")) return false;
    }
    const parent = /'([^']+)' in parents/.exec(q);
    if (parent && !f.parents.includes(parent[1]!)) return false;
    const mime = /mimeType='([^']+)'/.exec(q);
    if (mime && f.mimeType !== mime[1]) return false;
    return true;
}

export async function startFakeGoogle(port = 0): Promise<FakeGoogle> {
    const sessions = new Map<string, { meta: FakeFile; data: Buffer[]; received: number; part: number }>();
    let seq = 0;
    const state: Omit<FakeGoogle, 'url' | 'close'> = {
        files: new Map(),
        devicePolls: 0,
        pendingPolls: 1,
        revoked: false,
        failPart: null,
        revokeCalls: 0,
    };
    const ok = (req: IncomingMessage) => (req.headers.authorization ?? '').startsWith('Bearer at-');

    const server: Server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://x');
            const body = await readBody(req);
            const form = new URLSearchParams(body.toString());

            if (req.method === 'POST' && url.pathname === '/device/code') {
                if (form.get('client_id') !== 'client-123.apps.googleusercontent.com') return json(res, 401, { error: 'invalid_client' });
                return json(res, 200, { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', interval: 1, expires_in: 600 });
            }
            if (req.method === 'POST' && url.pathname === '/token') {
                if (form.get('client_secret') !== 'shh-secret') return json(res, 401, { error: 'invalid_client' });
                if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
                    state.devicePolls++;
                    if (state.devicePolls <= state.pendingPolls) return json(res, 428, { error: 'authorization_pending' });
                    return json(res, 200, { access_token: `at-${++seq}`, refresh_token: 'rt-1', expires_in: 3599 });
                }
                if (form.get('grant_type') === 'refresh_token') {
                    if (state.revoked || form.get('refresh_token') !== 'rt-1') return json(res, 400, { error: 'invalid_grant' });
                    return json(res, 200, { access_token: `at-${++seq}`, expires_in: 3599 });
                }
                return json(res, 400, { error: 'unsupported_grant_type' });
            }
            if (req.method === 'POST' && url.pathname === '/revoke') {
                state.revokeCalls++;
                return json(res, 200, {});
            }

            if (!url.pathname.startsWith('/upload/session/') && !ok(req)) return json(res, 401, { error: { message: 'Invalid Credentials' } });

            if (req.method === 'GET' && url.pathname === '/drive/v3/about') return json(res, 200, { user: { emailAddress: 'ops@acme.co' } });

            if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
                const q = url.searchParams.get('q') ?? '';
                const list = [...state.files.values()].filter((f) => matches(f, q));
                const size = Number(url.searchParams.get('pageSize') ?? 100);
                const start = Number(url.searchParams.get('pageToken') ?? 0);
                const page = list.slice(start, start + size);
                return json(res, 200, { files: page.map(meta), ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}) });
            }
            if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
                const m = JSON.parse(body.toString()) as Partial<FakeFile>;
                const f: FakeFile = {
                    id: `f${++seq}`, name: m.name ?? '', mimeType: m.mimeType ?? '', parents: m.parents ?? [],
                    appProperties: m.appProperties ?? {}, createdTime: new Date().toISOString(), data: Buffer.alloc(0), trashed: false,
                };
                state.files.set(f.id, f);
                return json(res, 200, { id: f.id });
            }
            if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
                const m = JSON.parse(body.toString()) as Partial<FakeFile>;
                if (m.parents?.some((p) => !state.files.has(p) || state.files.get(p)!.trashed)) return json(res, 404, { error: { message: 'File not found' } });
                const sid = randomBytes(6).toString('hex');
                sessions.set(sid, {
                    meta: { id: '', name: m.name ?? '', mimeType: 'application/octet-stream', parents: m.parents ?? [], appProperties: m.appProperties ?? {}, createdTime: new Date().toISOString(), data: Buffer.alloc(0), trashed: false },
                    data: [], received: 0, part: 0,
                });
                const addr = server.address() as AddressInfo;
                res.writeHead(200, { location: `http://127.0.0.1:${addr.port}/upload/session/${sid}` });
                return res.end();
            }
            if (req.method === 'PUT' && url.pathname.startsWith('/upload/session/')) {
                const s = sessions.get(url.pathname.split('/').pop()!);
                if (!s) return json(res, 404, {});
                const range = req.headers['content-range'] ?? '';
                const rangeHeader = () => (s.received > 0 ? { range: `bytes=0-${s.received - 1}` } : {});
                const statusQ = /^bytes \*\/(\*|\d+)$/.exec(range);
                if (statusQ) {
                    if (statusQ[1] !== '*' && Number(statusQ[1]) === s.received) return finish();
                    res.writeHead(308, rangeHeader());
                    return res.end();
                }
                s.part++;
                if (state.failPart === s.part) {
                    state.failPart = null;
                    // Recibe la MITAD (alineada a 256 KiB) y después "se cae".
                    const m = /^bytes (\d+)-(\d+)\//.exec(range)!;
                    if (Number(m[1]) === s.received) {
                        const half = Math.floor(body.length / 2 / 262144) * 262144;
                        s.data.push(body.subarray(0, half));
                        s.received += half;
                    }
                    return json(res, 503, { error: { message: 'Backend Error' } });
                }
                const m = /^bytes (\d+)-(\d+)\/(\*|\d+)$/.exec(range);
                if (!m || Number(m[1]) !== s.received) return json(res, 400, { error: { message: `bad range ${range} (tengo ${s.received})` } });
                s.data.push(body);
                s.received += body.length;
                if (m[3] !== '*' && Number(m[3]) === s.received) return finish();
                res.writeHead(308, rangeHeader());
                return res.end();

                function finish(): void {
                    const f = { ...s!.meta, id: `f${++seq}`, data: Buffer.concat(s!.data) };
                    state.files.set(f.id, f);
                    sessions.delete(url.pathname.split('/').pop()!);
                    json(res, 200, { id: f.id, size: String(f.data.length) });
                }
            }
            const fileM = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
            if (fileM) {
                const f = state.files.get(decodeURIComponent(fileM[1]!));
                if (!f || f.trashed) return json(res, 404, { error: { message: 'File not found' } });
                if (req.method === 'DELETE') {
                    state.files.delete(f.id);
                    res.writeHead(204);
                    return res.end();
                }
                if (url.searchParams.get('alt') === 'media') {
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    return res.end(f.data);
                }
                return json(res, 200, meta(f));
            }
            json(res, 404, { error: { message: `ruta falsa desconocida ${req.method} ${url.pathname}` } });
        })();
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const fake = state as FakeGoogle;
    fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    fake.close = () => new Promise((r) => server.close(() => r()));
    return fake;
}
