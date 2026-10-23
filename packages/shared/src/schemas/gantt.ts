import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import type { FieldType } from './field';
import { filterTreeSchema } from './filter';

/**
 * Vista Gantt / línea de tiempo (B1). Lógica PURA que comparten la vista
 * (front), el bundle y el PDF del servidor y el asistente: leer la config de
 * la vista sin romperse, la escala del tiempo (días ↔ píxeles, marcas del
 * encabezado) y dónde cae la barra de un registro.
 */

export const GANTT_ZOOMS = ['day', 'week', 'month', 'quarter'] as const;
export const ganttZoomSchema = z.enum(GANTT_ZOOMS);
export type GanttZoom = z.infer<typeof ganttZoomSchema>;

/** Píxeles por día en cada zoom (la pantalla y el PDF usan la misma escala). */
export const GANTT_PX_PER_DAY: Record<GanttZoom, number> = {
    day: 36,
    week: 14,
    month: 4.5,
    quarter: 1.6,
};

export const GANTT_COLOR_BY = ['field', 'rules', 'none'] as const;
export type GanttColorBy = (typeof GANTT_COLOR_BY)[number];

/** Tipos de los campos de inicio y fin. */
export const GANTT_DATE_TYPES: readonly FieldType[] = ['date', 'datetime'];
/** Tipos por los que se agrupa (encabezados plegables). */
export const GANTT_GROUP_TYPES: readonly FieldType[] = ['select', 'user', 'checkbox'];
/** Tipos que dan color a la barra (el color de la opción). */
export const GANTT_COLOR_TYPES: readonly FieldType[] = ['select'];

/** Filas que trae el bundle como máximo (las demás se informan). */
export const GANTT_MAX_ROWS = 2000;
/** «Sin programar» que viajan (el resto se cuenta). */
export const GANTT_MAX_UNSCHEDULED = 200;
/** Rango máximo que se puede pedir de una vez (días). */
export const GANTT_MAX_RANGE_DAYS = 3700;
/** Registros que congela una línea base como máximo. */
export const GANTT_MAX_BASELINE_ITEMS = 10_000;
/** Ancho de la columna del título en el panel izquierdo (por defecto) y de cada columna. */
export const GANTT_TITLE_WIDTH_DEFAULT = 260;
export const GANTT_COLUMN_WIDTH_DEFAULT = 120;
/** Columnas del panel izquierdo además del título (el PDF imprime las 3 primeras). */
export const GANTT_MAX_COLUMNS = 6;

export const ganttColumnSchema = z.object({
    field_id: idSchema,
    width: z.number().int().min(60).max(600).optional(),
});
export type GanttColumn = z.infer<typeof ganttColumnSchema>;

/**
 * Claves `gantt_*` de la config de la vista (las comunes —filtros, búsqueda,
 * orden, colores condicionales, grupos plegados— viven en `viewStateCommon`).
 * Las referencias a campos siguen la convención `*field_id(s)`: así las
 * plantillas y migrar una empresa las re-mapean sin código propio.
 */
export const ganttViewConfigShape = {
    gantt_start_field_id: idSchema,
    gantt_end_field_id: idSchema.nullable().optional(),
    gantt_group_by_field_id: idSchema.nullable().optional(),
    gantt_color_field_id: idSchema.nullable().optional(),
    gantt_color_by: z.enum(GANTT_COLOR_BY).optional(),
    gantt_columns: z.array(ganttColumnSchema).max(12).optional(),
    /** Ancho de la columna del título (el panel mide título + columnas). */
    gantt_title_width: z.number().int().min(80).max(600).optional(),
    gantt_zoom: ganttZoomSchema.optional(),
    gantt_show_subtasks: z.boolean().optional(),
    gantt_show_dependencies: z.boolean().optional(),
    gantt_show_baseline: z.boolean().optional(),
};

/** La config del Gantt ya normalizada (lo que lee la vista). */
export interface GanttSettings {
    startFieldId: number | null;
    endFieldId: number | null;
    groupByFieldId: number | null;
    colorFieldId: number | null;
    colorBy: GanttColorBy;
    columns: GanttColumn[];
    titleWidth: number | null;
    zoom: GanttZoom;
    showSubtasks: boolean;
    showDependencies: boolean;
    showBaseline: boolean;
}

