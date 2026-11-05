/**
 * v0.1.351 — Lógica PURA de los formularios (condiciones y páginas), sin
 * Zod: la usan el servidor, el constructor y el cliente de la página pública
 * (que se compila aparte y tiene que pesar poco). Antes el cliente tenía una
 * copia escrita a mano en ES5; ahora importa ésta.
 */

/** Lo que hace falta de una condición «mostrar sólo si…». */
export interface FormConditionLike {
    field_id: number;
    op: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'lt' | 'is_empty' | 'is_not_empty';
    value?: unknown;
}
type FormCondition = FormConditionLike;

/**
 * v0.1.357 — Una regla sobre un cálculo del formulario («si el puntaje es
 * mayor que 7»). Sólo en saltos y pantallas finales.
 */
export interface FormCalcConditionLike {
    calc: string;
    op: 'eq' | 'neq' | 'gt' | 'lt';
    value?: unknown;
}

/** Una regla: sobre una pregunta o (v0.1.357) sobre un cálculo. */
export type FormRuleLike = FormConditionLike | FormCalcConditionLike;

/** v0.1.357 — ¿Es una regla sobre un cálculo? */
export function isFormCalcRule(r: FormRuleLike | null | undefined): r is FormCalcConditionLike {
    return !!r && typeof (r as FormCalcConditionLike).calc === 'string';
}

/**
 * v0.1.356 — Varias condiciones juntas: se cumplen TODAS (`all`) o ALGUNA
 * (`any`). Una condición suelta (lo de siempre) vale igual que un grupo de
 * una sola regla.
 */
export interface FormConditionGroupLike {
    match: 'all' | 'any';
    rules: ReadonlyArray<FormRuleLike>;
}
export type FormShowIfLike = FormRuleLike | FormConditionGroupLike;

/** v0.1.357 — Cómo se guarda el valor de un cálculo junto a las respuestas (`calc:puntaje`). */
export const FORM_CALC_VALUE_PREFIX = 'calc:';

/** ¿Es un grupo de condiciones (y no una condición suelta)? */
export function isFormConditionGroup(c: FormShowIfLike | null | undefined): c is FormConditionGroupLike {
    return !!c && typeof c === 'object' && Array.isArray((c as FormConditionGroupLike).rules);
}

/** Las reglas de una condición o de un grupo, en una lista. */
export function formConditionRules(c: FormShowIfLike | null | undefined): FormRuleLike[] {
    if (!c) return [];
    return isFormConditionGroup(c) ? [...c.rules] : [c];
}

/** Los campos de los que depende una condición o un grupo (sin los cálculos). */
export function formConditionFieldIds(c: FormShowIfLike | null | undefined): number[] {
    const out = new Set<number>();
    for (const r of formConditionRules(c)) if (!isFormCalcRule(r)) out.add(r.field_id);
    return [...out];
}

/** v0.1.357 — Los cálculos de los que depende una condición o un grupo. */
export function formConditionCalcKeys(c: FormShowIfLike | null | undefined): string[] {
    const out = new Set<string>();
    for (const r of formConditionRules(c)) if (isFormCalcRule(r)) out.add(r.calc);
    return [...out];
}

