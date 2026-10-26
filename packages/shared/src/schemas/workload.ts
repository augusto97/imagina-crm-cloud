import { z } from 'zod';
import { idSchema } from './common';
import type { FieldType } from './field';
import { dayToYmd, ymdToDay } from './gantt';

/**
 * B2 — Vista «Carga de trabajo». Lógica PURA que comparten el bundle del
 * servidor, la vista (front) y el asistente:
 *  - la config de la vista (`workload_*`), con lectura tolerante;
 *  - la capacidad de una persona (horas por día, días laborables, registros
 *    por semana), que vive en `memberships.settings.capacity`;
 *  - el tiempo: columnas (día, semana o mes), días hábiles y el reparto del
 *    esfuerzo estimado en los días hábiles del tramo (como ClickUp);
 *  - el resumen por persona y del equipo, y la reasignación optimista.
 *
 * El servidor calcula la grilla con ESTAS funciones (una sola regla en los dos
 * lados): el front sólo las usa para mover la carga de un registro de una
 * persona a otra mientras llega la respuesta.
 */

// ─────────────────────────── Constantes ───────────────────────────

/** Qué se mide: cantidad de registros, esfuerzo estimado o tiempo registrado. */
export const WORKLOAD_METRICS = ['count', 'estimate', 'time'] as const;
export const workloadMetricSchema = z.enum(WORKLOAD_METRICS);
export type WorkloadMetric = z.infer<typeof workloadMetricSchema>;

/** Columnas: días, semanas (de lunes a domingo) o meses. */
export const WORKLOAD_ZOOMS = ['day', 'week', 'month'] as const;
export const workloadZoomSchema = z.enum(WORKLOAD_ZOOMS);
export type WorkloadZoom = z.infer<typeof workloadZoomSchema>;

/** Unidad de un campo numérico de estimación (un campo Duración ya está en minutos). */
export const WORKLOAD_ESTIMATE_UNITS = ['hours', 'minutes'] as const;
export const workloadEstimateUnitSchema = z.enum(WORKLOAD_ESTIMATE_UNITS);
export type WorkloadEstimateUnit = z.infer<typeof workloadEstimateUnitSchema>;

/** El campo de asignación: una persona. */
export const WORKLOAD_PERSON_TYPES: readonly FieldType[] = ['user'];
/** Las fechas del registro (inicio y fin, o una sola). */
export const WORKLOAD_DATE_TYPES: readonly FieldType[] = ['date', 'datetime'];
/**
 * El esfuerzo estimado: un número (horas o minutos), una Duración (minutos) o
 * un derivado numérico (rollup, calculado, fórmula) — los derivados sólo si el
 * servidor los sabe expresar en SQL.
 */
export const WORKLOAD_ESTIMATE_TYPES: readonly FieldType[] = ['number', 'duration', 'rollup', 'computed', 'formula'];

/** Clave de la fila «Sin asignar» (registros sin persona). */
export const WORKLOAD_UNASSIGNED = '__none__';

/** Rango máximo que se pide de una vez (la ventana más ancha, 6 meses, entra holgada). */
export const WORKLOAD_MAX_RANGE_DAYS = 400;
/** Filas que el servidor lee como mucho para calcular la grilla (el resto se informa). */
export const WORKLOAD_MAX_ROWS = 20_000;
/** Registros que viajan para el panel y el arrastre (la grilla se calcula con todos). */
export const WORKLOAD_MAX_ITEMS = 3000;
/** Personas visibles elegibles como mucho. */
export const WORKLOAD_MAX_PEOPLE = 500;
/** Desde qué porcentaje de la capacidad la celda se pinta ámbar («cerca del límite»). */
export const WORKLOAD_NEAR_RATIO = 0.85;

// ─────────────────────────── Capacidad ───────────────────────────

/**
 * Capacidad de una persona en el workspace. Las horas por día y los días
 * laborables valen para el esfuerzo y el tiempo registrado; los registros por
 * semana, para la cantidad. Días: 0 = domingo … 6 = sábado.
 */