export const DEFAULT_GANTT_SETTINGS: GanttSettings = {
    startFieldId: null,
    endFieldId: null,
    groupByFieldId: null,
    colorFieldId: null,
    colorBy: 'field',
    columns: [],
    titleWidth: null,
    zoom: 'week',
    showSubtasks: true,
    showDependencies: true,
    showBaseline: true,
};

const posInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

/** Lee la config de una vista Gantt SIN romperse (lo que no tiene forma, al default). */
export function readGanttSettings(config: unknown): GanttSettings {
    const c = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const start = posInt(c.gantt_start_field_id);
    const end = posInt(c.gantt_end_field_id);
    const columns: GanttColumn[] = [];
    if (Array.isArray(c.gantt_columns)) {
        for (const col of c.gantt_columns) {
            if (!col || typeof col !== 'object') continue;
            const id = posInt((col as { field_id?: unknown }).field_id);
            if (id === null || columns.some((x) => x.field_id === id)) continue;
            const w = (col as { width?: unknown }).width;
            columns.push(typeof w === 'number' && Number.isInteger(w) && w >= 60 && w <= 600 ? { field_id: id, width: w } : { field_id: id });
            if (columns.length >= 12) break;
        }
    }
    const title = c.gantt_title_width;
    return {
        startFieldId: start,
        // El fin por el MISMO campo del inicio no existe: todo sería hito.
        endFieldId: end !== null && end !== start ? end : null,
        groupByFieldId: posInt(c.gantt_group_by_field_id),
        colorFieldId: posInt(c.gantt_color_field_id),
        colorBy: (GANTT_COLOR_BY as readonly unknown[]).includes(c.gantt_color_by) ? (c.gantt_color_by as GanttColorBy) : 'field',
        columns,
        titleWidth: typeof title === 'number' && Number.isInteger(title) && title >= 80 && title <= 600 ? title : null,
        zoom: (GANTT_ZOOMS as readonly unknown[]).includes(c.gantt_zoom) ? (c.gantt_zoom as GanttZoom) : 'week',
        showSubtasks: c.gantt_show_subtasks !== false,
        showDependencies: c.gantt_show_dependencies !== false,
        showBaseline: c.gantt_show_baseline !== false,
    };
}

/** Todas las claves `gantt_*` (para limpiar antes de mezclar). */
export const GANTT_CONFIG_KEYS = Object.keys(ganttViewConfigShape) as Array<keyof typeof ganttViewConfigShape>;

/**
 * Inverso de `readGanttSettings`: sólo lo que no es el default (una vista no
 * gana claves vacías). El inicio se escribe siempre (es obligatorio).
 */
export function ganttSettingsToConfig(s: GanttSettings): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (s.startFieldId !== null) out.gantt_start_field_id = s.startFieldId;
    if (s.endFieldId !== null && s.endFieldId !== s.startFieldId) out.gantt_end_field_id = s.endFieldId;
    if (s.groupByFieldId !== null) out.gantt_group_by_field_id = s.groupByFieldId;
    if (s.colorFieldId !== null) out.gantt_color_field_id = s.colorFieldId;
    if (s.colorBy !== 'field') out.gantt_color_by = s.colorBy;
    if (s.columns.length > 0) out.gantt_columns = s.columns.map((c) => (c.width ? { field_id: c.field_id, width: c.width } : { field_id: c.field_id }));
    if (s.titleWidth !== null) out.gantt_title_width = s.titleWidth;
    if (s.zoom !== 'week') out.gantt_zoom = s.zoom;
    if (!s.showSubtasks) out.gantt_show_subtasks = false;
    if (!s.showDependencies) out.gantt_show_dependencies = false;
    if (!s.showBaseline) out.gantt_show_baseline = false;
    return out;
}

/** La config de la vista con los ajustes del Gantt reemplazados. */
export function withGanttSettings(config: Record<string, unknown>, s: GanttSettings): Record<string, unknown> {
    const out: Record<string, unknown> = { ...config };
    for (const k of GANTT_CONFIG_KEYS) delete out[k];
    return { ...out, ...ganttSettingsToConfig(s) };
}

// ─────────────────────────── Línea base ───────────────────────────

/**
 * Línea base: las fechas de inicio y fin de cada registro CONGELADAS en un
 * momento, para comparar después (barra fantasma debajo). Una por vista.
 */
