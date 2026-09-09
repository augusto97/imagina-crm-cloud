import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { dashboardVisibilitySchema } from './dashboard';
import { fieldTypeSchema } from './field';
import { BLUEPRINT_VERSION, blueprintWidgetSchema, templateCategorySchema } from './list-template';

/**
 * Plantillas de dashboards y de automatizaciones (v0.1.167).
 *
 * A diferencia de una plantilla de LISTA —que crea la lista y sus campos—,
 * un tablero o una automatización se aplican SOBRE una lista que ya existe,
 * con sus propios campos. Por eso estas plantillas no hablan de campos
 * concretos sino de ROLES: "el campo de estado (un select)", "el monto (una
 * moneda o un número)", "la fecha de vencimiento". Al aplicarlas, quien las
 * usa elige la lista y a qué campo suyo corresponde cada rol — igual que
 * ClickUp pide la ubicación al usar una plantilla de dashboard — y el
 * cuerpo se re-escribe con los ids/slugs reales.
 *
 * Dentro del cuerpo, un rol se referencia como `{ $field: key }` (dashboards:
 * las claves `*_field_id` de los widgets) o directamente por su `key` como
 * si fuera un slug (automatizaciones: condiciones, `changed_fields`,
 * `values` de update_field y merge tags `{{key}}`).
 */

// ── Roles ────────────────────────────────────────────────────────────────

export const templateRoleFieldSchema = z.object({
    key: z.string().min(1).max(63),
    label: z.string().min(1).max(190),
    /** Tipos de campo aceptables para este rol (vacío = cualquiera). */
    types: z.array(fieldTypeSchema).default([]),
    required: z.boolean().default(true),
});
export type TemplateRoleField = z.infer<typeof templateRoleFieldSchema>;

export const templateRoleListSchema = z.object({
    key: z.string().min(1).max(63),
    label: z.string().min(1).max(190),
    fields: z.array(templateRoleFieldSchema).default([]),
});
export type TemplateRoleList = z.infer<typeof templateRoleListSchema>;

// ── Dashboards ───────────────────────────────────────────────────────────

export const dashboardTemplateSchema = z.object({
    version: z.literal(BLUEPRINT_VERSION),
    lists: z.array(templateRoleListSchema).min(1).max(5),
    widgets: z.array(blueprintWidgetSchema).min(1),
    settings: z.record(z.unknown()).default({}),
});
export type DashboardTemplate = z.infer<typeof dashboardTemplateSchema>;

export const dashboardTemplateSummarySchema = z.object({
    id: z.string().min(1),
    source: z.enum(['system', 'workspace']),
    name: z.string().min(1).max(190),
    description: z.string().max(2000).nullable().default(null),
    category: templateCategorySchema.default('otros'),
    /** Icono del catálogo de listas (v0.1.168; null = genérico de tablero). */
    icon: z.string().max(64).nullable().default(null),
    color: z.string().max(32).nullable().default(null),
    /** Los roles: es lo que la UI necesita para el paso de mapeo. */
    lists: z.array(templateRoleListSchema),
    widgets: z.array(z.object({ type: z.string(), title: z.string() })),
    created_at: isoDateTimeSchema.nullable().default(null),
});
export type DashboardTemplateSummary = z.infer<typeof dashboardTemplateSummarySchema>;

/** `POST /dashboard-templates` — guardar un dashboard del workspace como plantilla. */
export const createDashboardTemplateSchema = z.object({
    dashboard_id: idSchema,
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullish(),
    category: templateCategorySchema.optional(),
});
export type CreateDashboardTemplateInput = z.infer<typeof createDashboardTemplateSchema>;

/** Mapeo de UN rol de lista: la lista elegida y el campo por cada rol de campo. */
export const roleListMappingSchema = z.object({
    list_id: idSchema,
    fields: z.record(idSchema).default({}),
});
export type RoleListMapping = z.infer<typeof roleListMappingSchema>;

/** `POST /dashboard-templates/:id/apply` */
export const applyDashboardTemplateSchema = z.object({
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullish(),
    visibility: dashboardVisibilitySchema.optional(),
    allowed_roles: z.array(z.string()).max(10).optional(),
    /** key del rol de lista → mapeo. */
    lists: z.record(roleListMappingSchema),
});
export type ApplyDashboardTemplateInput = z.infer<typeof applyDashboardTemplateSchema>;

// ── Automatizaciones ─────────────────────────────────────────────────────

export const AUTOMATION_TEMPLATE_CATEGORIES = ['correo', 'plazos', 'campos', 'integraciones', 'otros'] as const;
export const automationTemplateCategorySchema = z.enum(AUTOMATION_TEMPLATE_CATEGORIES);
export type AutomationTemplateCategory = z.infer<typeof automationTemplateCategorySchema>;

/**
 * Cuerpo de una automatización con los campos expresados por ROL (la key
 * del rol ocupa el lugar del slug). Se aplica en el cliente: se re-escribe
 * con `remapAutomationSlugs` y se abre en el editor para revisar antes de
 * guardar — una receta trae destinatarios o valores que hay que completar.
 */
