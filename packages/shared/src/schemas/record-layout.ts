import { z } from 'zod';
import { idSchema } from './common';
import type { FieldType } from './field';
import { filterTreeSchema } from './filter';

/**
 * v0.1.230 — Plantillas de la ficha del registro, versión 3.
 *
 * La v2 (un grid de 12 columnas con bloques sueltos `x/y/w/pos` y los campos
 * referenciados por SLUG) no podía expresar lo que la gente arma en una ficha
 * moderna: pestañas, secciones con columnas, cada campo mostrado de la forma
 * que corresponde a su tipo (un porcentaje como anillo, una fecha como cuenta
 * regresiva, un select como etapas) y gráficos sobre los registros VINCULADOS
 * (las facturas de este cliente agrupadas por estado).
 *
 * Forma:
 *
 *   { v: 3, theme, header, pages: [{ id, name, sections: [{ columns, blocks }] }] }
 *
 * - Las secciones reparten 12 columnas (`columns: [8, 4]`) y cada columna es
 *   una PILA de bloques (`blocks[i]`): no hay coordenadas que se desalineen.
 * - Toda referencia es por ID (regla de oro nº 1): `field_id`, `list_id`.
 * - Un bloque de datos declara su FUENTE (`DataSource`): el propio registro,
 *   los registros vinculados por una relación (en cualquiera de los dos
 *   sentidos) o una lista entera.
 *
 * Vive en `list.settings.record_layout_v3`. Las plantillas v2 se convierten
 * solas al leerlas (`migrateCrmV2ToV3`): nadie pierde su diseño.
 */

// ── Fuentes de datos ─────────────────────────────────────────────────────

/**
 * De dónde salen los datos de un bloque.
 *  - `record`: el propio registro (sus campos).
 *  - `related`: los registros vinculados por el campo relation `field_id`.
 *    Si el campo es de ESTA lista son sus destinos (hacia afuera); si es de
 *    otra lista, los registros de esa lista que apuntan a éste (hacia
 *    adentro). `direction` sólo hace falta en una relación de la lista
 *    consigo misma, donde los dos sentidos son posibles.
 *  - `list`: una lista entera (comparar al registro con el total).
 */
export const layoutDataSourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('record') }),
    z.object({
        kind: z.literal('related'),
        field_id: idSchema,
        direction: z.enum(['forward', 'reverse']).optional(),
    }),
    z.object({ kind: z.literal('list'), list_id: idSchema }),
]);
export type LayoutDataSource = z.infer<typeof layoutDataSourceSchema>;

// ── Bloques ──────────────────────────────────────────────────────────────

export const LAYOUT_BLOCK_TYPES = [
    // Datos del registro
    'field',
    'fields',
    'stages',
    'description',
    'files',
    'record_stats',
    // Datos vinculados / agregados
    'related',
    'chart',
    // Conversación
    'comments',
    'activity',
    // Contenido
    'heading',
    'text',
    'notice',
    'image',
    'gallery',
    'button',
    'embed',
    'divider',
    'spacer',
    // Acciones
    'portal_access',
    // v0.1.251 — cobros con Mercado Pago / Wompi (links de pago del registro).
    'payments',
] as const;
export const layoutBlockTypeSchema = z.enum(LAYOUT_BLOCK_TYPES);
export type LayoutBlockType = z.infer<typeof layoutBlockTypeSchema>;

/**
 * Un bloque. `config` depende del tipo y es permisivo a propósito (la
 * interfaz guarda opciones de presentación que el backend no necesita
 * conocer); lo que el backend SÍ lee (las fuentes y la config de gráficos
 * y vistas vinculadas) se valida al pedir los datos. `style` es la capa de
 * estilo compartida con los tableros (`lib/blockStyle`).
 */
export const layoutBlockSchema = z
    .object({
        id: z.string().min(1).max(80),
        type: layoutBlockTypeSchema,
        title: z.string().max(200).optional(),
        config: z.record(z.unknown()).default({}),
        style: z.record(z.unknown()).optional(),
    })
    .passthrough();
export type LayoutBlock = z.infer<typeof layoutBlockSchema>;