export const ganttBaselineSchema = z.object({
    id: idSchema,
    view_id: idSchema,
    name: z.string(),
    start_field_id: idSchema,
    end_field_id: idSchema.nullable(),
    item_count: z.number().int().nonnegative(),
    created_by: idSchema.nullable(),
    created_by_name: z.string().nullable(),
    created_at: isoDateTimeSchema,
});
export type GanttBaseline = z.infer<typeof ganttBaselineSchema>;

export const saveGanttBaselineSchema = z.object({
    name: z.string().trim().max(120).optional(),
});
export type SaveGanttBaselineInput = z.infer<typeof saveGanttBaselineSchema>;

/** Las fechas congeladas de un registro (crudas, como estaban guardadas). */
export interface GanttBaselineItem {
    start: string | null;
    end: string | null;
}

// ─────────────────────────── Bundle ───────────────────────────

/** Fila del bundle: el registro con `fields` por slug (como el kanban). */
export interface GanttBundleRow {
    id: number;
    fields: Record<string, unknown>;
    relations: Record<string, unknown>;
    parent_id: number | null;
    subtask_count: number;
    has_description: boolean;
    blocked_by_open: number;
    created_by: number;
    created_at: string;
    updated_at: string;
}

export interface GanttBundle {
    meta: {
        start_field_id: number;
        end_field_id: number | null;
        from: string;
        to: string;
        /** Registros del rango (sin contar los padres agregados para anidar). */
        total: number;
        truncated: boolean;
        unscheduled_total: number;
    };
    records: GanttBundleRow[];
    unscheduled: GanttBundleRow[];
    dependencies: Array<{ id: number; blocker_id: number; blocked_id: number; lag_days: number }>;
    baseline: (GanttBaseline & { items: Record<string, GanttBaselineItem> }) | null;
    reschedule: { enabled: boolean; start_field_id: number | null; end_field_id: number | null };
}

/** PDF: lo que pide la pantalla (la misma vista, el rango que se ve). */
export const ganttPdfRequestSchema = z.object({
    view_id: idSchema.optional(),
    title: z.string().trim().max(200).optional(),
    start_field_id: idSchema,
    end_field_id: idSchema.nullable().optional(),
    group_by_field_id: idSchema.nullable().optional(),
    color_field_id: idSchema.nullable().optional(),
    column_field_ids: z.array(idSchema).max(6).optional(),
    /** Color de las barras: por el select (`color_field_id`), por las reglas de la vista o sin color. */
    color_by: z.enum(GANTT_COLOR_BY).optional(),
    zoom: ganttZoomSchema,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    filter_tree: filterTreeSchema.optional(),
    search: z.string().max(200).optional(),
    /** El orden de la vista (`field_{id}:{dir},…`): el PDF sale en el mismo orden que la pantalla. */
    sort: z.string().max(500).optional(),
    show_subtasks: z.boolean().optional(),
    show_dependencies: z.boolean().optional(),
    show_baseline: z.boolean().optional(),
    collapsed_groups: z.array(z.string().max(500)).max(500).optional(),
});
export type GanttPdfRequest = z.infer<typeof ganttPdfRequestSchema>;

// ─────────────────────────── Escala del tiempo ───────────────────────────

