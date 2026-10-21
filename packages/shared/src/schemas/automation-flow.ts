import { addDaysYmd, FALLBACK_TIME_ZONE, isValidTimeZone, zonedInstant, zonedToday } from './timezone';

/**
 * v0.1.289 — Piezas PURAS del flujo de una automatización que comparten el
 * motor (servidor), el editor (navegador) y el asistente: la acción «Esperar»
 * (cuándo se reanuda), «Repetir por cada registro vinculado» (topes), las
 * respuestas con nombre de los webhooks y el direccionamiento de un paso
 * dentro del árbol de acciones (ramas de un si/sino y el cuerpo de un bucle).
 *
 * El motor y el editor calculan la hora de reanudación con la MISMA función
 * (`waitResumeAt`): lo que el editor muestra («esperaría hasta el jueves a las
 * 9:00») es lo que después hace el motor.
 */

// ── Direccionamiento de pasos ────────────────────────────────────────────

/**
 * Una rama de un contenedor: `then`/`else` de un si/sino y `each` (el cuerpo)
 * de «Repetir por cada registro vinculado».
 */
export type FlowBranch = 'then' | 'else' | 'each';
/**
 * Ruta de un paso: índices y ramas alternados — `[2, 'then', 0]` es el primer
 * paso de la rama «Sí» del si/sino que está en la posición 2 de la raíz.
 */
export type FlowPath = Array<number | FlowBranch>;

export const FLOW_BRANCH_KEYS: Record<FlowBranch, string> = {
    then: 'then_actions',
    else: 'else_actions',
    each: 'actions',
};

interface FlowNodeLike {
    type?: unknown;
    config?: unknown;
}

/** Las acciones de una rama de un contenedor (vacío si no hay). */
export function flowBranch(node: FlowNodeLike | undefined, branch: FlowBranch): FlowNodeLike[] {
    const cfg = node?.config;
    if (!cfg || typeof cfg !== 'object') return [];
    const raw = (cfg as Record<string, unknown>)[FLOW_BRANCH_KEYS[branch]];
    return Array.isArray(raw) ? (raw as FlowNodeLike[]) : [];
}

/** El paso en una ruta (o undefined si la ruta ya no existe). */
export function flowNodeAt<T extends FlowNodeLike>(actions: readonly T[], path: FlowPath): T | undefined {
    if (path.length === 0 || path.length % 2 === 0) return undefined;
    let seq: readonly FlowNodeLike[] = actions;
    for (let i = 0; i < path.length; i += 2) {
        const idx = path[i];
        if (typeof idx !== 'number') return undefined;
        const node = seq[idx];
        if (!node || typeof node !== 'object') return undefined;
        if (i === path.length - 1) return node as T;
        const branch = path[i + 1];
        if (branch !== 'then' && branch !== 'else' && branch !== 'each') return undefined;
        seq = flowBranch(node, branch);
    }
    return undefined;
}

export function flowPathKey(path: FlowPath): string {
    return path.join('.');
}

/** Lee una ruta guardada (`"2.then.0"` o un array) — null si no es válida. */
export function parseFlowPath(raw: unknown): FlowPath | null {
    const parts = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? raw.split('.') : null;
    if (!parts || parts.length === 0 || parts.length > 40) return null;
    const out: FlowPath = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (i % 2 === 0) {
            const n = typeof p === 'number' ? p : Number(p);
            if (!Number.isInteger(n) || n < 0 || n > 10_000) return null;
            out.push(n);
        } else {
            if (p !== 'then' && p !== 'else' && p !== 'each') return null;
            out.push(p);
        }
    }
    return out;
}

// ── «Esperar» ─────────────────────────────────────────────────────────────

export const WAIT_UNITS = ['minutes', 'hours', 'days'] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];
export type WaitMode = 'duration' | 'until_field';

const UNIT_MS: Record<WaitUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

/** Lo más lejos que puede esperar una automatización (un año y un día). */
export const MAX_WAIT_DAYS = 366;
const MAX_WAIT_MS = MAX_WAIT_DAYS * UNIT_MS.days;