/** ¿Está vacío este valor como respuesta? (casilla sin marcar cuenta como vacía). */
export function isEmptyAnswer(value: unknown): boolean {
    if (value === null || value === undefined || value === false) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/** v0.1.355 — ¿Respondió esta pregunta? En «Sí / No», el «No» (false) también es una respuesta. */
export function formAnswered(display: string | undefined, value: unknown): boolean {
    if (display === 'yes_no') return value === true || value === false;
    return !isEmptyAnswer(value);
}

function asNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/** v0.1.357 — Una regla sobre un cálculo: compara números (un cálculo que no se pudo hacer no cumple nada). */
function evaluateCalcRule(rule: FormCalcConditionLike, value: unknown): boolean {
    const a = asNumber(value);
    const b = asNumber(rule.value);
    if (a === null || b === null) return false;
    switch (rule.op) {
        case 'eq':
            return Math.abs(a - b) < 1e-9;
        case 'neq':
            return Math.abs(a - b) >= 1e-9;
        case 'gt':
            return a > b;
        case 'lt':
            return a < b;
        default:
            return false;
    }
}

/** Evalúa una condición contra la respuesta actual del campo que controla. */
export function evaluateFormCondition(cond: FormCondition, answer: unknown): boolean {
    const empty = isEmptyAnswer(answer);
    switch (cond.op) {
        case 'is_empty':
            return empty;
        case 'is_not_empty':
            return !empty;
        case 'eq':
        case 'neq': {
            let match: boolean;
            if (Array.isArray(answer)) match = answer.map(String).includes(String(cond.value));
            else if (typeof answer === 'boolean') match = answer === (cond.value === true || cond.value === 'true');
            else match = !empty && String(answer).trim().toLowerCase() === String(cond.value ?? '').trim().toLowerCase();
            return cond.op === 'eq' ? match : !match;
        }
        case 'in': {
            const wanted = Array.isArray(cond.value) ? cond.value.map(String) : [];
            if (wanted.length === 0) return false;
            if (Array.isArray(answer)) return answer.some((a) => wanted.includes(String(a)));
            return !empty && wanted.includes(String(answer));
        }
        case 'contains':
            if (empty) return false;
            if (Array.isArray(answer)) return answer.map(String).includes(String(cond.value));
            return String(answer).toLowerCase().includes(String(cond.value ?? '').toLowerCase());
        case 'gt':
        case 'lt': {
            const a = asNumber(answer);
            const b = asNumber(cond.value);
            if (a === null || b === null) return false;
            return cond.op === 'gt' ? a > b : a < b;
        }
        default:
            return false;
    }
}

/**
 * ¿Se muestra este ítem con las respuestas actuales? Un ítem cuyo campo de
 * control está OCULTO (por su propia condición) no se muestra: si no, una
 * respuesta escrita y después escondida seguiría abriendo preguntas.
 * `values` va por id de campo (texto). Las cadenas se cortan a 20 niveles.
 */
/** v0.1.355 — Una fila de matriz (guardada: `field_id`; pública: `key`). */
interface MatrixRowLike {
    field_id?: number;
    key?: string;
}
interface LogicItemLike {
    type: string;
    field_id?: number;
    /** v0.1.355 — las filas de una matriz (cada una es un campo). */
    rows?: ReadonlyArray<MatrixRowLike>;
    show_if: FormShowIfLike | null;
}

/** v0.1.355 — El ítem que pregunta este campo: una pregunta o una fila de una matriz. */
export function formControllerOf<T extends LogicItemLike>(items: ReadonlyArray<T>, fieldId: number): T | undefined {
    return items.find(
        (i) =>
            (i.type === 'field' && i.field_id === fieldId) ||
            (i.type === 'matrix' && Array.isArray(i.rows) && i.rows.some((r) => (r.field_id ?? Number(r.key)) === fieldId)),
    );
}

export function formItemVisible<T extends LogicItemLike>(
    item: { show_if: FormShowIfLike | null },
    items: ReadonlyArray<T>,
    values: Record<string, unknown>,
    depth = 0,
    /**
     * v0.1.356 — ¿La pregunta que controla está en una página por la que
     * pasó la persona? (Con saltos de página, una respuesta de una página que
     * se saltó no cuenta, aunque haya quedado escrita de antes.)
     */
    reachable?: (controller: T) => boolean,
): boolean {
    const cond = item.show_if;
    if (!cond) return true;
    if (depth > 20) return false;
    return formConditionMet(cond, items, values, depth, reachable);
}

/**
 * v0.1.356 — ¿Se cumple esta condición (o grupo) con las respuestas
 * actuales? Cada regla exige que la pregunta que la controla esté en el
 * formulario, a la vista y (si se pasa `reachable`) en el camino recorrido.
 * Un grupo vacío se cumple.
 */
export function formConditionMet<T extends LogicItemLike>(
    cond: FormShowIfLike,
    items: ReadonlyArray<T>,
    values: Record<string, unknown>,
    depth = 0,
    reachable?: (controller: T) => boolean,
): boolean {
    const rules = formConditionRules(cond);
    if (rules.length === 0) return true;
    const one = (rule: FormRuleLike): boolean => {
        // v0.1.357 — un cálculo: su valor viaja junto a las respuestas (`calc:puntaje`).
        if (isFormCalcRule(rule)) return evaluateCalcRule(rule, values[FORM_CALC_VALUE_PREFIX + rule.calc]);
        const controller = formControllerOf(items, rule.field_id);
        // Una condición sobre un campo que ya no está en el formulario no se cumple.
        if (!controller) return false;
        if (reachable && !reachable(controller)) return false;
        if (!formItemVisible(controller, items, values, depth + 1, reachable)) return false;
        return evaluateFormCondition(rule, values[String(rule.field_id)]);
    };
    return isFormConditionGroup(cond) && cond.match === 'any' ? rules.some(one) : rules.every(one);
}

// ─────────────────────── Varias páginas (v0.1.289) ───────────────────────

/** Una página del formulario: los ítems entre dos saltos de página. */
export interface FormPage<T> {
    /** Id del salto de página que la abre (null = la primera, antes de cualquier salto). */
    break_id: string | null;
    title: string;
    items: T[];
}

/**
 * Parte los ítems en páginas por los saltos. Un salto al principio, al final
 * o dos seguidos no dejan páginas vacías: una página sin ítems no existe.
 * Sin saltos hay UNA página (el formulario de siempre).
 */
export function splitFormPages<T extends { id: string; type: string; title?: string }>(items: readonly T[]): Array<FormPage<T>> {
    const pages: Array<FormPage<T>> = [];
    let current: FormPage<T> = { break_id: null, title: '', items: [] };
    for (const item of items) {
        if (item.type === 'page_break') {
            if (current.items.length > 0) pages.push(current);
            current = { break_id: item.id, title: typeof item.title === 'string' ? item.title : '', items: [] };
            continue;
        }
        current.items.push(item);
    }
    if (current.items.length > 0 || pages.length === 0) pages.push(current);
    return pages;
}

/**
 * ¿Se muestra esta página con las respuestas actuales? Una página con
 * preguntas se muestra si al menos una está a la vista (no oculta y con su
 * condición cumplida); una página sólo de títulos/textos, si alguno se ve.
 * Así una página cuyas preguntas dependen de una respuesta anterior se salta
 * sola cuando no aplica. Acepta los ítems guardados (`field_id`) y los
 * públicos (`key`, el id del campo como texto).
 */
export function formPageVisible(
    page: { items: ReadonlyArray<{ type: string; hidden?: boolean; field_id?: number; key?: string; rows?: ReadonlyArray<MatrixRowLike>; show_if: FormShowIfLike | null }> },
    allItems: ReadonlyArray<{ type: string; field_id?: number; key?: string; rows?: ReadonlyArray<MatrixRowLike>; show_if: FormShowIfLike | null }>,
    values: Record<string, unknown>,
): boolean {
    const norm = allItems.map((i) => ({ ...i, field_id: i.field_id ?? (i.key !== undefined ? Number(i.key) : undefined) }));
    const questions = page.items.filter((i) => i.type === 'field' || i.type === 'matrix');
    if (questions.length > 0) return questions.some((i) => !i.hidden && formItemVisible(i, norm, values));
    return page.items.some((i) => formItemVisible(i, norm, values));
}

/** ¿El formulario tiene más de una página? */
export function formHasPages(items: ReadonlyArray<{ id: string; type: string }>): boolean {
    return splitFormPages(items).length > 1;
}

// ─────────────────────── Saltos y pantallas finales (v0.1.356) ───────────────────────

/** La primera página (la que va antes de cualquier salto). */
export const FORM_START_PAGE = 'start';
/** Destino de un salto que termina el formulario. */
export const FORM_JUMP_END = 'end';
/** Prefijo de un salto que termina en una pantalla final puntual. */
export const FORM_JUMP_ENDING_PREFIX = 'ending:';

/**
 * Un salto: al terminar la página `from` (`start` = la primera, si no el id
 * del salto de página que la abre), si se cumple `when` (null = siempre), ir
 * a la página `to` (el id de su salto de página), terminar (`end`) o
 * terminar en una pantalla final puntual (`ending:<id>`). Sólo hacia adelante.
 */
export interface FormJumpLike {
    from: string;
    when: FormShowIfLike | null;
    to: string;
}

type FlowItem = { id: string; type: string; title?: string; hidden?: boolean; field_id?: number; key?: string; rows?: ReadonlyArray<MatrixRowLike>; show_if: FormShowIfLike | null };

// ─────────────────────── Cálculos y puntaje (v0.1.357) ───────────────────────

/** Lo que aporta una pregunta a un cálculo (`key` = la clave de la respuesta, el id del campo como texto). */
export interface FormCalcPartLike {
    key: string;
    points: Readonly<Record<string, number>>;
    multiplier: number | null;
}

/** Un cálculo listo para hacerse (`parts` null = lo hace el servidor; aquí vale su inicio). */
export interface FormCalcLike {
    key: string;
    start: number;
    parts: ReadonlyArray<FormCalcPartLike> | null;
}

/**
 * v0.1.357 — Lo que suma una respuesta a un cálculo: los puntos de la opción
 * elegida (varias opciones se suman; Sí/No y la casilla son `true`/`false`;
 * una escala, su número como texto) o, si la pregunta tiene un factor, la
 * respuesta numérica multiplicada por él. Sin respuesta, nada.
 */
export function formCalcPartValue(part: FormCalcPartLike, answer: unknown): number {
    const pts = (k: string): number => {
        const v = part.points[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    };
    if (answer === null || answer === undefined) return 0;
    if (typeof answer === 'boolean') return pts(String(answer));
    if (Array.isArray(answer)) return answer.reduce<number>((acc, a) => acc + pts(String(a)), 0);
    if (part.multiplier !== null && part.multiplier !== undefined) {
        const n = asNumber(answer);
        return n === null ? 0 : n * part.multiplier;
    }
    if (typeof answer === 'number') return pts(String(answer));
    if (typeof answer === 'string') return answer.trim() === '' ? 0 : pts(answer.trim());
    return 0;
}

/** Redondea a 6 decimales (así 0,1 + 0,2 da 0,3). */
function roundCalc(n: number): number {
    return Number.isFinite(n) ? Number(n.toFixed(6)) : 0;
}

/**
 * v0.1.357 — El valor de cada cálculo con las respuestas que CUENTAN (las de
 * las preguntas por las que pasó la persona y que se le mostraron). `counts`
 * decide por la clave de la respuesta.
 */
export function formCalcValues(calcs: ReadonlyArray<FormCalcLike>, values: Record<string, unknown>, counts: (key: string) => boolean): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of calcs) {
        let total = Number.isFinite(c.start) ? c.start : 0;
        for (const p of c.parts ?? []) if (counts(p.key)) total += formCalcPartValue(p, values[p.key]);
        out[c.key] = roundCalc(total);
    }
    return out;
}

