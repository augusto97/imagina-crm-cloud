import { z } from 'zod';
import { idSchema } from './common';
import { SQL_SYNC_FIELD_TYPES, SQL_SYNC_KEY_TYPES } from './sql-sync';

/**
 * v0.1.459 (G3) — Sincronizar una lista con una hoja de Google Sheets en los
 * dos sentidos.
 *
 * Una conexión `google_sheets` (Integraciones, OAuth con la app de Google del
 * operador y el permiso `spreadsheets`) puede tener VARIAS sincronizaciones:
 * cada una une UNA pestaña de una planilla con UNA lista. Cada cuánto (o
 * enseguida que alguien cambia algo en la app) se lee la pestaña completa en
 * un pedido, se empareja cada fila con su registro por una columna CLAVE y se
 * concilian las dos puntas según la dirección elegida:
 *  - `sheet_to_app`: la hoja manda (lo editado en la app vuelve al valor de
 *    la hoja, como la sincronización desde SQL);
 *  - `app_to_sheet`: la app manda (la pestaña es un espejo de la lista);
 *  - `both`: lo que cambió de cada lado desde la última vez viaja al otro; si
 *    la MISMA celda cambió en los dos lados, gana la app y queda anotado.
 *
 * La clave por defecto es una columna «ID» que escribe la app con el número
 * del registro (estable aunque se cambie cualquier otro dato); como
 * alternativa, una columna de la hoja que coincide con un campo de la lista
 * (email, NIT, código).
 *
 * Lo que la app escribe en la hoja va como VALOR, nunca como fórmula
 * (`valueInputOption: RAW`): un dato de un registro que empieza con `=`
 * queda como texto en la planilla.
 */

/** Tipos de campo que se sincronizan (los mismos que la sincronización desde SQL). */
export const SHEET_SYNC_FIELD_TYPES = SQL_SYNC_FIELD_TYPES;

/** Tipos que pueden ser la columna clave (modo «una columna de la hoja»). */
export const SHEET_SYNC_KEY_TYPES = SQL_SYNC_KEY_TYPES;

export const SHEET_SYNC_DIRECTIONS = ['sheet_to_app', 'app_to_sheet', 'both'] as const;
export type SheetSyncDirection = (typeof SHEET_SYNC_DIRECTIONS)[number];

/** Una fila que desaparece de la hoja: nada, o el registro a la papelera de la app. */
export const SHEET_ON_SHEET_DELETE = ['ignore', 'trash'] as const;
/** Un registro que se borra en la app: nada, o se borra su fila de la hoja. */
export const SHEET_ON_APP_DELETE = ['ignore', 'delete_row'] as const;

/** Cada cuánto se revisa, en minutos. */
export const SHEET_SYNC_INTERVALS = [5, 15, 30, 60, 180, 360, 1440] as const;

/**
 * Filas de la hoja (y registros de la lista) que maneja una sincronización.
 * Una planilla más grande se lee hasta aquí y se avisa: lo de más abajo no
 * se toca (ni se borra, ni se da por desaparecido).
 */
export const SHEET_SYNC_MAX_ROWS = 10_000;
/** Columnas que se leen de la pestaña (A…CV). */
export const SHEET_SYNC_MAX_COLUMNS = 100;
/** Filas que muestra «Probar». */
export const SHEET_SYNC_PREVIEW_ROWS = 20;
/** Nombre por defecto de la columna con el número del registro. */
export const SHEET_SYNC_ID_COLUMN = 'ID';

export const sheetSyncKeySchema = z.discriminatedUnion('mode', [
    z.object({
        /** La app escribe el número del registro en esta columna (recomendado). */
        mode: z.literal('app_id'),
        column: z.string().trim().min(1).max(100).default(SHEET_SYNC_ID_COLUMN),
    }),
    z.object({
        /** Una columna de la hoja que coincide con un campo de la lista (email, NIT…). */
        mode: z.literal('field'),
        column: z.string().trim().min(1).max(100),
        field_id: idSchema,
    }),
]);
export type SheetSyncKey = z.infer<typeof sheetSyncKeySchema>;

