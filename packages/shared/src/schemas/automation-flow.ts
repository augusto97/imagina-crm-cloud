import { companyCalendar, companyWaitTarget, defaultCompanyHours, type CompanyCalendar } from './company-hours';
import { addDaysYmd, FALLBACK_TIME_ZONE, isValidTimeZone, zonedInstant, zonedToday } from './timezone';

/**
 * v0.1.288 — Piezas PURAS del flujo de una automatización que comparten el
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
 * Una rama de un contenedor: `then`/`else` de un si/sino, `each` (el cuerpo)
 * de «Repetir por cada registro vinculado», v0.1.460 `case<N>` y `default`
 * de «Según el valor de…» y `fail`: la rama «Si este paso falla» de cualquier
 * paso (vive en `on_error.actions`, al lado de `config`).
 */
export type FlowBranch = 'then' | 'else' | 'each' | 'default' | 'fail' | `case${number}`;
/**
 * Ruta de un paso: índices y ramas alternados — `[2, 'then', 0]` es el primer
 * paso de la rama «Sí» del si/sino que está en la posición 2 de la raíz;
 * `[1, 'case2', 0]` el primero de la tercera rama de un «Según el valor de…».
 */
export type FlowPath = Array<number | FlowBranch>;

export const FLOW_BRANCH_KEYS: Record<'then' | 'else' | 'each' | 'default', string> = {
    then: 'then_actions',
    else: 'else_actions',
    each: 'actions',
    default: 'default_actions',
};

const CASE_BRANCH_RE = /^case(\d{1,2})$/;

/** ¿Es el nombre de una rama? (`then`, `else`, `each`, `default`, `fail`, `case0`…). */
export function isFlowBranch(p: unknown): p is FlowBranch {
    return p === 'then' || p === 'else' || p === 'each' || p === 'default' || p === 'fail' || (typeof p === 'string' && CASE_BRANCH_RE.test(p));
}

/** `case<N>` → N (o null si no es una rama de un «Según el valor de…»). */
export function caseBranchIndex(branch: unknown): number | null {
    if (typeof branch !== 'string') return null;
    const m = CASE_BRANCH_RE.exec(branch);
    return m ? Number(m[1]) : null;
}

export function caseBranch(index: number): FlowBranch {
    return `case${index}` as FlowBranch;
}

interface FlowNodeLike {
    type?: unknown;
    config?: unknown;
    on_error?: unknown;
}

/** Las acciones de una rama de un contenedor (vacío si no hay). */
export function flowBranch(node: FlowNodeLike | undefined, branch: FlowBranch): FlowNodeLike[] {
    if (branch === 'fail') {
        const oe = node?.on_error;
        const raw = oe && typeof oe === 'object' ? (oe as Record<string, unknown>).actions : undefined;
        return Array.isArray(raw) ? (raw as FlowNodeLike[]) : [];
    }
    const cfg = node?.config;
    if (!cfg || typeof cfg !== 'object') return [];
    const c = cfg as Record<string, unknown>;
    const caseIdx = caseBranchIndex(branch);
    if (caseIdx !== null) {
        const cases = Array.isArray(c.cases) ? c.cases : [];
        const one = cases[caseIdx] as { actions?: unknown } | undefined;
        return one && Array.isArray(one.actions) ? (one.actions as FlowNodeLike[]) : [];
    }
    const raw = c[FLOW_BRANCH_KEYS[branch as 'then' | 'else' | 'each' | 'default']];
    return Array.isArray(raw) ? (raw as FlowNodeLike[]) : [];
}

/** Una lista de acciones hija de un paso, con su rama. */
export interface FlowChildList {
    branch: FlowBranch;
    actions: unknown[];
}

/**
 * Todas las listas de acciones hijas de un paso, según su tipo: las ramas del
 * si/sino, el cuerpo del bucle, las ramas y «En otro caso» de «Según el valor
 * de…» y la rama «Si falla». Son las MISMAS listas (no copias): quien recorre
 * para cambiar algo en el lugar puede mutar sus elementos.
 */
