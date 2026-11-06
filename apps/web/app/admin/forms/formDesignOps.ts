import {
    ATTRIBUTION_KEYS,
    attributionFieldFor,
    FORM_CALC_KEY_RE,
    FORM_MAX_CALCS,
    fieldDefaultOf,
    formConditionRules,
    isFormCalcCondition,
    isFormConditionGroup,
    FORM_JUMP_END,
    FORM_JUMP_ENDING_PREFIX,
    FORM_START_PAGE,
    formConfigSchema,
    formItemSchema,
    isFormFieldType,
    isUserWritableType,
    newFormItemId,
    splitFormPages,
    type FormCalc,
    type FormCalcPart,
    type FormConfig,
    type FormCondition,
    type FormEnding,
    type FormItem,
    type FormJump,
    type FormSettings,
    type FormShowIf,
    type FieldType,
} from '@imagina-base/shared';

/**
 * v0.1.275 — Operaciones puras del constructor de formularios. Toda
 * modificación devuelve un `FormConfig` nuevo (para deshacer y comparar).
 */

interface FieldLike {
    id: number;
    label: string;
    type: string;
    is_required: boolean;
    /** v0.1.300 — para saber si tiene un valor por defecto que cubre el hueco. */
    config?: Record<string, unknown>;
}

/**
 * v0.1.351 — Lee la configuración que llega del servidor completando los
 * valores por defecto de cada versión (una pregunta guardada antes no trae
 * `width` ni `option_images`). Si no valida (datos de una versión futura),
 * se usa tal cual: mejor eso que vaciar el formulario al guardar.
 */
export function readFormConfig(raw: unknown): FormConfig {
    const parsed = formConfigSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : (raw as FormConfig);
}

export function insertAfter(items: FormItem[], item: FormItem, afterId: string | null): FormItem[] {
    if (afterId === null) return [...items, item];
    const idx = items.findIndex((i) => i.id === afterId);
    if (idx < 0) return [...items, item];
    return [...items.slice(0, idx + 1), item, ...items.slice(idx + 1)];
}

/**
 * v0.1.355 — Los campos que el formulario ya usa: como pregunta, como fila de
 * una matriz o como el texto del «Otro» de una pregunta. Cada campo se usa una vez.
 */
export function usedFieldIds(config: FormConfig): Set<number> {
    const out = new Set<number>();
    for (const i of config.items) {
        if (i.type === 'field') {
            out.add(i.field_id);
            if (i.other_field_id !== null) out.add(i.other_field_id);
        } else if (i.type === 'matrix') for (const r of i.rows) out.add(r.field_id);
    }
    return out;
}

/** v0.1.355 — Agrega una matriz con estas filas y columnas. */
export function addMatrixItem(
    config: FormConfig,
    rowFieldIds: readonly number[],
    columns: ReadonlyArray<{ value: string; label: string }>,
    afterId: string | null,
): { config: FormConfig; id: string } {
    const item = formItemSchema.parse({
        id: newFormItemId(),
        type: 'matrix',
        label: '',
        rows: rowFieldIds.map((field_id) => ({ field_id })),
        columns,
    });
    return { config: { ...config, items: insertAfter(config.items, item, afterId) }, id: item.id };
}

/**
 * v0.1.355 — Columnas de arranque de una matriz según su primera fila: las
 * opciones de una selección, o del 1 al máximo de una calificación.
 */