/** La config de «Esperar» ya leída, con defaults tolerantes. */
export interface WaitConfig {
    mode: WaitMode;
    /** Esperar N unidades (modo `duration`). */
    amount: number;
    unit: WaitUnit;
    /** Slug del campo de fecha (modo `until_field`). */
    dateField: string;
    /** Desplazamiento respecto de la fecha: «1 día antes». */
    offsetAmount: number;
    offsetUnit: WaitUnit;
    offsetDirection: 'before' | 'after';
    /** «A las 9:00 de ese día» (en la zona de la empresa). */
    atTime: { h: number; m: number } | null;
}

function num(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

function unitOf(v: unknown, fallback: WaitUnit): WaitUnit {
    return (WAIT_UNITS as readonly unknown[]).includes(v) ? (v as WaitUnit) : fallback;
}

/** `"09:30"` → {h: 9, m: 30}; null si no es una hora válida. */
export function parseClockTime(raw: unknown): { h: number; m: number } | null {
    if (typeof raw !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return h >= 0 && h <= 23 && mm >= 0 && mm <= 59 ? { h, m: mm } : null;
}

export function readWaitConfig(cfg: Record<string, unknown> | null | undefined): WaitConfig {
    const c = cfg ?? {};
    return {
        mode: c.mode === 'until_field' ? 'until_field' : 'duration',
        amount: Math.max(0, num(c.amount, 0)),
        unit: unitOf(c.unit, 'days'),
        dateField: typeof c.date_field === 'string' ? c.date_field : '',
        offsetAmount: Math.max(0, num(c.offset_amount, 0)),
        offsetUnit: unitOf(c.offset_unit, 'days'),
        offsetDirection: c.offset_direction === 'after' ? 'after' : 'before',
        atTime: parseClockTime(c.at_time),
    };
}

/** Lo que le falta a un «Esperar» para poder correr (null = está bien). */
export function waitConfigProblem(cfg: Record<string, unknown> | null | undefined): string | null {
    const w = readWaitConfig(cfg);
    if (w.mode === 'duration') {
        if (!(w.amount > 0)) return 'Indica cuánto esperar (un número mayor que 0).';
        if (w.amount * UNIT_MS[w.unit] > MAX_WAIT_MS) return `Una espera puede durar como mucho ${MAX_WAIT_DAYS} días.`;
        return null;
    }
    if (w.dateField === '') return 'Elige el campo de fecha hasta el que hay que esperar.';
    if (w.offsetAmount * UNIT_MS[w.offsetUnit] > MAX_WAIT_MS) return `El desplazamiento puede ser de ${MAX_WAIT_DAYS} días como mucho.`;
    return null;
}

export type WaitTarget =
    | { ok: true; at: Date }
    | { ok: false; reason: 'empty' | 'invalid' | 'too_far' | 'config'; message: string };

/** Lee el valor de un campo de fecha: «sólo fecha» o un instante. */
function readDateValue(value: unknown): { ymd: string } | { instant: Date } | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const v = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ymd: v };
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return null;
    // Un instante sin zona es UTC (como lo guarda la app).
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v.replace(' ', 'T') : `${v.replace(' ', 'T')}Z`;
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? null : { instant: at };
}

/**
 * Cuándo se reanuda una espera. `field` es el campo de fecha del registro en
 * el modo «hasta una fecha» (su etiqueta sólo se usa en los mensajes).
 *
 * - Una fecha SIN hora («vence el 7») cuenta desde la medianoche de la zona
 *   de la empresa; «a las 9:00» pone esa hora en el día resultante.
 * - Un desplazamiento en días sobre una fecha sin hora se calcula por
 *   calendario (no se corre una hora en los cambios de horario).
 */