export const sheetColumnMapSchema = z.object({
    /** El encabezado de la columna en la hoja (si no existe, la app lo agrega). */
    column: z.string().trim().min(1).max(100),
    field_id: idSchema,
});
export type SheetColumnMap = z.infer<typeof sheetColumnMapSchema>;

const spreadsheetIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{20,128}$/, 'Planilla inválida');

const sheetSyncBase = {
    name: z.string().trim().min(1).max(120),
    list_id: idSchema,
    spreadsheet_id: spreadsheetIdSchema,
    /** La pestaña, por su id (`gid`): sigue funcionando si alguien la renombra. */
    sheet_gid: z.number().int().min(0).max(2_147_483_647),
    /** Fila de los encabezados (1 = la primera). Los datos empiezan debajo. */
    header_row: z.number().int().min(1).max(50),
    direction: z.enum(SHEET_SYNC_DIRECTIONS),
    key: sheetSyncKeySchema,
    columns: z.array(sheetColumnMapSchema).max(SHEET_SYNC_MAX_COLUMNS),
    on_sheet_delete: z.enum(SHEET_ON_SHEET_DELETE),
    on_app_delete: z.enum(SHEET_ON_APP_DELETE),
    interval_minutes: z
        .number()
        .int()
        .refine((n) => (SHEET_SYNC_INTERVALS as readonly number[]).includes(n), 'Intervalo no disponible'),
    enabled: z.boolean(),
};

export const createSheetSyncSchema = z.object({
    ...sheetSyncBase,
    header_row: sheetSyncBase.header_row.default(1),
    direction: sheetSyncBase.direction.default('both'),
    key: sheetSyncBase.key.default({ mode: 'app_id', column: SHEET_SYNC_ID_COLUMN }),
    columns: sheetSyncBase.columns.default([]),
    on_sheet_delete: sheetSyncBase.on_sheet_delete.default('ignore'),
    on_app_delete: sheetSyncBase.on_app_delete.default('ignore'),
    interval_minutes: sheetSyncBase.interval_minutes.default(15),
    enabled: sheetSyncBase.enabled.default(true),
});
export type CreateSheetSyncInput = z.infer<typeof createSheetSyncSchema>;

export const updateSheetSyncSchema = z.object(sheetSyncBase).partial();
export type UpdateSheetSyncInput = z.infer<typeof updateSheetSyncSchema>;

/**
 * Lo guardado en `sheet_syncs.settings`. Además de lo que elige la persona,
 * el servidor recuerda el nombre de la planilla y de la pestaña (para
 * mostrarlos sin pedirle nada a Google).
 */
export type SheetSyncSettings = Omit<CreateSheetSyncInput, 'name' | 'list_id' | 'enabled'> & {
    spreadsheet_title: string;
    sheet_title: string;
};

/** Leído con tolerancia: una fila vieja o tocada a mano no rompe la sincronización. */
export function readSheetSyncSettings(raw: unknown): SheetSyncSettings {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const titles = {
        spreadsheet_title: typeof obj.spreadsheet_title === 'string' ? obj.spreadsheet_title : '',
        sheet_title: typeof obj.sheet_title === 'string' ? obj.sheet_title : '',
    };
    const parsed = createSheetSyncSchema.omit({ name: true, list_id: true, enabled: true }).safeParse(obj);
    if (parsed.success) return { ...parsed.data, ...titles };
    const key = sheetSyncKeySchema.safeParse(obj.key);
    const columns = z.array(sheetColumnMapSchema).safeParse(obj.columns);
    return {
        spreadsheet_id: typeof obj.spreadsheet_id === 'string' ? obj.spreadsheet_id : '',
        sheet_gid: Number(obj.sheet_gid) || 0,
        header_row: Number(obj.header_row) >= 1 ? Math.min(50, Math.floor(Number(obj.header_row))) : 1,
        direction: (SHEET_SYNC_DIRECTIONS as readonly string[]).includes(String(obj.direction)) ? (obj.direction as SheetSyncDirection) : 'sheet_to_app',
        key: key.success ? key.data : { mode: 'app_id', column: SHEET_SYNC_ID_COLUMN },
        columns: columns.success ? columns.data : [],
        on_sheet_delete: 'ignore',
        on_app_delete: 'ignore',
        interval_minutes: 60,
        ...titles,
    };
}