const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` → número de día (días desde 1970-01-01, UTC). null si no se lee. */
export function ymdToDay(ymd: string): number | null {
    const m = YMD.exec(ymd);
    if (!m) return null;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

/** Número de día → `YYYY-MM-DD`. */
export function dayToYmd(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * El DÍA de un valor de fecha: una fecha `YYYY-MM-DD` es ese día; un instante
 * (fecha y hora) cae en el día de la zona indicada (la de la empresa en el
 * servidor; sin zona, la del navegador).
 */
export function dayOfDateValue(type: string, value: unknown, timeZone?: string): number | null {
    if (typeof value !== 'string' || value === '') return null;
    if (type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(value)) return ymdToDay(value);
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    if (timeZone) {
        try {
            // en-CA da `YYYY-MM-DD`.
            const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
            return ymdToDay(ymd);
        } catch {
            // zona inválida: cae a la local
        }
    }
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/**
 * Corre un valor de fecha `days` días enteros conservando su formato: una
 * fecha sigue siendo `YYYY-MM-DD` y un instante conserva su hora LOCAL (se
 * suma en el calendario, así un cambio de horario no la corre una hora).
 */
export function addDaysToDateValue(type: string, value: string, days: number): string {
    if (type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = ymdToDay(value);
        return d === null ? value : dayToYmd(d + days);
    }
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return value;
    const d = new Date(t);
    d.setDate(d.getDate() + days);
    return d.toISOString();
}

/** El valor de fecha que corresponde a un día al PROGRAMAR (sin valor previo). */
export function dateValueForDay(type: string, day: number): string {
    const ymd = dayToYmd(day);
    if (type === 'date') return ymd;
    // Fecha y hora sin hora previa: a las 9:00 locales.
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, 9, 0, 0).toISOString();
}

export interface GanttBar {
    /** Día de inicio y de fin (inclusive). En un hito, iguales. */
    start: number;
    end: number;
    milestone: boolean;
}

/**
 * Dónde cae la barra de un registro. Con inicio y fin: la barra (si el fin
 * quedó antes del inicio se dibuja al revés, no se pierde). Con UNA sola
 * fecha (o sin campo de fin): un hito. Sin fechas: null («Sin programar»).
 */
export function ganttBarOf(
    data: Record<string, unknown>,
    start: { key: string; type: string },
    end: { key: string; type: string } | null,
    timeZone?: string,
): GanttBar | null {
    const s = dayOfDateValue(start.type, data[start.key], timeZone);
    const e = end ? dayOfDateValue(end.type, data[end.key], timeZone) : null;
    if (s === null && e === null) return null;
    if (s === null || e === null || !end) {
        const d = (s ?? e)!;
        return { start: d, end: d, milestone: true };
    }
    return { start: Math.min(s, e), end: Math.max(s, e), milestone: false };
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS_SHORT = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];

export interface GanttTick {
    /** Primer día del tramo y cuántos días dura (dentro del rango pedido). */
    day: number;
    days: number;
    label: string;
    /** Fin de semana (zoom día). */
    weekend?: boolean;
}

function partsOf(day: number): { y: number; m: number; d: number; wd: number } {
    const dt = new Date(day * DAY_MS);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

function monthStart(y: number, m: number): number {
    return Math.floor(Date.UTC(y, m, 1) / DAY_MS);
}

/** Lunes de la semana del día (las semanas arrancan el lunes). */
export function mondayOf(day: number): number {
    const wd = partsOf(day).wd;
    return day - ((wd + 6) % 7);
}

function clip(t: GanttTick, from: number, to: number): GanttTick | null {
    const a = Math.max(t.day, from);
    const b = Math.min(t.day + t.days - 1, to);
    return b < a ? null : { ...t, day: a, days: b - a + 1 };
}

/**
 * Marcas del encabezado para un zoom entre dos días (inclusive): una fila de
 * arriba (meses o años) y una de abajo (días, semanas, meses o trimestres),
 * con etiquetas en español.
 */
export function ganttTicks(zoom: GanttZoom, from: number, to: number): { top: GanttTick[]; bottom: GanttTick[] } {
    const top: GanttTick[] = [];
    const bottom: GanttTick[] = [];
    if (to < from) return { top, bottom };
    const startP = partsOf(from);
    if (zoom === 'day' || zoom === 'week') {
        // Arriba: meses.
        let y = startP.y;
        let m = startP.m;
        for (;;) {
            const a = monthStart(y, m);
            if (a > to) break;
            const b = monthStart(m === 11 ? y + 1 : y, (m + 1) % 12) - 1;
            const t = clip({ day: a, days: b - a + 1, label: `${MONTHS_LONG[m]} ${y}` }, from, to);
            if (t) top.push(t);
            m += 1;
            if (m === 12) {
                m = 0;
                y += 1;
            }
        }
        if (zoom === 'day') {
            for (let d = from; d <= to; d++) {
                const p = partsOf(d);
                bottom.push({ day: d, days: 1, label: `${WEEKDAYS_SHORT[p.wd]} ${p.d}`, weekend: p.wd === 0 || p.wd === 6 });
            }
        } else {
            for (let w = mondayOf(from); w <= to; w += 7) {
                const p = partsOf(w);
                const t = clip({ day: w, days: 7, label: `${p.d} ${MONTHS_SHORT[p.m]}` }, from, to);
                if (t) bottom.push(t);
            }
        }
        return { top, bottom };
    }
    // Arriba: años.
    for (let y = startP.y; ; y++) {
        const a = monthStart(y, 0);
        if (a > to) break;
        const b = monthStart(y + 1, 0) - 1;
        const t = clip({ day: a, days: b - a + 1, label: String(y) }, from, to);
        if (t) top.push(t);
    }
    if (zoom === 'month') {
        let y = startP.y;
        let m = startP.m;
        for (;;) {
            const a = monthStart(y, m);
            if (a > to) break;
            const b = monthStart(m === 11 ? y + 1 : y, (m + 1) % 12) - 1;
            const t = clip({ day: a, days: b - a + 1, label: MONTHS_SHORT[m]! }, from, to);
            if (t) bottom.push(t);
            m += 1;
            if (m === 12) {
                m = 0;
                y += 1;
            }
        }
    } else {
        let y = startP.y;
        let q = Math.floor(startP.m / 3);
        for (;;) {
            const a = monthStart(y, q * 3);
            if (a > to) break;
            const nq = q === 3 ? 0 : q + 1;
            const ny = q === 3 ? y + 1 : y;
            const b = monthStart(ny, nq * 3) - 1;
            const t = clip({ day: a, days: b - a + 1, label: `T${q + 1}` }, from, to);
            if (t) bottom.push(t);
            q = nq;
            y = ny;
        }
    }
    return { top, bottom };
}

/** Fecha corta para la interfaz y el PDF (`12 jul 2026`). */
export function ganttDayLabel(day: number): string {
    const p = partsOf(day);
    return `${p.d} ${MONTHS_SHORT[p.m]} ${p.y}`;
}

/** Duración legible de una barra (`1 día`, `12 días`). */
export function ganttDurationLabel(bar: GanttBar): string {
    const days = bar.end - bar.start + 1;
    return days === 1 ? '1 día' : `${days} días`;
}

// ─────────────────────────── Filas ───────────────────────────

/** Clave del grupo «Sin valor» (la misma del kanban y la vista agrupada). */
export const GANTT_NULL_GROUP = '__null__';

export type GanttRowItem =
    | { kind: 'group'; key: string; count: number; collapsed: boolean }
    | { kind: 'record'; id: number; depth: 0 | 1; hasChildren: boolean; collapsed: boolean; group: string | null };

/**
 * Las filas del Gantt en orden, ya aplanadas: encabezados de grupo (si se
 * agrupa) y, dentro, cada registro seguido de sus subtareas (anidadas, una
 * profundidad). Respeta el orden de entrada (el del servidor), deja los
 * grupos en `groupOrder` («Sin valor» al final) y oculta lo plegado. La usan
 * la vista y el PDF: lo que se imprime es lo que se ve.
 */
export function buildGanttRows<R>(
    records: readonly R[],
    acc: { id: (r: R) => number; parent: (r: R) => number | null; group?: (r: R) => string | null },
    opts: {
        grouped: boolean;
        groupOrder?: readonly string[];
        collapsedGroups?: ReadonlySet<string>;
        collapsedParents?: ReadonlySet<number>;
        showSubtasks?: boolean;
    },
): GanttRowItem[] {
    const showSubtasks = opts.showSubtasks !== false;
    const ids = new Set(records.map(acc.id));
    const children = new Map<number, R[]>();
    const roots: R[] = [];
    for (const r of records) {
        const p = acc.parent(r);
        if (p !== null && ids.has(p)) {
            if (!showSubtasks) continue;
            const list = children.get(p) ?? [];
            list.push(r);
            children.set(p, list);
        } else {
            roots.push(r);
        }
    }
    const emit = (out: GanttRowItem[], r: R, group: string | null): void => {
        const id = acc.id(r);
        const kids = children.get(id) ?? [];
        const collapsed = opts.collapsedParents?.has(id) ?? false;
        out.push({ kind: 'record', id, depth: 0, hasChildren: kids.length > 0, collapsed, group });
        if (collapsed) return;
        for (const k of kids) out.push({ kind: 'record', id: acc.id(k), depth: 1, hasChildren: false, collapsed: false, group });
    };
    const out: GanttRowItem[] = [];
    if (!opts.grouped || !acc.group) {
        for (const r of roots) emit(out, r, null);
        return out;
    }
    const byGroup = new Map<string, R[]>();
    for (const r of roots) {
        const key = acc.group(r) ?? GANTT_NULL_GROUP;
        const list = byGroup.get(key) ?? [];
        list.push(r);
        byGroup.set(key, list);
    }
    const order = [...(opts.groupOrder ?? []).filter((k) => k !== GANTT_NULL_GROUP && byGroup.has(k))];
    for (const k of byGroup.keys()) if (k !== GANTT_NULL_GROUP && !order.includes(k)) order.push(k);
    if (byGroup.has(GANTT_NULL_GROUP)) order.push(GANTT_NULL_GROUP);
    for (const key of order) {
        const list = byGroup.get(key)!;
        const count = list.reduce((n, r) => n + 1 + (children.get(acc.id(r))?.length ?? 0), 0);
        const collapsed = opts.collapsedGroups?.has(key) ?? false;
        out.push({ kind: 'group', key, count, collapsed });
        if (collapsed) continue;
        for (const r of list) emit(out, r, key === GANTT_NULL_GROUP ? null : key);
    }
    return out;
}

/**
 * La clave de grupo de un valor (select, persona, casilla), con las reglas
 * del motor de agregados. null = «Sin valor».
 */
export function ganttGroupKey(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

// ─────────────────────────── Orden de los grupos ───────────────────────────

interface GroupFieldLike {
    type: string;
    config?: unknown;
}

/**
 * El orden de los grupos del Gantt (pantalla y PDF): un select sigue el orden
 * de sus OPCIONES (el que eligió quien armó la lista); una casilla, «Sí» y
 * después «No»; el resto (personas), por su etiqueta. «Sin valor» al final.
 */
export function ganttGroupOrder(field: GroupFieldLike | null, keys: readonly string[], label: (key: string) => string): string[] {
    const present = [...new Set(keys)].filter((k) => k !== GANTT_NULL_GROUP);
    let ordered: string[];
    if (field?.type === 'select') {
        const opts = ((field.config as { options?: Array<{ value?: unknown }> } | undefined)?.options ?? []).map((o) => String(o.value));
        const known = opts.filter((v) => present.includes(v));
        const rest = present.filter((k) => !opts.includes(k)).sort((a, b) => label(a).localeCompare(label(b), 'es'));
        ordered = [...known, ...rest];
    } else if (field?.type === 'checkbox') {
        ordered = ['true', 'false'].filter((k) => present.includes(k));
    } else {
        ordered = [...present].sort((a, b) => label(a).localeCompare(label(b), 'es'));
    }
    if (keys.includes(GANTT_NULL_GROUP)) ordered.push(GANTT_NULL_GROUP);
    return ordered;
}

// ─────────────────────────── Colores ───────────────────────────

/**
 * Los colores de las reglas condicionales (`VIEW_ROW_COLORS`) como hex, para
 * pintar barras: la pantalla y el PDF usan la misma tabla.
 */
export const GANTT_RULE_COLOR_HEX: Readonly<Record<string, string>> = {
    red: '#ef4444',
    orange: '#f97316',
    amber: '#f59e0b',
    yellow: '#eab308',
    green: '#22c55e',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    blue: '#3b82f6',
    violet: '#8b5cf6',
    pink: '#ec4899',
    gray: '#6b7280',
};

/** El color de una barra sin color propio. */
export const GANTT_DEFAULT_BAR_COLOR = '#3b82f6';

// ─────────────────────────── Ventana de tiempo ───────────────────────────

/**
 * Cuántos días se piden a cada lado del centro según el zoom: lo que entra en
 * unas cuantas pantallas. Al acercarse a un borde la vista pide el tramo
 * siguiente (la ventana CRECE: las filas ya cargadas no se mueven).
 */
export const GANTT_FETCH_HALF_SPAN: Record<GanttZoom, number> = {
    day: 45,
    week: 120,
    month: 400,
    quarter: 1100,
};

/** La ventana inicial alrededor de un día (inclusive). */
export function ganttWindowAround(zoom: GanttZoom, center: number): { from: number; to: number } {
    const half = GANTT_FETCH_HALF_SPAN[zoom];
    return { from: center - half, to: center + half };
}

/**
 * ¿Hay que agrandar la ventana? Si lo visible (más medio tramo de margen) se
 * sale de lo cargado, devuelve la ventana nueva: la UNIÓN de lo cargado con lo
 * que hace falta (nunca se achica mientras quepa), acotada a
 * `GANTT_MAX_RANGE_DAYS` alrededor de lo visible. null = alcanza lo cargado.
 */
export function ganttGrowWindow(
    loaded: { from: number; to: number },
    visible: { from: number; to: number },
    zoom: GanttZoom,
): { from: number; to: number } | null {
    const margin = Math.ceil(GANTT_FETCH_HALF_SPAN[zoom] / 2);
    const needFrom = visible.from - margin;
    const needTo = visible.to + margin;
    if (needFrom >= loaded.from && needTo <= loaded.to) return null;
    let from = needFrom < loaded.from ? Math.min(loaded.from, needFrom - GANTT_FETCH_HALF_SPAN[zoom]) : loaded.from;
    let to = needTo > loaded.to ? Math.max(loaded.to, needTo + GANTT_FETCH_HALF_SPAN[zoom]) : loaded.to;
    if (to - from + 1 > GANTT_MAX_RANGE_DAYS) {
        // Demasiado ancho: se queda con lo que rodea a lo visible.
        const center = Math.round((visible.from + visible.to) / 2);
        const half = Math.floor(GANTT_MAX_RANGE_DAYS / 2) - 1;
        from = Math.max(from, center - half);
        to = Math.min(to, center + half);
    }
    return { from, to };
}

// ─────────────────────────── Mover y estirar ───────────────────────────

export type GanttDragMode = 'move' | 'start' | 'end';

/**
 * La barra después de arrastrar `delta` días: moverla corre las dos puntas;
 * estirar un borde cambia sólo ése (sin cruzar el otro: mínimo un día).
 */
export function ganttDraggedBar(bar: GanttBar, mode: GanttDragMode, delta: number): GanttBar {
    if (delta === 0) return bar;
    if (bar.milestone || mode === 'move') return { ...bar, start: bar.start + delta, end: bar.end + delta };
    if (mode === 'start') return { ...bar, start: Math.min(bar.start + delta, bar.end) };
    return { ...bar, end: Math.max(bar.end + delta, bar.start) };
}

export interface GanttDateFieldRef {
    slug: string;
    type: string;
}

/**
 * Los valores nuevos (por slug) de una barra movida, conservando el formato
 * de cada campo (fecha, o fecha y hora con su hora). Un hito sin fin mueve
 * sólo la fecha que tiene. Devuelve sólo lo que cambia.
 */
export function ganttMovePatch(
    values: Record<string, unknown>,
    start: GanttDateFieldRef,
    end: GanttDateFieldRef | null,
    before: GanttBar,
    after: GanttBar,
): Record<string, string> {
    const patch: Record<string, string> = {};
    const shift = (f: GanttDateFieldRef, days: number): void => {
        const v = values[f.slug];
        if (days === 0 || typeof v !== 'string' || v === '') return;
        const next = addDaysToDateValue(f.type, v, days);
        if (next !== v) patch[f.slug] = next;
    };
    const has = (f: GanttDateFieldRef | null): boolean => f !== null && typeof values[f.slug] === 'string' && values[f.slug] !== '';
    if (before.milestone) {
        const days = after.start - before.start;
        if (has(start)) shift(start, days);
        if (end && has(end)) shift(end, days);
        return patch;
    }
    // Una barra al revés (fin antes que el inicio) se dibuja ordenada: el
    // borde de la izquierda es el que tenga la fecha menor.
    const sVal = has(start) ? dayOfDateValue(start.type, values[start.slug]) : null;
    const eVal = end && has(end) ? dayOfDateValue(end.type, values[end.slug]) : null;
    const reversed = sVal !== null && eVal !== null && eVal < sVal;
    const leftDelta = after.start - before.start;
    const rightDelta = after.end - before.end;
    shift(start, reversed ? rightDelta : leftDelta);
    if (end) shift(end, reversed ? leftDelta : rightDelta);
    return patch;
}

/**
 * Programar un registro SIN fechas soltándolo en un día: el inicio cae ahí y,
 * si la vista tiene fin, la barra nace de `days` días.
 */
export function ganttSchedulePatch(start: GanttDateFieldRef, end: GanttDateFieldRef | null, day: number, days = 1): Record<string, string> {
    const patch: Record<string, string> = { [start.slug]: dateValueForDay(start.type, day) };
    if (end) patch[end.slug] = dateValueForDay(end.type, day + Math.max(1, days) - 1);
    return patch;
}
