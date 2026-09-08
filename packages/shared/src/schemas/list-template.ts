import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { fieldTypeSchema } from './field';
import { viewTypeSchema } from './view';

/**
 * Blueprint de listas (v0.1.166) — el formato PORTABLE de una lista.
 *
 * Es el único mecanismo detrás de "Duplicar lista" y de las plantillas:
 * serializar una lista → blueprint, y materializar un blueprint → lista
 * nueva. Lo que hace ClickUp con "Duplicate" y con su Template Center es,
 * por dentro, exactamente esto.
 *
 * Reglas que lo hacen portable (también entre workspaces):
 *  - Las referencias INTERNAS por id de campo (`title_field_id`,
 *    `group_by_field_id`, `sort[].field_id`, `inputs` de un computed…) se
 *    convierten en tokens `{ "$field": "<slug>" }`: el id es la verdad dentro
 *    de la DB (regla de oro nº 1), pero el blueprint no tiene DB.
 *  - Las referencias a OTRA lista del mismo blueprint (`target_list_id` de
 *    una relation, `list_id` de un create_record) van como
 *    `{ "$list": "<key>" }`, así un pack Clientes + Facturas se materializa
 *    con la relación armada. Un id numérico se conserva tal cual: sólo sirve
 *    dentro del mismo workspace (duplicar), y al aplicar se descarta si la
 *    lista no existe.
 *  - Lo que NO se copia nunca: tokens de webhook entrante (se regeneran al
 *    guardar), la publicación pública (la copia nace SIN publicar) y los
 *    accesos de portal (son por registro).
 */
export const BLUEPRINT_VERSION = 1;

/** Token de referencia a un campo por slug (dentro de la misma lista). */
export const fieldRefSchema = z.object({ $field: z.string().min(1) });
/** Token de referencia a otra lista del mismo blueprint. */
export const listRefSchema = z.object({ $list: z.string().min(1) });

export const blueprintFieldSchema = z.object({
    label: z.string().min(1).max(190),
    slug: z.string().min(1).max(63),
    type: fieldTypeSchema,
    config: z.record(z.unknown()).default({}),
    is_required: z.boolean().default(false),
    is_unique: z.boolean().default(false),
    is_indexed: z.boolean().default(false),
    description: z.string().max(500).nullable().default(null),
});
export type BlueprintField = z.infer<typeof blueprintFieldSchema>;

export const blueprintViewSchema = z.object({
    name: z.string().min(1).max(190),
    type: viewTypeSchema,
    config: z.record(z.unknown()).default({}),
    is_default: z.boolean().default(false),
});
export type BlueprintView = z.infer<typeof blueprintViewSchema>;

export const blueprintAutomationSchema = z.object({
    name: z.string().min(1).max(190),
    description: z.string().max(2000).nullable().default(null),
    trigger_type: z.string().min(1),
    trigger_config: z.record(z.unknown()).default({}),
    actions: z.array(z.unknown()).min(1),
    is_active: z.boolean().default(true),
});
export type BlueprintAutomation = z.infer<typeof blueprintAutomationSchema>;

/**
 * Registro de muestra. `data` va por SLUG (no por `f{id}`: no hay ids).
 * `key` permite que otro registro del blueprint lo referencie (subtareas por
 * `parent_key`, relaciones por `{ "$record": key }`).
 */
export const blueprintRecordSchema = z.object({
    key: z.string().min(1).optional(),
    data: z.record(z.unknown()).default({}),
    parent_key: z.string().min(1).optional(),
    /**
     * slug del campo relation → destinos: una `key` de registro del pack, o
     * el id numérico de un registro que ya existe (sólo vale dentro del
     * mismo workspace, o sea al duplicar).
     */
    relations: z.record(z.array(z.union([z.string(), z.number()]))).optional(),
});
export type BlueprintRecord = z.infer<typeof blueprintRecordSchema>;