export const workloadCapacitySchema = z.object({
    hours_per_day: z.number().min(0).max(24),
    work_days: z.array(z.number().int().min(0).max(6)).max(7),
    records_per_week: z.number().int().min(0).max(1000),
});
export type WorkloadCapacity = z.infer<typeof workloadCapacitySchema>;

/** `null` = volver al valor por defecto. */
export const setWorkloadCapacitySchema = z.object({ capacity: workloadCapacitySchema.nullable() });
export type SetWorkloadCapacityInput = z.infer<typeof setWorkloadCapacitySchema>;

/** 8 h por día, de lunes a viernes, 10 registros por semana. */
export const WORKLOAD_DEFAULT_CAPACITY: WorkloadCapacity = Object.freeze({
    hours_per_day: 8,
    work_days: [1, 2, 3, 4, 5],
    records_per_week: 10,
}) as WorkloadCapacity;

/**
 * Lee la capacidad guardada SIN romperse: lo que no tiene forma toma el valor
 * por defecto (`custom: false` si no había nada propio). Los días se ordenan y
 * se quitan los repetidos.
 */
export function readWorkloadCapacity(raw: unknown): { capacity: WorkloadCapacity; custom: boolean } {
    const parsed = workloadCapacitySchema.safeParse(raw);
    if (!parsed.success) return { capacity: { ...WORKLOAD_DEFAULT_CAPACITY, work_days: [...WORKLOAD_DEFAULT_CAPACITY.work_days] }, custom: false };
    return { capacity: normalizeCapacity(parsed.data), custom: true };
}

export function normalizeCapacity(c: WorkloadCapacity): WorkloadCapacity {
    return {
        hours_per_day: Math.round(c.hours_per_day * 100) / 100,
        work_days: [...new Set(c.work_days)].sort((a, b) => a - b),
        records_per_week: c.records_per_week,
    };
}

// ─────────────────────────── Config de la vista ───────────────────────────

/**
 * Claves `workload_*` de la config de la vista. Las referencias a campos
 * terminan en `_field_id` (las re-mapean solas las plantillas y migrar una
 * empresa); `workload_user_ids` son PERSONAS y `workload_team_id` un EQUIPO,
 * que migrar una empresa traduce aparte (ver `remapViewConfig`).
 */
export const workloadViewConfigShape = {
    workload_person_field_id: idSchema,
    workload_start_field_id: idSchema.nullable().optional(),
    workload_end_field_id: idSchema.nullable().optional(),
    workload_metric: workloadMetricSchema.optional(),
    workload_estimate_field_id: idSchema.nullable().optional(),
    workload_estimate_unit: workloadEstimateUnitSchema.optional(),
    workload_zoom: workloadZoomSchema.optional(),
    /** Personas visibles (por id). Sin valor = todas las que pueden ver la lista. */
    workload_user_ids: z.array(idSchema).max(WORKLOAD_MAX_PEOPLE).nullable().optional(),
    /**
     * C1 — Sólo las personas de un EQUIPO (resuelto en el servidor, en vivo:
     * quien entra o sale del equipo aparece o desaparece solo). Se combina con
     * `workload_user_ids` (la intersección).
     */
    workload_team_id: idSchema.nullable().optional(),
    workload_show_unassigned: z.boolean().optional(),
    /** Ocultar terminados (el criterio de «Mi trabajo»). Sin valor: sí, salvo en «Tiempo registrado». */
    workload_hide_done: z.boolean().optional(),
};

/** La config de la carga ya normalizada (lo que lee la vista y el servidor). */
export interface WorkloadSettings {
    personFieldId: number | null;
    startFieldId: number | null;
    endFieldId: number | null;
    metric: WorkloadMetric;
    estimateFieldId: number | null;
    estimateUnit: WorkloadEstimateUnit;
    zoom: WorkloadZoom;
    /** `null` = todas las personas. */
    userIds: number[] | null;
    /** C1 — `null` = sin filtro por equipo. */
    teamId: number | null;
    showUnassigned: boolean;
    hideDone: boolean;
}