/** Visualizaciones de un bloque `chart` (las mismas que los tableros). */
export const LAYOUT_CHART_KINDS = ['kpi', 'bar', 'pie', 'line', 'area', 'funnel', 'gauge', 'stat_delta', 'table'] as const;
export const layoutChartKindSchema = z.enum(LAYOUT_CHART_KINDS);
export type LayoutChartKind = z.infer<typeof layoutChartKindSchema>;

/** Tipo de widget de tablero equivalente (el motor y los componentes son los mismos). */
export const CHART_KIND_WIDGET: Record<LayoutChartKind, string> = {
    kpi: 'kpi',
    bar: 'chart_bar',
    pie: 'chart_pie',
    line: 'chart_line',
    area: 'chart_area',
    funnel: 'funnel',
    gauge: 'gauge',
    stat_delta: 'stat_delta',
    table: 'table',
};

/** Vistas de un bloque `related`. */
export const RELATED_VIEWS = ['table', 'list', 'cards', 'board', 'timeline', 'gallery'] as const;
export const relatedViewSchema = z.enum(RELATED_VIEWS);
export type RelatedView = z.infer<typeof relatedViewSchema>;

/**
 * Lo que el backend lee de un bloque `chart` para calcular sus datos. El
 * resto de claves (icono, prefijo, meta, colores) son del front y viajan
 * tal cual.
 */
export const layoutChartConfigSchema = z
    .object({
        source: layoutDataSourceSchema,
        kind: layoutChartKindSchema.default('kpi'),
        metric: z.string().max(40).optional(),
        metric_field_id: idSchema.optional(),
        group_by_field_id: idSchema.optional(),
        date_field_id: idSchema.optional(),
        time_bucket: z.string().max(20).optional(),
        filter_tree: filterTreeSchema.optional(),
        visible_field_ids: z.array(idSchema).max(12).optional(),
        sort_field_id: idSchema.optional(),
        sort_dir: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        period_days: z.number().int().min(1).max(365).optional(),
    })
    .passthrough();
export type LayoutChartConfig = z.infer<typeof layoutChartConfigSchema>;

/** Lo que el backend lee de un bloque `related` para listar los vinculados. */
export const layoutRelatedConfigSchema = z
    .object({
        source: layoutDataSourceSchema,
        view: relatedViewSchema.default('table'),
        field_ids: z.array(idSchema).max(12).optional(),
        sort_field_id: idSchema.optional(),
        sort_dir: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        filter_tree: filterTreeSchema.optional(),
    })
    .passthrough();
export type LayoutRelatedConfig = z.infer<typeof layoutRelatedConfigSchema>;

// ── Secciones, páginas, cabecera y tema ──────────────────────────────────

export const layoutSectionSchema = z
    .object({
        id: z.string().min(1).max(80),
        title: z.string().max(200).optional(),
        /** Anchos de columna sobre 12 (1 a 4 columnas). */
        columns: z.array(z.number().int().min(1).max(12)).min(1).max(4),
        /** Una pila de bloques por columna. */
        blocks: z.array(z.array(layoutBlockSchema).max(40)),
        style: z.record(z.unknown()).optional(),
    })
    .passthrough()
    .refine((s) => s.columns.reduce((a, b) => a + b, 0) === 12, {
        message: 'Las columnas de una sección tienen que sumar 12',
        path: ['columns'],
    })
    .refine((s) => s.blocks.length === s.columns.length, {
        message: 'Cada columna necesita su pila de bloques',
        path: ['blocks'],
    });
export type LayoutSection = z.infer<typeof layoutSectionSchema>;

export const layoutPageSchema = z
    .object({
        id: z.string().min(1).max(80),
        name: z.string().trim().min(1).max(60),
        icon: z.string().max(40).optional(),
        sections: z.array(layoutSectionSchema).max(30),
    })
    .passthrough();
export type LayoutPage = z.infer<typeof layoutPageSchema>;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const layoutHeaderSchema = z
    .object({
        /** Campo del título (null = el campo de título de la lista). */
        title_field_id: idSchema.nullable().optional(),
        /** Una línea bajo el título (empresa · ciudad). */
        subtitle_field_ids: z.array(idSchema).max(4).default([]),
        /** Propiedades como chips junto al título (estado, responsable, fecha). */
        chip_field_ids: z.array(idSchema).max(8).default([]),
        /** Un select mostrado como ETAPAS bajo la cabecera (clickeable). */
        stages_field_id: idSchema.nullable().optional(),
        cover: z
            .object({
                kind: z.enum(['none', 'color', 'gradient', 'image']).default('gradient'),
                color: hexColorSchema.optional(),
                image_field_id: idSchema.optional(),
                image_url: z.string().max(2000).optional(),
            })
            .default({ kind: 'gradient' }),
        avatar: z
            .object({
                kind: z.enum(['initials', 'image', 'icon', 'none']).default('initials'),
                field_id: idSchema.optional(),
                icon: z.string().max(40).optional(),
            })
            .default({ kind: 'initials' }),
        /** Creado / actualizado / por quién. */
        show_meta: z.boolean().default(true),
    })
    .passthrough();