export function defaultMatrixColumns(field: FieldLike | undefined): Array<{ value: string; label: string }> {
    if (!field) return [];
    if (field.type === 'select' || field.type === 'multi_select') {
        const raw = (field.config?.options as Array<{ value?: unknown; label?: unknown }> | undefined) ?? [];
        return raw
            .flatMap((o) => (typeof o?.value === 'string' ? [{ value: o.value, label: typeof o.label === 'string' && o.label ? o.label : o.value }] : []))
            .slice(0, 10);
    }
    if (field.type === 'rating') {
        const max = Math.max(1, Math.min(10, Math.round(Number(field.config?.max) || 5)));
        return Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
    }
    return [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
}

export function addFieldItem(config: FormConfig, fieldId: number, afterId: string | null): { config: FormConfig; id: string } {
    if (config.items.some((i) => i.type === 'field' && i.field_id === fieldId)) {
        const existing = config.items.find((i) => i.type === 'field' && i.field_id === fieldId)!;
        return { config, id: existing.id };
    }
    const item = formItemSchema.parse({ id: newFormItemId(), type: 'field', field_id: fieldId });
    return { config: { ...config, items: insertAfter(config.items, item, afterId) }, id: item.id };
}

/** v0.1.351 — Lo que se agrega desde «Contenido» (sin campo de la lista). */
export type FormContentType = 'heading' | 'text' | 'page_break' | 'image';

export function addContentItem(
    config: FormConfig,
    type: FormContentType,
    afterId: string | null,
): { config: FormConfig; id: string } {
    const item = formItemSchema.parse(
        type === 'page_break'
            ? { id: newFormItemId(), type, title: '' }
            : type === 'image'
              ? { id: newFormItemId(), type }
              : { id: newFormItemId(), type, text: type === 'heading' ? 'Nueva sección' : '' },
    );
    return { config: { ...config, items: insertAfter(config.items, item, afterId) }, id: item.id };
}

/**
 * v0.1.289 — Número de página (1, 2, 3…) de cada ítem, contando los saltos.
 * Un salto queda en la página que ABRE. Sirve para el panel de estructura.
 */
export function pageNumbers(config: FormConfig): Map<string, number> {
    const out = new Map<string, number>();
    let page = 1;
    let seenContent = false;
    for (const item of config.items) {
        if (item.type === 'page_break') {
            // Un salto al principio (o dos seguidos) no abre una página vacía.
            if (seenContent) page += 1;
            seenContent = false;
            out.set(item.id, page);
            continue;
        }
        seenContent = true;
        out.set(item.id, page);
    }
    return out;
}

/** Cantidad de páginas del formulario (1 = sin saltos). */
export function pageCount(config: FormConfig): number {
    return splitFormPages(config.items).length;
}

/**
 * Preguntas de tipo email del formulario (para elegir el correo de quien
 * responde: confirmación y copia de las respuestas).
 */
export function emailQuestions<F extends FieldLike>(fields: readonly F[], config: FormConfig): F[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    return config.items.flatMap((i) => {
        if (i.type !== 'field') return [];
        const f = byId.get(i.field_id);
        return f && f.type === 'email' ? [f] : [];
    });
}

export function updateItem(config: FormConfig, id: string, patch: Partial<FormItem>): FormConfig {
    return {
        ...config,
        items: config.items.map((i) => (i.id === id ? ({ ...i, ...patch, id: i.id, type: i.type } as FormItem) : i)),
    };
}

/** Quita la pregunta y las condiciones de otras que dependían de ella. */
export function removeItem(config: FormConfig, id: string): FormConfig {
    const target = config.items.find((i) => i.id === id);
    const fieldId = target?.type === 'field' ? target.field_id : null;
    // v0.1.355 — una matriz se lleva las condiciones que dependían de sus filas.
    const rowIds = new Set(target?.type === 'matrix' ? target.rows.map((r) => r.field_id) : []);
    // Era la pregunta del correo de quien responde: sin ella no hay a quién
    // confirmarle ni mandarle la copia.
    const settings =
        fieldId !== null && config.settings.respondent_email_field_id === fieldId
            ? { ...config.settings, respondent_email_field_id: null, confirm_email: false, send_copy: false }
            : config.settings;
    const next: FormConfig = {
        ...config,
        settings,
        items: config.items.filter((i) => i.id !== id),
    };
    const gone = new Set<number>([...(fieldId !== null ? [fieldId] : []), ...rowIds]);
    return withoutLogicOn(next, gone, target?.type === 'page_break' ? target.id : null);
}

/**
 * v0.1.356 — Quita de la lógica lo que dependía de preguntas (o de una
 * página) que ya no están: las reglas sobre esos campos (una condición que
 * se queda sin reglas desaparece; un salto cuya condición se vacía, también,
 * para no volverse «siempre»), y los saltos desde o hacia esa página.
 */
export function withoutLogicOn(config: FormConfig, fieldIds: ReadonlySet<number>, breakId: string | null = null): FormConfig {
    if (fieldIds.size === 0 && !breakId) return config;
    const clean = (c: FormShowIf | null): FormShowIf | null => {
        if (!c) return null;
        const rules = formConditionRules(c).filter((r) => isFormCalcCondition(r) || !fieldIds.has(r.field_id));
        if (rules.length === 0) return null;
        // Una sola regla se guarda suelta (como la guarda el editor).
        return isFormConditionGroup(c) && rules.length > 1 ? { match: c.match, rules } : rules[0]!;
    };
    return {
        ...config,
        items: config.items.map((i) => (i.show_if ? ({ ...i, show_if: clean(i.show_if) } as FormItem) : i)),
        settings: {
            ...config.settings,
            jumps: config.settings.jumps.flatMap((j) => {
                if (breakId && (j.from === breakId || j.to === breakId)) return [];
                if (!j.when) return [j];
                const when = clean(j.when);
                return when ? [{ ...j, when }] : [];
            }),
            endings: config.settings.endings.map((e) => ({ ...e, when: clean(e.when) })),
            // v0.1.357 — lo que sumaba una pregunta borrada deja de sumar.
            calcs: config.settings.calcs.map((c) => ({ ...c, parts: c.parts.filter((p) => !fieldIds.has(p.field_id)) })),
        },
    };
}

// ─────────────────────── Lógica (v0.1.356) ───────────────────────

/** Una página para elegir en un salto: su clave (`start` o el id del salto) y su nombre. */
export interface PageChoice {
    key: string;
    index: number;
    label: string;
}

/** Las páginas del formulario, con «Página 2 · Tu empresa». */
export function pageChoices(config: FormConfig): PageChoice[] {
    return splitFormPages(config.items).map((p, index) => ({
        key: p.break_id ?? FORM_START_PAGE,
        index,
        label: `Página ${index + 1}${p.title ? ` · ${p.title}` : ''}`,
    }));
}

/** Adónde puede ir un salto desde una página: las de más adelante, terminar o una pantalla final. */
export function jumpTargets(config: FormConfig, from: string): Array<{ value: string; label: string }> {
    const pages = pageChoices(config);
    const at = pages.find((p) => p.key === from)?.index ?? 0;
    return [
        ...pages.filter((p) => p.index > at && p.key !== FORM_START_PAGE).map((p) => ({ value: p.key, label: `Ir a la ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}` })),
        { value: FORM_JUMP_END, label: 'Terminar el formulario' },
        ...config.settings.endings.map((e, i) => ({ value: `${FORM_JUMP_ENDING_PREFIX}${e.id}`, label: `Terminar en «${endingName(e, i)}»` })),
    ];
}

/** El nombre de una pantalla final para el constructor. */
export function endingName(e: FormEnding, index: number): string {
    return e.name.trim() || e.title.trim() || `Pantalla final ${index + 1}`;
}

/** Las preguntas que pueden decidir un salto desde una página: las de esa página y las anteriores. */
export function jumpCandidates(config: FormConfig, from: string): Array<{ field_id: number; item_id: string }> {
    const pages = splitFormPages(config.items);
    const at = from === FORM_START_PAGE ? 0 : pages.findIndex((p) => p.break_id === from);
    const upTo = pages.slice(0, Math.max(0, at) + 1).flatMap((p) => p.items);
    return upTo.flatMap((i) =>
        i.type === 'field' ? [{ field_id: i.field_id, item_id: i.id }] : i.type === 'matrix' ? i.rows.map((r) => ({ field_id: r.field_id, item_id: i.id })) : [],
    );
}

/** Todas las preguntas del formulario (para las condiciones de una pantalla final). */
export function allCandidates(config: FormConfig): Array<{ field_id: number; item_id: string }> {
    return conditionCandidates(config, '__end__');
}

export function addJump(config: FormConfig, from: string, firstField: number | null): FormConfig {
    const jump: FormJump = {
        id: newFormItemId(),
        from,
        when: firstField !== null ? { field_id: firstField, op: 'eq', value: '' } : null,
        to: jumpTargets(config, from)[0]?.value ?? FORM_JUMP_END,
    };
    return { ...config, settings: { ...config.settings, jumps: [...config.settings.jumps, jump] } };
}

export function updateJump(config: FormConfig, id: string, patch: Partial<FormJump>): FormConfig {
    return { ...config, settings: { ...config.settings, jumps: config.settings.jumps.map((j) => (j.id === id ? { ...j, ...patch, id } : j)) } };
}

export function removeJump(config: FormConfig, id: string): FormConfig {
    return { ...config, settings: { ...config.settings, jumps: config.settings.jumps.filter((j) => j.id !== id) } };
}

export function moveJump(config: FormConfig, id: string, dir: -1 | 1): FormConfig {
    const list = [...config.settings.jumps];
    const idx = list.findIndex((j) => j.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return config;
    [list[idx], list[to]] = [list[to]!, list[idx]!];
    return { ...config, settings: { ...config.settings, jumps: list } };
}

export function addEnding(config: FormConfig): FormConfig {
    const n = config.settings.endings.length + 1;
    const ending: FormEnding = { id: newFormItemId(), name: `Pantalla final ${n}`, title: '¡Gracias!', message: '', redirect_url: null, when: null };
    return { ...config, settings: { ...config.settings, endings: [...config.settings.endings, ending] } };
}

export function updateEnding(config: FormConfig, id: string, patch: Partial<FormEnding>): FormConfig {
    return { ...config, settings: { ...config.settings, endings: config.settings.endings.map((e) => (e.id === id ? { ...e, ...patch, id } : e)) } };
}

/** Quita la pantalla y los saltos que llevaban a ella. */
export function removeEnding(config: FormConfig, id: string): FormConfig {
    return {
        ...config,
        settings: {
            ...config.settings,
            endings: config.settings.endings.filter((e) => e.id !== id),
            jumps: config.settings.jumps.filter((j) => j.to !== `${FORM_JUMP_ENDING_PREFIX}${id}`),
        },
    };
}

export function moveEnding(config: FormConfig, id: string, dir: -1 | 1): FormConfig {
    const list = [...config.settings.endings];
    const idx = list.findIndex((e) => e.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return config;
    [list[idx], list[to]] = [list[to]!, list[idx]!];
    return { ...config, settings: { ...config.settings, endings: list } };
}

/** Cuántas reglas de lógica tiene (para el contador de la pestaña). */
export function logicCount(config: FormConfig): number {
    return config.settings.jumps.length + config.settings.endings.length + config.settings.calcs.length;
}

// ─────────────────────── Cálculos y puntaje (v0.1.357) ───────────────────────

/** El nombre para usar entre llaves a partir del que escribe la persona: «Puntaje final» → `puntaje_final`. */
export function calcKeyFrom(name: string, taken: ReadonlySet<string>): string {
    let base = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 36);
    if (!/^[a-z]/.test(base)) base = `calc_${base}`.replace(/_+$/, '');
    if (!FORM_CALC_KEY_RE.test(base)) base = 'calculo';
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
    return key;
}

/** Nombres que ya están en uso: los de los campos de la lista y los de los otros cálculos. */
export function takenCalcKeys(config: FormConfig, fieldSlugs: ReadonlyArray<string>, exceptId?: string): Set<string> {
    return new Set([...fieldSlugs, ...config.settings.calcs.filter((c) => c.id !== exceptId).map((c) => c.key)]);
}

/** Un cálculo nuevo («Puntaje»), con un nombre entre llaves que no choca con nada. */
export function addCalc(config: FormConfig, fieldSlugs: ReadonlyArray<string>, name = 'Puntaje'): { config: FormConfig; id: string } {
    if (config.settings.calcs.length >= FORM_MAX_CALCS) return { config, id: '' };
    const id = newFormItemId();
    const calc: FormCalc = { id, key: calcKeyFrom(name, takenCalcKeys(config, fieldSlugs)), name, start: 0, parts: [], save_field_id: null };
    return { config: updateSettings(config, { calcs: [...config.settings.calcs, calc] }), id };
}

export function updateCalc(config: FormConfig, id: string, patch: Partial<FormCalc>): FormConfig {
    return updateSettings(config, { calcs: config.settings.calcs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

/** Cambia lo que suma una pregunta (null = deja de sumar). */
export function setCalcPart(config: FormConfig, id: string, fieldId: number, part: Omit<FormCalcPart, 'field_id'> | null): FormConfig {
    return updateSettings(config, {
        calcs: config.settings.calcs.map((c) => {
            if (c.id !== id) return c;
            const rest = c.parts.filter((p) => p.field_id !== fieldId);
            const empty = !part || (part.multiplier === null && Object.keys(part.points).length === 0);
            if (empty) return { ...c, parts: rest };
            // En el orden del formulario (así se lee igual que las preguntas).
            const next = [...rest, { field_id: fieldId, ...part }];
            const order = calcSourceOrder(config);
            next.sort((a, b) => (order.get(a.field_id) ?? 1e9) - (order.get(b.field_id) ?? 1e9));
            return { ...c, parts: next };
        }),
    });
}

function calcSourceOrder(config: FormConfig): Map<number, number> {
    const out = new Map<number, number>();
    let n = 0;
    for (const i of config.items) {
        if (i.type === 'field') out.set(i.field_id, n++);
        else if (i.type === 'matrix') for (const r of i.rows) out.set(r.field_id, n++);
    }
    return out;
}

/** Reemplaza `{{viejo}}` por `{{nuevo}}` en un texto (conserva lo de después de la barra). */
function swapToken(text: string, from: string, to: string): string {
    if (!text || !text.includes('{{')) return text;
    const re = new RegExp(`\\{\\{\\s*${from}\\s*(\\|[^{}]*)?\\}\\}`, 'g');
    return text.replace(re, (_m, rest?: string) => `{{${to}${rest ?? ''}}}`);
}

/**
 * Cambia el nombre entre llaves de un cálculo: también en las reglas que lo
 * miran y en los textos que lo muestran (si no, quedarían apuntando a nada).
 */
export function renameCalcKey(config: FormConfig, id: string, nextKey: string): FormConfig {
    const calc = config.settings.calcs.find((c) => c.id === id);
    if (!calc || calc.key === nextKey || !FORM_CALC_KEY_RE.test(nextKey)) return config;
    const from = calc.key;
    const rule = (c: FormShowIf | null): FormShowIf | null => {
        if (!c) return c;
        const fix = (r: FormCondition): FormCondition => (isFormCalcCondition(r) && r.calc === from ? { ...r, calc: nextKey } : r);
        return isFormConditionGroup(c) ? { ...c, rules: c.rules.map(fix) } : fix(c);
    };
    const t = (x: string): string => swapToken(x, from, nextKey);
    const s = config.settings;
    return {
        ...config,
        items: config.items.map((i): FormItem => {
            if (i.type === 'field' || i.type === 'matrix') return { ...i, label: t(i.label), help: t(i.help) } as FormItem;
            if (i.type === 'heading' || i.type === 'text') return { ...i, text: t(i.text) } as FormItem;
            if (i.type === 'page_break') return { ...i, title: t(i.title) } as FormItem;
            if (i.type === 'image') return { ...i, caption: t(i.caption) } as FormItem;
            return i;
        }),
        settings: {
            ...s,
            title: t(s.title),
            description: t(s.description),
            success_title: t(s.success_title),
            success_message: t(s.success_message),
            welcome: { ...s.welcome, title: t(s.welcome.title), message: t(s.welcome.message) },
            jumps: s.jumps.map((j) => ({ ...j, when: rule(j.when) })),
            endings: s.endings.map((e) => ({ ...e, title: t(e.title), message: t(e.message), when: rule(e.when) })),
            calcs: s.calcs.map((c) => (c.id === id ? { ...c, key: nextKey } : c)),
        },
    };
}

/** Quita un cálculo y las reglas que lo miraban (un salto que se queda sin reglas también se va). */
export function removeCalc(config: FormConfig, id: string): FormConfig {
    const calc = config.settings.calcs.find((c) => c.id === id);
    if (!calc) return config;
    const clean = (c: FormShowIf | null): FormShowIf | null => {
        if (!c) return null;
        const rules = formConditionRules(c).filter((r) => !(isFormCalcCondition(r) && r.calc === calc.key));
        if (rules.length === 0) return null;
        return isFormConditionGroup(c) && rules.length > 1 ? { match: c.match, rules } : rules[0]!;
    };
    const s = config.settings;
    return updateSettings(config, {
        calcs: s.calcs.filter((c) => c.id !== id),
        jumps: s.jumps.flatMap((j) => {
            if (!j.when) return [j];
            const when = clean(j.when);
            return when ? [{ ...j, when }] : [];
        }),
        endings: s.endings.map((e) => ({ ...e, when: clean(e.when) })),
    });
}

/** Una pregunta que puede sumar a un cálculo, con lo que se puede puntuar. */
export interface CalcSource {
    fieldId: number;
    label: string;
    /** Puntos por opción, o la respuesta (un número) multiplicada. */
    kind: 'choices' | 'number';
    /** Varias opciones: se suman. */
    multiple: boolean;
    choices: Array<{ value: string; label: string }>;
}

const CALC_NUMBER_TYPES = new Set(['number', 'currency', 'percent', 'rating', 'duration']);

/** Las preguntas del formulario que pueden sumar puntos, en orden (también las filas de una matriz). */
export function calcSources(config: FormConfig, fieldsById: ReadonlyMap<number, { label: string; type: string; config?: Record<string, unknown> }>): CalcSource[] {
    const out: CalcSource[] = [];
    const seen = new Set<number>();
    const add = (fieldId: number, label: string, yes?: string, no?: string): void => {
        const f = fieldsById.get(fieldId);
        if (!f || seen.has(fieldId)) return;
        let src: CalcSource | null = null;
        if (f.type === 'select' || f.type === 'multi_select') {
            const opts = (f.config?.options as Array<{ value: string; label?: string }> | undefined) ?? [];
            src = { fieldId, label, kind: 'choices', multiple: f.type === 'multi_select', choices: opts.map((o) => ({ value: o.value, label: o.label || o.value })) };
        } else if (f.type === 'checkbox') {
            src = { fieldId, label, kind: 'choices', multiple: false, choices: [{ value: 'true', label: yes || 'Sí' }, { value: 'false', label: no || 'No' }] };
        } else if (CALC_NUMBER_TYPES.has(f.type)) {
            src = { fieldId, label, kind: 'number', multiple: false, choices: [] };
        }
        if (src) {
            seen.add(fieldId);
            out.push(src);
        }
    };
    for (const i of config.items) {
        if (i.type === 'field') {
            // Ordenar elige el orden de TODAS las opciones: no hay una respuesta que puntuar.
            if (i.display === 'ranking' || i.display === 'signature') continue;
            add(i.field_id, i.label || fieldsById.get(i.field_id)?.label || '', i.yes_label, i.no_label);
        } else if (i.type === 'matrix') {
            for (const r of i.rows) add(r.field_id, `${i.label ? `${i.label} · ` : ''}${r.label || fieldsById.get(r.field_id)?.label || ''}`);
        }
    }
    return out;
}

/** Entre cuánto y cuánto puede dar un cálculo de puntos por opción (null si alguna respuesta se multiplica). */
export function calcRange(calc: FormCalc, sources: readonly CalcSource[]): { min: number; max: number } | null {
    if (calc.parts.length === 0) return null;
    let min = calc.start;
    let max = calc.start;
    const byId = new Map(sources.map((x) => [x.fieldId, x]));
    for (const p of calc.parts) {
        if (p.multiplier !== null) return null;
        const vals = Object.values(p.points);
        if (vals.length === 0) continue;
        if (byId.get(p.field_id)?.multiple) {
            min += vals.filter((v) => v < 0).reduce((a, b) => a + b, 0);
            max += vals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
        } else {
            // Puede no responder (0) o elegir la de más o la de menos.
            min += Math.min(0, ...vals);
            max += Math.max(0, ...vals);
        }
    }
    return { min: Number(min.toFixed(6)), max: Number(max.toFixed(6)) };
}

/** Los cálculos que puede mirar una regla de un salto o una pantalla final. */
export function calcChoices(config: FormConfig): Array<{ key: string; name: string }> {
    return config.settings.calcs.map((c) => ({ key: c.key, name: c.name || c.key }));
}

/** Una condición nueva sobre un campo. */
export function newRule(fieldId: number): FormCondition {
    return { field_id: fieldId, op: 'eq', value: '' };
}

export function moveItem(config: FormConfig, id: string, dir: -1 | 1): FormConfig {
    const idx = config.items.findIndex((i) => i.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= config.items.length) return config;
    const items = config.items.slice();
    [items[idx], items[to]] = [items[to]!, items[idx]!];
    return { ...config, items };
}

/** Mueve a una posición (índice sobre la lista SIN el ítem, como lo marca la línea). */
export function moveItemTo(config: FormConfig, id: string, index: number): FormConfig {
    const item = config.items.find((i) => i.id === id);
    if (!item) return config;
    const rest = config.items.filter((i) => i.id !== id);
    const at = Math.max(0, Math.min(index, rest.length));
    return { ...config, items: [...rest.slice(0, at), item, ...rest.slice(at)] };
}

export function updateSettings(config: FormConfig, patch: Partial<FormSettings>): FormConfig {
    return { ...config, settings: { ...config.settings, ...patch } };
}

/** Campos de la lista que se pueden preguntar y todavía no están en el formulario. */
export function availableFields<F extends FieldLike>(fields: readonly F[], config: FormConfig, locked?: { has(id: number): boolean } | null): F[] {
    const asked = usedFieldIds(config);
    // v0.1.374 — las columnas del origen (campaña, clic del anuncio…) se llenan solas: no se preguntan.
    const origin = attributionColumnIds(config);
    // v0.1.383 — tampoco las que escribe una sincronización (cobros, suscripciones, SLA): lo
    // respondido no se guardaría.
    return fields.filter((f) => isFormFieldType(f.type) && !asked.has(f.id) && !origin.has(f.id) && !locked?.has(f.id));
}

/** v0.1.374 — Las columnas donde el formulario guarda de dónde vino cada registro (si está encendido). */
export function attributionColumnIds(config: FormConfig): Set<number> {
    const a = config.settings.attribution;
    const out = new Set<number>();
    if (!a?.enabled) return out;
    for (const k of ATTRIBUTION_KEYS) {
        const id = attributionFieldFor(a, k);
        if (id !== null) out.add(id);
    }
    return out;
}

/**
 * Campos que la LISTA exige y el formulario no pide (o pide como ocultos):
 * cada respuesta fallaría. Se avisa en el constructor antes de publicar.
 */
export function missingRequired<F extends FieldLike>(fields: readonly F[], config: FormConfig): F[] {
    return fields.filter((f) => {
        // Una casilla obligatoria sin marcar se guarda como «no»; los
        // calculados no se escriben.
        if (!f.is_required || f.type === 'checkbox') return false;
        if (!isUserWritableType(f.type as FieldType)) return false;
        // v0.1.300 — un valor por defecto fijo, «hoy» o «ahora» completa la respuesta
        // («quien lo crea» no: un formulario público no tiene usuario).
        const def = fieldDefaultOf(f.config);
        if (def && def.kind !== 'creator') return false;
        // v0.1.355 — una fila de una matriz obligatoria y sin condición la cubre.
        const matrix = config.items.find((i) => i.type === 'matrix' && i.rows.some((r) => r.field_id === f.id));
        if (matrix && matrix.type === 'matrix') return !matrix.required || matrix.show_if !== null;
        const item = config.items.find((i) => i.type === 'field' && i.field_id === f.id);
        if (!item || item.type !== 'field') return true;
        // Oculta (sólo por la dirección) o condicional: puede llegar vacía.
        return item.hidden || item.show_if !== null;
    });
}

/** Preguntas ANTERIORES a esta que pueden controlar su visibilidad. */
export function conditionCandidates(config: FormConfig, id: string): Array<{ field_id: number; item_id: string }> {
    const idx = config.items.findIndex((i) => i.id === id);
    return config.items
        .slice(0, idx < 0 ? config.items.length : idx)
        .flatMap((i) =>
            i.type === 'field'
                ? [{ field_id: i.field_id, item_id: i.id }]
                : i.type === 'matrix'
                  ? i.rows.map((r) => ({ field_id: r.field_id, item_id: i.id }))
                  : [],
        );
}

export function questionCount(config: FormConfig): number {
    return config.items.reduce((n, i) => n + (i.type === 'field' && !i.hidden ? 1 : i.type === 'matrix' ? i.rows.length : 0), 0);
}

/**
 * v0.1.356 — Las respuestas que se pueden recordar en un texto con
 * `{{nombre}}`: las de los campos que el formulario pregunta (también las
 * ocultas que llegan por la dirección, las filas de una matriz y lo escrito
 * en un «Otro»), en el orden del formulario.
 */
export function recallChoices<F extends { id: number; slug: string; label: string }>(config: FormConfig, fields: readonly F[]): Array<{ id: number; slug: string; label: string }> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const ids: number[] = [];
    for (const i of config.items) {
        if (i.type === 'field') {
            ids.push(i.field_id);
            if (i.other_field_id) ids.push(i.other_field_id);
        } else if (i.type === 'matrix') ids.push(...i.rows.map((r) => r.field_id));
    }
    return [...new Set(ids)].flatMap((id) => {
        const f = byId.get(id);
        return f ? [{ id: f.id, slug: f.slug, label: f.label }] : [];
    });
}
