import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Redis from 'ioredis';
import type { ClientErrorEntry, ClientErrorReport } from '@imagina-base/shared';

/**
 * v0.1.435 — Errores de las PANTALLAS (lo que falla en el navegador de quien
 * usa la app): antes quedaban en la consola de esa persona y nadie se enteraba.
 * Llegan a Plataforma → Diagnóstico agrupados — mismo mensaje, misma pantalla,
 * mismo lugar del código = una fila con su contador —, 14 días y hasta 200
 * grupos.
 *
 * Nunca guarda datos de la persona: ni IP, ni usuario, ni la consulta de la
 * dirección (puede traer un token), ni el dominio en el stack. Los números de
 * la ruta se cambian por `:id`.
 */
const META_KEY = 'diag:cerr';
const COUNT_KEY = 'diag:cerr:n';
const CAP = 200;
const PRUNE_TO = 150;
const TTL_SECONDS = 14 * 86_400;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Mensajes que no dicen nada útil del lado de la app (el navegador, una extensión, la red). */
const NOISE: RegExp[] = [
    /^script error\.?$/i,
    /resizeobserver loop/i,
    /failed to fetch dynamically imported module/i,
    /importing a module script failed/i,
    /error loading dynamically imported module/i,
    /^(load failed|failed to fetch|networkerror when attempting to fetch resource\.?)$/i,
    /^aborterror\b|the (user|operation) aborted/i,
];

export function isNoiseMessage(message: string): boolean {
    const m = message.trim();
    return m === '' || NOISE.some((r) => r.test(m));
}

/** `/lists/12/records/abc…` → `/lists/:id/records/:token` (sin consulta ni ancla). */
export function normalizeRoute(route: string): string {
    const path = String(route || '/').split(/[?#]/)[0]!;
    const parts = path
        .split('/')
        .map((seg) => {
            if (/^\d+$/.test(seg)) return ':id';
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
            if (seg.length >= 20 && /^[A-Za-z0-9_.~-]+$/.test(seg) && /\d/.test(seg)) return ':token';
            return seg;
        })
        .join('/');
    return clip(parts.startsWith('/') ? parts : `/${parts}`, 200);
}

/** El mensaje para AGRUPAR: los números y los ids cambian entre una vez y otra. */
function groupingMessage(message: string): string {
    return message
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
        .replace(/\b[0-9a-f]{12,}\b/gi, '#')
        .replace(/\d+/g, '#')
        .slice(0, 300);
}

/** Sin el dominio ni la consulta de cada archivo (`https://x.y/assets/a.js?v=1:3:9` → `/assets/a.js:3:9`). */
export function cleanStack(stack: string | undefined): string | null {
    if (!stack) return null;
    const out = stack
        .replace(/(?:https?|chrome-extension|moz-extension|safari-web-extension):\/\/[^/\s)]+/g, '')
        .replace(/\?[^\s:)]*/g, '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(0, 25)
        .join('\n');
    return out ? clip(out, 4000) : null;
}

/** «Chrome 131 · Android», «Safari 18 · iPhone», «Firefox 133 · Windows». */
export function browserLabel(ua: string | undefined): string | null {
    const s = String(ua ?? '');
    if (!s) return null;
    const pick = (re: RegExp): string | null => re.exec(s)?.[1] ?? null;
    let name: string | null = null;
    let v: string | null;
    if ((v = pick(/Edg(?:A|iOS)?\/(\d+)/))) name = 'Edge';
    else if ((v = pick(/OPR\/(\d+)/))) name = 'Opera';
    else if ((v = pick(/SamsungBrowser\/(\d+)/))) name = 'Samsung Internet';
    else if ((v = pick(/(?:Firefox|FxiOS)\/(\d+)/))) name = 'Firefox';
    else if ((v = pick(/(?:Chrome|CriOS)\/(\d+)/))) name = 'Chrome';
    else if ((v = pick(/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/))) name = 'Safari';
    const os = /iPhone/.test(s)
        ? 'iPhone'
        : /iPad/.test(s)
          ? 'iPad'
          : /Android/.test(s)
            ? 'Android'
            : /Windows/.test(s)
              ? 'Windows'
              : /Mac OS X|Macintosh/.test(s)
                ? 'Mac'
                : /CrOS/.test(s)
                  ? 'ChromeOS'
                  : /Linux/.test(s)
                    ? 'Linux'
                    : null;
    const who = name ? `${name}${v ? ` ${v}` : ''}` : null;
    const label = [who, os].filter(Boolean).join(' · ');
    return label ? clip(label, 80) : null;
}

let cachedVersion: string | null = null;
function appVersion(): string {
    if (cachedVersion) return cachedVersion;
    for (const candidate of [join(process.cwd(), '..', '..', 'VERSION'), join(process.cwd(), 'VERSION')]) {
        try {
            cachedVersion = readFileSync(candidate, 'utf8').trim().slice(0, 40);
            return cachedVersion;
        } catch {
            // siguiente
        }
    }
    cachedVersion = 'dev';
    return cachedVersion;
}

export interface ClientErrorStore {
    hget(key: string, field: string): Promise<string | null>;
    hgetall(key: string): Promise<Record<string, string>>;
    hlen(key: string): Promise<number>;
}

/**
 * Lo deja en el grupo que le corresponde. Devuelve la clave del grupo, o null
 * si no se guardó (ruido). Best-effort: un Redis caído no rompe nada.
 */
export async function recordClientError(
    redis: Redis,
    report: ClientErrorReport,
    ua: string | undefined,
    now = new Date(),
): Promise<string | null> {
    const message = clip(report.message.trim(), 400);
    if (isNoiseMessage(message)) return null;
    const route = normalizeRoute(report.route);
    const component = report.component ? clip(report.component.trim(), 200) : null;
    const stack = cleanStack(report.stack);
    // El lugar del código: la primera línea del stack que nombra un archivo.
    const where = stack?.split('\n').find((l) => /\.[cm]?[jt]sx?:\d+/.test(l)) ?? '';
    const key = createHash('sha1')
        .update([report.surface, report.kind, groupingMessage(message), route, component ?? '', where.replace(/:\d+:\d+\)?$/, '')].join('|'))
        .digest('hex')
        .slice(0, 16);
    const at = now.toISOString();
    try {
        const prev = await redis.hget(META_KEY, key);
        let first_at = at;
        if (prev) {
            try {
                first_at = (JSON.parse(prev) as ClientErrorEntry).first_at || at;
            } catch {
                /* fila rota: se reescribe */
            }
        } else if ((await redis.hlen(META_KEY)) >= CAP) {
            await pruneClientErrors(redis);
        }
        const entry: Omit<ClientErrorEntry, 'count'> = {
            key,
            kind: report.kind,
            surface: report.surface,
            message,
            route,
            stack,
            component,
            browser: browserLabel(ua),
            version: appVersion(),
            first_at,
            last_at: at,
        };
        await redis
            .multi()
            .hset(META_KEY, key, JSON.stringify(entry))
            .hincrby(COUNT_KEY, key, 1)
            .expire(META_KEY, TTL_SECONDS)
            .expire(COUNT_KEY, TTL_SECONDS)
            .exec();
        return key;
    } catch {
        return null;
    }
}

