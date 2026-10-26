import type { FieldType } from './field';
import {
    KANBAN_CARD_SIZES,
    KANBAN_VALUE_METRICS,
    type KanbanCardSize,
    type KanbanValueMetric,
} from './view';

/**
 * v0.1.297 — Kanban para ventas (B5): lógica PURA que comparten el tablero (front),
 * el bundle del servidor y el asistente. Lo que vive aquí no toca la base:
 * leer la config de la vista sin romperse, armar las claves de celda y pasar
 * de la clave de un grupo al VALOR que hay que escribir al mover una tarjeta.
 */

/** Clave de la columna/carril «Sin valor» (la misma de la vista agrupada). */
export const KANBAN_NULL_KEY = '__null__';

/** Tope de columnas que viajan en el bundle (las demás se informan como ocultas). */
export const KANBAN_MAX_COLUMNS = 100;
/** Tope de carriles que viajan. */
export const KANBAN_MAX_LANES = 50;
/** Tarjetas por celda en la primera carga y en cada «Mostrar más». */
export const KANBAN_PAGE_SIZE = 25;
/** Lo máximo que se puede cargar de una celda con «Mostrar más». */
export const KANBAN_MAX_PER_CELL = 500;

/**
 * Tipos por los que se arman las COLUMNAS: los que se escriben con un valor
 * simple al soltar la tarjeta. El texto se conserva por compatibilidad con
 * tableros viejos (columnas dinámicas por valor).
 */
export const KANBAN_COLUMN_TYPES: readonly FieldType[] = ['select', 'user', 'checkbox', 'text', 'team'];
/** Tipos de los CARRILES (vendedor, prioridad, sí/no, equipo). */
export const KANBAN_LANE_TYPES: readonly FieldType[] = ['select', 'user', 'checkbox', 'team'];
/** Tipos que se pueden sumar/promediar por columna. */
export const KANBAN_VALUE_TYPES: readonly FieldType[] = ['number', 'currency', 'percent', 'rating', 'duration', 'rollup', 'computed'];

/** La config del tablero ya normalizada (lo que lee la vista). */
export interface KanbanSettings {
    titleFieldId: number | null;
    metaFieldIds: number[];
    valueFieldId: number | null;
    valueMetric: KanbanValueMetric;
    laneFieldId: number | null;
    collapsedLanes: string[];
    collapsedColumns: string[];
    hiddenColumns: string[];
    hideEmpty: boolean;
    /** Clave de columna → límite de tarjetas (WIP). */
    wipLimits: Record<string, number>;
    /** Clave de columna → campos que se piden al entrar. */
    moveRules: Record<string, number[]>;
    coverFieldId: number | null;
    cardSize: KanbanCardSize;
}

export const DEFAULT_KANBAN_SETTINGS: KanbanSettings = {
    titleFieldId: null,
    metaFieldIds: [],
    valueFieldId: null,
    valueMetric: 'sum',
    laneFieldId: null,
    collapsedLanes: [],
    collapsedColumns: [],
    hiddenColumns: [],
    hideEmpty: false,
    wipLimits: {},
    moveRules: {},
    coverFieldId: null,
    cardSize: 'normal',
};

const posInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

const idList = (v: unknown): number[] => {
    if (!Array.isArray(v)) return [];
    const out: number[] = [];
    for (const x of v) {
        const id = posInt(x);
        if (id !== null && !out.includes(id)) out.push(id);
    }
    return out;
};

const keyList = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) if (typeof x === 'string' && x !== '' && !out.includes(x)) out.push(x);
    return out;
};

/**
 * Lee la config de una vista kanban SIN romperse: lo que no tiene la forma
 * esperada se descarta (una regla a medias, un límite negativo, un id de
 * texto) y lo ausente toma el default. La usan el tablero y el asistente.
 */