/**
 * v0.1.460 — La rama en palabras, para armar ubicaciones legibles en los
 * mensajes («Acción 2.sí.1», «Acción 3.rama 2.1», «Acción 4.si falla.1»).
 */
export function flowBranchWord(branch: FlowBranch): string {
    if (branch === 'then') return 'sí';
    if (branch === 'else') return 'no';
    if (branch === 'each') return 'cada';
    if (branch === 'default') return 'en otro caso';
    if (branch === 'fail') return 'si falla';
    const i = caseBranchIndex(branch);
    return i === null ? String(branch) : `rama ${i + 1}`;
}

export function flowChildLists(node: unknown): FlowChildList[] {
    if (!node || typeof node !== 'object') return [];
    const n = node as FlowNodeLike;
    const cfg = n.config && typeof n.config === 'object' ? (n.config as Record<string, unknown>) : {};
    const out: FlowChildList[] = [];
    if (n.type === 'if_else') {
        if (Array.isArray(cfg.then_actions)) out.push({ branch: 'then', actions: cfg.then_actions });
        if (Array.isArray(cfg.else_actions)) out.push({ branch: 'else', actions: cfg.else_actions });
    } else if (n.type === 'for_each_linked') {
        if (Array.isArray(cfg.actions)) out.push({ branch: 'each', actions: cfg.actions });
    } else if (n.type === 'switch') {
        const cases = Array.isArray(cfg.cases) ? cfg.cases : [];
        cases.forEach((c, i) => {
            const acts = c && typeof c === 'object' ? (c as Record<string, unknown>).actions : undefined;
            if (Array.isArray(acts)) out.push({ branch: caseBranch(i), actions: acts });
        });
        if (Array.isArray(cfg.default_actions)) out.push({ branch: 'default', actions: cfg.default_actions });
    }
    const oe = n.on_error;
    if (oe && typeof oe === 'object' && Array.isArray((oe as Record<string, unknown>).actions)) {
        out.push({ branch: 'fail', actions: (oe as Record<string, unknown>).actions as unknown[] });
    }
    return out;
}

/**
 * Una copia del paso con cada lista hija reemplazada por `fn(lista, rama)`
 * (para quien arma un árbol nuevo: traducir, enmascarar, normalizar).
 */
export function mapFlowChildLists<T>(node: T, fn: (actions: unknown[], branch: FlowBranch) => unknown[]): T {
    if (!node || typeof node !== 'object') return node;
    const n = node as FlowNodeLike & Record<string, unknown>;
    const kids = flowChildLists(n);
    if (kids.length === 0) return node;
    const cfg = n.config && typeof n.config === 'object' ? { ...(n.config as Record<string, unknown>) } : {};
    let onError = n.on_error && typeof n.on_error === 'object' ? { ...(n.on_error as Record<string, unknown>) } : undefined;
    const cases = Array.isArray(cfg.cases) ? [...cfg.cases] : undefined;
    for (const k of kids) {
        const next = fn(k.actions, k.branch);
        if (k.branch === 'fail' && onError) onError = { ...onError, actions: next };
        else if (k.branch === 'default') cfg.default_actions = next;
        else if (caseBranchIndex(k.branch) !== null && cases) {
            const i = caseBranchIndex(k.branch)!;
            cases[i] = { ...(cases[i] as Record<string, unknown>), actions: next };
        } else if (k.branch === 'then') cfg.then_actions = next;
        else if (k.branch === 'else') cfg.else_actions = next;
        else if (k.branch === 'each') cfg.actions = next;
    }
    if (cases) cfg.cases = cases;
    const out: Record<string, unknown> = { ...n, config: cfg };
    if (onError) out.on_error = onError;
    return out as T;
}

/**
 * Recorre TODOS los pasos de un árbol (también los de las ramas y de «Si
 * falla»), en orden, con su profundidad. Tope de profundidad para no
 * recorrer sin fin un JSON armado a mano.
 */