/** Las respuestas más los cálculos (`calc:puntaje`), para evaluar las reglas que miran un cálculo. */
export function withFormCalcValues(values: Record<string, unknown>, calcs: Record<string, number>): Record<string, unknown> {
    const keys = Object.keys(calcs);
    if (keys.length === 0) return values;
    const out: Record<string, unknown> = { ...values };
    for (const k of keys) out[FORM_CALC_VALUE_PREFIX + k] = calcs[k];
    return out;
}

/** El recorrido de una persona por el formulario con sus respuestas actuales. */
export interface FormFlow {
    /** Las páginas del formulario (los ítems con `field_id` normalizado). */
    pages: Array<FormPage<FlowItem & { field_id?: number }>>;
    /** Índices de las páginas por las que pasa, en orden. */
    path: number[];
    /** ¿Este ítem (por id) se le muestra? (página recorrida + su condición). */
    shown: (id: string) => boolean;
    /** Un salto la mandó a una pantalla final puntual (su id), o null. */
    endingId: string | null;
    /** ¿Un salto terminó el formulario antes de la última página? */
    endedEarly: boolean;
    /** v0.1.357 — El valor de cada cálculo con las respuestas del camino. */
    calcs: Record<string, number>;
}

/**
 * v0.1.356 — El camino por las páginas. Empieza en la primera; una página
 * sin preguntas a la vista se salta sola (como siempre); al terminar una
 * página se mira su primer salto que se cumple. Las preguntas de una página
 * por la que NO pasó no cuentan: ni se piden, ni se guardan, ni sirven de
 * condición. Lo usan la página pública (para «Siguiente» y el avance) y el
 * servidor (para saber qué respuestas aceptar) — la misma función.
 */