export function readKanbanSettings(config: unknown): KanbanSettings {
    const c = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const wipLimits: Record<string, number> = {};
    if (Array.isArray(c.kanban_wip_limits)) {
        for (const w of c.kanban_wip_limits) {
            if (!w || typeof w !== 'object') continue;
            const { column, limit } = w as { column?: unknown; limit?: unknown };
            if (typeof column === 'string' && column !== '' && typeof limit === 'number' && Number.isInteger(limit) && limit >= 1) {
                wipLimits[column] = Math.min(10_000, limit);
            }
        }
    }
    const moveRules: Record<string, number[]> = {};
    if (Array.isArray(c.kanban_move_rules)) {
        for (const r of c.kanban_move_rules) {
            if (!r || typeof r !== 'object') continue;
            const { column, required_field_ids } = r as { column?: unknown; required_field_ids?: unknown };
            const ids = idList(required_field_ids).slice(0, 20);
            if (typeof column === 'string' && column !== '' && ids.length > 0) moveRules[column] = ids;
        }
    }
    const lane = posInt(c.kanban_lane_field_id);
    return {
        titleFieldId: posInt(c.kanban_title_field_id),
        metaFieldIds: idList(c.kanban_meta_field_ids),
        valueFieldId: posInt(c.kanban_value_field_id),
        valueMetric: (KANBAN_VALUE_METRICS as readonly unknown[]).includes(c.kanban_value_metric)
            ? (c.kanban_value_metric as KanbanValueMetric)
            : 'sum',
        // Un carril por el MISMO campo de las columnas no existe.
        laneFieldId: lane !== null && lane !== posInt(c.group_by_field_id) ? lane : null,
        collapsedLanes: keyList(c.kanban_collapsed_lanes),
        collapsedColumns: keyList(c.kanban_collapsed_columns),
        hiddenColumns: keyList(c.kanban_hidden_columns),
        hideEmpty: c.kanban_hide_empty === true,
        wipLimits,
        moveRules,
        coverFieldId: posInt(c.kanban_cover_field_id),
        cardSize: (KANBAN_CARD_SIZES as readonly unknown[]).includes(c.kanban_card_size)
            ? (c.kanban_card_size as KanbanCardSize)
            : 'normal',
    };
}

/**
 * Inverso de `readKanbanSettings`: las claves `kanban_*` de la config, sólo
 * con lo que NO es el default (una vista vieja no gana claves vacías). El
 * llamador las mezcla con el resto de la config de la vista.
 */
export function kanbanSettingsToConfig(s: KanbanSettings): Record<string, unknown> {
    const out: Record<string, unknown> = {
        kanban_title_field_id: s.titleFieldId,
        kanban_meta_field_ids: [...s.metaFieldIds],
    };
    if (s.valueFieldId !== null) {
        out.kanban_value_field_id = s.valueFieldId;
        if (s.valueMetric !== 'sum') out.kanban_value_metric = s.valueMetric;
    }
    if (s.laneFieldId !== null) out.kanban_lane_field_id = s.laneFieldId;
    if (s.laneFieldId !== null && s.collapsedLanes.length > 0) out.kanban_collapsed_lanes = [...s.collapsedLanes];
    if (s.collapsedColumns.length > 0) out.kanban_collapsed_columns = [...s.collapsedColumns];
    if (s.hiddenColumns.length > 0) out.kanban_hidden_columns = [...s.hiddenColumns];
    if (s.hideEmpty) out.kanban_hide_empty = true;
    const wip = Object.entries(s.wipLimits)
        .filter(([, limit]) => Number.isInteger(limit) && limit >= 1)
        .map(([column, limit]) => ({ column, limit }));
    if (wip.length > 0) out.kanban_wip_limits = wip;
    const rules = Object.entries(s.moveRules)
        .filter(([, ids]) => ids.length > 0)
        .map(([column, ids]) => ({ column, required_field_ids: [...ids] }));
    if (rules.length > 0) out.kanban_move_rules = rules;
    if (s.coverFieldId !== null) out.kanban_cover_field_id = s.coverFieldId;
    if (s.cardSize !== 'normal') out.kanban_card_size = s.cardSize;
    return out;
}

/** Todas las claves `kanban_*` que escribe `kanbanSettingsToConfig` (para limpiar antes de mezclar). */
export const KANBAN_CONFIG_KEYS = [
    'kanban_title_field_id',
    'kanban_meta_field_ids',
    'kanban_value_field_id',
    'kanban_value_metric',
    'kanban_lane_field_id',
    'kanban_collapsed_lanes',
    'kanban_collapsed_columns',
    'kanban_hidden_columns',
    'kanban_hide_empty',
    'kanban_wip_limits',
    'kanban_move_rules',
    'kanban_cover_field_id',
    'kanban_card_size',
] as const;

/** La config de la vista con los ajustes del tablero reemplazados. */
export function withKanbanSettings(config: Record<string, unknown>, s: KanbanSettings): Record<string, unknown> {
    const out: Record<string, unknown> = { ...config };
    for (const k of KANBAN_CONFIG_KEYS) delete out[k];
    return { ...out, ...kanbanSettingsToConfig(s) };
}

