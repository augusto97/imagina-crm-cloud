/**
 * v0.1.466 — Dos pasos nuevos de las automatizaciones (ideas E9 y E10).
 *
 *  - «Comprobar y detener si no se cumple» (`stop_unless`): una condición (el
 *    MISMO shape y el MISMO evaluador que la condición de cada paso y que
 *    «Si / Entonces / Si no») evaluada sobre el registro TAL COMO QUEDÓ después
 *    de los pasos anteriores. Si no se cumple, la corrida termina ahí (como la
 *    espera con «Continuar sólo si…»): no es una falla ni abre un Problema.
 *    Dentro de «Repetir por cada registro vinculado» corta sólo los pasos de
 *    ESE vinculado y la repetición sigue con el próximo; en cualquier otro
 *    lugar (también dentro de una rama) detiene toda la automatización.
 *  - «Agregar un comentario» (`add_comment`): un comentario con variables en
 *    el registro (o, dentro de una repetición, en el vinculado), como nota
 *    interna o visible para el cliente. Lo firma la automatización —una marca
 *    del servidor que nadie puede fabricar— y nunca dispara «Cuando se agrega
 *    un comentario» (evita bucles).
 *
 * Todo puro y sin zod: lo usan el motor, el editor y el asistente. Lo guardado
 * se lee con tolerancia (un valor raro cae al default, nunca rompe la corrida).
 */

export const STOP_UNLESS_ACTION = 'stop_unless';
export const ADD_COMMENT_ACTION = 'add_comment';

/** El texto de un comentario (el mismo tope que el de una persona). */
export const ADD_COMMENT_MAX_BODY = 10000;

/** Operadores sin valor (vacío / tiene valor). */
const NO_VALUE_OPS = ['is_null', 'is_not_null', 'is_empty', 'is_not_empty'];

/** Una regla de la condición de «Comprobar y detener». */
export interface StopUnlessRule {
    field: string;
    op: string;
    value: unknown;
}

/**
 * Las reglas guardadas en `config.condition` (`[{field|slug, op, value}]`,
 * unidas por «y»). Las que no tienen campo se ignoran.
 */
export function readStopUnlessRules(cfg: Record<string, unknown> | null | undefined): StopUnlessRule[] {
    const raw = cfg?.condition;
    if (!Array.isArray(raw)) return [];
    const out: StopUnlessRule[] = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const rule = r as { field?: unknown; slug?: unknown; op?: unknown; value?: unknown };
        const field = String(rule.field ?? rule.slug ?? '').trim();
        if (field === '') continue;
        out.push({ field, op: typeof rule.op === 'string' && rule.op !== '' ? rule.op : 'eq', value: rule.value ?? null });
    }
    return out;
}

/** Lo que le falta a «Comprobar y detener» para poder guardarse (vacío = listo). */
export function stopUnlessIssues(cfg: Record<string, unknown>, at: string): Array<{ path: string; message: string }> {
    if (readStopUnlessRules(cfg).length > 0) return [];
    return [
        {
            path: `${at}.config.condition`,
            message: 'Agrega al menos una regla a «Comprobar y detener»: si no se cumplen todas, la automatización se detiene ahí.',
        },
    ];
}

/** Cómo se lee un operador de una condición («es», «no contiene», «está vacío»…). */
export const CONDITION_OP_TEXT: Record<string, string> = {
    eq: 'es',
    equals: 'es',
    neq: 'no es',
    not_equals: 'no es',
    contains: 'contiene',
    not_contains: 'no contiene',
    starts_with: 'empieza con',
    ends_with: 'termina con',
    in: 'es alguno de',
    nin: 'no es ninguno de',
    not_in: 'no es ninguno de',
    gt: 'es mayor que',
    gte: 'es mayor o igual que',
    lt: 'es menor que',
    lte: 'es menor o igual que',
    is_null: 'está vacío',
    is_empty: 'está vacío',
    is_not_null: 'tiene valor',
    is_not_empty: 'tiene valor',
    between_relative: 'está en',
    changed: 'cambió',
};