/** ¿La sincronización lee la hoja y escribe en la app? */
export function sheetSyncReadsSheet(direction: SheetSyncDirection): boolean {
    return direction !== 'app_to_sheet';
}

/** ¿La sincronización escribe en la hoja? */
export function sheetSyncWritesSheet(direction: SheetSyncDirection): boolean {
    return direction !== 'sheet_to_app';
}

// --- Probar una planilla ------------------------------------------------------

/** Abrir una planilla para elegir la pestaña y ver sus columnas. */
export const sheetPreviewSchema = z.object({
    /** El enlace (https://docs.google.com/spreadsheets/d/…/edit#gid=…) o el id pelado. */
    spreadsheet: z.string().trim().min(1).max(500),
    /** La pestaña; sin ella, la del enlace (`#gid=`) o la primera. */
    sheet_gid: z.number().int().min(0).max(2_147_483_647).optional(),
    header_row: z.number().int().min(1).max(50).optional(),
});
export type SheetPreviewInput = z.infer<typeof sheetPreviewSchema>;

/** Tipo de campo que sugiere una columna por sus valores. */
export type SheetSuggestedFieldType = 'text' | 'long_text' | 'email' | 'url' | 'phone' | 'number' | 'checkbox' | 'date' | 'datetime' | 'select';

export interface SheetPreviewTab {
    gid: number;
    title: string;
    rows: number;
    columns: number;
}

export interface SheetPreviewColumn {
    /** El encabezado tal como está en la hoja. */
    name: string;
    /** Letra de la columna (A, B… AA). */
    letter: string;
    suggested_type: SheetSuggestedFieldType;
}

export interface SheetPreviewResult {
    spreadsheet_id: string;
    spreadsheet_title: string;
    tabs: SheetPreviewTab[];
    sheet_gid: number;
    sheet_title: string;
    header_row: number;
    columns: SheetPreviewColumn[];
    /** Las primeras filas de datos, con cada valor ya en texto para mostrar. */
    rows: Array<Record<string, string | null>>;
    /** Filas con datos debajo de los encabezados (hasta el tope). */
    total_rows: number;
    /** La pestaña no tiene encabezados (la app los va a escribir). */
    empty: boolean;
}

// --- Estado -------------------------------------------------------------------

export interface SheetSyncRunResult {
    /** Filas con datos leídas de la hoja. */
    read: number;
    /** Registros creados en la app (filas nuevas de la hoja). */
    created: number;
    /** Registros de la app que cambiaron por la hoja. */
    updated: number;
    /** Celdas escritas en la hoja (cambios de la app y números de registro). */
    cells_written: number;
    /** Filas agregadas al final de la hoja (registros nuevos de la app). */
    rows_added: number;
    /** Filas borradas de la hoja (registros borrados en la app). */
    rows_deleted: number;
    /** Registros enviados a la papelera de la app (filas borradas en la hoja). */
    trashed: number;
    unchanged: number;
    /** Filas que no se pudieron guardar (clave vacía o repetida, valor inválido). */
    failed: number;
    /** Celdas que cambiaron en los dos lados: ganó la app. */
    conflicts: number;
    /** La hoja tenía más filas que el tope: lo de más abajo no se tocó. */
    truncated: boolean;
    elapsed_ms: number;
}

export interface SheetSyncRowError {
    /** «Fila 12» (de la hoja) o «Registro #45». */
    where: string;
    message: string;
}

export interface SheetSyncConflict {
    where: string;
    field: string;
    /** El valor de la app (el que quedó). */
    kept: string;
    /** El de la hoja (el que se reemplazó). */
    replaced: string;
}

export interface SheetSyncStatus {
    running: boolean;
    queued: boolean;
    initial_done: boolean;
    last_run_at: string | null;
    last_success_at: string | null;
    next_run_at: string | null;
    last_error: string | null;
    /** Avisos de la última corrida (columnas que faltan, celdas inválidas…). */
    notes: string[];
    last_result: SheetSyncRunResult | null;
    errors: SheetSyncRowError[];
    conflicts: SheetSyncConflict[];
}

