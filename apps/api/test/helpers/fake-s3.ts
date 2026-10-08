import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * v0.1.268 — un S3 MÍNIMO en proceso para los tests (path-style: PUT, GET,
 * HEAD y DELETE de objetos, incluidas las URLs prefirmadas). No verifica
 * firmas: lo que se prueba es lo nuestro (dónde va cada archivo, la mudanza,
 * los permisos), no el SDK de AWS. En CI no hay imagen de MinIO.
 *
 * `down = true` simula un bucket caído (503 a todo); `buckets` son los que
 * existen (otro nombre → NoSuchBucket, como S3).
 */
export interface FakeS3 {
    endpoint: string;
    objects: Map<string, { body: Buffer; type: string }>;
    buckets: Set<string>;
    down: boolean;
    requests: Array<{ method: string; path: string }>;
    close(): Promise<void>;
}

function xmlError(code: string, message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c as Buffer));
    const raw = Buffer.concat(chunks);
    // Por si algún cliente manda «aws-chunked» (tamaño;firma\r\ndatos\r\n…0\r\n).
    if (String(req.headers['content-encoding'] ?? '').includes('aws-chunked')) {
        const out: Buffer[] = [];
        let i = 0;
        while (i < raw.length) {
            const eol = raw.indexOf('\r\n', i);
            if (eol < 0) break;
            const size = parseInt(raw.subarray(i, eol).toString().split(';')[0]!, 16);
            if (!size) break;
            out.push(raw.subarray(eol + 2, eol + 2 + size));
            i = eol + 2 + size + 2;
        }
        return Buffer.concat(out);
    }
    return raw;
}

export async function startFakeS3(buckets: string[] = ['empresa']): Promise<FakeS3> {
    const state = {
        objects: new Map<string, { body: Buffer; type: string }>(),
        buckets: new Set(buckets),
        down: false,
        requests: [] as Array<{ method: string; path: string }>,
    };
    const server: Server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://x');
            const method = req.method ?? 'GET';
            state.requests.push({ method, path: url.pathname });
            if (state.down) {
                res.writeHead(503, { 'content-type': 'application/xml' });
                res.end(xmlError('ServiceUnavailable', 'Bucket caído (simulado)'));
                return;
            }
            const [, bucket = '', ...rest] = url.pathname.split('/');
            const key = decodeURIComponent(rest.join('/'));
            if (!state.buckets.has(bucket)) {
                res.writeHead(404, { 'content-type': 'application/xml' });
                res.end(xmlError('NoSuchBucket', 'The specified bucket does not exist'));
                return;
            }
            const id = `${bucket}/${key}`;
            if (method === 'PUT') {
                const body = await readBody(req);
                state.objects.set(id, { body, type: String(req.headers['content-type'] ?? 'application/octet-stream') });
                res.writeHead(200, { etag: '"fake"' });
                res.end();
                return;
            }
            const obj = state.objects.get(id);
            if (method === 'DELETE') {
                state.objects.delete(id);
                res.writeHead(204);
                res.end();
                return;
            }
            if (!obj) {
                res.writeHead(404, { 'content-type': 'application/xml' });
                res.end(method === 'HEAD' ? undefined : xmlError('NoSuchKey', 'The specified key does not exist.'));
                return;
            }
            const headers: Record<string, string> = {
                'content-length': String(obj.body.length),
                'content-type': url.searchParams.get('response-content-type') ?? obj.type,
                etag: '"fake"',
            };
            const disp = url.searchParams.get('response-content-disposition');
            if (disp) headers['content-disposition'] = disp;
            res.writeHead(200, headers);
            res.end(method === 'HEAD' ? undefined : obj.body);
        })().catch((err: unknown) => {
            res.writeHead(500);
            res.end(String(err));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return Object.assign(state, {
        endpoint: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    });
}
