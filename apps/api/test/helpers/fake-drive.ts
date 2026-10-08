import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * v0.1.269 — Google Drive MÍNIMO en proceso: lo justo de la API v3 que usa el
 * almacenamiento (buscar/crear carpeta, subida multipart, leer, consultar y
 * borrar). Exige el token esperado y simula un Drive lleno con `full`.
 */
export interface FakeDrive {
    apiBase: string;
    token: string;
    files: Map<string, { name: string; parents: string[]; body: Buffer; folder: boolean; trashed: boolean }>;
    full: boolean;
    close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
}

function gerr(status: number, reason: string, message: string): string {
    return JSON.stringify({ error: { code: status, message, errors: [{ reason, message }] } });
}

export async function startFakeDrive(token = 'drive-token'): Promise<FakeDrive> {
    const state = {
        token,
        files: new Map<string, { name: string; parents: string[]; body: Buffer; folder: boolean; trashed: boolean }>(),
        full: false,
    };
    const server: Server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://x');
            const send = (status: number, body?: string | Buffer, type = 'application/json'): void => {
                res.writeHead(status, body !== undefined ? { 'content-type': type } : {});
                res.end(body);
            };
            if (req.headers.authorization !== `Bearer ${state.token}`) return send(401, gerr(401, 'authError', 'Invalid Credentials'));
            const body = await readBody(req);
            const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);

            if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
                const q = url.searchParams.get('q') ?? '';
                const name = /name='([^']+)'/.exec(q)?.[1];
                const found = [...state.files.entries()].filter(([, f]) => f.folder && !f.trashed && f.name === name);
                return send(200, JSON.stringify({ files: found.map(([id]) => ({ id })) }));
            }
            if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
                const meta = JSON.parse(body.toString()) as { name: string };
                const id = `fold_${randomBytes(4).toString('hex')}`;
                state.files.set(id, { name: meta.name, parents: [], body: Buffer.alloc(0), folder: true, trashed: false });
                return send(200, JSON.stringify({ id }));
            }
            if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files') {
                const boundary = /boundary=([^;]+)/.exec(String(req.headers['content-type']))?.[1] ?? '';
                const raw = body.toString('latin1');
                const parts = raw.split(`--${boundary}`).slice(1, 3);
                const metaPart = parts[0]!.split('\r\n\r\n')[1]!.trim();
                const meta = JSON.parse(metaPart) as { name: string; parents: string[] };
                const filePart = parts[1]!;
                const content = filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2);
                const parent = state.files.get(meta.parents[0] ?? '');
                if (!parent || parent.trashed) return send(404, gerr(404, 'notFound', `File not found: ${meta.parents[0]}`));
                if (state.full) return send(403, gerr(403, 'storageQuotaExceeded', 'The user has exceeded their Drive storage quota'));
                const id = `file_${randomBytes(6).toString('hex')}`;
                const buf = Buffer.from(content, 'latin1');
                state.files.set(id, { name: meta.name, parents: meta.parents, body: buf, folder: false, trashed: false });
                return send(200, JSON.stringify({ id, size: String(buf.length) }));
            }
            if (m) {
                const f = state.files.get(decodeURIComponent(m[1]!));
                if (!f) return send(404, gerr(404, 'notFound', 'File not found'));
                if (req.method === 'DELETE') {
                    state.files.delete(decodeURIComponent(m[1]!));
                    return send(204);
                }
                if (url.searchParams.get('alt') === 'media') return send(200, f.body, 'application/octet-stream');
                return send(200, JSON.stringify({ id: m[1], trashed: f.trashed }));
            }
            send(404, gerr(404, 'notFound', 'no route'));
        })().catch((err: unknown) => {
            res.writeHead(500);
            res.end(String(err));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return Object.assign(state, {
        apiBase: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    });
}