export function waitResumeAt(
    cfg: Record<string, unknown> | null | undefined,
    input: { now: Date; timeZone?: string | null; field?: { label?: string; value: unknown } | null },
): WaitTarget {
    const w = readWaitConfig(cfg);
    const tz = isValidTimeZone(input.timeZone) ? input.timeZone : FALLBACK_TIME_ZONE;
    const problem = waitConfigProblem(cfg);
    if (problem) return { ok: false, reason: 'config', message: problem };

    let at: Date;
    if (w.mode === 'duration') {
        at = new Date(input.now.getTime() + w.amount * UNIT_MS[w.unit]);
    } else {
        const label = input.field?.label ? `«${input.field.label}»` : 'El campo de fecha';
        const raw = input.field?.value;
        if (raw === null || raw === undefined || raw === '') {
            return { ok: false, reason: 'empty', message: `${label} está vacío en este registro.` };
        }
        const parsed = readDateValue(raw);
        if (!parsed) return { ok: false, reason: 'invalid', message: `${label} no tiene una fecha válida («${String(raw)}»).` };
        const sign = w.offsetDirection === 'before' ? -1 : 1;
        const offset = sign * w.offsetAmount;
        if ('ymd' in parsed && w.offsetUnit === 'days') {
            const day = addDaysYmd(parsed.ymd, offset);
            at = zonedInstant(day, tz, w.atTime ?? {});
        } else {
            const base = 'ymd' in parsed ? zonedInstant(parsed.ymd, tz) : parsed.instant;
            const moved = new Date(base.getTime() + offset * UNIT_MS[w.offsetUnit]);
            at = w.atTime ? zonedInstant(zonedToday(tz, moved), tz, w.atTime) : moved;
        }
    }
    if (at.getTime() - input.now.getTime() > MAX_WAIT_MS) {
        return { ok: false, reason: 'too_far', message: `La espera terminaría dentro de más de ${MAX_WAIT_DAYS} días.` };
    }
    return { ok: true, at };
}

const UNIT_LABEL: Record<WaitUnit, [string, string]> = {
    minutes: ['minuto', 'minutos'],
    hours: ['hora', 'horas'],
    days: ['día', 'días'],
};

export function waitUnitLabel(n: number, unit: WaitUnit): string {
    const [one, many] = UNIT_LABEL[unit];
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * La espera en lenguaje claro: «Espera 3 días», «Espera hasta 1 día antes de
 * «Vencimiento» a las 09:00».
 */
export function describeWait(cfg: Record<string, unknown> | null | undefined, fieldLabel?: string): string {
    const w = readWaitConfig(cfg);
    if (w.mode === 'duration') {
        return w.amount > 0 ? `Espera ${waitUnitLabel(w.amount, w.unit)}` : 'Espera (falta indicar cuánto)';
    }
    if (w.dateField === '') return 'Espera hasta una fecha (falta elegir el campo)';
    const field = `«${fieldLabel ?? w.dateField}»`;
    const offset =
        w.offsetAmount > 0
            ? `${waitUnitLabel(w.offsetAmount, w.offsetUnit)} ${w.offsetDirection === 'before' ? 'antes de' : 'después de'} ${field}`
            : field;
    const time = w.atTime ? ` a las ${String(w.atTime.h).padStart(2, '0')}:${String(w.atTime.m).padStart(2, '0')}` : '';
    return `Espera hasta ${offset}${time}`;
}

// ── «Repetir por cada registro vinculado» ────────────────────────────────

/** Cuántos vinculados procesa un bucle como mucho (el resto queda anotado). */
export const FOR_EACH_MAX_ITEMS = 200;

// ── Programado «para cada registro» ──────────────────────────────────────

/** Cuántos registros procesa un disparo programado «para cada registro». */
export const SCHEDULED_EACH_MAX = 1000;
/** De a cuántos registros se encolan las corridas de un disparo así. */
export const SCHEDULED_EACH_BATCH = 50;

// ── Respuestas de webhooks ───────────────────────────────────────────────

/**
 * Nombre de una respuesta guardada (`{{respuestas.<nombre>.body.x}}`): letras
 * minúsculas, números y guion bajo, empezando por letra.
 */
export const RESPONSE_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Cuánto del cuerpo de una respuesta se guarda para los pasos siguientes. Lo
 * que pase de aquí llega recortado (y un JSON recortado ya no se lee como
 * JSON: queda como texto).
 */
export const RESPONSE_BODY_MAX_BYTES = 64 * 1024;

/** Las acciones que dejan su respuesta para los pasos siguientes. */
export const RESPONSE_ACTIONS: readonly string[] = ['call_webhook', 'connector_action'];
