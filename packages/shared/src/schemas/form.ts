import { z } from 'zod';
import type { FieldType } from './field';

/**
 * v0.1.275 — Formularios públicos (ADR-S39).
 *
 * Un formulario es una puerta de ENTRADA a una lista: quien lo completa
 * (sin cuenta) crea un registro. Vive en su propia tabla (`forms`, RLS) y
 * se publica por un token opaco, igual que la lista pública de ADR-S14 —
 * pero al revés: aquélla deja LEER, éste deja ESCRIBIR, y sólo los campos
 * que el formulario pregunta.
 *
 * El diseño se guarda como `config` = ítems ordenados + ajustes. Cada ítem
 * de campo apunta al campo por ID (regla de oro nº 1): renombrar el campo
 * o cambiarle el slug no rompe el formulario.
 */

/** Tipos de campo que un formulario puede preguntar. */
export const FORM_FIELD_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'email',
    'url',
    'phone',
    'rating',
    'percent',
    'duration',
    'file',
] as const satisfies readonly FieldType[];
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

const FORM_TYPE_SET = new Set<string>(FORM_FIELD_TYPES);
/**
 * ¿Este tipo de campo se puede preguntar en un formulario? Quedan afuera los
 * que no escribe una persona (calculados, lookup, rollup), las personas del
 * equipo (`user`: el visitante no conoce a nadie) y las relaciones (exponer
 * los registros de otra lista a cualquiera con el enlace sería una fuga).
 */
export function isFormFieldType(type: string): type is FormFieldType {
    return FORM_TYPE_SET.has(type);
}

export const FORM_CONDITION_OPS = [
    'eq',
    'neq',
    'in',
    'contains',
    'gt',
    'lt',
    'is_empty',
    'is_not_empty',
] as const;
export type FormConditionOp = (typeof FORM_CONDITION_OPS)[number];

/**
 * «Mostrar sólo si…»: depende de la respuesta a OTRO campo del formulario.
 * Una sola condición por ítem a propósito — la lógica que se arma con un
 * clic es la que la gente entiende; un árbol AND/OR acá sería un editor de
 * filtros para personas que sólo quieren «si eligió Empresa, pedir el NIT».
 */
export const formConditionSchema = z.object({
    field_id: z.number().int().positive(),
    op: z.enum(FORM_CONDITION_OPS),
    value: z.unknown().optional(),
});
export type FormCondition = z.infer<typeof formConditionSchema>;

const itemIdSchema = z.string().regex(/^[a-z0-9]{4,24}$/);

export const formFieldItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('field'),
    field_id: z.number().int().positive(),
    /** Pregunta que ve el visitante; vacío = la etiqueta del campo. */
    label: z.string().max(300).default(''),
    help: z.string().max(1000).default(''),
    placeholder: z.string().max(200).default(''),
    /** Obligatorio en ESTE formulario (aunque el campo no lo sea en la lista). */
    required: z.boolean().default(false),
    /**
     * Campo oculto: no se muestra, sólo se completa por la dirección
     * (`?origen=instagram`). Para saber de dónde llegó cada respuesta.
     */
    hidden: z.boolean().default(false),
    /** Selección: botones de opción, lista desplegable o casillas. */
    display: z.enum(['auto', 'radio', 'dropdown']).default('auto'),
    show_if: formConditionSchema.nullable().default(null),
});
export type FormFieldItem = z.infer<typeof formFieldItemSchema>;

export const formHeadingItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('heading'),
    text: z.string().max(300).default(''),
    show_if: formConditionSchema.nullable().default(null),
});

export const formTextItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('text'),
    text: z.string().max(5000).default(''),
    show_if: formConditionSchema.nullable().default(null),
});