export const DEFAULT_WORKLOAD_SETTINGS: WorkloadSettings = {
    personFieldId: null,
    startFieldId: null,
    endFieldId: null,
    metric: 'count',
    estimateFieldId: null,
    estimateUnit: 'hours',
    zoom: 'week',
    userIds: null,
    teamId: null,
    showUnassigned: true,
    hideDone: true,
};

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/** Ocultar terminados por defecto: sí, salvo en «Tiempo registrado» (el tiempo ya trabajado cuenta). */
export function defaultHideDone(metric: WorkloadMetric): boolean {
    return metric !== 'time';
}

/** Lee la config de una vista de carga SIN romperse (lo que no tiene forma, al default). */
export function readWorkloadSettings(config: unknown): WorkloadSettings {
    const c = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const metric = (WORKLOAD_METRICS as readonly unknown[]).includes(c.workload_metric) ? (c.workload_metric as WorkloadMetric) : 'count';
    const start = posInt(c.workload_start_field_id);
    const end = posInt(c.workload_end_field_id);
    let userIds: number[] | null = null;
    if (Array.isArray(c.workload_user_ids)) {
        userIds = [...new Set(c.workload_user_ids.map(posInt).filter((x): x is number => x !== null))].slice(0, WORKLOAD_MAX_PEOPLE);
    }
    return {
        personFieldId: posInt(c.workload_person_field_id),
        startFieldId: start,
        // El fin por el MISMO campo del inicio no existe: sería una sola fecha.
        endFieldId: end !== null && end !== start ? end : null,
        metric,
        estimateFieldId: posInt(c.workload_estimate_field_id),
        estimateUnit: (WORKLOAD_ESTIMATE_UNITS as readonly unknown[]).includes(c.workload_estimate_unit)
            ? (c.workload_estimate_unit as WorkloadEstimateUnit)
            : 'hours',
        zoom: (WORKLOAD_ZOOMS as readonly unknown[]).includes(c.workload_zoom) ? (c.workload_zoom as WorkloadZoom) : 'week',
        userIds,
        teamId: posInt(c.workload_team_id),
        showUnassigned: c.workload_show_unassigned !== false,
        hideDone: typeof c.workload_hide_done === 'boolean' ? c.workload_hide_done : defaultHideDone(metric),
    };
}

/** Todas las claves `workload_*` (para limpiar antes de mezclar). */
export const WORKLOAD_CONFIG_KEYS = Object.keys(workloadViewConfigShape) as Array<keyof typeof workloadViewConfigShape>;

/** Inverso de `readWorkloadSettings`: sólo lo que no es el default (una vista no gana claves vacías). */
export function workloadSettingsToConfig(s: WorkloadSettings): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (s.personFieldId !== null) out.workload_person_field_id = s.personFieldId;
    if (s.startFieldId !== null) out.workload_start_field_id = s.startFieldId;
    if (s.endFieldId !== null && s.endFieldId !== s.startFieldId) out.workload_end_field_id = s.endFieldId;
    if (s.metric !== 'count') out.workload_metric = s.metric;
    if (s.estimateFieldId !== null) out.workload_estimate_field_id = s.estimateFieldId;
    if (s.estimateUnit !== 'hours') out.workload_estimate_unit = s.estimateUnit;
    if (s.zoom !== 'week') out.workload_zoom = s.zoom;
    if (s.userIds !== null) out.workload_user_ids = [...s.userIds];
    if (s.teamId !== null) out.workload_team_id = s.teamId;
    if (!s.showUnassigned) out.workload_show_unassigned = false;
    if (s.hideDone !== defaultHideDone(s.metric)) out.workload_hide_done = s.hideDone;
    return out;
}

/** Reemplaza SÓLO las claves `workload_*` de una config (filtros, búsqueda y demás quedan). */
export function withWorkloadSettings(config: Record<string, unknown>, s: WorkloadSettings): Record<string, unknown> {
    const out: Record<string, unknown> = { ...config };
    for (const k of WORKLOAD_CONFIG_KEYS) delete out[k];
    return { ...out, ...workloadSettingsToConfig(s) };
}

