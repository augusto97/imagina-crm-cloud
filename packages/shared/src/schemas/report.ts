import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { dashboardVisibilitySchema, type WidgetSpec, type WidgetType } from './dashboard';
import { formatYmdRange, periodPresetName } from '../dashboard-report/compare';

/**
 * v0.1.464 (J1) — Informes: un documento armado con bloques (título, texto con
 * formato, indicadores, gráficos y tablas) donde cada bloque de datos puede
 * salir de una lista DISTINTA. Se lee de arriba abajo, se descarga en PDF y en
 * Excel y se programa por correo. La diferencia con un tablero: un tablero es
 * una grilla viva para mirar; un informe es un documento para leer, imprimir
 * y mandar.
 *
 * Un bloque de datos usa EXACTAMENTE la configuración de un widget de tablero
 * (`config` con su métrica, campos, filtros, período y comparación): se
 * calcula con el mismo motor, el mismo ACL y la misma zona horaria. Todo lo
 * guardado apunta a listas y campos por ID (regla de oro nº 1).
 */

/** Tope de bloques de un informe (los de adentro de un bloque de columnas no cuentan aparte). */
export const REPORT_MAX_BLOCKS = 40;
/** Tope de bloques de DATOS (cada uno es al menos una consulta por cada vez que se calcula). */
export const REPORT_MAX_DATA_BLOCKS = 60;
/** Largo máximo del texto de un bloque de texto (formato sencillo). */
export const REPORT_TEXT_MAX = 20_000;

/** Tipos de widget que puede usar un bloque de datos (los de contenido son bloques propios). */
export const REPORT_DATA_TYPES = [
    'kpi',
    'gauge',
    'stat_delta',
    'chart_bar',
    'chart_pie',
    'chart_line',
    'chart_area',
    'funnel',
    'table',
    'pivot',
    'forecast',
] as const satisfies readonly WidgetType[];
export type ReportDataType = (typeof REPORT_DATA_TYPES)[number];

/** Tipos de bloque. */
export const REPORT_BLOCK_TYPES = ['heading', 'text', 'widget', 'columns', 'divider', 'page_break'] as const;
export type ReportBlockType = (typeof REPORT_BLOCK_TYPES)[number];

const blockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Identificador de bloque inválido.');

/** La parte de datos de un bloque: lo mismo que un widget de tablero, sin su lugar en la grilla. */
export const reportDataWidgetSchema = z.object({
    type: z.enum(REPORT_DATA_TYPES),
    list_id: idSchema,
    title: z.string().max(300).default(''),
    config: z.record(z.unknown()).default({}),
});
export type ReportDataWidget = z.infer<typeof reportDataWidgetSchema>;

export const reportHeadingBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('heading'),
    text: z.string().max(300).default(''),
    subtitle: z.string().max(500).default(''),
});
export const reportTextBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('text'),
    /** Formato sencillo: `**negrita**`, `- viñeta`, `## título`, `[enlace](https://…)`. */
    text: z.string().max(REPORT_TEXT_MAX).default(''),
});
export const reportWidgetBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('widget'),
    widget: reportDataWidgetSchema,
});
export const reportColumnsBlockSchema = z.object({
    id: blockIdSchema,
    type: z.literal('columns'),
    /** 2 o 3 bloques de datos lado a lado (en el celular se apilan). */
    children: z.array(reportWidgetBlockSchema).min(2, 'Una fila de columnas lleva 2 o 3 bloques.').max(3, 'Una fila de columnas lleva 2 o 3 bloques.'),
});
export const reportDividerBlockSchema = z.object({ id: blockIdSchema, type: z.literal('divider') });
/** Salto de página: sólo cambia el PDF. */
export const reportPageBreakBlockSchema = z.object({ id: blockIdSchema, type: z.literal('page_break') });

export const reportBlockSchema = z.discriminatedUnion('type', [
    reportHeadingBlockSchema,
    reportTextBlockSchema,
    reportWidgetBlockSchema,
    reportColumnsBlockSchema,
    reportDividerBlockSchema,
    reportPageBreakBlockSchema,
]);
export type ReportBlock = z.infer<typeof reportBlockSchema>;
export type ReportWidgetBlock = z.infer<typeof reportWidgetBlockSchema>;
export type ReportColumnsBlock = z.infer<typeof reportColumnsBlockSchema>;

