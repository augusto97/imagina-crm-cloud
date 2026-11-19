import { quoteSheetTitle, sheetColumnLetter } from '@imagina-base/shared';
import type { SheetCell } from './sheet-values';

/**
 * v0.1.459 (G3) — Lo justo de la API v4 de Google Sheets que usa la
 * sincronización: leer los datos de la planilla y una pestaña ENTERA en UN
 * pedido, escribir varias celdas en UN pedido (`values:batchUpdate`, RAW),
 * agregar filas al final (`append`, RAW) y borrar filas o sumar columnas
 * (`spreadsheets:batchUpdate`). Las cuotas de Google son por minuto: una
 * corrida hace 2 lecturas y, como mucho, 3 escrituras.
 *
 * Sin dependencias: `fetch` con el token VIGENTE de la conexión (lo renueva
 * el servicio de conectores). La URL base se puede apuntar a un doble
 * (`GOOGLE_SHEETS_API_URL`, sólo desarrollo y tests).
 */

export const SHEETS_API_DEFAULT = 'https://sheets.googleapis.com';
const TIMEOUT_MS = 60_000;

export class SheetsApiError extends Error {
    override name = 'SheetsApiError';
    constructor(
        message: string,
        readonly status = 0,
        /** Lo arregla la persona (permisos, autorización): abre un problema. */
        readonly needsUser = false,
    ) {
        super(message);
    }
}

export interface SheetsTab {
    gid: number;
    title: string;
    rows: number;
    columns: number;
}

export interface SheetsSpreadsheet {
    title: string;
    tabs: SheetsTab[];
}

export interface SheetsCellWrite {
    /** Fila de la hoja (1 = la primera). */
    row: number;
    /** Columna (0 = A). */
    col: number;
    value: SheetCell;
}

export interface SheetsApiOptions {
    apiBase: string;
    token: () => Promise<string>;
}

// --- Pedidos (puros: se prueban sin red) ------------------------------------

/** El rango de una pestaña entera desde una fila: `'Ventas'!A1:CV10001`. */
export function tabRange(title: string, fromRow: number, toRow: number, columns: number): string {
    return `${quoteSheetTitle(title)}!A${fromRow}:${sheetColumnLetter(Math.max(1, columns) - 1)}${toRow}`;
}

/** Una celda: `'Ventas'!C12`. */
export function cellRange(title: string, row: number, col: number): string {
    return `${quoteSheetTitle(title)}!${sheetColumnLetter(col)}${row}`;
}

/** Cuerpo de `values:batchUpdate` (RAW: nunca se interpreta como fórmula). */
export function batchUpdateBody(title: string, writes: readonly SheetsCellWrite[]): { valueInputOption: 'RAW'; data: Array<{ range: string; values: SheetCell[][] }> } {
    return {
        valueInputOption: 'RAW',
        data: writes.map((w) => ({ range: cellRange(title, w.row, w.col), values: [[w.value ?? '']] })),
    };
}

/** Pedidos de `spreadsheets:batchUpdate` para borrar filas (de abajo hacia arriba). */
export function deleteRowsRequests(gid: number, rows: readonly number[]): Array<Record<string, unknown>> {
    return [...new Set(rows)]
        .sort((a, b) => b - a)
        .map((row) => ({ deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }));
}

// --- Cliente ------------------------------------------------------------------

export class SheetsApi {
    constructor(private readonly opts: SheetsApiOptions) {}

