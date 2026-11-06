import { z } from 'zod';

import { validateFieldValue } from '../field-types/validate';
import { jsonbKeyForField, type FieldType } from './field';

/**
 * v0.1.386 — «Origen y etiquetas» de un formulario: lo que cada registro que
 * llega por ESTE formulario guarda además de las respuestas.
 *
 * - **El nombre del formulario** en una columna de texto: una lista puede
 *   tener varios formularios (el de la landing de Navidad, el de contacto…) y
 *   así se sabe de cuál llegó cada registro (para filtrar, agrupar o armar
 *   automatizaciones).
 * - **Valores fijos**: una etiqueta («Landing Navidad»), un estado inicial,
 *   el responsable o el equipo que le toca… El mismo campo en dos formularios
 *   con valores distintos dice de dónde vino cada uno.
 *
 * La página desde donde se envió vive en `settings.attribution`
 * (`page_url_field_id`, v0.1.374): es un dato de origen como la campaña.
 */

/** Tipos de campo que aceptan un valor fijo (lo que una persona escribe a mano, sin archivos ni vínculos). */
export const FORM_FIXED_VALUE_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'select',
    'multi_select',
    'checkbox',
    'date',
    'datetime',
    'email',
    'url',
    'phone',
    'user',
    'team',
] as const satisfies readonly FieldType[];
const FIXED_TYPE_SET = new Set<string>(FORM_FIXED_VALUE_TYPES);
export function isFormFixedValueType(type: string): boolean {
    return FIXED_TYPE_SET.has(type);
}

/** Tipos de columna que guardan el nombre del formulario. */
export const FORM_NAME_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'long_text']);

/** Qué nombre se guarda: el que ve tu equipo (nombre interno) o el título que ve quien responde. */
export const FORM_NAME_SOURCES = ['name', 'title'] as const;
export type FormNameSource = (typeof FORM_NAME_SOURCES)[number];

export const FORM_MAX_FIXED_VALUES = 20;

export const formFixedValueSchema = z.object({
    field_id: z.number().int().positive(),
    /** Ya normalizado con el validador del campo (el servidor lo vuelve a pasar al guardar). */
    value: z.unknown(),
});
export type FormFixedValue = { field_id: number; value: unknown };

export const formRecordValuesSchema = z.object({
    /** La columna de texto donde va el nombre del formulario (null = no se guarda). */
    form_name_field_id: z.number().int().positive().nullable().catch(null).default(null),
    form_name_source: z.enum(FORM_NAME_SOURCES).catch('name').default('name'),
    /** Valores que se ponen en cada registro. Uno roto se descarta sin tirar los demás. */
    fixed: z
        .array(z.unknown())
        .catch([])
        .default([])
        .transform((arr) =>
            arr.slice(0, FORM_MAX_FIXED_VALUES).flatMap((x): FormFixedValue[] => {
                const r = formFixedValueSchema.safeParse(x);
                return r.success && r.data.value !== undefined ? [{ field_id: r.data.field_id, value: r.data.value }] : [];
            }),
        ),
});
export type FormRecordValues = z.infer<typeof formRecordValuesSchema>;
export const FORM_RECORD_VALUES_DEFAULT: FormRecordValues = { form_name_field_id: null, form_name_source: 'name', fixed: [] };

interface FieldLike {
    id: number;
    type: string;
    config?: Record<string, unknown> | null;
}

