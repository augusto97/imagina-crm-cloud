/**
 * v0.1.470 — Una ficha diseñada nunca esconde campos: los campos de la
 * lista que el diseño no ubica en ningún lado (ni en la cabecera, ni en las
 * propiedades clave, ni en las etapas, ni en ningún bloque de ninguna
 * pestaña) aparecen al final de la primera pestaña en «Otros campos (N)».
 * Así un campo creado DESPUÉS de diseñar la ficha se ve y se edita sin que
 * nadie tenga que volver al editor.
 *
 * Puro y sin zod: lo usan la ficha, el editor («Campos sin ubicar») y el
 * asistente (`get_list_schema`). El portal nunca lo dibuja.
 */
import { isSystemField } from './field';

/** Lo mínimo de un campo que hace falta para decidir. */
export interface UnplacedFieldLite {
    id: number;
    slug: string;
    type: string;
    is_primary?: boolean;
}

/** Lo mínimo del diseño (la plantilla v3 guardada o convertida). */
export interface UnplacedLayoutLike {
    header?: unknown;
    pages?: ReadonlyArray<{ sections?: ReadonlyArray<{ blocks?: ReadonlyArray<ReadonlyArray<{ type?: unknown; config?: unknown }>> }> }>;
    show_unplaced_fields?: unknown;
    unplaced_fields_open?: unknown;
}

/** «Mostrar al final los campos que no están en el diseño» — sin el dato, sí. */
export function readShowUnplacedFields(layout: Pick<UnplacedLayoutLike, 'show_unplaced_fields'> | null | undefined): boolean {
    return layout?.show_unplaced_fields !== false;
}

/** «Cómo empieza» la sección — sin el dato (o con algo raro), plegada. */
export function readUnplacedFieldsOpen(layout: Pick<UnplacedLayoutLike, 'unplaced_fields_open'> | null | undefined): boolean {
    return layout?.unplaced_fields_open === true;
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
};
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(num).filter((n): n is number => n !== null) : []);

/**
 * Los ids de campo que el diseño muestra en algún lado. Un bloque «Archivos»
 * sin campos elegidos muestra TODOS los de archivo; un bloque de vinculados
 * por una relación de la lista muestra esa relación; con `show_meta`, la
 * cabecera muestra creado / actualizado y por quién.
 */
export function placedLayoutFieldIds(layout: UnplacedLayoutLike, fields: readonly UnplacedFieldLite[]): Set<number> {
    const placed = new Set<number>();
    const add = (v: unknown): void => {
        const n = num(v);
        if (n !== null) placed.add(n);
    };
    const header = (layout.header ?? {}) as Record<string, unknown>;
    add(header.title_field_id);
    for (const id of nums(header.subtitle_field_ids)) placed.add(id);
    for (const id of nums(header.chip_field_ids)) placed.add(id);
    add(header.stages_field_id);
    const cover = header.cover as Record<string, unknown> | undefined;
    if (cover && cover.kind === 'image') add(cover.image_field_id);
    const avatar = header.avatar as Record<string, unknown> | undefined;
    if (avatar && avatar.kind === 'image') add(avatar.field_id);
    if (header.show_meta !== false && header.hidden !== true) {
        for (const f of fields) if (isSystemField(f.type)) placed.add(f.id);
    }

    for (const page of layout.pages ?? []) {
        for (const section of page.sections ?? []) {
            for (const column of section.blocks ?? []) {
                for (const block of column ?? []) {
                    const c = (block?.config ?? {}) as Record<string, unknown>;
                    switch (block?.type) {
                        case 'field':
                        case 'stages':
                            add(c.field_id);
                            break;
                        case 'fields':
                            for (const id of nums(c.field_ids)) placed.add(id);
                            break;
                        case 'files': {
                            const ids = nums(c.field_ids);
                            if (ids.length > 0) for (const id of ids) placed.add(id);
                            else for (const f of fields) if (f.type === 'file') placed.add(f.id);
                            break;
                        }
                        case 'text':
                        case 'embed':
                            if (c.source === 'field') add(c.field_id);
                            break;
                        case 'button':
                            add(c.target_field_id);
                            break;
                        case 'related': {
                            const src = c.source as { kind?: unknown; field_id?: unknown } | undefined;
                            if (src && src.kind === 'related') add(src.field_id);
                            break;
                        }
                        default:
                            break;
                    }
                }
            }
        }
    }
    return placed;
}

/**
 * Los campos de la lista que el diseño no muestra, en el orden de la lista.
 * Fuera: el campo de título (va arriba de todo), los que quien mira tiene
 * ocultos por su rol y, si el diseño apagó la sección, todos.
 */
export function unplacedLayoutFields<F extends UnplacedFieldLite>(
    layout: UnplacedLayoutLike | null | undefined,
    fields: readonly F[],
    opts: { hiddenSlugs?: Iterable<string>; titleFieldId?: number | null; ignoreSetting?: boolean } = {},
): F[] {
    if (!layout) return [];
    if (opts.ignoreSetting !== true && !readShowUnplacedFields(layout)) return [];
    const placed = placedLayoutFieldIds(layout, fields);
    const hidden = new Set(opts.hiddenSlugs ?? []);
    const header = (layout.header ?? {}) as Record<string, unknown>;
    const titleId = num(header.title_field_id) ?? num(opts.titleFieldId) ?? fields.find((f) => f.is_primary)?.id ?? null;
    return fields.filter((f) => f.id !== titleId && !placed.has(f.id) && !hidden.has(f.slug));
}