export type LayoutHeader = z.infer<typeof layoutHeaderSchema>;

export const LAYOUT_THEME_PRESETS = ['default', 'minimal', 'corporate', 'fresh', 'warm'] as const;
export const layoutThemeSchema = z
    .object({
        preset: z.enum(LAYOUT_THEME_PRESETS).default('default'),
        /** Acento propio (null = el color primario de la empresa). */
        accent: hexColorSchema.nullable().optional(),
        radius: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
        density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
        surface: z.enum(['cards', 'flat', 'outlined']).optional(),
    })
    .passthrough();
export type LayoutTheme = z.infer<typeof layoutThemeSchema>;

export const recordLayoutV3Schema = z
    .object({
        v: z.literal(3),
        theme: layoutThemeSchema.default({ preset: 'default' }),
        header: layoutHeaderSchema.default({}),
        pages: z.array(layoutPageSchema).min(1).max(12),
    })
    .passthrough();
export type RecordLayoutV3 = z.infer<typeof recordLayoutV3Schema>;
/** Lo que se escribe (defaults opcionales). */
export type RecordLayoutV3Input = z.input<typeof recordLayoutV3Schema>;

/** Todos los bloques de una plantilla, en orden de lectura. */
export function layoutBlocks(layout: Pick<RecordLayoutV3, 'pages'>): LayoutBlock[] {
    const out: LayoutBlock[] = [];
    for (const page of layout.pages) {
        for (const section of page.sections) {
            for (const column of section.blocks) out.push(...column);
        }
    }
    return out;
}

/** Bloques que necesitan datos calculados por el servidor (gráficos y vinculados). */
export const DATA_BLOCK_TYPES: readonly LayoutBlockType[] = ['chart', 'related'];

// ── Formas de mostrar un campo ───────────────────────────────────────────

export interface FieldDisplayDef {
    key: string;
    label: string;
}

/**
 * Cómo se puede mostrar cada TIPO de campo en un bloque `field` (y dentro
 * de `fields`). La primera es la de siempre. La interfaz arma el selector
 * con esto y el renderer cae a la primera si recibe una que el tipo no
 * admite (un campo que cambió de tipo no rompe la ficha).
 */