export function formFlow(
    items: ReadonlyArray<FlowItem>,
    values: Record<string, unknown>,
    jumps: ReadonlyArray<FormJumpLike> = [],
    /** v0.1.357 — Los cálculos (un salto puede mirar el puntaje que se lleva hasta esa página). */
    calcs: ReadonlyArray<FormCalcLike> = [],
): FormFlow {
    const norm = items.map((i) => ({ ...i, field_id: i.field_id ?? (i.key !== undefined ? Number(i.key) : undefined) }));
    const pages = splitFormPages(norm);
    const reach = new Set<(typeof norm)[number]>();
    const isReachable = (c: (typeof norm)[number]): boolean => reach.has(c);
    // v0.1.357 — una respuesta cuenta en un cálculo si su pregunta está en el camino y a la vista.
    const counts = (key: string): boolean => {
        const ctl = formControllerOf(norm, Number(key));
        return !!ctl && reach.has(ctl) && formItemVisible(ctl, norm, values, 0, isReachable);
    };
    const calcNow = (): Record<string, number> => formCalcValues(calcs, values, counts);
    const path: number[] = [];
    let endingId: string | null = null;
    let endedEarly = false;
    let i = 0;
    let guard = 0;
    while (i < pages.length && guard++ < 500) {
        const page = pages[i]!;
        for (const it of page.items) reach.add(it);
        const questions = page.items.filter((it) => it.type === 'field' || it.type === 'matrix');
        const pageShown =
            questions.length > 0
                ? questions.some((it) => !it.hidden && formItemVisible(it, norm, values, 0, isReachable))
                : page.items.some((it) => formItemVisible(it, norm, values, 0, isReachable));
        if (!pageShown) {
            for (const it of page.items) reach.delete(it);
            i++;
            continue;
        }
        path.push(i);
        const key = page.break_id ?? FORM_START_PAGE;
        const here = jumps.filter((j) => j.from === key);
        // Los cálculos se hacen sólo si algún salto de esta página los mira.
        const jv = here.some((j) => formConditionCalcKeys(j.when).length > 0) ? withFormCalcValues(values, calcNow()) : values;
        const jump = here.find((j) => !j.when || formConditionMet(j.when, norm, jv, 0, isReachable));
        if (jump) {
            if (jump.to === FORM_JUMP_END || jump.to.startsWith(FORM_JUMP_ENDING_PREFIX)) {
                endedEarly = i < pages.length - 1;
                if (jump.to !== FORM_JUMP_END) endingId = jump.to.slice(FORM_JUMP_ENDING_PREFIX.length);
                break;
            }
            const target = pages.findIndex((p) => p.break_id === jump.to);
            if (target > i) {
                i = target;
                continue;
            }
        }
        i++;
    }
    const byId = new Map(norm.map((n) => [n.id, n]));
    return {
        pages,
        path,
        endingId,
        endedEarly,
        calcs: calcNow(),
        shown: (id) => {
            const it = byId.get(id);
            return !!it && reach.has(it) && formItemVisible(it, norm, values, 0, isReachable);
        },
    };
}