    /** El nombre de la planilla y sus pestañas (sin datos). */
    async spreadsheet(id: string): Promise<SheetsSpreadsheet> {
        const fields = 'properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))';
        const json = (await this.call('GET', `/v4/spreadsheets/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, undefined, 'abrir la planilla')) as {
            properties?: { title?: string };
            sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
        };
        const tabs = (json.sheets ?? [])
            .map((s) => s.properties ?? {})
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            .map((p) => ({ gid: Number(p.sheetId ?? 0), title: String(p.title ?? ''), rows: Number(p.gridProperties?.rowCount ?? 0), columns: Number(p.gridProperties?.columnCount ?? 0) }));
        return { title: String(json.properties?.title ?? ''), tabs };
    }

    /** Las celdas de un rango, como las guarda Sheets (números, booleanos, texto). */
    async values(id: string, range: string): Promise<unknown[][]> {
        const q = `valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`;
        const json = (await this.call('GET', `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?${q}`, undefined, 'leer la hoja')) as {
            values?: unknown[][];
        };
        return Array.isArray(json.values) ? json.values.map((r) => (Array.isArray(r) ? r : [])) : [];
    }

    /** Escribe varias celdas en UN pedido. */
    async writeCells(id: string, title: string, writes: readonly SheetsCellWrite[]): Promise<void> {
        if (writes.length === 0) return;
        await this.call('POST', `/v4/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`, batchUpdateBody(title, writes), 'escribir en la hoja');
    }

    /** Agrega filas al final de la tabla que empieza en la fila de encabezados. */
    async appendRows(id: string, title: string, headerRow: number, columns: number, rows: readonly SheetCell[][]): Promise<void> {
        if (rows.length === 0) return;
        const range = tabRange(title, headerRow, headerRow, columns);
        await this.call(
            'POST',
            `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { values: rows.map((r) => r.map((c) => c ?? '')) },
            'agregar filas a la hoja',
        );
    }

    /** Borra filas (de abajo hacia arriba, así los números no se corren). */
    async deleteRows(id: string, gid: number, rows: readonly number[]): Promise<void> {
        if (rows.length === 0) return;
        await this.call('POST', `/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`, { requests: deleteRowsRequests(gid, rows) }, 'borrar filas de la hoja');
    }

    /** Suma columnas al final de la pestaña (para escribir encabezados nuevos). */
    async addColumns(id: string, gid: number, count: number): Promise<void> {
        if (count <= 0) return;
        await this.call(
            'POST',
            `/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,
            { requests: [{ appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: count } }] },
            'agregar columnas a la hoja',
        );
    }

    private async call(method: 'GET' | 'POST', path: string, body: unknown, what: string): Promise<unknown> {
        const token = await this.opts.token();
        let res: Response;
        try {
            res = await fetch(`${this.opts.apiBase.replace(/\/+$/, '')}${path}`, {
                method,
                headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (err) {
            throw new SheetsApiError(`No se pudo conectar con Google Sheets (${err instanceof Error ? err.message : String(err)}).`);
        }
        if (!res.ok) throw await sheetsError(res, what);
        const text = await res.text();
        if (text === '') return {};
        try {
            return JSON.parse(text) as unknown;
        } catch {
            throw new SheetsApiError(`Google Sheets respondió algo que no se entiende al ${what}.`, res.status);
        }
    }
}

/** El error de Google, en lenguaje claro y con lo que hay que hacer. */
export async function sheetsError(res: Response, what: string): Promise<SheetsApiError> {
    let message = '';
    let reason = '';
    try {
        const json = (await res.json()) as { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } };
        message = json.error?.message ?? '';
        reason = json.error?.errors?.[0]?.reason ?? json.error?.status ?? '';
    } catch {
        // cuerpo vacío o no-JSON
    }
    return sheetsErrorFrom(res.status, message, reason, what);
}

export function sheetsErrorFrom(status: number, message: string, reason: string, what: string): SheetsApiError {
    if (status === 401) {
        return new SheetsApiError('Google rechazó el acceso a la planilla: la autorización venció o se revocó. Reconecta Google Sheets en Ajustes → Integraciones.', 401, true);
    }
    if (status === 429 || reason === 'rateLimitExceeded' || reason === 'RESOURCE_EXHAUSTED') {
        return new SheetsApiError('Google Sheets pidió esperar (demasiados pedidos seguidos). La sincronización vuelve a intentar en un rato.', 429);
    }
    if (status === 403) {
        return new SheetsApiError(
            'La cuenta de Google conectada no tiene permiso para esa planilla. Compártela con esa cuenta (como editor si la app tiene que escribir) o conecta otra cuenta.',
            403,
            true,
        );
    }
    if (status === 404) {
        return new SheetsApiError('La planilla ya no existe o se movió a la papelera de Google Drive. Revisa el enlace.', 404, true);
    }
    if (status === 400 && /protected/i.test(message)) {
        return new SheetsApiError(`La hoja tiene celdas protegidas: la app no pudo ${what}. Quita la protección o dale permiso a la cuenta conectada.`, 400, true);
    }
    if (status === 400 && /parse range|Unable to parse/i.test(message)) {
        return new SheetsApiError('La pestaña elegida ya no existe en la planilla: elige otra en la sincronización.', 400, true);
    }
    if (status >= 500) return new SheetsApiError(`Google Sheets no respondió bien al ${what} (${status}). Se vuelve a intentar en la próxima corrida.`, status);
    return new SheetsApiError(`Google Sheets no dejó ${what} (${status}${message ? `: ${message}` : ''}).`, status, status === 400);
}
