import {
    fieldDefaultOf,
    formConditionRules,
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
        const rules = formConditionRules(c).filter((r) => !fieldIds.has(r.field_id));
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
    return config.settings.jumps.length + config.settings.endings.length;
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
export function availableFields<F extends FieldLike>(fields: readonly F[], config: FormConfig): F[] {
    const asked = usedFieldIds(config);
    return fields.filter((f) => isFormFieldType(f.type) && !asked.has(f.id));
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