/** Deja los PRUNE_TO grupos más recientes. */
async function pruneClientErrors(redis: Redis): Promise<void> {
    const all = await redis.hgetall(META_KEY);
    const rows = Object.entries(all)
        .map(([k, v]) => {
            try {
                return { k, last: (JSON.parse(v) as ClientErrorEntry).last_at };
            } catch {
                return { k, last: '' };
            }
        })
        .sort((a, b) => (a.last < b.last ? 1 : -1));
    const drop = rows.slice(PRUNE_TO).map((r) => r.k);
    if (drop.length) await redis.multi().hdel(META_KEY, ...drop).hdel(COUNT_KEY, ...drop).exec();
}

/** Los grupos de los últimos 14 días, del más reciente al más viejo. */
export async function readClientErrors(redis: Redis, limit = 100, now = Date.now()): Promise<ClientErrorEntry[]> {
    const [meta, counts] = await Promise.all([redis.hgetall(META_KEY), redis.hgetall(COUNT_KEY)]);
    const cutoff = now - TTL_SECONDS * 1000;
    const out: ClientErrorEntry[] = [];
    for (const [key, raw] of Object.entries(meta)) {
        try {
            const e = JSON.parse(raw) as Omit<ClientErrorEntry, 'count'>;
            if (Date.parse(e.last_at) < cutoff) continue;
            out.push({ ...e, key, count: Number(counts[key] ?? 1) || 1 });
        } catch {
            /* fila corrupta: se ignora */
        }
    }
    return out.sort((a, b) => (a.last_at < b.last_at ? 1 : -1)).slice(0, limit);
}

export async function clearClientErrors(redis: Redis): Promise<void> {
    await redis.del(META_KEY, COUNT_KEY);
}