// ─────────────────────────── Tiempo ───────────────────────────

/** Día de la semana de un `YYYY-MM-DD` (0 = domingo … 6 = sábado). */
export function dowOfYmd(ymd: string): number {
    const day = ymdToDay(ymd);
    return day === null ? 0 : dowOfDay(day);
}

/** El 1970-01-01 fue jueves. */
function dowOfDay(day: number): number {
    return (((day % 7) + 7 + 4) % 7);
}

/** Lunes de la semana de `ymd` (las semanas de la carga van de lunes a domingo). */
export function workloadWeekStart(ymd: string): string {
    const day = ymdToDay(ymd);
    if (day === null) return ymd;
    return dayToYmd(day - ((dowOfDay(day) + 6) % 7));
}

/** Primer día del mes de `ymd`. */
export function workloadMonthStart(ymd: string): string {
    return `${ymd.slice(0, 7)}-01`;
}

function addMonths(ymd: string, n: number): string {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(5, 7)) - 1 + n;
    const d = new Date(Date.UTC(y, m, 1));
    return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
    const day = ymdToDay(ymd);
    return day === null ? ymd : dayToYmd(day + n);
}

/** Clave de la columna a la que pertenece un día: el día, el lunes de su semana o el 1.º de su mes. */
export function workloadBucketKey(ymd: string, zoom: WorkloadZoom): string {
    if (zoom === 'day') return ymd;
    if (zoom === 'week') return workloadWeekStart(ymd);
    return workloadMonthStart(ymd);
}

/** Cuántas columnas se ven en cada zoom: dos semanas de días, ocho semanas o seis meses. */
export const WORKLOAD_WINDOW: Record<WorkloadZoom, number> = { day: 14, week: 8, month: 6 };

/**
 * La ventana visible que contiene `anchor` (alineada a su columna): en días,
 * desde el lunes de esa semana; en semanas, desde ese lunes; en meses, desde
 * el 1.º de ese mes.
 */
export function workloadWindow(anchor: string, zoom: WorkloadZoom): { from: string; to: string } {
    if (zoom === 'month') {
        const from = workloadMonthStart(anchor);
        return { from, to: addDays(addMonths(from, WORKLOAD_WINDOW.month), -1) };
    }
    const from = workloadWeekStart(anchor);
    const days = zoom === 'day' ? WORKLOAD_WINDOW.day : WORKLOAD_WINDOW.week * 7;
    return { from, to: addDays(from, days - 1) };
}

/** La ventana anterior (−1) o siguiente (+1): se corre la mitad en días, cuatro semanas o tres meses. */
export function workloadShiftWindow(from: string, zoom: WorkloadZoom, dir: -1 | 1): { from: string; to: string } {
    if (zoom === 'month') return workloadWindow(addMonths(from, dir * 3), zoom);
    return workloadWindow(addDays(from, dir * (zoom === 'day' ? 7 : 28)), zoom);
}

export interface WorkloadBucket {
    key: string;
    /** Primer y último día de la columna DENTRO del rango pedido. */
    start: string;
    end: string;
    /** Los días de la columna dentro del rango (YYYY-MM-DD). */
    days: string[];
}

/** Las columnas de `[from, to]` en el zoom elegido (una columna recortada en los bordes se queda con sus días). */
export function workloadBuckets(from: string, to: string, zoom: WorkloadZoom): WorkloadBucket[] {
    const a = ymdToDay(from);
    const b = ymdToDay(to);
    if (a === null || b === null || b < a) return [];
    const out: WorkloadBucket[] = [];
    let current: WorkloadBucket | null = null;
    for (let d = a; d <= b && d - a < WORKLOAD_MAX_RANGE_DAYS; d++) {
        const ymd = dayToYmd(d);
        const key = workloadBucketKey(ymd, zoom);
        if (!current || current.key !== key) {
            current = { key, start: ymd, end: ymd, days: [] };
            out.push(current);
        }
        current.days.push(ymd);
        current.end = ymd;
    }
    return out;
}