function isEmpty(v: unknown): boolean {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Normaliza un valor fijo con el validador del campo (null = el campo no lo acepta o queda vacío). */
export function normalizeFixedValue(field: FieldLike, value: unknown): unknown | null {
    if (!isFormFixedValueType(field.type)) return null;
    const res = validateFieldValue({ type: field.type as FieldType, config: field.config ?? {}, is_required: false }, value);
    if (!res.ok || isEmpty(res.value)) return null;
    // Una casilla «apagada» no es un valor que valga la pena fijar (es lo mismo que nada).
    if (field.type === 'checkbox' && res.value !== true) return null;
    return res.value;
}

/**
 * Limpia lo que llega del constructor o de la API: columnas de la lista y de
 * un tipo que sirve, sin repetir, con el valor normalizado, y nunca una que el
 * formulario ya escribe por otro lado (`taken`: preguntas, cálculos, origen).
 * Una «varias opciones» que el formulario también pregunta SÍ vale: las
 * opciones fijas se suman a las que elige la persona.
 */
export function cleanFormRecordValues(
    rv: FormRecordValues,
    fields: ReadonlyArray<FieldLike>,
    opts: { asked?: ReadonlySet<number>; taken?: ReadonlySet<number> } = {},
): FormRecordValues {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const asked = opts.asked ?? new Set<number>();
    const taken = opts.taken ?? new Set<number>();
    const nameField = rv.form_name_field_id !== null ? byId.get(rv.form_name_field_id) : undefined;
    const formNameId =
        nameField && FORM_NAME_FIELD_TYPES.has(nameField.type) && !asked.has(nameField.id) && !taken.has(nameField.id) ? nameField.id : null;
    const seen = new Set<number>();
    const fixed: FormFixedValue[] = [];
    for (const fv of rv.fixed) {
        const field = byId.get(fv.field_id);
        if (!field || seen.has(field.id) || field.id === formNameId || taken.has(field.id)) continue;
        if (asked.has(field.id) && field.type !== 'multi_select') continue;
        const value = normalizeFixedValue(field, fv.value);
        if (value === null) continue;
        seen.add(field.id);
        fixed.push({ field_id: field.id, value });
    }
    return { form_name_field_id: formNameId, form_name_source: rv.form_name_source, fixed };
}

/** Las columnas que llena «Origen y etiquetas» (para no ofrecerlas como pregunta ni como columna de origen). */
export function formRecordValuesFieldIds(rv: FormRecordValues): Set<number> {
    const out = new Set<number>(rv.fixed.map((f) => f.field_id));
    if (rv.form_name_field_id !== null) out.add(rv.form_name_field_id);
    return out;
}

/** El nombre que se guarda (el título público cae al nombre interno si está vacío). */
export function formNameFor(source: FormNameSource, name: string, title: string): string {
    const t = (source === 'title' ? title.trim() || name : name).trim();
    return t.slice(0, 300);
}

/**
 * Suma lo de «Origen y etiquetas» a lo que respondió la persona (`data`, por
 * clave `f{id}`). Lo que la persona respondió GANA: un valor fijo sólo llena lo
 * que quedó vacío, salvo «varias opciones», donde se suman (sin repetir). Cada
 * valor vuelve a pasar por el validador del campo (pudo cambiar de tipo desde
 * que se armó el formulario): lo que ya no encaja se descarta sin fallar.
 */
export function applyFormRecordValues(
    data: Record<string, unknown>,
    rv: FormRecordValues,
    ctx: { fields: ReadonlyArray<FieldLike>; formName: string; formTitle: string },
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    const byId = new Map(ctx.fields.map((f) => [f.id, f]));
    for (const fv of rv.fixed) {
        const field = byId.get(fv.field_id);
        if (!field) continue;
        const value = normalizeFixedValue(field, fv.value);
        if (value === null) continue;
        const key = jsonbKeyForField(field.id);
        const current = out[key];
        if (field.type === 'multi_select' && Array.isArray(value)) {
            const merged = Array.isArray(current) ? [...(current as unknown[])] : [];
            for (const v of value) if (!merged.includes(v)) merged.push(v);
            out[key] = merged;
        } else if (isEmpty(current) || (field.type === 'checkbox' && current !== true)) {
            out[key] = value;
        }
    }
    if (rv.form_name_field_id !== null) {
        const field = byId.get(rv.form_name_field_id);
        const key = jsonbKeyForField(rv.form_name_field_id);
        const name = formNameFor(rv.form_name_source, ctx.formName, ctx.formTitle);
        if (field && FORM_NAME_FIELD_TYPES.has(field.type) && name !== '' && isEmpty(out[key])) out[key] = name;
    }
    return out;
}
