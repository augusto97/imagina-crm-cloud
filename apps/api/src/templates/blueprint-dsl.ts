import {
    BLUEPRINT_VERSION,
    type BlueprintDashboard,
    type BlueprintField,
    type BlueprintList,
    type BlueprintWidget,
    type ListBlueprint,
} from '@imagina-base/shared';

/**
 * Mini-lenguaje para escribir blueprints a mano (v0.1.166): lo usan las
 * plantillas del sistema y, desde v0.1.206, el pack de la sincronización con
 * WooCommerce. Vive aparte para que los dos compartan exactamente las mismas
 * formas (una relation, un rollup con filtro, un KPI) en vez de copiarlas.
 */

// ── Helpers de escritura compacta ────────────────────────────────────────

export const f = (
    label: string,
    slug: string,
    type: BlueprintField['type'],
    extra: Partial<Omit<BlueprintField, 'label' | 'slug' | 'type'>> = {},
): BlueprintField => ({
    label,
    slug,
    type,
    config: {},
    is_required: false,
    is_unique: false,
    is_indexed: false,
    description: null,
    ...extra,
});

export const opt = (value: string, label: string, color: string) => ({ value, label, color });
export const select = (label: string, slug: string, options: Array<ReturnType<typeof opt>>) =>
    f(label, slug, 'select', { config: { options } });
export const ref = (slug: string) => ({ $field: slug });
export const listRef = (key: string) => ({ $list: key });
/** Campo de OTRA lista del pack (lookup/rollup a través de una relación, v0.1.171). */
export const xref = (listKey: string, slug: string) => ({ $field: slug, $list: listKey });
/**
 * Lookup: muestra `otherKey.targetSlug` a través de la relación
 * `relKey.relSlug`. Las dos keys son distintas cuando la relación vive en la
 * propia lista (hacia afuera): el campo destino está del OTRO lado.
 */
export const lookup = (
    label: string,
    slug: string,
    relKey: string,
    relSlug: string,
    otherKey: string,
    targetSlug: string,
    description: string,
) =>
    f(label, slug, 'lookup', {
        config: { relation_field_id: xref(relKey, relSlug), target_field_id: xref(otherKey, targetSlug) },
        description,
    });
type RollupFilter = { slug: string; op: string; value: unknown };

/** Rollup hacia adentro: agrega `targetSlug` de los registros de `relKey` que apuntan acá por `relSlug`. */
export const rollup = (
    label: string,
    slug: string,
    relKey: string,
    relSlug: string,
    operation: 'count' | 'sum' | 'avg' | 'min' | 'max',
    targetSlug: string | null,
    description: string,
    /** Una condición o varias (en AND) sobre la otra lista. */
    filter?: RollupFilter | RollupFilter[],
) => {
    const filters = filter === undefined ? [] : Array.isArray(filter) ? filter : [filter];
    return f(label, slug, 'rollup', {
        config: {
            relation_field_id: xref(relKey, relSlug),
            operation,
            ...(targetSlug ? { target_field_id: xref(relKey, targetSlug) } : {}),
            ...(filters.length > 0
                ? {
                      filter_tree: {
                          type: 'group',
                          logic: 'and',
                          children: filters.map((c) => ({ type: 'condition', field_id: xref(relKey, c.slug), op: c.op, value: c.value })),
                      },
                  }
                : {}),
        },
        description,
    });
};

export const table = (name = 'Tabla', is_default = true, config: Record<string, unknown> = {}) => ({
    name,
    type: 'table' as const,
    config,
    is_default,
});
export const kanban = (name: string, bySlug: string) => ({
    name,
    type: 'kanban' as const,
    config: { group_by_field_id: ref(bySlug) },
    is_default: false,
});
export const calendar = (name: string, dateSlug: string) => ({
    name,
    type: 'calendar' as const,
    config: { date_field_id: ref(dateSlug) },
    is_default: false,
});

export const list = (
    key: string,
    name: string,
    icon: string,
    color: string,
    fields: BlueprintField[],
    rest: Partial<Omit<BlueprintList, 'key' | 'name' | 'icon' | 'color' | 'fields'>> = {},
): BlueprintList => ({
    key,
    name,
    icon,
    color,
    settings: {},
    fields,
    views: [table()],
    automations: [],
    records: [],
    ...rest,
});

export const single = (l: BlueprintList, dashboards: BlueprintDashboard[] = []): ListBlueprint => ({
    version: BLUEPRINT_VERSION,
    lists: [l],
    dashboards,
});

// ── Tableros del pack (v0.1.167) ─────────────────────────────────────────
// Grilla de 12 columnas × filas de 64px. `$field` se resuelve contra la
// lista del propio widget.
export const widget = (
    type: string,
    listKey: string,
    title: string,
    config: Record<string, unknown>,
    x: number,
    y: number,
    w: number,
    h: number,
): BlueprintWidget => ({ type, list: listRef(listKey), title, config, layout: { x, y, w, h } });
export const kpi = (listKey: string, title: string, config: Record<string, unknown>, x: number, y = 0, w = 3) =>
    widget('kpi', listKey, title, { metric: 'count', ...config }, x, y, w, 2);
export const dashboard = (name: string, description: string, widgets: BlueprintWidget[]): BlueprintDashboard => ({
    name,
    description,
    widgets,
    settings: {},
});

