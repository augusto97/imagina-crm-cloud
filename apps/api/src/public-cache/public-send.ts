import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * v0.1.352 (ADR-S95) — Una respuesta pública armada UNA vez y comprimida UNA
 * vez (brotli y gzip), lista para mandar a todas las visitas. Antes cada carga
 * de un formulario comprimía ~50 KB en el momento: era casi un tercio del
 * trabajo del servidor por visita.
 */
export interface Precompressed {
    raw: Buffer;
    br: Buffer;
    gzip: Buffer;
    /** ETag débil (el contenido, no los bytes comprimidos). */
    etag: string;
}

export function precompress(body: string | Buffer, opts: { quality?: number } = {}): Precompressed {
    const raw = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const sha = createHash('sha256').update(raw).digest('base64url');
    return {
        raw,
        br: brotliCompressSync(raw, {
            params: {
                [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
                [zlibConstants.BROTLI_PARAM_QUALITY]: opts.quality ?? 6,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
            },
        }),
        gzip: gzipSync(raw, { level: 6 }),
        etag: `W/"${sha.slice(0, 27)}"`,
    };
}

/** La codificación que acepta el navegador (respeta `;q=0`). */
export function pickEncoding(acceptEncoding: string | string[] | undefined): 'br' | 'gzip' | null {
    const header = (Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : acceptEncoding ?? '').toLowerCase();
    const accepted = new Set<string>();
    for (const part of header.split(',')) {
        const [name, ...params] = part.trim().split(';');
        if (!name) continue;
        const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
        if (q && Number(q.slice(2)) === 0) continue;
        accepted.add(name.trim());
    }
    if (accepted.has('br')) return 'br';
    if (accepted.has('gzip') || accepted.has('*')) return 'gzip';
    return null;
}

/** ¿El navegador ya tiene esta versión? (`If-None-Match`). */
export function notModified(req: FastifyRequest, etag: string): boolean {
    const inm = req.headers['if-none-match'];
    if (!inm) return false;
    const list = (Array.isArray(inm) ? inm.join(',') : inm).split(',').map((s) => s.trim().replace(/^W\//, ''));
    const mine = etag.replace(/^W\//, '');
    return list.includes(mine) || list.includes('*');
}

/**
 * Manda una respuesta precomprimida: 304 si el navegador ya la tiene, si no
 * los bytes en la codificación que acepta. Con `Content-Encoding` puesto, el
 * compresor global no la vuelve a comprimir.
 */
export function sendPrecompressed(req: FastifyRequest, reply: FastifyReply, body: Precompressed, contentType: string): void {
    reply.header('ETag', body.etag).header('Vary', 'Accept-Encoding');
    if (notModified(req, body.etag)) {
        reply.status(304).send();
        return;
    }
    const enc = pickEncoding(req.headers['accept-encoding']);
    reply.type(contentType);
    if (enc === 'br') {
        reply.header('Content-Encoding', 'br').send(body.br);
    } else if (enc === 'gzip') {
        reply.header('Content-Encoding', 'gzip').send(body.gzip);
    } else {
        reply.send(body.raw);
    }
}

/**
 * Lo público cacheable: el navegador (y una CDN delante, si la hay) lo guarda
 * medio minuto y mientras tanto puede mostrar el anterior hasta 2 minutos más
 * mientras lo pide de nuevo. Nada personal viaja en estas páginas.
 */
export const PUBLIC_PAGE_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=120';

/** «Muchas visitas»: la fila de armados se llenó. El visitante reintenta en segundos. */
export function busyPage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Un momento</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>Hay muchas visitas en este momento</h1><p>Vuelve a cargar la página en unos segundos.</p></div></body></html>`;
}