/** Los bloques de DATOS de un informe, en orden de lectura (los de las columnas, de izquierda a derecha). */
export function reportDataBlocks(blocks: readonly ReportBlock[]): ReportWidgetBlock[] {
    const out: ReportWidgetBlock[] = [];
    for (const b of blocks) {
        if (b.type === 'widget') out.push(b);
        else if (b.type === 'columns') out.push(...b.children);
    }
    return out;
}

/** Todos los ids (bloques y bloques dentro de columnas). */
function allIds(blocks: readonly ReportBlock[]): string[] {
    const ids: string[] = [];
    for (const b of blocks) {
        ids.push(b.id);
        if (b.type === 'columns') for (const c of b.children) ids.push(c.id);
    }
    return ids;
}

/** Los bloques al GUARDAR: estrictos (lo que la persona arma tiene que estar bien). */
export const reportBlocksSchema = z
    .array(reportBlockSchema)
    .max(REPORT_MAX_BLOCKS, `Un informe admite hasta ${REPORT_MAX_BLOCKS} bloques.`)
    .superRefine((blocks, ctx) => {
        const ids = allIds(blocks);
        if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hay dos bloques con el mismo identificador.' });
        if (reportDataBlocks(blocks).length > REPORT_MAX_DATA_BLOCKS) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Un informe admite hasta ${REPORT_MAX_DATA_BLOCKS} bloques de datos.` });
        }
    });

/**
 * Lectura TOLERANTE de los bloques guardados: un bloque roto (una versión
 * futura, una edición a mano) se descarta y se cuenta, sin tirar el informe.
 * Una fila de columnas a la que le queda un solo bloque sano pasa a ser ese
 * bloque suelto; sin ninguno, se descarta.
 */
export function readReportBlocks(raw: unknown): { blocks: ReportBlock[]; dropped: number } {
    if (!Array.isArray(raw)) return { blocks: [], dropped: raw === undefined || raw === null ? 0 : 1 };
    const blocks: ReportBlock[] = [];
    const seen = new Set<string>();
    let dropped = 0;
    const fresh = (id: string): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    };
    for (const item of raw.slice(0, REPORT_MAX_BLOCKS * 2)) {
        if (blocks.length >= REPORT_MAX_BLOCKS) {
            dropped++;
            continue;
        }
        const obj = item as { type?: unknown; children?: unknown } | null;
        if (obj && typeof obj === 'object' && obj.type === 'columns' && Array.isArray(obj.children)) {
            const id = reportColumnsBlockSchema.shape.id.safeParse((obj as { id?: unknown }).id);
            const kids: ReportWidgetBlock[] = [];
            for (const c of obj.children.slice(0, 3)) {
                const p = reportWidgetBlockSchema.safeParse(c);
                if (p.success && fresh(p.data.id)) kids.push(p.data);
                else dropped++;
            }
            if (obj.children.length > 3) dropped += obj.children.length - 3;
            if (kids.length >= 2 && id.success && fresh(id.data)) blocks.push({ id: id.data, type: 'columns', children: kids });
            else if (kids.length >= 1) blocks.push(...kids);
            else dropped++;
            continue;
        }
        const p = reportBlockSchema.safeParse(item);
        if (p.success && fresh(p.data.id)) blocks.push(p.data);
        else dropped++;
    }
    return { blocks, dropped };
}

/**
 * Ajustes del informe: el período y la comparación GLOBALES (pisan los de
 * cada bloque, como el período y el «Comparar» de un tablero), y su ícono.
 *  - `period`: `''` = el de cada bloque; un preset (`this_month`…) o `custom:YYYY-MM-DD:YYYY-MM-DD`.
 *  - `compare`: `''` = lo de cada bloque; `none`, `previous`, `last_year` o `custom:…`.
 */
export const reportSettingsSchema = z
    .object({
        period: z.string().max(64).default(''),
        compare: z.string().max(64).default(''),
        icon: z.string().max(60).nullable().default(null),
        color: z.string().max(40).nullable().default(null),
    })
    .passthrough();
export type ReportSettings = z.infer<typeof reportSettingsSchema>;

/** Lectura tolerante de los ajustes: lo que no se entiende queda en su valor por defecto. */
export function readReportSettings(raw: unknown): ReportSettings {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const str = (v: unknown, max: number): string => (typeof v === 'string' && v.length <= max ? v : '');
    const nstr = (v: unknown, max: number): string | null => (typeof v === 'string' && v !== '' && v.length <= max ? v : null);
    return { ...obj, period: str(obj.period, 64), compare: str(obj.compare, 64), icon: nstr(obj.icon, 60), color: nstr(obj.color, 40) };
}

export const reportSchema = z.object({
    id: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    blocks: z.array(reportBlockSchema),
    settings: reportSettingsSchema,
    visibility: dashboardVisibilitySchema,
    allowed_roles: z.array(z.string()),
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    /** Bloques guardados que no se pudieron leer (se descartaron al mostrarlo). */
    dropped_blocks: z.number().int().nonnegative().default(0),
});
export type Report = z.infer<typeof reportSchema>;

export const createReportSchema = z.object({
    name: z.string().trim().min(1, 'Ponle un nombre al informe.').max(190),
    description: z.string().max(2000).nullable().optional(),
    blocks: reportBlocksSchema.default([]),
    settings: reportSettingsSchema.partial().optional(),
    visibility: dashboardVisibilitySchema.optional(),
    allowed_roles: z.array(z.string().max(40)).max(10).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const updateReportSchema = createReportSchema.partial();
export type UpdateReportInput = z.infer<typeof updateReportSchema>;

/**
 * Lo que manda quien MIRA el informe (el selector de período y de
 * comparación de la página). Sin la clave = lo guardado en el informe;
 * `''` = lo de cada bloque.
 */
export const reportBundleRequestSchema = z.object({
    period: z.string().max(64).optional(),
    compare: z.string().max(64).optional(),
});
export type ReportBundleRequest = z.infer<typeof reportBundleRequestSchema>;

/** Vista previa del editor: los bloques SIN guardar, calculados con el mismo motor. */
export const reportPreviewRequestSchema = reportBundleRequestSchema.extend({
    blocks: reportBlocksSchema,
});
export type ReportPreviewRequest = z.infer<typeof reportPreviewRequestSchema>;

export const REPORT_EXPORT_FORMATS = ['pdf', 'xlsx'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const reportExportRequestSchema = reportBundleRequestSchema.extend({
    format: z.enum(REPORT_EXPORT_FORMATS),
});
export type ReportExportRequest = z.infer<typeof reportExportRequestSchema>;

/** El cálculo de un informe en UN pedido: `{ [blockId]: datos }` (o `{ __error }` por bloque). */
export interface ReportBundle {
    data: Record<string, unknown>;
    /** Período y comparación que se aplicaron (`''` = lo de cada bloque). */
    period: string;
    compare: string;
}

/** Un bloque de datos como widget de tablero (para el motor y los componentes de la app). */
export function reportBlockWidgetSpec(block: ReportWidgetBlock): WidgetSpec {
    return {
        id: block.id,
        type: block.widget.type,
        list_id: block.widget.list_id,
        title: block.widget.title,
        config: block.widget.config,
        layout: { x: 0, y: 0, w: 12, h: 4 },
    };
}

/** Las listas que usa un informe (para invalidar cuando cambian sus registros). */
export function reportListIds(blocks: readonly ReportBlock[]): number[] {
    return [...new Set(reportDataBlocks(blocks).map((b) => b.widget.list_id))];
}

const CUSTOM_RANGE_RE = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

function rangeText(a: string, b: string): string {
    return formatYmdRange(a <= b ? { from: a, to: b } : { from: b, to: a });
}

/** El período del informe en palabras (portada del PDF, Excel y la página). */
export function reportPeriodText(period: string): string {
    if (!period) return 'El de cada bloque';
    const m = CUSTOM_RANGE_RE.exec(period);
    if (m) return rangeText(m[1]!, m[2]!);
    return periodPresetName(period) ?? 'El de cada bloque';
}

/** La comparación del informe en palabras (vacío = lo de cada bloque). */
export function reportCompareText(compare: string): string {
    if (!compare) return '';
    if (compare === 'none') return 'Sin comparar';
    if (compare === 'previous') return 'Comparado con el período anterior';
    if (compare === 'last_year') return 'Comparado con el mismo período del año anterior';
    const m = CUSTOM_RANGE_RE.exec(compare);
    if (m) return `Comparado con ${rangeText(m[1]!, m[2]!)}`;
    return '';
}
