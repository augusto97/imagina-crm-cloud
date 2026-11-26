/**
 * v0.1.460 — Automatizaciones, parte 2: tres piezas de control del flujo.
 *
 *  - «Preguntarle a la IA» (`ask_ai`): una instrucción con variables; la IA
 *    contesta con el tipo pedido (texto, una opción, un número, sí/no, una
 *    fecha o varios datos con nombre) y la respuesta queda para los pasos
 *    siguientes (`{{respuestas.ia.valor}}`) o se guarda en un campo.
 *  - «Según el valor de…» (`switch`): varias ramas por el valor de un campo o
 *    de una variable, más «En otro caso». Gana la primera que coincide.
 *  - «Si este paso falla» (`on_error`, al lado de `config` en cada paso):
 *    detener, seguir, reintentar o hacer otros pasos.
 *
 * Todo puro y sin zod: lo usan el motor, el editor y el asistente. Lo guardado
 * se lee con tolerancia (un valor raro cae al default, nunca rompe la corrida).
 */
import { evaluateConditionOp, type ConditionOptions } from '../field-types/conditions';
import { relativeDateLabel, relativeDateValueIssue } from '../field-types/date-ranges';
import { RESPONSE_NAME_RE } from './automation-flow';

export const SWITCH_ACTION = 'switch';
export const ASK_AI_ACTION = 'ask_ai';