export const automationTemplateSchema = z.object({
    version: z.literal(BLUEPRINT_VERSION),
    fields: z.array(templateRoleFieldSchema).default([]),
    name: z.string().min(1).max(190),
    description: z.string().max(2000).nullable().default(null),
    trigger_type: z.string().min(1),
    trigger_config: z.record(z.unknown()).default({}),
    actions: z.array(z.unknown()).min(1),
});
export type AutomationTemplate = z.infer<typeof automationTemplateSchema>;

export const automationTemplateSummarySchema = z.object({
    id: z.string().min(1),
    source: z.enum(['system', 'workspace']),
    name: z.string().min(1).max(190),
    description: z.string().max(2000).nullable().default(null),
    category: automationTemplateCategorySchema.default('otros'),
    template: automationTemplateSchema,
    created_at: isoDateTimeSchema.nullable().default(null),
});
export type AutomationTemplateSummary = z.infer<typeof automationTemplateSummarySchema>;

/** `POST /automation-templates` — guardar una automatización como plantilla. */
export const createAutomationTemplateSchema = z.object({
    list_id: idSchema,
    automation_id: idSchema,
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullish(),
    category: automationTemplateCategorySchema.optional(),
});
export type CreateAutomationTemplateInput = z.infer<typeof createAutomationTemplateSchema>;

// ── Helpers puros ────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Todos los `{ $field: key }` que aparecen en un valor (sin repetir). */
export function collectFieldTokens(value: unknown): string[] {
    const out = new Set<string>();
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
            for (const item of v) walk(item);
            return;
        }
        if (isPlainObject(v)) {
            if (typeof v.$field === 'string' && Object.keys(v).length === 1) {
                out.add(v.$field);
                return;
            }
            for (const inner of Object.values(v)) walk(inner);
        }
    };
    walk(value);
    return [...out];
}

/**
 * Dónde vive un slug dentro de una automatización:
 *  - claves `slug` / `field` / `due_field` / `date_field` (condiciones,
 *    trigger field_changed, due_date_reached);
 *  - los ítems de `changed_fields`;
 *  - las CLAVES de `values` (update_field / create_record) y de un
 *    `field_filters` en su forma legacy de objeto plano;
 *  - los merge tags `{{slug}}`, `{{before.slug}}` y `{{slug|+1m}}` en
 *    cualquier cadena. Los tags de sistema (`record.id`, `date.today`,
 *    `payload.x`) llevan punto y no se tocan.
 */
const SLUG_KEYS: ReadonlySet<string> = new Set(['slug', 'field', 'due_field', 'date_field']);
const SLUG_ARRAY_KEYS: ReadonlySet<string> = new Set(['changed_fields']);
const SLUG_MAP_KEYS: ReadonlySet<string> = new Set(['values', 'field_filters']);
const MERGE_TAG_RE = /\{\{\s*(before\.)?([A-Za-z0-9_]+)((?:\|[^}]*)?)\s*\}\}/g;

function walkAutomationSlugs(value: unknown, onSlug: (slug: string) => string | undefined): unknown {
    const mapString = (s: string): string =>
        s.replace(MERGE_TAG_RE, (whole, before: string | undefined, slug: string, mods: string) => {
            const next = onSlug(slug);
            return next === undefined ? whole : `{{${before ?? ''}${next}${mods}}}`;
        });
    const walk = (v: unknown, key: string | null): unknown => {
        if (typeof v === 'string') {
            if (key !== null && SLUG_KEYS.has(key)) return onSlug(v) ?? v;
            return mapString(v);
        }
        if (Array.isArray(v)) {
            if (key !== null && SLUG_ARRAY_KEYS.has(key)) {
                return v.map((item) => (typeof item === 'string' ? onSlug(item) ?? item : item));
            }
            return v.map((item) => walk(item, null));
        }
        if (isPlainObject(v)) {
            const renameKeys = key !== null && SLUG_MAP_KEYS.has(key);
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v)) {
                const nk = renameKeys ? onSlug(k) ?? k : k;
                out[nk] = walk(inner, k);
            }
            return out;
        }
        return v;
    };
    return walk(value, null);
}

/** Slugs de campo que una automatización referencia (trigger + acciones). */
export function collectAutomationSlugs(auto: { trigger_config: unknown; actions: unknown }): string[] {
    const found = new Set<string>();
    walkAutomationSlugs({ trigger_config: auto.trigger_config, actions: auto.actions }, (slug) => {
        found.add(slug);
        return undefined;
    });
    return [...found];
}

/**
 * Re-escribe una automatización cambiando slugs por otros (rol → campo real
 * al aplicar una plantilla; slug viejo → nuevo al renombrar). Lo que no está
 * en `mapping` queda tal cual.
 */
export function remapAutomationSlugs<T extends { trigger_config: Record<string, unknown>; actions: unknown[] }>(
    auto: T,
    mapping: ReadonlyMap<string, string> | Record<string, string>,
): T {
    const map = mapping instanceof Map ? mapping : new Map(Object.entries(mapping));
    const r = walkAutomationSlugs(
        { trigger_config: auto.trigger_config, actions: auto.actions },
        (slug) => map.get(slug),
    ) as { trigger_config: Record<string, unknown>; actions: unknown[] };
    return { ...auto, trigger_config: r.trigger_config, actions: r.actions };
}