export interface SheetSync {
    id: number;
    connection_id: number;
    connection_name: string;
    name: string;
    list_id: number;
    list_name: string | null;
    list_slug: string | null;
    spreadsheet_id: string;
    spreadsheet_title: string;
    spreadsheet_url: string;
    sheet_gid: number;
    sheet_title: string;
    header_row: number;
    direction: SheetSyncDirection;
    key: SheetSyncKey;
    columns: SheetColumnMap[];
    on_sheet_delete: (typeof SHEET_ON_SHEET_DELETE)[number];
    on_app_delete: (typeof SHEET_ON_APP_DELETE)[number];
    interval_minutes: number;
    enabled: boolean;
    /** Registros de la lista unidos a una fila de la hoja. */
    linked: number;
    status: SheetSyncStatus;
    created_at: string;
}

/** Qué haría la próxima corrida, sin escribir nada. */
export interface SheetSyncDryRun {
    result: SheetSyncRunResult;
    notes: string[];
    errors: SheetSyncRowError[];
    conflicts: SheetSyncConflict[];
    sample: Array<{
        where: string;
        action: 'create' | 'update' | 'write_sheet' | 'add_row' | 'delete_row' | 'trash';
        changes: Array<{ label: string; before: string; after: string }>;
    }>;
}

// --- Piezas puras ---------------------------------------------------------------

/**
 * La planilla y la pestaña a partir del enlace que pega la persona (o el id
 * pelado). `null` si no se reconoce.
 */
export function parseSpreadsheetLink(raw: string): { spreadsheetId: string; gid: number | null } | null {
    const text = raw.trim();
    const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,128})/.exec(text);
    const id = fromUrl ? fromUrl[1]! : /^[A-Za-z0-9_-]{20,128}$/.test(text) ? text : null;
    if (!id) return null;
    const gid = /[#?&]gid=(\d{1,10})/.exec(text);
    return { spreadsheetId: id, gid: gid ? Number(gid[1]) : null };
}

/** El enlace para abrir la planilla en esa pestaña. */
export function spreadsheetUrl(spreadsheetId: string, gid?: number | null): string {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit${gid !== null && gid !== undefined ? `#gid=${gid}` : ''}`;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function sheetColumnLetter(index: number): string {
    let n = Math.max(0, Math.floor(index)) + 1;
    let out = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        out = String.fromCharCode(65 + r) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

/** A → 0, Z → 25, AA → 26. `-1` si no es una letra de columna. */
export function sheetColumnIndex(letters: string): number {
    const s = letters.trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(s)) return -1;
    let n = 0;
    for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** «Ventas 2026» → `'Ventas 2026'` (con las comillas simples escapadas). */
export function quoteSheetTitle(title: string): string {
    return `'${title.replace(/'/g, "''")}'`;
}

/** «Número_Factura», «numero factura» y «NumeroFactura» son el mismo encabezado. */
export function normalizeSheetHeader(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * La posición de un encabezado en la fila de encabezados: exacto primero,
 * después sin mayúsculas, acentos ni espacios. `-1` si no está.
 */
export function findSheetColumn(headers: readonly string[], name: string): number {
    const exact = headers.findIndex((h) => h.trim() === name.trim());
    if (exact >= 0) return exact;
    const n = normalizeSheetHeader(name);
    if (n === '') return -1;
    return headers.findIndex((h) => normalizeSheetHeader(h) === n);
}

/** «Cada hora», «Cada 5 minutos», «Una vez por día». */
export function describeSheetInterval(minutes: number): string {
    if (minutes === 60) return 'cada hora';
    if (minutes === 1440) return 'una vez por día';
    if (minutes % 60 === 0) return `cada ${minutes / 60} horas`;
    return `cada ${minutes} minutos`;
}

export const SHEET_DIRECTION_LABELS: Record<SheetSyncDirection, string> = {
    sheet_to_app: 'De la hoja a la app',
    app_to_sheet: 'De la app a la hoja',
    both: 'En los dos sentidos',
};

/** Próxima revisión programada. */
export function nextSheetSyncRun(intervalMinutes: number, from: Date): Date {
    const m = (SHEET_SYNC_INTERVALS as readonly number[]).includes(intervalMinutes) ? intervalMinutes : 60;
    return new Date(from.getTime() + m * 60_000);
}