export const formItemSchema = z.discriminatedUnion('type', [
    formFieldItemSchema,
    formHeadingItemSchema,
    formTextItemSchema,
]);
export type FormItem = z.infer<typeof formItemSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const formSettingsSchema = z.object({
    title: z.string().max(200).default(''),
    description: z.string().max(5000).default(''),
    submit_label: z.string().max(60).default('Enviar'),
    success_title: z.string().max(200).default('¡Gracias!'),
    success_message: z.string().max(2000).default('Recibimos tu respuesta.'),
    /** Al enviar, llevar a esta dirección (https) en vez del mensaje. */
    redirect_url: z
        .string()
        .max(2000)
        .regex(/^https:\/\/[^\s]+$/, 'La dirección tiene que empezar con https://')
        .nullable()
        .default(null),
    /** Botón «Enviar otra respuesta» en la pantalla de gracias. */
    allow_another: z.boolean().default(true),
    /** Completar campos desde la dirección: `?nombre=Ana&origen=web`. */
    allow_prefill: z.boolean().default(true),
    /** Sitios que pueden insertarlo por iframe; vacío = cualquiera. */
    allowed_domains: z.array(z.string().max(253)).max(50).default([]),
    /** Color del botón y los detalles; null = el color de la marca. */
    accent_color: hexColor.nullable().default(null),
    show_logo: z.boolean().default(true),
    /** Deja de recibir respuestas después de este día (inclusive). */
    closes_at: isoDate.nullable().default(null),
    /** Deja de recibir respuestas al llegar a este número. */
    max_submissions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    closed_message: z.string().max(1000).default('Este formulario ya no está recibiendo respuestas.'),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const FORM_MAX_ITEMS = 120;

export const formConfigSchema = z.object({
    items: z.array(formItemSchema).max(FORM_MAX_ITEMS).default([]),
    settings: formSettingsSchema.default({}),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

export interface FormDto {
    id: number;
    list_id: number;
    name: string;
    enabled: boolean;
    config: FormConfig;
    /** Dirección pública relativa (`/api/v1/public/f/:token`), con o sin publicar. */
    public_path: string;
    submissions_count: number;
    last_submitted_at: string | null;
    created_at: string;
    updated_at: string;
}

export const createFormSchema = z.object({
    name: z.string().trim().min(1).max(120),
    config: formConfigSchema.optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    config: formConfigSchema.optional(),
    /** Emite una dirección nueva: la anterior deja de funcionar. */
    regenerate_token: z.boolean().optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

// ─────────────────────────── Público ───────────────────────────

export interface PublicFormOption {
    value: string;
    label: string;
}

/** Lo que el visitante necesita de cada campo — nada de la lista entera. */
export interface PublicFormFieldItem {
    id: string;
    type: 'field';
    /** Clave del valor en el envío: el id del campo como texto. */
    key: string;
    /** Para completar desde la dirección (`?slug=valor`). */
    slug: string;
    field_type: FormFieldType;
    label: string;
    help: string;
    placeholder: string;
    required: boolean;
    hidden: boolean;
    display: 'radio' | 'dropdown' | 'checkboxes';
    options?: PublicFormOption[];
    /** Sólo lo que el control necesita: máximos, decimales, símbolo, país. */
    config: {
        max_files?: number;
        max?: number;
        min?: number;
        precision?: number;
        currency?: string;
        default_country?: string;
        max_length?: number;
    };
    show_if: FormCondition | null;
}

export type PublicFormItem =
    | PublicFormFieldItem
    | { id: string; type: 'heading'; text: string; show_if: FormCondition | null }
    | { id: string; type: 'text'; text: string; show_if: FormCondition | null };

export interface PublicFormMeta {
    title: string;
    description: string;
    submit_label: string;
    success_title: string;
    success_message: string;
    redirect_url: string | null;
    allow_another: boolean;
    allow_prefill: boolean;
    accent_color: string;
    logo_url: string | null;
    company: string;
    /** Separadores de la empresa para leer «150.000». */
    number_format: 'comma_dot' | 'dot_comma' | 'space_comma';
    items: PublicFormItem[];
    /** null = recibe respuestas; si no, el mensaje de cerrado. */
    closed: string | null;
    /** Sello de carga (anti-robots): el envío tiene que traerlo. */
    stamp: string;
    max_upload_bytes: number;
}

export const submitFormSchema = z.object({
    /** Clave = id del campo como texto (`"12"`). */
    values: z.record(z.string().regex(/^\d{1,12}$/), z.unknown()).default({}),
    /** Archivos subidos antes: clave = id del campo, valor = sus comprobantes. */
    uploads: z.record(z.string().regex(/^\d{1,12}$/), z.array(z.string().max(300)).max(20)).default({}),
    stamp: z.string().max(200),
    /** Campo trampa: una persona nunca lo ve ni lo llena. */
    hp: z.string().max(500).optional(),
});
export type SubmitFormInput = z.infer<typeof submitFormSchema>;

export interface SubmitFormResult {
    ok: true;
    redirect_url: string | null;
}

export interface FormUploadResult {
    token: string;
    name: string;
    size: number;
}

// ─────────────────────────── Lógica pura ───────────────────────────

/** ¿Está vacío este valor como respuesta? (casilla sin marcar cuenta como vacía). */
export function isEmptyAnswer(value: unknown): boolean {
    if (value === null || value === undefined || value === false) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
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
export function formItemVisible(
    item: { show_if: FormCondition | null },
    items: ReadonlyArray<{ type: string; field_id?: number; show_if: FormCondition | null }>,
    values: Record<string, unknown>,
    depth = 0,
): boolean {
    const cond = item.show_if;
    if (!cond) return true;
    if (depth > 20) return false;
    const controller = items.find((i) => i.type === 'field' && i.field_id === cond.field_id);
    // Una condición sobre un campo que ya no está en el formulario no se cumple.
    if (!controller) return false;
    if (!formItemVisible(controller, items, values, depth + 1)) return false;
    return evaluateFormCondition(cond, values[String(cond.field_id)]);
}

/** Id corto y estable para un ítem nuevo. */
export function newFormItemId(): string {
    let s = '';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/**
 * Formulario de arranque para una lista: pregunta sus campos escribibles en
 * orden (hasta 12), con los obligatorios de la lista ya marcados. Es un
 * punto de partida — se edita en el constructor.
 */
export function defaultFormConfig(
    listName: string,
    fields: ReadonlyArray<{ id: number; type: string; is_required?: boolean }>,
): FormConfig {
    const askable = fields.filter((f) => isFormFieldType(f.type)).slice(0, 12);
    return formConfigSchema.parse({
        items: askable.map((f) => ({
            id: newFormItemId(),
            type: 'field',
            field_id: f.id,
            required: f.is_required === true,
        })),
        settings: { title: listName },
    });
}

// ─────────────────────── Preguntas públicas ───────────────────────

/** Lo mínimo de un campo que hace falta para armar su pregunta. */
export interface FormFieldLike {
    id: number;
    slug: string;
    label: string;
    type: string;
    config: Record<string, unknown>;
    is_required: boolean;
    description?: string | null;
}

function optionsOf(field: FormFieldLike): PublicFormOption[] {
    const raw = field.config.options;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((o) => {
        if (!o || typeof o !== 'object') return [];
        const { value, label } = o as { value?: unknown; label?: unknown };
        if (typeof value !== 'string') return [];
        return [{ value, label: typeof label === 'string' && label !== '' ? label : value }];
    });
}

function cfgNum(cfg: Record<string, unknown>, key: string): number | undefined {
    const v = cfg[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function publicField(item: FormFieldItem, field: FormFieldLike): PublicFormFieldItem {
    const cfg = field.config;
    const type = field.type as FormFieldType;
    const options = type === 'select' || type === 'multi_select' ? optionsOf(field) : undefined;
    const display: PublicFormFieldItem['display'] =
        type === 'multi_select'
            ? 'checkboxes'
            : item.display === 'radio' || item.display === 'dropdown'
              ? item.display
              : (options?.length ?? 0) <= 6
                ? 'radio'
                : 'dropdown';
    const config: PublicFormFieldItem['config'] = {};
    const max_files = cfgNum(cfg, 'max_files');
    const max = cfgNum(cfg, 'max');
    const min = cfgNum(cfg, 'min');
    const precision = cfgNum(cfg, 'precision');
    const max_length = cfgNum(cfg, 'max_length');
    if (max_files !== undefined) config.max_files = max_files;
    if (max !== undefined) config.max = max;
    if (min !== undefined) config.min = min;
    if (precision !== undefined) config.precision = precision;
    if (max_length !== undefined) config.max_length = max_length;
    if (typeof cfg.currency === 'string') config.currency = cfg.currency;
    if (typeof cfg.default_country === 'string') config.default_country = cfg.default_country;
    return {
        id: item.id,
        type: 'field',
        key: String(field.id),
        slug: field.slug,
        field_type: type,
        label: item.label.trim() || field.label,
        help: item.help.trim() || (field.description ?? ''),
        placeholder: item.placeholder,
        required: (item.required || field.is_required) && !item.hidden,
        hidden: item.hidden,
        display,
        ...(options ? { options } : {}),
        config,
        show_if: item.show_if,
    };
}

/**
 * Lo que viaja al visitante: sólo las preguntas, nada del resto de la lista.
 * La usan la página pública Y la vista previa del constructor — lo que se ve
 * al diseñar es, por construcción, lo que ve quien lo completa.
 */
export function buildPublicFormItems(config: FormConfig, fields: ReadonlyArray<FormFieldLike>): PublicFormItem[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: PublicFormItem[] = [];
    for (const item of config.items) {
        if (item.type === 'heading' || item.type === 'text') {
            out.push({ id: item.id, type: item.type, text: item.text, show_if: item.show_if });
            continue;
        }
        const field = byId.get(item.field_id);
        if (!field || !isFormFieldType(field.type)) continue;
        out.push(publicField(item, field));
    }
    return out;
}
