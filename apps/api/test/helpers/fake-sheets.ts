import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * v0.1.459 (G3) — Google Sheets MÍNIMO en proceso: lo justo de la API v4 que
 * usa la sincronización (datos de la planilla, leer un rango, escribir celdas
 * con RAW, agregar filas al final, borrar filas y sumar columnas). Guarda las
 * celdas tipadas (número, booleano, texto) como Sheets con
 * `UNFORMATTED_VALUE`, exige el token y anota cada pedido para poder
 * comprobar qué se escribió.
 *
 * Lo usan los tests y, en desarrollo, `scripts/dev/fake-sheets.mjs` (con
 * `/__set`, `/__dump` y `/__fail` para manejarlo desde afuera). Sólo sintaxis
 * de TypeScript que Node puede quitar sola (sin enums ni propiedades en el
 * constructor), así el script de desarrollo lo importa sin compilar.
 */
export type FakeCell = string | number | boolean | null;

export interface FakeTab {
    gid: number;
    title: string;
    rows: FakeCell[][];
    rowCount: number;
    columnCount: number;
}

export interface FakeBook {
    title: string;
    tabs: FakeTab[];
}

export interface FakeSheetsCall {
    method: string;
    path: string;
    body: unknown;
}

export interface FakeSheets {
    apiBase: string;
    token: string;
    books: Map<string, FakeBook>;
    log: FakeSheetsCall[];
    /** Responder ese código a todo (401 = autorización vencida, 403 = sin permiso, 429…). */
    failWith: number | null;
    setBook(id: string, title: string, tabs: Array<{ gid?: number; title: string; rows: FakeCell[][]; rowCount?: number; columnCount?: number }>): void;
    tab(id: string, gid?: number): FakeTab;
    /** Las filas de la pestaña sin las celdas vacías del final. */
    grid(id: string, gid?: number): FakeCell[][];
    close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks).toString('utf8');
}

function gerr(status: number, message: string, statusText = 'INVALID_ARGUMENT'): string {
    return JSON.stringify({ error: { code: status, message, status: statusText } });
}