/** ¿Es día laborable para estos días de trabajo? */
export function isWorkday(ymd: string, workDays: readonly number[]): boolean {
    return workDays.includes(dowOfYmd(ymd));
}

/** Días laborables entre dos fechas inclusive (sin recorrer el tramo: un tramo de años cuesta lo mismo). */
export function countWorkdays(start: string, end: string, workDays: readonly number[]): number {
    const a = ymdToDay(start);
    const b = ymdToDay(end);
    if (a === null || b === null || b < a || workDays.length === 0) return 0;
    const set = new Set(workDays);
    const n = b - a + 1;
    const full = Math.floor(n / 7);
    let count = full * set.size;
    for (let d = a + full * 7; d <= b; d++) if (set.has(dowOfDay(d))) count += 1;
    return count;
}

// ─────────────────────────── Carga de un registro ───────────────────────────

/** Lo que el reparto necesita de un registro: su tramo (días en la zona de la empresa) y su estimación. */
export interface WorkloadSpan {
    start: string | null;
    end: string | null;
    /** Esfuerzo estimado en MINUTOS (null = sin estimación). */
    estimate_minutes: number | null;
}

/**
 * La carga de UN registro en cada columna de `[from, to]`. Las claves son las
 * columnas donde el registro está ACTIVO (algún día laborable de su tramo cae
 * ahí); el valor es lo que suma:
 *  - `count`: 1 por columna (un registro de tres semanas ocupa las tres);
 *  - `estimate`: la estimación repartida en partes iguales entre los días
 *    laborables de TODO el tramo (`estimación ÷ días hábiles`), sumando los que
 *    caen en cada columna — como ClickUp. Un tramo sin días laborables (un
 *    sábado suelto) se reparte en sus días corridos. Sin estimación la columna
 *    figura con 0: el registro se ve en el panel aunque no sume.
 * Un registro sin fecha no tiene columna (va a «Sin fecha»).
 */
export function workloadItemLoad(
    item: WorkloadSpan,
    metric: Exclude<WorkloadMetric, 'time'>,
    workDays: readonly number[],
    from: string,
    to: string,
    zoom: WorkloadZoom,
): Record<string, number> {
    const out: Record<string, number> = {};
    const startYmd = item.start ?? item.end;
    if (startYmd === null) return out;
    const s = ymdToDay(startYmd);
    const eRaw = item.end !== null ? ymdToDay(item.end) : s;
    const f = ymdToDay(from);
    const t = ymdToDay(to);
    if (s === null || f === null || t === null) return out;
    const e = eRaw === null || eRaw < s ? s : eRaw;
    if (e < f || s > t) return out;
    const workdays = countWorkdays(dayToYmd(s), dayToYmd(e), workDays);
    const useAll = workdays === 0;
    const units = useAll ? e - s + 1 : workdays;
    const set = new Set(workDays);
    const perDay = metric === 'estimate' && item.estimate_minutes !== null && item.estimate_minutes > 0 ? item.estimate_minutes / units : 0;
    const lo = Math.max(s, f);
    const hi = Math.min(e, t);
    for (let d = lo; d <= hi; d++) {
        if (!useAll && !set.has(dowOfDay(d))) continue;
        const key = workloadBucketKey(dayToYmd(d), zoom);
        if (metric === 'count') out[key] = 1;
        else out[key] = (out[key] ?? 0) + perDay;
    }
    return out;
}

/**
 * La capacidad de una persona en una columna (sus días dentro del rango): en
 * MINUTOS para el esfuerzo y el tiempo (horas por día × días laborables), y en
 * registros para la cantidad (registros por semana, prorrateados por los días
 * laborables de la columna).
 */
export function workloadBucketCapacity(capacity: WorkloadCapacity, metric: WorkloadMetric, days: readonly string[]): number {
    const set = new Set(capacity.work_days);
    if (set.size === 0) return 0;
    let workdays = 0;
    for (const d of days) if (set.has(dowOfYmd(d))) workdays += 1;
    if (metric === 'count') return (capacity.records_per_week * workdays) / set.size;
    return capacity.hours_per_day * 60 * workdays;
}

