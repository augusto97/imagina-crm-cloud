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
    show_if: FormCondition | null;
}

/** v0.1.355 — El ítem que pregunta este campo: una pregunta o una fila de una matriz. */
export function formControllerOf<T extends LogicItemLike>(items: ReadonlyArray<T>, fieldId: number): T | undefined {
    return items.find(
        (i) =>
            (i.type === 'field' && i.field_id === fieldId) ||
            (i.type === 'matrix' && Array.isArray(i.rows) && i.rows.some((r) => (r.field_id ?? Number(r.key)) === fieldId)),
    );
}

export function formItemVisible(
    item: { show_if: FormCondition | null },
    items: ReadonlyArray<LogicItemLike>,
    values: Record<string, unknown>,
    depth = 0,
): boolean {
    const cond = item.show_if;
    if (!cond) return true;
    if (depth > 20) return false;
    const controller = formControllerOf(items, cond.field_id);
    // Una condición sobre un campo que ya no está en el formulario no se cumple.
    if (!controller) return false;
    if (!formItemVisible(controller, items, values, depth + 1)) return false;
    return evaluateFormCondition(cond, values[String(cond.field_id)]);
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
    page: { items: ReadonlyArray<{ type: string; hidden?: boolean; field_id?: number; key?: string; rows?: ReadonlyArray<MatrixRowLike>; show_if: FormCondition | null }> },
    allItems: ReadonlyArray<{ type: string; field_id?: number; key?: string; rows?: ReadonlyArray<MatrixRowLike>; show_if: FormCondition | null }>,
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