export const blueprintListSchema = z.object({
    /** Identificador dentro del blueprint (para `$list`). */
    key: z.string().min(1).max(63),
    name: z.string().min(1).max(190),
    icon: z.string().max(64).nullable().default(null),
    color: z.string().max(32).nullable().default(null),
    settings: z.record(z.unknown()).default({}),
    fields: z.array(blueprintFieldSchema).default([]),
    views: z.array(blueprintViewSchema).default([]),
    automations: z.array(blueprintAutomationSchema).default([]),
    records: z.array(blueprintRecordSchema).default([]),
});
export type BlueprintList = z.infer<typeof blueprintListSchema>;

export const listBlueprintSchema = z.object({
    version: z.literal(BLUEPRINT_VERSION),
    lists: z.array(blueprintListSchema).min(1).max(10),
});
export type ListBlueprint = z.infer<typeof listBlueprintSchema>;

/** Qué llevarse al duplicar / al guardar como plantilla. Los campos siempre van. */
export const blueprintIncludeSchema = z.object({
    views: z.boolean().default(true),
    automations: z.boolean().default(true),
    /** Ajustes de la lista: permisos por rol, apariencia, plantillas de ficha/portal. */
    settings: z.boolean().default(true),
    records: z.boolean().default(false),
});
export type BlueprintInclude = z.infer<typeof blueprintIncludeSchema>;

/** `POST /lists/:id/duplicate` */
export const duplicateListSchema = z.object({
    name: z.string().trim().min(1).max(190).optional(),
    include: blueprintIncludeSchema.default({}),
});
export type DuplicateListInput = z.infer<typeof duplicateListSchema>;

// ── Plantillas ──────────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = [
    'ventas',
    'clientes',
    'proyectos',
    'operaciones',
    'finanzas',
    'personas',
    'otros',
] as const;
export const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;

/** Resumen de una plantilla (galería). El blueprint completo va aparte. */
export const listTemplateSummarySchema = z.object({
    /** `sys:<key>` para las del sistema; el id numérico para las del workspace. */
    id: z.string().min(1),
    source: z.enum(['system', 'workspace']),
    name: z.string().min(1).max(190),
    description: z.string().max(2000).nullable().default(null),
    icon: z.string().max(64).nullable().default(null),
    color: z.string().max(32).nullable().default(null),
    category: templateCategorySchema.default('otros'),
    /** Para la vista previa de la galería sin bajar el blueprint entero. */
    lists: z.array(
        z.object({
            name: z.string(),
            fields: z.array(z.object({ label: z.string(), type: fieldTypeSchema })),
            views: z.array(z.object({ name: z.string(), type: viewTypeSchema })),
            automations: z.array(z.string()),
            records_count: z.number().int().nonnegative(),
        }),
    ),
    created_at: isoDateTimeSchema.nullable().default(null),
});
export type ListTemplateSummary = z.infer<typeof listTemplateSummarySchema>;

/** `POST /list-templates` — guardar UNA lista del workspace como plantilla. */
export const createListTemplateSchema = z.object({
    list_id: idSchema,
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullish(),
    category: templateCategorySchema.optional(),
    include: blueprintIncludeSchema.default({}),
});
export type CreateListTemplateInput = z.infer<typeof createListTemplateSchema>;

/** `POST /list-templates/:id/apply` */
export const applyListTemplateSchema = z.object({
    /** Nombre para la lista (la primera del pack); las demás conservan el suyo. */
    name: z.string().trim().min(1).max(190).optional(),
    include_records: z.boolean().default(true),
    group_id: idSchema.nullable().optional(),
});
export type ApplyListTemplateInput = z.infer<typeof applyListTemplateSchema>;

// ── Tokens: id ↔ slug ────────────────────────────────────────────────────

const FIELD_ID_KEY = /(^|_)field_id$/;
const FIELD_IDS_KEY = /(^|_)field_ids$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reemplaza los ids de campo por tokens `{ $field: slug }` en cualquier JSON
 * (settings de la lista, config de vistas, config de automatizaciones).
 *
 * Qué se considera "id de campo": un número bajo una clave que termina en
 * `field_id`, un array de números bajo una que termina en `field_ids`, y las
 * claves extra que el caller indique (`inputs` de un computed). Un id que no
 * pertenece al mapa se deja tal cual — puede ser un campo de OTRA lista
 * (widgets del portal), y ahí el id numérico sigue siendo la referencia.
 */
