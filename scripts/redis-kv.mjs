#!/usr/bin/env node
// Cliente Redis MÍNIMO (RESP2 sobre net/tls, sin dependencias) para los scripts
// de snapshot/restore (ADR-S20). Existe porque `redis-cli` no está en todos los
// hosts (el runner de CI, un VPS con Redis en Docker sin nombre conocido) y el
// único requisito real de la app es Node.
//
//   node redis-kv.mjs ping <url>                 → exit 0 si responde PONG
//   node redis-kv.mjs dump <url> <patrón>        → JSON {clave: valor} por stdout
//                                                  (sólo claves de tipo string)
//   node redis-kv.mjs load <url> <archivo.json>  → SET de cada par; imprime N
//
// URL: redis://[user][:pass@]host[:port][/db]  ·  rediss:// usa TLS.
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';

function parseUrl(raw) {
    const u = new URL(raw);
    const db = Number((u.pathname || '/').slice(1) || 0);
    return {
        host: u.hostname || '127.0.0.1',
        port: Number(u.port || 6379),
        tls: u.protocol === 'rediss:',
        username: decodeURIComponent(u.username || ''),
        password: decodeURIComponent(u.password || ''),
        db: Number.isFinite(db) ? db : 0,
    };
}

function encode(args) {
    const parts = [`*${args.length}\r\n`];
    for (const a of args) {
        const b = Buffer.from(String(a), 'utf8');
        parts.push(`$${b.length}\r\n`, b, '\r\n');
    }
    return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
}

/** Parser RESP2 incremental. Devuelve [valor, bytesConsumidos] o null si falta data. */
function parse(buf, off = 0) {
    if (off >= buf.length) return null;
    const type = String.fromCharCode(buf[off]);
    const nl = buf.indexOf('\r\n', off + 1);
    if (nl < 0) return null;
    const line = buf.toString('utf8', off + 1, nl);
    const next = nl + 2;
    switch (type) {
        case '+': return [line, next];
        case '-': return [new Error(line), next];
        case ':': return [Number(line), next];
        case '$': {
            const len = Number(line);
            if (len < 0) return [null, next];
            if (buf.length < next + len + 2) return null;
            return [buf.toString('utf8', next, next + len), next + len + 2];
        }
        case '*': {
            const n = Number(line);
            if (n < 0) return [null, next];
            const out = [];
            let pos = next;
            for (let i = 0; i < n; i++) {
                const r = parse(buf, pos);
                if (!r) return null;
                out.push(r[0]);
                pos = r[1];
            }
            return [out, pos];
        }
        default: throw new Error(`RESP inesperado: ${type}`);
    }
}

function connect(cfg) {
    return new Promise((resolve, reject) => {
        const sock = cfg.tls
            ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
            : net.connect({ host: cfg.host, port: cfg.port });
        const pending = [];
        let buf = Buffer.alloc(0);
        sock.setTimeout(10_000, () => sock.destroy(new Error('timeout')));
        sock.on('error', (e) => { reject(e); for (const p of pending.splice(0)) p.reject(e); });
        sock.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            for (;;) {
                let r;
                try { r = parse(buf); } catch (e) { sock.destroy(e); return; }
                if (!r) return;
                buf = buf.subarray(r[1]);
                const p = pending.shift();
                if (!p) continue;
                r[0] instanceof Error ? p.reject(r[0]) : p.resolve(r[0]);
            }
        });
        const cmd = (...args) => new Promise((res, rej) => { pending.push({ resolve: res, reject: rej }); sock.write(encode(args)); });
        sock.once(cfg.tls ? 'secureConnect' : 'connect', () => resolve({ cmd, close: () => sock.end() }));
    });
}

async function open(raw) {
    const cfg = parseUrl(raw);
    const c = await connect(cfg);
    if (cfg.password) await c.cmd(...(cfg.username ? ['AUTH', cfg.username, cfg.password] : ['AUTH', cfg.password]));
    if (cfg.db) await c.cmd('SELECT', cfg.db);
    return c;
}

const [mode, url, arg] = process.argv.slice(2);
if (!mode || !url) {
    console.error('uso: redis-kv.mjs ping|dump|load <url> [patrón|archivo]');
    process.exit(2);
}
let client;
try {
    client = await open(url);
    if (mode === 'ping') {
        const r = await client.cmd('PING');
        process.stdout.write(`${r}\n`);
    } else if (mode === 'dump') {
        const out = {};
        let cursor = '0';
        do {
            const [next, keys] = await client.cmd('SCAN', cursor, 'MATCH', arg || '*', 'COUNT', '200');
            cursor = String(next);
            for (const k of keys) {
                // Sólo strings (las claves platform:* lo son); un hash/set da WRONGTYPE y se salta.
                try {
                    const v = await client.cmd('GET', k);
                    if (v !== null) out[k] = v;
                } catch { /* WRONGTYPE */ }
            }
        } while (cursor !== '0');
        process.stdout.write(`${JSON.stringify(out)}\n`);
    } else if (mode === 'load') {
        const data = JSON.parse(readFileSync(arg, 'utf8'));
        let n = 0;
        for (const [k, v] of Object.entries(data)) {
            await client.cmd('SET', k, String(v));
            n++;
        }
        process.stdout.write(`${n}\n`);
    } else {
        console.error(`modo desconocido: ${mode}`);
        process.exit(2);
    }
    client.close();
} catch (e) {
    client?.close();
    console.error(`redis-kv ${mode}: ${e.message}`);
    process.exit(1);
}