function positiveInt(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function str(v: unknown, max: number): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Sin tildes, minúsculas y sin espacios de más (para comparar respuestas). */
export function foldAnswer(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[.\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── «Según el valor de…» ─────────────────────────────────────────────────

/** Cuántas ramas (sin contar «En otro caso») puede tener una automatización. */
export const SWITCH_MAX_CASES = 12;
export const SWITCH_LABEL_MAX = 60;

/** Operadores de una rama: el mismo vocabulario que las condiciones. */
export const SWITCH_OPS = [
    'eq',
    'neq',
    'in',
    'nin',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'gt',
    'gte',
    'lt',
    'lte',
    'is_null',
    'is_not_null',
    // v0.1.469 — una fecha: «este mes», «próximos 10 días», «hace más de 30 días».
    'between_relative',
] as const;
export type SwitchOp = (typeof SWITCH_OPS)[number];
export const SWITCH_OPS_WITHOUT_VALUE: readonly SwitchOp[] = ['is_null', 'is_not_null'];

export const SWITCH_OP_LABELS: Record<SwitchOp, string> = {
    eq: 'es',
    neq: 'no es',
    in: 'es alguno de',
    nin: 'no es ninguno de',
    contains: 'contiene',
    not_contains: 'no contiene',
    starts_with: 'empieza con',
    ends_with: 'termina con',
    gt: 'es mayor que',
    gte: 'es mayor o igual que',
    lt: 'es menor que',
    lte: 'es menor o igual que',
    is_null: 'está vacío',
    is_not_null: 'tiene un valor',
    between_relative: 'está en',
};

/** De dónde sale el valor que decide la rama: un campo (por id) o una variable. */
export type SwitchSource = { kind: 'field'; fieldId: number } | { kind: 'variable'; path: string } | { kind: 'none' };

export interface SwitchCase {
    label: string;
    op: SwitchOp;
    value: unknown;
    actions: unknown[];
}

export interface SwitchConfig {
    source: SwitchSource;
    cases: SwitchCase[];
    defaultActions: unknown[];
}

/** Una variable (`respuestas.ia.valor`, `payload.estado`), sin las llaves. */
export function cleanVariablePath(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const t = raw.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
    return /^[A-Za-z0-9_][A-Za-z0-9_.\-|]{0,119}$/.test(t) ? t : '';
}

export function readSwitchSource(cfg: Record<string, unknown> | null | undefined): SwitchSource {
    const c = cfg ?? {};
    const fieldId = positiveInt(c.source_field_id);
    if (fieldId !== null) return { kind: 'field', fieldId };
    const path = cleanVariablePath(c.source_variable);
    if (path !== '') return { kind: 'variable', path };
    return { kind: 'none' };
}

export function readSwitchConfig(cfg: Record<string, unknown> | null | undefined): SwitchConfig {
    const c = cfg ?? {};
    const cases: SwitchCase[] = [];
    for (const raw of Array.isArray(c.cases) ? c.cases.slice(0, SWITCH_MAX_CASES) : []) {
        const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const op = (SWITCH_OPS as readonly unknown[]).includes(r.op) ? (r.op as SwitchOp) : 'eq';
        cases.push({
            label: str(r.label, SWITCH_LABEL_MAX),
            op,
            value: r.value ?? null,
            actions: Array.isArray(r.actions) ? r.actions : [],
        });
    }
    return {
        source: readSwitchSource(c),
        cases,
        defaultActions: Array.isArray(c.default_actions) ? c.default_actions : [],
    };
}

/** Lo que se muestra de un valor en una rama («Pagada», «alguno de A, B»). */
export function switchValueText(value: unknown, labelOf?: (v: string) => string): string {
    const one = (v: unknown): string => {
        const s = v === null || v === undefined ? '' : String(v);
        return labelOf ? labelOf(s) : s;
    };
    if (Array.isArray(value)) return value.map(one).filter(Boolean).join(', ');
    return one(value);
}

/** El nombre de una rama: el que le pusieron o «<op> <valor>». */
export function switchCaseLabel(c: SwitchCase, index: number, labelOf?: (v: string) => string): string {
    if (c.label !== '') return c.label;
    if (SWITCH_OPS_WITHOUT_VALUE.includes(c.op)) return SWITCH_OP_LABELS[c.op].replace(/^./, (m) => m.toUpperCase());
    // v0.1.469 — «Próximos 10 días», «Hace más de 30 días», «Este mes».
    if (c.op === 'between_relative') return relativeDateLabel(c.value) ?? `Rama ${index + 1}`;
    const v = switchValueText(c.value, labelOf);
    if (v === '') return `Rama ${index + 1}`;
    return c.op === 'eq' ? v : `${SWITCH_OP_LABELS[c.op]} ${v}`;
}

/** Una regla de una rama evaluada (para que «Probar» diga POR QUÉ). */
export interface SwitchCaseCheck {
    index: number;
    label: string;
    ok: boolean;
}

/**
 * Qué rama toma «Según el valor de…»: la primera que coincide (−1 = «En otro
 * caso»). Usa el MISMO evaluador que las condiciones de las automatizaciones.
 */
export function pickSwitchCase(
    cases: readonly SwitchCase[],
    actual: unknown,
    opts: ConditionOptions = {},
    labelOf?: (v: string) => string,
): { index: number; checks: SwitchCaseCheck[] } {
    const checks: SwitchCaseCheck[] = [];
    for (const [i, c] of cases.entries()) {
        const ok = evaluateConditionOp(actual, c.op, c.value, opts);
        checks.push({ index: i, label: switchCaseLabel(c, i, labelOf), ok });
        if (ok) return { index: i, checks };
    }
    return { index: -1, checks };
}

/** El caso tiene lo que necesita (un valor, salvo «está vacío» / «tiene un valor»). */
function caseNeedsValue(c: SwitchCase): boolean {
    if (SWITCH_OPS_WITHOUT_VALUE.includes(c.op)) return false;
    const v = c.value;
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/** «Según «Estado»: 3 ramas y «En otro caso»». */
export function describeSwitch(cfg: Record<string, unknown> | null | undefined, sourceLabel?: string | null): string {
    const s = readSwitchConfig(cfg);
    const source =
        s.source.kind === 'none' ? null : s.source.kind === 'variable' ? `{{${s.source.path}}}` : sourceLabel ? `«${sourceLabel}»` : 'un campo';
    if (!source) return 'Según el valor de… (falta elegir de qué)';
    const n = s.cases.length;
    const other = s.defaultActions.length > 0 ? ' y «En otro caso»' : '';
    return `Según ${source}: ${n === 1 ? '1 rama' : `${n} ramas`}${other}`;
}

export interface ControlIssue {
    path: string;
    message: string;
}

export function switchIssues(cfg: Record<string, unknown> | null | undefined, at: string): ControlIssue[] {
    const s = readSwitchConfig(cfg);
    const out: ControlIssue[] = [];
    if (s.source.kind === 'none') out.push({ path: `${at}.config.source_field_id`, message: 'Elige el campo o la variable que decide la rama.' });
    const rawCases = Array.isArray(cfg?.cases) ? cfg!.cases : [];
    if (rawCases.length === 0) out.push({ path: `${at}.config.cases`, message: 'Agrega al menos una rama.' });
    if (rawCases.length > SWITCH_MAX_CASES) {
        out.push({ path: `${at}.config.cases`, message: `Puede haber como mucho ${SWITCH_MAX_CASES} ramas (más «En otro caso»).` });
    }
    s.cases.forEach((c, i) => {
        if (caseNeedsValue(c)) {
            out.push({ path: `${at}.config.cases.${i}.value`, message: `En la rama «${switchCaseLabel(c, i)}» falta el valor con el que se compara.` });
        } else if (c.op === 'between_relative') {
            const issue = relativeDateValueIssue(c.value);
            if (issue) out.push({ path: `${at}.config.cases.${i}.value`, message: `En la rama ${i + 1}: ${issue}` });
        }
    });
    return out;
}

// ── «Si este paso falla» ─────────────────────────────────────────────────

export const ON_ERROR_MODES = ['stop', 'continue', 'retry', 'steps'] as const;
export type OnErrorMode = (typeof ON_ERROR_MODES)[number];
/** Qué hacer si los reintentos se agotan. */
export type OnErrorFallback = 'stop' | 'continue' | 'steps';

export const ON_ERROR_MODE_LABELS: Record<OnErrorMode, string> = {
    stop: 'Detener la automatización',
    continue: 'Seguir con el resto',
    retry: 'Reintentar',
    steps: 'Hacer otros pasos',
};

/** Cuántas veces se puede reintentar un paso. */
export const ON_ERROR_RETRY_MAX = 3;
/** Cuántos pasos puede tener la rama «Si falla». */
export const ON_ERROR_MAX_STEPS = 10;

/**
 * Los pasos que llaman a otro servicio (y por eso pueden fallar por un rato):
 * webhooks, apps conectadas (WhatsApp, SMS, reuniones…), correos y la IA.
 * Reintentar un «Actualizar campo» no arregla nada: no se ofrece.
 */
export const RETRYABLE_ACTIONS: readonly string[] = ['call_webhook', 'connector_action', 'send_email', 'reply_email', 'ask_ai', 'request_signature'];

/**
 * Los contenedores no fallan por sí mismos: cada paso de adentro tiene lo suyo.
 * v0.1.466 — «Comprobar y detener» tampoco: si no se cumple, termina (no falla).
 */
export const ON_ERROR_EXEMPT_ACTIONS: readonly string[] = ['if_else', SWITCH_ACTION, 'stop_unless'];

/** Los pasos que no pueden ir dentro de «Si falla» (esperar no tiene un "después" claro). */
export const ON_ERROR_FORBIDDEN_INSIDE: readonly string[] = ['wait', 'wait_approval'];

/** Espera antes de cada reintento (crece: 3 s, 10 s, 30 s). */
export const ON_ERROR_RETRY_DELAYS_MS: readonly number[] = [3_000, 10_000, 30_000];

export interface OnErrorConfig {
    mode: OnErrorMode;
    /** Reintentos (1 a 3), sólo con `retry`. */
    retries: number;
    /** Si los reintentos se agotan. */
    ifStillFails: OnErrorFallback;
    /** La rama «Si falla» (con `steps`, o `retry` + `ifStillFails: steps`). */
    actions: unknown[];
    /** Después de la rama «Si falla»: seguir con el resto o terminar ahí. */
    afterSteps: 'continue' | 'stop';
}

export const DEFAULT_ON_ERROR: OnErrorConfig = { mode: 'stop', retries: 2, ifStillFails: 'stop', actions: [], afterSteps: 'stop' };

export function isRetryableAction(type: unknown): boolean {
    return typeof type === 'string' && RETRYABLE_ACTIONS.includes(type);
}

/** Lee `on_error` de un paso (sin nada, o algo raro, = detener). */
export function readOnError(raw: unknown): OnErrorConfig {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_ON_ERROR };
    const r = raw as Record<string, unknown>;
    const mode = (ON_ERROR_MODES as readonly unknown[]).includes(r.mode) ? (r.mode as OnErrorMode) : 'stop';
    const retries = Math.min(ON_ERROR_RETRY_MAX, Math.max(1, Math.round(Number(r.retries) || DEFAULT_ON_ERROR.retries)));
    const ifStillFails: OnErrorFallback = r.if_still_fails === 'continue' || r.if_still_fails === 'steps' ? r.if_still_fails : 'stop';
    return {
        mode,
        retries,
        ifStillFails,
        actions: Array.isArray(r.actions) ? r.actions : [],
        afterSteps: r.after_steps === 'continue' ? 'continue' : 'stop',
    };
}

/**
 * Lo que se hace cuando el paso falla DEFINITIVAMENTE (tras los reintentos,
 * si los hay): detener, seguir o la rama de pasos.
 */
export function onErrorFinal(cfg: OnErrorConfig): OnErrorFallback {
    return cfg.mode === 'retry' ? cfg.ifStillFails : cfg.mode;
}

/** ¿El paso usa la rama «Si falla»? */
export function onErrorUsesSteps(cfg: OnErrorConfig): boolean {
    return onErrorFinal(cfg) === 'steps';
}

/** Lo que se guarda (sin claves de más): undefined = el default (detener). */
export function writeOnError(cfg: OnErrorConfig): Record<string, unknown> | undefined {
    if (cfg.mode === 'stop') return undefined;
    const out: Record<string, unknown> = { mode: cfg.mode };
    if (cfg.mode === 'retry') {
        out.retries = cfg.retries;
        out.if_still_fails = cfg.ifStillFails;
    }
    if (onErrorUsesSteps(cfg)) {
        out.actions = cfg.actions;
        out.after_steps = cfg.afterSteps;
    }
    return out;
}

/** «Si falla: lo reintenta hasta 2 veces; si sigue fallando, sigue con el resto». */
export function describeOnError(raw: unknown): string {
    const c = readOnError(raw);
    const fallback = (f: OnErrorFallback): string =>
        f === 'stop'
            ? 'detiene la automatización'
            : f === 'continue'
              ? 'sigue con el resto'
              : `hace ${c.actions.length === 1 ? '1 paso' : `${c.actions.length} pasos`} y ${c.afterSteps === 'continue' ? 'sigue con el resto' : 'termina'}`;
    if (c.mode === 'retry') {
        return `Si falla: lo reintenta hasta ${c.retries === 1 ? '1 vez' : `${c.retries} veces`}; si sigue fallando, ${fallback(c.ifStillFails)}`;
    }
    return `Si falla: ${fallback(c.mode)}`;
}

/** Espera antes del reintento número `attempt` (1, 2, 3). */
export function retryDelayMs(attempt: number): number {
    return ON_ERROR_RETRY_DELAYS_MS[Math.min(ON_ERROR_RETRY_DELAYS_MS.length, Math.max(1, attempt)) - 1]!;
}

export function onErrorIssues(type: unknown, raw: unknown, at: string, inFailBranch: boolean): ControlIssue[] {
    if (raw === undefined || raw === null) return [];
    const out: ControlIssue[] = [];
    if (typeof type === 'string' && ON_ERROR_EXEMPT_ACTIONS.includes(type)) return out;
    const c = readOnError(raw);
    if (c.mode === 'retry' && !isRetryableAction(type)) {
        out.push({ path: `${at}.on_error.mode`, message: 'Reintentar sólo sirve para pasos que llaman a otro servicio (webhooks, apps conectadas, correos y la IA).' });
    }
    if (inFailBranch && onErrorUsesSteps(c)) {
        out.push({ path: `${at}.on_error.mode`, message: 'Dentro de «Si falla» no se pueden anidar otros pasos de falla: elige detener, seguir o reintentar.' });
    }
    if (onErrorUsesSteps(c)) {
        if (c.actions.length === 0) out.push({ path: `${at}.on_error.actions`, message: 'Agrega al menos un paso para cuando falle.' });
        if (c.actions.length > ON_ERROR_MAX_STEPS) {
            out.push({ path: `${at}.on_error.actions`, message: `«Si falla» puede tener como mucho ${ON_ERROR_MAX_STEPS} pasos.` });
        }
    }
    return out;
}

/** Las variables del error dentro de la rama «Si falla». */
export const ERROR_VARIABLES: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'error.mensaje', label: 'Qué falló (el mensaje del error)' },
    { key: 'error.paso', label: 'El paso que falló' },
];

// ── «Preguntarle a la IA» ────────────────────────────────────────────────

export const ASK_AI_OUTPUTS = ['text', 'choice', 'number', 'boolean', 'date', 'fields'] as const;
export type AskAiOutput = (typeof ASK_AI_OUTPUTS)[number];

export const ASK_AI_OUTPUT_LABELS: Record<AskAiOutput, string> = {
    text: 'Texto libre',
    choice: 'Una opción de una lista',
    number: 'Un número',
    boolean: 'Sí o no',
    date: 'Una fecha',
    fields: 'Varios datos con nombre',
};

export const ASK_AI_ITEM_TYPES = ['text', 'number', 'date', 'boolean'] as const;
export type AskAiItemType = (typeof ASK_AI_ITEM_TYPES)[number];
export const ASK_AI_ITEM_TYPE_LABELS: Record<AskAiItemType, string> = {
    text: 'Texto',
    number: 'Número',
    date: 'Fecha',
    boolean: 'Sí o no',
};

export const ASK_AI_DEFAULT_NAME = 'ia';
export const ASK_AI_INSTRUCTION_MAX = 4_000;
export const ASK_AI_MAX_CHOICES = 30;
export const ASK_AI_MAX_ITEMS = 12;
/** Cuánto de cada campo del registro viaja a la IA (y cuánto en total). */
export const ASK_AI_FIELD_CHARS = 600;
export const ASK_AI_RECORD_CHARS = 8_000;
/** Las claves que ya usa la respuesta: un dato con nombre no puede llamarse así. */
const RESERVED_KEYS = new Set(['texto', 'valor', 'status', 'body']);

export interface AskAiItem {
    key: string;
    label: string;
    type: AskAiItemType;
    fieldId: number | null;
}

export type AskAiLength = 'short' | 'medium' | 'long';

export interface AskAiConfig {
    instruction: string;
    includeRecord: boolean;
    output: AskAiOutput;
    /** Opciones escritas a mano (`choice`). */
    choices: string[];
    /** Las opciones de un campo de selección (`choice`). */
    choicesFieldId: number | null;
    /** Los datos con nombre (`fields`). */
    items: AskAiItem[];
    /** Guardar la respuesta en un campo (todas menos `fields`, que guarda por dato). */
    saveFieldId: number | null;
    responseName: string;
    /** `fast` (default) o el modelo del asistente. */
    quality: 'fast' | 'assistant';
    length: AskAiLength;
}

export const ASK_AI_MAX_TOKENS: Record<AskAiLength, number> = { short: 400, medium: 1_000, long: 2_500 };

function readItems(raw: unknown): AskAiItem[] {
    const out: AskAiItem[] = [];
    for (const r of Array.isArray(raw) ? raw.slice(0, ASK_AI_MAX_ITEMS) : []) {
        const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
        out.push({
            key: str(o.key, 40),
            label: str(o.label, 80),
            type: (ASK_AI_ITEM_TYPES as readonly unknown[]).includes(o.type) ? (o.type as AskAiItemType) : 'text',
            fieldId: positiveInt(o.field_id),
        });
    }
    return out;
}

export function readAskAiConfig(cfg: Record<string, unknown> | null | undefined): AskAiConfig {
    const c = cfg ?? {};
    const choices = (Array.isArray(c.choices) ? c.choices : typeof c.choices === 'string' ? c.choices.split(/\n|,/) : [])
        .map((x) => (typeof x === 'string' ? x.trim().slice(0, 120) : ''))
        .filter((x) => x !== '');
    const name = str(c.response_name, 40);
    return {
        instruction: typeof c.instruction === 'string' ? c.instruction.slice(0, ASK_AI_INSTRUCTION_MAX) : '',
        includeRecord: c.include_record !== false,
        output: (ASK_AI_OUTPUTS as readonly unknown[]).includes(c.output) ? (c.output as AskAiOutput) : 'text',
        choices: [...new Set(choices)].slice(0, ASK_AI_MAX_CHOICES),
        choicesFieldId: positiveInt(c.choices_field_id),
        items: readItems(c.items),
        saveFieldId: positiveInt(c.save_field_id),
        responseName: name !== '' ? name : ASK_AI_DEFAULT_NAME,
        quality: c.quality === 'assistant' ? 'assistant' : 'fast',
        length: c.length === 'medium' || c.length === 'long' ? c.length : 'short',
    };
}

export function askAiIssues(cfg: Record<string, unknown> | null | undefined, at: string): ControlIssue[] {
    const c = readAskAiConfig(cfg);
    const out: ControlIssue[] = [];
    const rawInstruction = typeof cfg?.instruction === 'string' ? cfg.instruction : '';
    if (rawInstruction.trim() === '') out.push({ path: `${at}.config.instruction`, message: 'Escribe qué le pides a la IA.' });
    if (rawInstruction.length > ASK_AI_INSTRUCTION_MAX) {
        out.push({ path: `${at}.config.instruction`, message: `La instrucción es demasiado larga (máximo ${ASK_AI_INSTRUCTION_MAX.toLocaleString('es')} caracteres).` });
    }
    if (!RESPONSE_NAME_RE.test(c.responseName)) {
        out.push({
            path: `${at}.config.response_name`,
            message: 'El nombre de la respuesta usa sólo minúsculas, números y guion bajo, y empieza con una letra (por ejemplo «ia»).',
        });
    }
    if (c.output === 'choice' && c.choicesFieldId === null && c.choices.length < 2) {
        out.push({ path: `${at}.config.choices`, message: 'Escribe al menos dos opciones o elige un campo de selección.' });
    }
    if (c.output === 'fields') {
        if (c.items.length === 0) out.push({ path: `${at}.config.items`, message: 'Agrega al menos un dato que la IA tenga que sacar.' });
        const seen = new Set<string>();
        c.items.forEach((it, i) => {
            if (!RESPONSE_NAME_RE.test(it.key)) {
                out.push({ path: `${at}.config.items.${i}.key`, message: `El nombre del dato ${i + 1} usa sólo minúsculas, números y guion bajo (por ejemplo «monto»).` });
            } else if (RESERVED_KEYS.has(it.key)) {
                out.push({ path: `${at}.config.items.${i}.key`, message: `«${it.key}» ya lo usa la respuesta: ponle otro nombre al dato.` });
            } else if (seen.has(it.key)) {
                out.push({ path: `${at}.config.items.${i}.key`, message: `Hay dos datos llamados «${it.key}».` });
            }
            seen.add(it.key);
        });
    }
    return out;
}

/** «Le pregunta a la IA → una opción en {{respuestas.ia.valor}}». */
export function describeAskAi(cfg: Record<string, unknown> | null | undefined, saveLabel?: string | null): string {
    const c = readAskAiConfig(cfg);
    const what = ASK_AI_OUTPUT_LABELS[c.output].toLowerCase();
    const into = c.output !== 'fields' && c.saveFieldId !== null ? ` y la guarda en «${saveLabel ?? 'un campo'}»` : '';
    return `Le pregunta a la IA (${what})${into}`;
}

/** Las variables que deja la respuesta. */
export function askAiVariables(cfg: Record<string, unknown> | null | undefined): Array<{ key: string; label: string }> {
    const c = readAskAiConfig(cfg);
    const base = `respuestas.${c.responseName}`;
    const out = [{ key: `${base}.texto`, label: 'La respuesta de la IA (como texto)' }];
    if (c.output === 'fields') {
        for (const it of c.items) if (it.key !== '') out.push({ key: `${base}.${it.key}`, label: it.label || it.key });
    } else if (c.output !== 'text') {
        out.push({ key: `${base}.valor`, label: `La respuesta leída (${ASK_AI_OUTPUT_LABELS[c.output].toLowerCase()})` });
    }
    return out;
}

/** Lo que el paso le dice a la IA sobre el formato de la respuesta. */
export function askAiFormatInstruction(c: AskAiConfig, choices: readonly string[]): string {
    switch (c.output) {
        case 'text':
            return {
                short: 'Responde en una o dos oraciones.',
                medium: 'Responde en un párrafo corto.',
                long: 'Puedes extenderte hasta unos tres párrafos.',
            }[c.length];
        case 'choice':
            return [
                'Responde EXACTAMENTE con una de estas opciones, escrita igual que aquí, y nada más:',
                ...choices.map((o) => `- ${o}`),
                'Si ninguna aplica, responde exactamente: (ninguna)',
            ].join('\n');
        case 'number':
            return 'Responde sólo con un número (sin palabras ni unidades). Si el dato no se puede saber, responde exactamente: (sin dato)';
        case 'boolean':
            return 'Responde sólo «sí» o «no».';
        case 'date':
            return 'Responde sólo con la fecha en formato AAAA-MM-DD. Si no se puede saber, responde exactamente: (sin dato)';
        case 'fields': {
            const lines = c.items.map((it) => {
                const kind =
                    it.type === 'number' ? 'un número' : it.type === 'date' ? 'una fecha AAAA-MM-DD' : it.type === 'boolean' ? 'true o false' : 'un texto';
                return `- "${it.key}": ${kind}${it.label ? ` (${it.label})` : ''}`;
            });
            return [
                'Responde SÓLO con un objeto JSON (sin Markdown ni texto alrededor) con estas claves:',
                ...lines,
                'Si un dato no está, usa null.',
            ].join('\n');
        }
    }
}

export type AskAiAnswer =
    | { ok: true; text: string; value: string | number | boolean | null; fields: Record<string, string | number | boolean | null> }
    | { ok: false; text: string; error: string };

function cleanAnswer(raw: string): string {
    let t = raw.trim();
    t = t.replace(/^```[a-z]*\s*\n?|\n?```$/g, '').trim();
    if (/^["«“'].*["»”']$/s.test(t)) t = t.slice(1, -1).trim();
    return t;
}

const NO_DATA_RE = /^\(?\s*sin dato\s*\)?\.?$/i;

/** Un número escrito por la IA: «1.500.000», «$ 99,90», «-3». Null si no se lee. */
export function parseAiNumber(raw: string): number | null {
    const strict = readAiNumber(raw);
    if (strict !== null) return strict;
    // «Aproximadamente 1.250.000 pesos»: si el texto trae UN solo número, ése.
    // Con dos o más («entre 1.000 y 2.000») es ambiguo: no se adivina.
    const tokens = raw.match(/-?\d[\d.,]*\d|-?\d/g) ?? [];
    return tokens.length === 1 ? readAiNumber(tokens[0]!) : null;
}

function readAiNumber(raw: string): number | null {
    const t = raw
        .replace(/[$€£]|\b(COP|USD|EUR|MXN|PEN|CLP|ARS)\b|%/gi, '')
        .replace(/\s+/g, '')
        .trim();
    if (!/^-?[\d.,]+$/.test(t)) return null;
    let s = t;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
        s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
        s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/** «sí»/«si»/«yes»/«true» → true, «no»/«false» → false; null si no se lee. */
export function parseAiBoolean(raw: string): boolean | null {
    const t = foldAnswer(raw).replace(/[.!¡]/g, '').trim();
    if (['si', 'yes', 'true', 'verdadero', 'cierto'].includes(t)) return true;
    if (['no', 'false', 'falso'].includes(t)) return false;
    return null;
}

/** Una fecha real AAAA-MM-DD (también DD/MM/AAAA). Null si no lo es. */
export function parseAiDate(raw: string): string | null {
    const strict = readAiDate(raw.trim());
    if (strict !== null) return strict;
    // «Vence el 2026-12-24.»: si el texto trae UNA sola fecha, ésa.
    const found = raw.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}/g) ?? [];
    return found.length === 1 ? readAiDate(found[0]!) : null;
}

function readAiDate(t: string): string | null {
    let y: number, m: number, d: number;
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (match) {
        y = Number(match[1]);
        m = Number(match[2]);
        d = Number(match[3]);
    } else {
        match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
        if (!match) return null;
        d = Number(match[1]);
        m = Number(match[2]);
        y = Number(match[3]);
    }
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function shortText(s: string): string {
    const one = s.replace(/\s+/g, ' ').trim();
    return one.length > 80 ? `${one.slice(0, 79)}…` : one;
}

/** El primer objeto JSON de un texto (la IA a veces lo envuelve en algo). */
function firstJsonObject(t: string): Record<string, unknown> | null {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const v = JSON.parse(t.slice(start, end + 1)) as unknown;
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/**
 * Lee la respuesta de la IA según el tipo pedido. Una opción fuera de la
 * lista, un número que no se lee o un JSON roto son un ERROR del paso (con el
 * motivo): seguir con un valor inventado sería peor. «(sin dato)» no es error:
 * la respuesta queda vacía (y no se guarda nada).
 */
export function parseAskAiAnswer(c: AskAiConfig, raw: string, choices: readonly string[] = c.choices): AskAiAnswer {
    const text = cleanAnswer(raw);
    const none = { fields: {} as Record<string, string | number | boolean | null> };
    switch (c.output) {
        case 'text':
            if (text === '') return { ok: false, text, error: 'La IA no respondió nada.' };
            return { ok: true, text: text.slice(0, 10_000), value: text.slice(0, 10_000), ...none };
        case 'choice': {
            if (/^\(?\s*ninguna\s*\)?\.?$/i.test(text)) return { ok: false, text, error: 'La IA respondió que ninguna de las opciones aplica.' };
            const bare = foldAnswer(text.replace(/["«»“”'`*]/g, ''));
            const hit = choices.find((o) => foldAnswer(o) === bare);
            if (!hit) return { ok: false, text, error: `La IA respondió «${shortText(text)}», que no es una de las opciones.` };
            return { ok: true, text: hit, value: hit, ...none };
        }
        case 'number': {
            if (NO_DATA_RE.test(text)) return { ok: true, text: '', value: null, ...none };
            const n = parseAiNumber(text);
            if (n === null) return { ok: false, text, error: `La IA respondió «${shortText(text)}», que no se puede leer como un número.` };
            return { ok: true, text: String(n), value: n, ...none };
        }
        case 'boolean': {
            const b = parseAiBoolean(text);
            if (b === null) return { ok: false, text, error: `La IA respondió «${shortText(text)}» en vez de «sí» o «no».` };
            return { ok: true, text: b ? 'Sí' : 'No', value: b, ...none };
        }
        case 'date': {
            if (NO_DATA_RE.test(text)) return { ok: true, text: '', value: null, ...none };
            const d = parseAiDate(text);
            if (d === null) return { ok: false, text, error: `La IA respondió «${shortText(text)}», que no es una fecha válida (AAAA-MM-DD).` };
            return { ok: true, text: d, value: d, ...none };
        }
        case 'fields': {
            const obj = firstJsonObject(text);
            if (!obj) return { ok: false, text, error: 'La IA no respondió con los datos pedidos (no se pudo leer el JSON).' };
            const fields: Record<string, string | number | boolean | null> = {};
            for (const it of c.items) {
                const v = obj[it.key];
                if (v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || NO_DATA_RE.test(v.trim())))) {
                    fields[it.key] = null;
                    continue;
                }
                const s = typeof v === 'string' ? v.trim() : String(v);
                const name = it.label || it.key;
                if (it.type === 'number') {
                    const n = typeof v === 'number' && Number.isFinite(v) ? v : parseAiNumber(s);
                    if (n === null) return { ok: false, text, error: `«${name}»: la IA respondió «${shortText(s)}», que no se puede leer como un número.` };
                    fields[it.key] = n;
                } else if (it.type === 'boolean') {
                    const b = typeof v === 'boolean' ? v : parseAiBoolean(s);
                    if (b === null) return { ok: false, text, error: `«${name}»: la IA respondió «${shortText(s)}» en vez de sí o no.` };
                    fields[it.key] = b;
                } else if (it.type === 'date') {
                    const d = parseAiDate(s);
                    if (d === null) return { ok: false, text, error: `«${name}»: la IA respondió «${shortText(s)}», que no es una fecha válida.` };
                    fields[it.key] = d;
                } else {
                    fields[it.key] = (typeof v === 'object' ? JSON.stringify(v) : s).slice(0, 4_000);
                }
            }
            return { ok: true, text, value: null, fields };
        }
    }
}