/**
 * Una regla en palabras: «Estado» es «Pendiente», «Monto» es mayor que «100»,
 * «Responsable» está vacío. `valueText` ya viene legible (la etiqueta de la
 * opción, no su valor interno).
 */
export function conditionRuleText(label: string, op: string, valueText: string): string {
    const opText = CONDITION_OP_TEXT[op] ?? op;
    if (NO_VALUE_OPS.includes(op)) return `«${label}» ${opText}`;
    return `«${label}» ${opText} «${valueText === '' ? '(vacío)' : valueText}»`;
}

/** Resumen de «Comprobar y detener» para el editor y el historial. */
export function describeStopUnless(rules: ReadonlyArray<{ label: string; op: string; valueText: string }>): string {
    if (rules.length === 0) return 'Falta elegir la condición';
    const first = conditionRuleText(rules[0]!.label, rules[0]!.op, rules[0]!.valueText);
    const more = rules.length > 1 ? ` y ${rules.length - 1} regla${rules.length - 1 === 1 ? '' : 's'} más` : '';
    return `Sigue sólo si ${first}${more}; si no, se detiene`;
}

// ── «Agregar un comentario» ──────────────────────────────────────────────

export type AddCommentVisibility = 'internal' | 'client';
export type AddCommentTarget = 'record' | 'item';

export interface AddCommentConfig {
    /** El texto con variables (`{{campo}}`, `@correo` para mencionar, `@equipo`). */
    body: string;
    /** `internal` = nota interna (por defecto); `client` = también la ve el cliente en su portal. */
    visibility: AddCommentVisibility;
    /** Dentro de una repetición: `item` = en el vinculado de esa vuelta; si no, en el que disparó. */
    target: AddCommentTarget;
}

export function readAddCommentConfig(cfg: Record<string, unknown> | null | undefined): AddCommentConfig {
    const c = cfg ?? {};
    return {
        body: typeof c.body === 'string' ? c.body.slice(0, ADD_COMMENT_MAX_BODY) : '',
        visibility: c.visibility === 'client' ? 'client' : 'internal',
        target: c.target === 'item' ? 'item' : 'record',
    };
}

/** Lo que le falta a «Agregar un comentario» para poder guardarse (vacío = listo). */
export function addCommentIssues(cfg: Record<string, unknown>, at: string, inLoop: boolean): Array<{ path: string; message: string }> {
    const out: Array<{ path: string; message: string }> = [];
    const body = typeof cfg.body === 'string' ? cfg.body : '';
    if (body.trim() === '') out.push({ path: `${at}.config.body`, message: 'Escribe el texto del comentario.' });
    else if (body.length > ADD_COMMENT_MAX_BODY) {
        out.push({ path: `${at}.config.body`, message: 'El comentario es demasiado largo (máximo 10.000 caracteres).' });
    }
    if (cfg.target === 'item' && !inLoop) {
        out.push({ path: `${at}.config.target`, message: '«El registro vinculado» sólo existe dentro de «Repetir por cada registro vinculado».' });
    }
    return out;
}

/** El nombre con el que se ve el autor de un comentario de una automatización. */
export function automationCommentAuthor(name: string | null | undefined): string {
    const n = (name ?? '').trim();
    return n === '' ? 'Automatización' : `Automatización «${n.length > 80 ? `${n.slice(0, 79)}…` : n}»`;
}

/**
 * La marca que el servidor deja en `comments.metadata.automation` (y que una
 * persona no puede escribir). Tolerante: sin marca válida, null.
 */
export function readAutomationCommentMark(metadata: unknown): { id: number; name: string } | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const raw = (metadata as { automation?: unknown }).automation;
    if (!raw || typeof raw !== 'object') return null;
    const id = Number((raw as { id?: unknown }).id);
    const name = (raw as { name?: unknown }).name;
    if (!Number.isInteger(id) || id <= 0) return null;
    return { id, name: typeof name === 'string' ? name : '' };
}