function colIndex(letters: string): number {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** `'Ventas 2026'!A1:CV10001`, `Hoja1!C12` → pestaña y celdas (0-based, fin incluido). */
export function parseA1(range: string): { title: string; c1: number; r1: number; c2: number; r2: number } | null {
    const bang = range.lastIndexOf('!');
    if (bang < 0) return null;
    let title = range.slice(0, bang);
    if (title.startsWith("'") && title.endsWith("'")) title = title.slice(1, -1).replace(/''/g, "'");
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(range.slice(bang + 1));
    if (!m) return null;
    const c1 = colIndex(m[1]!);
    const r1 = Number(m[2]) - 1;
    const c2 = m[3] ? colIndex(m[3]) : c1;
    const r2 = m[4] ? Number(m[4]) - 1 : r1;
    return { title, c1, r1, c2, r2 };
}

function isEmpty(c: FakeCell | undefined): boolean {
    return c === null || c === undefined || c === '';
}

function trimRow(row: FakeCell[]): FakeCell[] {
    let end = row.length;
    while (end > 0 && isEmpty(row[end - 1])) end--;
    return row.slice(0, end).map((c) => (c === null || c === undefined ? '' : c));
}

export async function startFakeSheets(opts: { port?: number; token?: string } = {}): Promise<FakeSheets> {
    const books = new Map<string, FakeBook>();
    const log: FakeSheetsCall[] = [];
    const state = { token: opts.token ?? 'sheets-token', failWith: null as number | null };

    const findTab = (book: FakeBook, title: string): FakeTab | undefined => book.tabs.find((t) => t.title === title);

    const server: Server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://x');
            const send = (status: number, body?: unknown): void => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
            };
            const raw = await readBody(req);
            const body = raw ? (JSON.parse(raw) as unknown) : undefined;

            // ── Control (sólo desarrollo) ───────────────────────────────────
            if (url.pathname === '/__set' && req.method === 'POST') {
                const b = body as { id: string; title: string; tabs: Array<{ gid?: number; title: string; rows: FakeCell[][] }> };
                api.setBook(b.id, b.title, b.tabs);
                return send(200, { ok: true });
            }
            if (url.pathname === '/__dump') {
                const id = url.searchParams.get('id') ?? '';
                const b = books.get(id);
                if (!b) return send(404, { error: 'no existe' });
                return send(200, { title: b.title, tabs: b.tabs.map((t) => ({ gid: t.gid, title: t.title, rows: t.rows.map(trimRow), rowCount: t.rowCount, columnCount: t.columnCount })) });
            }
            if (url.pathname === '/__fail' && req.method === 'POST') {
                state.failWith = (body as { status?: number | null })?.status ?? null;
                return send(200, { ok: true });
            }
            if (url.pathname === '/__log') return send(200, log);

            log.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body });
            if (state.failWith) {
                const s = state.failWith;
                return send(s, gerr(s, s === 401 ? 'Request had invalid authentication credentials.' : s === 403 ? 'The caller does not have permission' : 'Quota exceeded', s === 401 ? 'UNAUTHENTICATED' : s === 403 ? 'PERMISSION_DENIED' : 'RESOURCE_EXHAUSTED'));
            }
            if (req.headers.authorization !== `Bearer ${state.token}`) return send(401, gerr(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED'));

            const meta = /^\/v4\/spreadsheets\/([^/:]+)$/.exec(url.pathname);
            if (meta && req.method === 'GET') {
                const b = books.get(decodeURIComponent(meta[1]!));
                if (!b) return send(404, gerr(404, 'Requested entity was not found.', 'NOT_FOUND'));
                return send(200, {
                    properties: { title: b.title },
                    sheets: b.tabs.map((t, index) => ({ properties: { sheetId: t.gid, title: t.title, index, gridProperties: { rowCount: t.rowCount, columnCount: t.columnCount } } })),
                });
            }
            const getVals = /^\/v4\/spreadsheets\/([^/:]+)\/values\/(.+)$/.exec(url.pathname);
            if (getVals && req.method === 'GET') {
                const b = books.get(decodeURIComponent(getVals[1]!));
                if (!b) return send(404, gerr(404, 'Requested entity was not found.', 'NOT_FOUND'));
                const r = parseA1(decodeURIComponent(getVals[2]!));
                const t = r ? findTab(b, r.title) : undefined;
                if (!r || !t) return send(400, gerr(400, `Unable to parse range: ${decodeURIComponent(getVals[2]!)}`));
                const out: FakeCell[][] = [];
                for (let i = r.r1; i <= Math.min(r.r2, t.rows.length - 1); i++) out.push(trimRow((t.rows[i] ?? []).slice(r.c1, r.c2 + 1)));
                while (out.length > 0 && out[out.length - 1]!.length === 0) out.pop();
                return send(200, { range: decodeURIComponent(getVals[2]!), majorDimension: 'ROWS', ...(out.length > 0 ? { values: out } : {}) });
            }
            const batch = /^\/v4\/spreadsheets\/([^/:]+)\/values:batchUpdate$/.exec(url.pathname);
            if (batch && req.method === 'POST') {
                const b = books.get(decodeURIComponent(batch[1]!));
                if (!b) return send(404, gerr(404, 'Requested entity was not found.', 'NOT_FOUND'));
                const data = (body as { data: Array<{ range: string; values: FakeCell[][] }> }).data;
                for (const d of data) {
                    const r = parseA1(d.range);
                    const t = r ? findTab(b, r.title) : undefined;
                    if (!r || !t) return send(400, gerr(400, `Unable to parse range: ${d.range}`));
                    if (r.c1 >= t.columnCount) return send(400, gerr(400, `Range (${d.range}) exceeds grid limits. Max columns: ${t.columnCount}`));
                    if (r.r1 >= t.rowCount) return send(400, gerr(400, `Range (${d.range}) exceeds grid limits. Max rows: ${t.rowCount}`));
                }
                for (const d of data) {
                    const r = parseA1(d.range)!;
                    const t = findTab(b, r.title)!;
                    d.values.forEach((vals, i) => {
                        const row = (t.rows[r.r1 + i] ??= []);
                        vals.forEach((v, j) => {
                            row[r.c1 + j] = v;
                        });
                    });
                    for (let i = 0; i < t.rows.length; i++) t.rows[i] ??= [];
                }
                return send(200, { totalUpdatedCells: data.length });
            }
            const append = /^\/v4\/spreadsheets\/([^/:]+)\/values\/(.+):append$/.exec(url.pathname);
            if (append && req.method === 'POST') {
                const b = books.get(decodeURIComponent(append[1]!));
                const r = parseA1(decodeURIComponent(append[2]!));
                const t = b && r ? findTab(b, r.title) : undefined;
                if (!t || !r) return send(400, gerr(400, 'Unable to parse range'));
                // La "tabla" empieza en la fila del rango: se agrega después de su última fila con datos.
                let last = r.r1;
                for (let i = r.r1; i < t.rows.length; i++) if ((t.rows[i] ?? []).some((c) => !isEmpty(c))) last = i;
                const values = (body as { values: FakeCell[][] }).values;
                for (let i = t.rows.length; i <= last; i++) t.rows[i] = [];
                t.rows.splice(last + 1, 0, ...values.map((v) => [...v]));
                t.rowCount += values.length;
                return send(200, { updates: { updatedRows: values.length } });
            }
            const struct = /^\/v4\/spreadsheets\/([^/:]+):batchUpdate$/.exec(url.pathname);
            if (struct && req.method === 'POST') {
                const b = books.get(decodeURIComponent(struct[1]!));
                if (!b) return send(404, gerr(404, 'Requested entity was not found.', 'NOT_FOUND'));
                const requests = (body as { requests: Array<Record<string, { range?: { sheetId: number; dimension: string; startIndex: number; endIndex: number }; sheetId?: number; dimension?: string; length?: number }>> }).requests;
                for (const q of requests) {
                    if (q.deleteDimension) {
                        const g = q.deleteDimension.range!;
                        const t = b.tabs.find((x) => x.gid === g.sheetId);
                        if (!t) return send(400, gerr(400, 'No grid with id'));
                        t.rows.splice(g.startIndex, g.endIndex - g.startIndex);
                        t.rowCount -= g.endIndex - g.startIndex;
                    } else if (q.appendDimension) {
                        const t = b.tabs.find((x) => x.gid === q.appendDimension!.sheetId);
                        if (!t) return send(400, gerr(400, 'No grid with id'));
                        if (q.appendDimension.dimension === 'COLUMNS') t.columnCount += q.appendDimension.length ?? 0;
                        else t.rowCount += q.appendDimension.length ?? 0;
                    }
                }
                return send(200, { replies: [] });
            }
            return send(404, gerr(404, `Ruta desconocida ${req.method} ${url.pathname}`, 'NOT_FOUND'));
        })().catch((err: unknown) => {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(gerr(500, String(err), 'INTERNAL'));
        });
    });
    await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const api: FakeSheets = {
        apiBase: `http://127.0.0.1:${port}`,
        get token() {
            return state.token;
        },
        set token(v: string) {
            state.token = v;
        },
        books,
        log,
        get failWith() {
            return state.failWith;
        },
        set failWith(v: number | null) {
            state.failWith = v;
        },
        setBook(id, title, tabs) {
            books.set(id, {
                title,
                tabs: tabs.map((t, i) => ({
                    gid: t.gid ?? i * 1000,
                    title: t.title,
                    rows: t.rows.map((r) => [...r]),
                    rowCount: t.rowCount ?? Math.max(1000, t.rows.length),
                    columnCount: t.columnCount ?? Math.max(26, ...t.rows.map((r) => r.length)),
                })),
            });
        },
        tab(id, gid) {
            const b = books.get(id);
            if (!b) throw new Error(`No existe la planilla ${id}`);
            const t = gid === undefined ? b.tabs[0] : b.tabs.find((x) => x.gid === gid);
            if (!t) throw new Error(`No existe la pestaña ${gid}`);
            return t;
        },
        grid(id, gid) {
            const rows = api.tab(id, gid).rows.map(trimRow);
            while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop();
            return rows;
        },
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
    return api;
}