export const FIELD_DISPLAYS: Record<FieldType, readonly FieldDisplayDef[]> = {
    text: [
        { key: 'text', label: 'Texto' },
        { key: 'big', label: 'Destacado' },
        { key: 'badge', label: 'Etiqueta' },
        { key: 'copy', label: 'Con botón de copiar' },
    ],
    long_text: [
        { key: 'text', label: 'Texto' },
        { key: 'quote', label: 'Cita' },
        { key: 'clamp', label: 'Resumen desplegable' },
    ],
    // v0.1.277 — el campo con IA se muestra como un texto largo.
    ai: [
        { key: 'text', label: 'Texto' },
        { key: 'quote', label: 'Cita' },
        { key: 'clamp', label: 'Resumen desplegable' },
    ],
    number: [
        { key: 'number', label: 'Número' },
        { key: 'big', label: 'Cifra grande' },
        { key: 'bar', label: 'Barra de progreso' },
        { key: 'ring', label: 'Anillo' },
        { key: 'gauge', label: 'Medidor' },
    ],
    currency: [
        { key: 'number', label: 'Importe' },
        { key: 'big', label: 'Cifra grande' },
        { key: 'bar', label: 'Barra hacia una meta' },
        { key: 'gauge', label: 'Medidor hacia una meta' },
    ],
    percent: [
        { key: 'bar', label: 'Barra de progreso' },
        { key: 'ring', label: 'Anillo' },
        { key: 'gauge', label: 'Medidor' },
        { key: 'big', label: 'Cifra grande' },
        { key: 'number', label: 'Número' },
    ],
    rating: [
        { key: 'stars', label: 'Estrellas' },
        { key: 'big', label: 'Cifra grande' },
    ],
    duration: [
        { key: 'number', label: 'Duración' },
        { key: 'big', label: 'Cifra grande' },
    ],
    date: [
        { key: 'date', label: 'Fecha' },
        { key: 'relative', label: 'Relativa (hace 3 días)' },
        { key: 'countdown', label: 'Cuenta regresiva' },
        { key: 'calendar', label: 'Hoja de calendario' },
    ],
    datetime: [
        { key: 'date', label: 'Fecha y hora' },
        { key: 'relative', label: 'Relativa (hace 3 horas)' },
        { key: 'countdown', label: 'Cuenta regresiva' },
        { key: 'calendar', label: 'Hoja de calendario' },
    ],
    checkbox: [
        { key: 'check', label: 'Casilla' },
        { key: 'badge', label: 'Etiqueta Sí / No' },
    ],
    select: [
        { key: 'chip', label: 'Etiqueta' },
        { key: 'stages', label: 'Etapas' },
        { key: 'big', label: 'Etiqueta grande' },
    ],
    multi_select: [
        { key: 'chips', label: 'Etiquetas' },
        { key: 'list', label: 'Lista' },
    ],
    email: [
        { key: 'link', label: 'Enlace' },
        { key: 'button', label: 'Botón' },
    ],
    url: [
        { key: 'link', label: 'Enlace' },
        { key: 'button', label: 'Botón' },
        { key: 'image', label: 'Imagen' },
    ],
    phone: [
        { key: 'link', label: 'Número' },
        { key: 'button', label: 'Botón para llamar' },
    ],
    user: [
        { key: 'avatar', label: 'Avatar y nombre' },
        { key: 'name', label: 'Sólo el nombre' },
    ],
    relation: [
        { key: 'chips', label: 'Etiquetas' },
        { key: 'list', label: 'Lista' },
    ],
    file: [
        { key: 'list', label: 'Lista de archivos' },
        { key: 'gallery', label: 'Galería' },
    ],
    computed: [
        { key: 'auto', label: 'Según el resultado' },
        { key: 'big', label: 'Cifra grande' },
    ],
    lookup: [{ key: 'auto', label: 'Según el campo de origen' }],
    rollup: [
        { key: 'number', label: 'Número' },
        { key: 'big', label: 'Cifra grande' },
        { key: 'bar', label: 'Barra hacia una meta' },
        { key: 'gauge', label: 'Medidor hacia una meta' },
    ],
};

export function defaultDisplayFor(type: FieldType): string {
    return FIELD_DISPLAYS[type]?.[0]?.key ?? 'auto';
}

/** La forma pedida si el tipo la admite; si no, la de siempre. */
export function resolveDisplay(type: FieldType, display: unknown): string {
    const all = FIELD_DISPLAYS[type] ?? [];
    return typeof display === 'string' && all.some((d) => d.key === display) ? display : defaultDisplayFor(type);
}

// ── Lectura tolerante ────────────────────────────────────────────────────

/** `settings.record_layout_v3` si valida; si no, null (la ficha cae a la conversión). */
export function readRecordLayoutV3(settings: Record<string, unknown> | null | undefined): RecordLayoutV3 | null {
    const parsed = recordLayoutV3Schema.safeParse((settings ?? {}).record_layout_v3);
    return parsed.success ? parsed.data : null;
}

// ── Datos de la ficha ────────────────────────────────────────────────────

/**
 * `POST /lists/:list/records/:id/layout-data` — la ficha pide en UN request
 * los datos de todos sus bloques que los necesitan (gráficos y vinculados).
 * Viaja la config de los bloques (y no un id de plantilla) para que el
 * editor pueda previsualizar lo que todavía no se guardó: el servidor
 * valida la fuente y aplica el ACL de quien mira igual.
 */
export const layoutDataRequestSchema = z.object({
    blocks: z
        .array(
            z.object({
                id: z.string().min(1).max(80),
                type: z.enum(['chart', 'related']),
                title: z.string().max(200).optional(),
                config: z.record(z.unknown()),
            }),
        )
        .max(40),
});
export type LayoutDataRequest = z.infer<typeof layoutDataRequestSchema>;