/**
 * v0.1.356 — La pantalla final que corresponde: la que pidió un salto, si
 * no la primera cuya condición se cumple (con las preguntas del camino), y
 * si ninguna, null (= el «¡Gracias!» del formulario). Una pantalla sin
 * condición sólo se muestra si un salto lleva a ella.
 */
export function formEndingFor<E extends { id: string; when: FormShowIfLike | null }>(
    endings: ReadonlyArray<E>,
    items: ReadonlyArray<FlowItem>,
    values: Record<string, unknown>,
    flow: FormFlow,
): E | null {
    if (flow.endingId) {
        const hit = endings.find((e) => e.id === flow.endingId);
        if (hit) return hit;
    }
    const norm = items.map((i) => ({ ...i, field_id: i.field_id ?? (i.key !== undefined ? Number(i.key) : undefined) }));
    const reachIds = new Set(norm.filter((n) => flow.shown(n.id) || n.hidden).map((n) => n.id));
    // v0.1.357 — una pantalla final puede mirar un cálculo («si el puntaje es mayor que 7»).
    const v = withFormCalcValues(values, flow.calcs);
    return endings.find((e) => !!e.when && formConditionRules(e.when).length > 0 && formConditionMet(e.when, norm, v, 0, (c) => reachIds.has(c.id))) ?? null;
}