export type WorkloadLevel = 'empty' | 'ok' | 'near' | 'over';

/**
 * Cómo se pinta una celda: vacía, bien, cerca del límite (≥ 85 %) o pasada de
 * la capacidad. Sin capacidad (un día no laborable, alguien sin horas) y con
 * carga, está pasada.
 */
export function workloadLevel(value: number, capacity: number): WorkloadLevel {
    if (!(value > 0.0001)) return 'empty';
    if (capacity <= 0) return 'over';
    const ratio = value / capacity;
    if (ratio > 1 + 1e-9) return 'over';
    if (ratio >= WORKLOAD_NEAR_RATIO) return 'near';
    return 'ok';
}

// ─────────────────────────── Bundle ───────────────────────────

/** Una fila de la carga: una persona (o «Sin asignar»). */
export interface WorkloadPerson {
    /** El id de usuario como texto, o `__none__`. */
    key: string;
    user_id: number | null;
    name: string;
    email: string | null;
    /**
     * Es del equipo y ve la lista: se le puede asignar trabajo desde aquí. Si
     * no (ya no es del equipo, o no tiene acceso a esta lista), la fila aparece
     * sólo porque tiene registros asignados.
     */
    member: boolean;
    capacity: WorkloadCapacity;
    /** Tiene capacidad propia (si no, la de por defecto). */
    capacity_custom: boolean;
}

/** Un registro de la carga (los que viajan, para el panel de una celda y el arrastre). */
export interface WorkloadItem {
    id: number;
    title: string | null;
    /** Fila: la persona asignada (o quien registró el tiempo, en «Tiempo registrado»). */
    person: string;
    start: string | null;
    end: string | null;
    estimate_minutes: number | null;
    /** El valor crudo del campo Persona (para deshacer con `expect`). */
    person_value: number | null;
    done: boolean;
    /** Quien mira puede editarlo (alcance de edición del ACL). */
    editable: boolean;
    /** Carga por columna (ver `workloadItemLoad`). */
    load: Record<string, number>;
}

export interface WorkloadTotals {
    value: number;
    capacity: number;
    /** Registros distintos activos en el rango. */
    records: number;
}

export interface WorkloadBundle {
    meta: {
        from: string;
        to: string;
        zoom: WorkloadZoom;
        metric: WorkloadMetric;
        time_zone: string;
        person_field_id: number;
        start_field_id: number | null;
        end_field_id: number | null;
        estimate_field_id: number | null;
        /** Minutos por unidad del campo de estimación (60 = horas, 1 = minutos). */
        estimate_unit_minutes: number;
        /** Se ocultaron los terminados (`done_reason` explica por qué no, si se pidió). */
        hide_done: boolean;
        done_reason?: 'no_status' | 'hidden';
        /** Hubo más filas que el tope: la grilla no las cuenta todas. */
        truncated: boolean;
        /** Viajan menos registros que los que suman en la grilla. */
        items_truncated: boolean;
        /** Registros (o pares registro-persona en el tiempo) activos en el rango. */
        total_records: number;
    };
    people: WorkloadPerson[];
    /** persona → columna → valor (registros, o minutos en esfuerzo y tiempo). */
    grid: Record<string, Record<string, number>>;
    totals: Record<string, WorkloadTotals>;
    team: WorkloadTotals & { unassigned: number };
    /** Registros SIN FECHA por persona (no entran en ninguna columna). */
    unscheduled: Record<string, number>;
    items: WorkloadItem[];
}

/**
 * Grilla, totales por persona y del equipo a partir de la carga de cada
 * registro. El servidor la arma con TODOS los registros del rango (no sólo los
 * que viajan). La fila «Sin asignar» no tiene capacidad ni suma al equipo.
 */