export function tokenizeFieldRefs(
    value: unknown,
    idToSlug: ReadonlyMap<number, string>,
    extraArrayKeys: readonly string[] = [],
): unknown {
    const walk = (v: unknown, key: string | null): unknown => {
        if (Array.isArray(v)) {
            const arrayOfIds =
                key !== null && (FIELD_IDS_KEY.test(key) || extraArrayKeys.includes(key));
            return v.map((item) => {
                if (arrayOfIds && typeof item === 'number') {
                    const slug = idToSlug.get(item);
                    return slug === undefined ? item : { $field: slug };
                }
                return walk(item, null);
            });
        }
        if (isPlainObject(v)) {
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v)) out[k] = walk(inner, k);
            return out;
        }
        if (key !== null && FIELD_ID_KEY.test(key) && typeof v === 'number') {
            const slug = idToSlug.get(v);
            return slug === undefined ? v : { $field: slug };
        }
        return v;
    };
    return walk(value, null);
}

/**
 * Inversa de `tokenizeFieldRefs`: `{ $field: slug }` → id. Un slug que no
 * existe en la lista destino se DESCARTA (null en un valor, se quita de un
 * array): una referencia rota es peor que ninguna.
 */
export function resolveFieldRefs(value: unknown, slugToId: ReadonlyMap<string, number>): unknown {
    const walk = (v: unknown): unknown => {
        if (Array.isArray(v)) {
            return v
                .map((item) => walk(item))
                .filter((item) => item !== undefined);
        }
        if (isPlainObject(v)) {
            if (typeof v.$field === 'string' && Object.keys(v).length === 1) {
                const id = slugToId.get(v.$field);
                return id === undefined ? undefined : id;
            }
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v)) {
                const r = walk(inner);
                out[k] = r === undefined ? null : r;
            }
            return out;
        }
        return v;
    };
    const r = walk(value);
    return r === undefined ? null : r;
}

const LIST_ID_KEYS: readonly string[] = ['list_id', 'target_list_id', 'target_list'];

/**
 * Reemplaza los ids de lista del pack por `{ $list: key }` (config de una
 * relation, destino de un create_record). Un id fuera del pack se conserva.
 */
export function tokenizeListRefs(value: unknown, idToKey: ReadonlyMap<number, string>): unknown {
    const walk = (v: unknown, key: string | null): unknown => {
        if (Array.isArray(v)) return v.map((item) => walk(item, null));
        if (isPlainObject(v)) {
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v)) out[k] = walk(inner, k);
            return out;
        }
        if (key !== null && LIST_ID_KEYS.includes(key)) {
            const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
            const k = Number.isInteger(n) ? idToKey.get(n) : undefined;
            return k === undefined ? v : { $list: k };
        }
        return v;
    };
    return walk(value, null);
}

/** `{ $list: key }` → id de lista del pack ya materializado. */
export function resolveListRefs(value: unknown, keyToId: ReadonlyMap<string, number>): unknown {
    const walk = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(walk);
        if (isPlainObject(v)) {
            if (typeof v.$list === 'string' && Object.keys(v).length === 1) {
                return keyToId.get(v.$list) ?? null;
            }
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v)) out[k] = walk(inner);
            return out;
        }
        return v;
    };
    return walk(value);
}

/**
 * Claves de `settings` de la lista que NO viajan en un blueprint:
 *  - `public`: la publicación es un token único por lista; la copia nace sin
 *    publicar (quien la quiera pública la publica a propósito).
 */
export const BLUEPRINT_EXCLUDED_SETTINGS: readonly string[] = ['public'];

/** Claves del `trigger_config` que son credenciales y se regeneran. */
export const BLUEPRINT_EXCLUDED_TRIGGER_KEYS: readonly string[] = ['webhook_token'];
