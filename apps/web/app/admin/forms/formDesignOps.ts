import {
    formItemSchema,
    isFormFieldType,
    newFormItemId,
    splitFormPages,
    type FormConfig,
    type FormItem,
    type FormSettings,
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
}

export function insertAfter(items: FormItem[], item: FormItem, afterId: string | null): FormItem[] {
    if (afterId === null) return [...items, item];
    const idx = items.findIndex((i) => i.id === afterId);
    if (idx < 0) return [...items, item];
    return [...items.slice(0, idx + 1), item, ...items.slice(idx + 1)];
}

export function addFieldItem(config: FormConfig, fieldId: number, afterId: string | null): { config: FormConfig; id: string } {
    if (config.items.some((i) => i.type === 'field' && i.field_id === fieldId)) {
        const existing = config.items.find((i) => i.type === 'field' && i.field_id === fieldId)!;
        return { config, id: existing.id };
    }
    const item = formItemSchema.parse({ id: newFormItemId(), type: 'field', field_id: fieldId });
    return { config: { ...config, items: insertAfter(config.items, item, afterId) }, id: item.id };
}

export function addContentItem(
    config: FormConfig,
    type: 'heading' | 'text' | 'page_break',
    afterId: string | null,
): { config: FormConfig; id: string } {
    const item = formItemSchema.parse(
        type === 'page_break'
            ? { id: newFormItemId(), type, title: '' }
            : { id: newFormItemId(), type, text: type === 'heading' ? 'Nueva sección' : '' },
    );
    return { config: { ...config, items: insertAfter(config.items, item, afterId) }, id: item.id };
}

/**
 * v0.1.290 — Número de página (1, 2, 3…) de cada ítem, contando los saltos.
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
            .map((i) => (fieldId !== null && i.show_if?.field_id === fieldId ? { ...i, show_if: null } : i)),
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
    const asked = new Set(config.items.flatMap((i) => (i.type === 'field' ? [i.field_id] : [])));
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
        if (['computed', 'lookup', 'rollup'].includes(f.type)) return false;
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
        .flatMap((i) => (i.type === 'field' ? [{ field_id: i.field_id, item_id: i.id }] : []));
}

export function questionCount(config: FormConfig): number {
    return config.items.filter((i) => i.type === 'field' && !i.hidden).length;
}