// ─────────────────────── Recordar respuestas (v0.1.356) ───────────────────────

/**
 * `{{nombre}}` o `{{nombre|amigo}}` (lo de después de la barra se usa si no
 * respondió). El nombre es el nombre interno del campo.
 */
export const FORM_RECALL_RE = /\{\{\s*([a-z][a-z0-9_]{0,62})\s*(?:\|([^{}]{0,80}))?\}\}/g;

/** Los nombres que aparecen en un texto. */
export function formRecallSlugs(text: string): string[] {
    const out = new Set<string>();
    for (const m of String(text ?? '').matchAll(FORM_RECALL_RE)) out.add(m[1]!);
    return [...out];
}

/** Reemplaza cada `{{nombre}}` con su respuesta (o lo de después de la barra). */
export function formRecallText(text: string, resolve: (slug: string) => string): string {
    return String(text ?? '').replace(FORM_RECALL_RE, (_m, slug: string, fallback?: string) => {
        const v = resolve(slug);
        return v !== '' ? v : (fallback ?? '').trim();
    });
}

/** Lo que hace falta de una pregunta pública para escribir su respuesta. */
export interface RecallItemLike {
    type: string;
    key?: string;
    field_type?: string;
    display?: string;
    options?: ReadonlyArray<{ value: string; label: string }>;
    yes_label?: string;
    no_label?: string;
    rows?: ReadonlyArray<{ key: string; values: ReadonlyArray<string | number | null> }>;
    /** En una matriz, sus columnas (en una pregunta es otra cosa: cuántas columnas de opciones). */
    columns?: ReadonlyArray<{ label: string }> | number | null;
}

/**
 * La respuesta de un campo como la leería una persona: la etiqueta de la
 * opción (no su valor interno), «Sí»/«No», varias opciones separadas por
 * coma, números con el formato que se pase.
 */
export function formAnswerText(items: ReadonlyArray<RecallItemLike>, key: string, values: Record<string, unknown>, fmtNumber: (n: number) => string = String): string {
    const v = values[key];
    if (v === null || v === undefined) return '';
    const q = items.find((i) => i.type === 'field' && i.key === key);
    if (!q) {
        // Una fila de una matriz: la etiqueta de la columna elegida.
        const m = items.find((i) => i.type === 'matrix' && (i.rows ?? []).some((r) => r.key === key));
        if (m) {
            const row = m.rows!.find((r) => r.key === key)!;
            const label = (one: unknown): string => {
                const idx = row.values.findIndex((x) => x !== null && String(x) === String(one));
                const cols = Array.isArray(m.columns) ? m.columns : [];
                return idx >= 0 ? (cols[idx]?.label ?? String(one)) : String(one);
            };
            return Array.isArray(v) ? v.map(label).join(', ') : label(v);
        }
    }
    const opt = (x: unknown): string => q?.options?.find((o) => o.value === String(x))?.label ?? String(x);
    if (typeof v === 'boolean') {
        if (q?.display === 'yes_no') return v ? q.yes_label || 'Sí' : q.no_label || 'No';
        return v ? 'Sí' : 'No';
    }
    if (Array.isArray(v)) return v.map(opt).filter((x) => x !== '').join(', ');
    if (typeof v === 'number') return Number.isFinite(v) ? fmtNumber(v) : '';
    if (typeof v === 'string') return q?.options?.length ? opt(v.trim()) : v.trim();
    return '';
}

// ─────────────────────── Escalas y deslizadores (v0.1.355) ───────────────────────

/** Una escala de botones tiene como mucho 11 (de 0 a 10, como el NPS). */
export const FORM_SCALE_MAX_BUTTONS = 11;

/** Lo que hace falta de un rango ya resuelto (`resolveFormRange`). */
export interface FormRangeLike {
    min: number;
    max: number;
    step: number;
}

/** Los valores de los botones de una escala (de `min` a `max` de a `step`). */
export function formScaleValues(range: FormRangeLike): number[] {
    const out: number[] = [];
    for (let i = 0; i < FORM_SCALE_MAX_BUTTONS; i++) {
        const v = Number((range.min + range.step * i).toFixed(6));
        if (v > range.max + 1e-9) break;
        out.push(v);
    }
    return out;
}