export function summarizeWorkload(
    items: ReadonlyArray<Pick<WorkloadItem, 'person' | 'load'>>,
    people: ReadonlyArray<Pick<WorkloadPerson, 'key' | 'capacity'>>,
    opts: { metric: WorkloadMetric; from: string; to: string; zoom: WorkloadZoom },
): Pick<WorkloadBundle, 'grid' | 'totals' | 'team'> {
    const buckets = workloadBuckets(opts.from, opts.to, opts.zoom);
    const grid: Record<string, Record<string, number>> = {};
    const totals: Record<string, WorkloadTotals> = {};
    for (const p of people) {
        grid[p.key] = {};
        let capacity = 0;
        if (p.key !== WORKLOAD_UNASSIGNED) for (const b of buckets) capacity += workloadBucketCapacity(p.capacity, opts.metric, b.days);
        totals[p.key] = { value: 0, capacity, records: 0 };
    }
    for (const it of items) {
        const row = grid[it.person];
        const tot = totals[it.person];
        if (!row || !tot) continue;
        const keys = Object.keys(it.load);
        if (keys.length === 0) continue;
        tot.records += 1;
        for (const k of keys) {
            const v = it.load[k] ?? 0;
            row[k] = (row[k] ?? 0) + v;
            if (opts.metric !== 'count') tot.value += v;
        }
        if (opts.metric === 'count') tot.value += 1;
    }
    const team = { value: 0, capacity: 0, records: 0, unassigned: 0 };
    for (const [key, t] of Object.entries(totals)) {
        if (key === WORKLOAD_UNASSIGNED) {
            team.unassigned = t.value;
            continue;
        }
        team.value += t.value;
        team.capacity += t.capacity;
        team.records += t.records;
    }
    return { grid, totals, team };
}

/**
 * Reasignar (optimista): la carga de un registro pasa a otra fila — recalculada
 * con los días laborables de la persona nueva — y los totales se corrigen con
 * la diferencia. Funciona aunque no viajen todos los registros (se resta y se
 * suma sólo el que se movió). `toPersonValue`: el valor nuevo del campo.
 */
export function reassignWorkloadItem(bundle: WorkloadBundle, itemId: number, toKey: string, toPersonValue: number | null): WorkloadBundle {
    const idx = bundle.items.findIndex((i) => i.id === itemId);
    const item = bundle.items[idx];
    if (idx < 0 || !item || item.person === toKey || bundle.meta.metric === 'time') return bundle;
    const target = bundle.people.find((p) => p.key === toKey);
    if (!target) return bundle;
    const { metric, from, to, zoom } = bundle.meta;
    const newLoad = workloadItemLoad(item, metric, target.capacity.work_days, from, to, zoom);
    const grid = { ...bundle.grid };
    const totals = { ...bundle.totals };
    const apply = (key: string, load: Record<string, number>, sign: 1 | -1): void => {
        const row = { ...(grid[key] ?? {}) };
        for (const [k, v] of Object.entries(load)) {
            const next = (row[k] ?? 0) + sign * v;
            if (Math.abs(next) < 1e-9) delete row[k];
            else row[k] = next;
        }
        grid[key] = row;
        const t = totals[key];
        if (t && Object.keys(load).length > 0) {
            const sum = metric === 'count' ? 1 : Object.values(load).reduce((a, b) => a + b, 0);
            totals[key] = { ...t, value: Math.max(0, t.value + sign * sum), records: Math.max(0, t.records + sign) };
        }
    };
    apply(item.person, item.load, -1);
    apply(toKey, newLoad, 1);
    const team = { ...bundle.team, value: 0, records: 0, unassigned: 0 };
    team.capacity = bundle.team.capacity;
    for (const [key, t] of Object.entries(totals)) {
        if (key === WORKLOAD_UNASSIGNED) team.unassigned = t.value;
        else {
            team.value += t.value;
            team.records += t.records;
        }
    }
    const items = [...bundle.items];
    items[idx] = { ...item, person: toKey, person_value: toPersonValue, load: newLoad };
    return { ...bundle, grid, totals, team, items };
}
