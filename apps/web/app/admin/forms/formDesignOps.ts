import {
    fieldDefaultOf,
    formConfigSchema,
    formItemSchema,
    isFormFieldType,
    isUserWritableType,
    newFormItemId,
    splitFormPages,
    type FormConfig,
    type FormItem,
    type FormSettings,
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
    return {
        ...config,
        settings,
        items: config.items
            .filter((i) => i.id !== id)
            .map((i) =>
                (fieldId !== null && i.show_if?.field_id === fieldId) || (i.show_if && rowIds.has(i.show_if.field_id)) ? { ...i, show_if: null } : i,
            ),
    };
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