export function walkFlowSteps(actions: unknown, visit: (step: Record<string, unknown>, depth: number) => void, depth = 0): void {
    if (!Array.isArray(actions) || depth > 10) return;
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue;
        visit(a as Record<string, unknown>, depth);
        for (const k of flowChildLists(a)) walkFlowSteps(k.actions, visit, depth + 1);
    }
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
        if (!isFlowBranch(branch)) return undefined;
        seq = flowBranch(node, branch);
    }
    return undefined;
}

export function flowPathKey(path: FlowPath): string {
    return path.join('.');
}

/** Cuántas ramas hay en una ruta (la profundidad del paso). */
export function flowPathDepth(pathKey: string): number {
    if (pathKey === '') return 0;
    return pathKey.split('.').filter((p) => isFlowBranch(p)).length;
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
            if (!isFlowBranch(p)) return null;
            out.push(p);
        }
    }
    return out;
}

// ── «Esperar» ─────────────────────────────────────────────────────────────

export const WAIT_UNITS = ['minutes', 'hours', 'days'] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];
/**
 * v0.1.467 (E8) — `business_day` («hasta un día laborable») y
 * `business_hours` («hasta el horario laboral») dependen del horario laboral
 * de la empresa (`company-hours.ts`).
 */
export type WaitMode = 'duration' | 'until_field' | 'business_day' | 'business_hours';
export const WAIT_MODES: readonly WaitMode[] = ['duration', 'until_field', 'business_day', 'business_hours'];

/** ¿Este modo depende del horario laboral de la empresa? */
export function isBusinessWaitMode(mode: unknown): mode is 'business_day' | 'business_hours' {
    return mode === 'business_day' || mode === 'business_hours';
}

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
    /**
     * «A las 9:00 de ese día» (en la zona de la empresa). En `business_day`,
     * la hora a la que sigue el próximo día laborable (sin ella, la de apertura).
     */
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
        mode: (WAIT_MODES as readonly unknown[]).includes(c.mode) ? (c.mode as WaitMode) : 'duration',
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
    // Las del horario laboral no necesitan nada más (la hora es opcional).
    if (isBusinessWaitMode(w.mode)) return null;
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
    /**
     * `immediate` (sólo los modos del horario laboral): ya es horario laboral
     * o día laborable — la corrida sigue en el acto, sin pausarse.
     */
    | { ok: true; at: Date; immediate?: 'open' | 'workday' }
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
    input: {
        now: Date;
        timeZone?: string | null;
        field?: { label?: string; value: unknown } | null;
        /**
         * v0.1.467 — el horario laboral de la empresa ya armado (con sus
         * festivos), para los modos `business_*`. Sin él se usa el de fábrica
         * sin festivos (el motor siempre lo pasa).
         */
        business?: CompanyCalendar | null;
    },
): WaitTarget {
    const w = readWaitConfig(cfg);
    const tz = isValidTimeZone(input.timeZone) ? input.timeZone : FALLBACK_TIME_ZONE;
    const problem = waitConfigProblem(cfg);
    if (problem) return { ok: false, reason: 'config', message: problem };

    let at: Date;
    if (isBusinessWaitMode(w.mode)) {
        const cal = input.business ?? companyCalendar(defaultCompanyHours(tz), tz);
        const target = companyWaitTarget(cal, w.mode, input.now, w.mode === 'business_day' ? w.atTime : null);
        if (!target) {
            return { ok: false, reason: 'config', message: 'El horario laboral de la empresa no tiene días laborables en el próximo año: revísalo en Ajustes → Horario laboral.' };
        }
        if (target.immediate) return { ok: true, at: target.at, immediate: w.mode === 'business_hours' ? 'open' : 'workday' };
        at = target.at;
    } else if (w.mode === 'duration') {
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
    const clock = (t: { h: number; m: number }): string => `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
    if (w.mode === 'business_hours') return 'Espera hasta el horario laboral';
    if (w.mode === 'business_day') return w.atTime ? `Espera hasta un día laborable a las ${clock(w.atTime)}` : 'Espera hasta un día laborable';
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