/**
 * Clave de una celda del tablero: la columna sola sin carriles, o el par
 * `[carril, columna]` (JSON, `__null__` para «Sin valor») con carriles — la
 * misma forma que el par (grupo, subgrupo) de la vista agrupada.
 */
export function kanbanCellKey(lane: string | null | undefined, column: string | null): string {
    if (lane === undefined) return column ?? KANBAN_NULL_KEY;
    return JSON.stringify([lane ?? KANBAN_NULL_KEY, column ?? KANBAN_NULL_KEY]);
}

/** La clave de grupo cruda (null = «Sin valor») ↔ la clave que viaja. */
export function kanbanRawKey(key: string): string | null {
    return key === KANBAN_NULL_KEY ? null : key;
}

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'rating', 'percent', 'duration'];
const STRING_TYPES: readonly FieldType[] = ['select', 'text', 'email', 'url', 'phone', 'date', 'datetime'];

/**
 * El VALOR que hay que escribir en un campo para que el registro caiga en el
 * grupo `key` (columna o carril al soltar una tarjeta). Los derivados
 * (lookup, rollup, computed, IA, tiempo) y los que no forman grupos no se
 * escriben: `ok: false`.
 */
export function kanbanBucketValue(type: FieldType, key: string | null): { ok: true; value: unknown } | { ok: false } {
    if (STRING_TYPES.includes(type)) return { ok: true, value: key };
    if (type === 'user') {
        if (key === null) return { ok: true, value: null };
        const n = Number(key);
        return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false };
    }
    if (type === 'checkbox') {
        if (key === null) return { ok: true, value: null };
        return { ok: true, value: key === 'true' || key === '1' };
    }
    if (NUMERIC_TYPES.includes(type)) {
        if (key === null) return { ok: true, value: null };
        const n = Number(key);
        return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    // C1 — la clave de un grupo de equipos es el conjunto (`[3, 7]`).
    if (type === 'team') {
        if (key === null) return { ok: true, value: null };
        try {
            const parsed: unknown = JSON.parse(key);
            const ids = (Array.isArray(parsed) ? parsed : [parsed]).map(Number);
            return ids.every((n) => Number.isInteger(n) && n > 0) ? { ok: true, value: ids } : { ok: false };
        } catch {
            return { ok: false };
        }
    }
    if (type === 'multi_select') {
        if (key === null) return { ok: true, value: [] };
        try {
            const parsed: unknown = JSON.parse(key);
            return Array.isArray(parsed) ? { ok: true, value: parsed.map(String) } : { ok: false };
        } catch {
            return { ok: false };
        }
    }
    return { ok: false };
}

/**
 * La clave de grupo de un VALOR, con las mismas reglas del motor de
 * agregados (`data->>'f…'` y el conjunto ordenado de un multi_select).
 * `undefined` = no se puede derivar en el cliente (derivados): el registro se
 * queda en la celda en la que lo mandó el servidor.
 */
export function kanbanBucketKeyOf(type: FieldType, value: unknown): string | null | undefined {
    if (value === null || value === undefined || value === '') return null;
    if (STRING_TYPES.includes(type)) return typeof value === 'string' ? value : String(value);
    if (type === 'user') {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? String(n) : String(value);
    }
    if (type === 'checkbox') {
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return String(value);
    }
    if (NUMERIC_TYPES.includes(type)) {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? String(n) : undefined;
    }
    if (type === 'multi_select') {
        if (!Array.isArray(value)) return undefined;
        if (value.length === 0) return null;
        const items = value.map(String).sort();
        return `[${items.map((v) => JSON.stringify(v)).join(', ')}]`;
    }
    if (type === 'team') {
        const ids = (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return null;
        return teamGroupKey(ids);
    }
    return undefined;
}

/**
 * C1 — La clave de grupo de un valor «Equipo»: el conjunto ORDENADO de ids
 * con la salida de texto de un array jsonb de Postgres (`[3, 7]`), la misma
 * que arma el motor de agregados.
 */
export function teamGroupKey(ids: readonly number[]): string {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    return `[${sorted.join(', ')}]`;
}

/** Ids de equipo de una clave de grupo (`[3, 7]`); otra cosa → []. */
export function parseTeamGroupKey(key: string | null | undefined): number[] {
    if (!key) return [];
    try {
        const parsed: unknown = JSON.parse(key);
        return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    } catch {
        return [];
    }
}

/** ¿Vacío para una regla «pedir al mover»? (una casilla sin marcar cuenta como vacía). */
export function isKanbanEmptyValue(value: unknown): boolean {
    return (
        value === null ||
        value === undefined ||
        value === false ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)
    );
}