/** ¿Este número entra en la escala o el deslizador? */
export function formRangeAccepts(kind: 'scale' | 'slider', range: FormRangeLike, value: unknown): boolean {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(n)) return false;
    if (kind === 'scale') return formScaleValues(range).some((v) => Math.abs(v - n) < 1e-6);
    return n >= range.min - 1e-9 && n <= range.max + 1e-9;
}

/** v0.1.356 — Un número con los separadores de la empresa («1.500.000,5»). */
export function formatFormNumber(n: number, fmt: 'comma_dot' | 'dot_comma' | 'space_comma' = 'comma_dot'): string {
    if (!Number.isFinite(n)) return '';
    const [int, dec] = String(Math.abs(n)).split('.');
    const sep = fmt === 'comma_dot' ? ',' : fmt === 'dot_comma' ? '.' : ' ';
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    const decSep = fmt === 'comma_dot' ? '.' : ',';
    return `${n < 0 ? '-' : ''}${grouped}${dec ? decSep + dec : ''}`;
}

/** v0.1.361 — El monto más alto que puede cobrar un formulario. */
export const FORM_PAYMENT_MAX_AMOUNT = 1_000_000_000;

/** v0.1.361 — De dónde sale el monto de un cobro al enviar (el subconjunto que usa el cálculo). */
export interface FormPaymentAmountRule {
    source: 'fixed' | 'calc' | 'field';
    amount: number | null;
    calc_key: string | null;
    min: number | null;
    max: number | null;
}

/**
 * v0.1.361 — El monto a cobrar con lo que respondió la persona: el fijo, el
 * resultado del cálculo o la respuesta de la pregunta (que tiene que estar
 * entre el mínimo y el máximo). Redondeado a centavos; 0 = no se cobra.
 * La usan el servidor (que manda) y la página (para mostrar el total).
 */
export function formPaymentAmount(
    payment: FormPaymentAmountRule,
    input: { calcs: Record<string, number>; fieldValue: unknown },
): { amount: number } | { error: 'below_min' | 'above_max' } {
    let raw = 0;
    if (payment.source === 'fixed') raw = payment.amount ?? 0;
    else if (payment.source === 'calc') raw = (payment.calc_key !== null ? input.calcs[payment.calc_key] : undefined) ?? 0;
    else {
        const v = typeof input.fieldValue === 'number' ? input.fieldValue : typeof input.fieldValue === 'string' && input.fieldValue.trim() !== '' ? Number(input.fieldValue) : 0;
        raw = Number.isFinite(v) ? v : 0;
        if (raw > 0 && payment.min !== null && raw < payment.min) return { error: 'below_min' };
        if (payment.max !== null && raw > payment.max) return { error: 'above_max' };
    }
    if (!Number.isFinite(raw) || raw <= 0) return { amount: 0 };
    return { amount: Math.min(FORM_PAYMENT_MAX_AMOUNT, Math.round(raw * 100) / 100) };
}

/**
 * v0.1.368 — «cada mes» / «cada 3 meses» / «cada año» / «cada 15 días»: cada
 * cuánto cobra un plan de suscripción. La usan la página del formulario, la de
 * confirmación y la ficha (un solo texto en toda la app).
 */
export function subscriptionFrequencyText(frequency: number, type: 'months' | 'days'): string {
    const n = Math.max(1, Math.floor(frequency));
    if (type === 'days') return n === 1 ? 'cada día' : `cada ${n} días`;
    if (n === 1) return 'cada mes';
    if (n === 12) return 'cada año';
    return `cada ${n} meses`;
}

/** v0.1.368 — Lo que se ve debajo del nombre de un plan: «7 días gratis · 12 cuotas». */
export function subscriptionPlanExtras(plan: { trial_days: number; cycles: number | null }): string {
    const out: string[] = [];
    if (plan.trial_days > 0) out.push(plan.trial_days === 1 ? '1 día gratis' : `${plan.trial_days} días gratis`);
    if (plan.cycles !== null && plan.cycles > 0) out.push(plan.cycles === 1 ? '1 cobro' : `${plan.cycles} cobros`);
    return out.join(' · ');
}
