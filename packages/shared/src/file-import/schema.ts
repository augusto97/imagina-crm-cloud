import { z } from 'zod';
import { COLOR_PRESETS } from '../schemas/field';

/**
 * v0.1.339 (ADR-S88) — «Crear desde un archivo».
 *
 * Una planilla (CSV o Excel, una o varias hojas) se convierte en una o varias
 * listas casi solas:
 *   1. Reglas (gratis, al instante, sobre TODO el archivo): el PERFIL de cada
 *      columna — cuánto hay vacío, valores distintos, formatos, el tipo que
 *      sugieren los datos, qué sobra, qué columnas describen OTRA cosa (los
 *      clientes repetidos en una hoja de facturas) y qué hojas se vinculan.
 *   2. La IA (opcional, con un RESUMEN protegido — nunca el archivo) afina ese
 *      borrador: tipos, nombres, opciones con color, qué descartar y por qué.
 *   3. La persona revisa el PLAN (este schema) y lo confirma. El servidor lo
 *      vuelve a validar contra el archivo y crea todo.
 *
 * El plan habla por ÍNDICE de columna dentro de su hoja: lo que se toca en la
 * revisión es siempre una columna del archivo, y el mismo plan sirve para la
 * vista previa (navegador) y para crear (servidor) — `resolveFileImportPlan`.
 */

/**
 * Las hojas viajan como texto y pueden pasar del tope general del cuerpo de
 * un pedido (2 MB): las rutas de «Crear desde un archivo» aceptan este tipo de
 * contenido con su propio tope (y ninguna otra ruta lo acepta).
 */
export const FILE_IMPORT_CONTENT_TYPE = 'application/vnd.imagina.file-import+json';
/** Texto total de las hojas que entra en un pedido. */
export const FILE_IMPORT_MAX_TOTAL_CHARS = 18_000_000;

export const FILE_IMPORT_MAX_SHEETS = 5;
/** Filas por hoja (el mismo tope del import). */
export const FILE_IMPORT_MAX_ROWS = 5000;
export const FILE_IMPORT_MAX_COLUMNS = 60;
/** Texto CSV por hoja. */
export const FILE_IMPORT_MAX_CSV_CHARS = 6_000_000;
/** Listas que puede crear un archivo (hojas + entidades separadas). */
export const FILE_IMPORT_MAX_LISTS = 6;

/** Los tipos que un archivo puede traer (lo demás —relación, persona, fórmulas— se arma después). */
export const FILE_IMPORT_FIELD_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'email',
    'url',
    'phone',
] as const;
export type FileImportFieldType = (typeof FILE_IMPORT_FIELD_TYPES)[number];

/** Qué clase de datos trae el archivo: ordena las recomendaciones del final. */
export const FILE_IMPORT_DATA_KINDS = [
    'contacts',
    'sales',
    'invoices',
    'projects',
    'support',
    'inventory',
    'appointments',
    'recruiting',
    'events',
    'expenses',
    'generic',
] as const;
export type FileImportDataKind = (typeof FILE_IMPORT_DATA_KINDS)[number];

export const FILE_IMPORT_DATA_KIND_LABELS: Record<FileImportDataKind, string> = {
    contacts: 'Contactos y clientes',
    sales: 'Ventas y oportunidades',
    invoices: 'Facturas y cobros',
    projects: 'Proyectos y tareas',
    support: 'Solicitudes de soporte',
    inventory: 'Productos e inventario',
    appointments: 'Citas y agenda',
    recruiting: 'Candidatos y vacantes',
    events: 'Eventos e inscripciones',
    expenses: 'Gastos y compras',
    generic: 'Datos generales',
};

export const FILE_IMPORT_FORMATS = ['nit', 'nit_dv', 'cedula', 'placa'] as const;
export const FILE_IMPORT_DATE_ORDERS = ['dmy', 'mdy', 'ymd'] as const;
export type FileImportDateOrder = (typeof FILE_IMPORT_DATE_ORDERS)[number];
export const FILE_IMPORT_NUMBER_FORMATS = ['comma_dot', 'dot_comma'] as const;
export type FileImportNumberFormat = (typeof FILE_IMPORT_NUMBER_FORMATS)[number];

const slug = z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/, 'snake_case que arranca con letra');
const columnIndex = z.number().int().min(0).max(FILE_IMPORT_MAX_COLUMNS - 1);
const sheetIndex = z.number().int().min(0).max(FILE_IMPORT_MAX_SHEETS - 1);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ── Lo que manda el navegador ──────────────────────────────────────────────

export const fileImportSheetInputSchema = z.object({
    name: z.string().trim().max(120).default(''),
    /** La hoja como texto CSV (un Excel ya convertido en el navegador). */
    csv: z.string().min(1).max(FILE_IMPORT_MAX_CSV_CHARS),
    /** Excel: índice de columna → tipo que sugieren los FORMATOS de sus celdas. */
    type_hints: z.record(z.string(), z.string().max(20)).optional(),
});
export type FileImportSheetInput = z.infer<typeof fileImportSheetInputSchema>;

const sheetsInput = z
    .array(fileImportSheetInputSchema)
    .min(1)
    .max(FILE_IMPORT_MAX_SHEETS)
    .refine((s) => s.reduce((n, x) => n + x.csv.length, 0) <= FILE_IMPORT_MAX_TOTAL_CHARS, {
        message: 'El archivo es demasiado grande: divídelo o quita las hojas que no necesitas.',
    });

export const fileImportAnalyzeSchema = z.object({
    file_name: z.string().trim().min(1).max(200),
    source: z.enum(['csv', 'xlsx']),
    sheets: sheetsInput,
});
export type FileImportAnalyzeInput = z.infer<typeof fileImportAnalyzeSchema>;

// ── El plan (lo que se revisa y se confirma) ───────────────────────────────

export const fileImportOptionSchema = z.object({
    value: slug,
    label: z.string().trim().min(1).max(80),
    color: z.enum(COLOR_PRESETS).optional(),
    /** Cómo aparece en el archivo («pagado», «PAGADA», «Pagada »): todo cae en esta opción. */
    aliases: z.array(z.string().max(200)).max(50).default([]),
});
export type FileImportOption = z.infer<typeof fileImportOptionSchema>;

export const fileImportFieldSchema = z.object({
    /** Índice de la columna en su hoja. */
    column: columnIndex,
    /** `false` = la columna se descarta (no se crea el campo ni se importa). */
    include: z.boolean(),
    label: z.string().trim().min(1).max(80),
    slug,
    type: z.enum(FILE_IMPORT_FIELD_TYPES),
    options: z.array(fileImportOptionSchema).max(100).optional(),
    currency: z.string().length(3).optional(),
    precision: z.number().int().min(0).max(4).optional(),
    default_country: z.string().length(2).optional(),
    /** Cómo leer las fechas de ESTA columna (manda sobre el formato de la empresa). */
    date_order: z.enum(FILE_IMPORT_DATE_ORDERS).optional(),
    /** Cómo leer los números de ESTA columna. */
    number_format: z.enum(FILE_IMPORT_NUMBER_FORMATS).optional(),
    is_unique: z.boolean().optional(),
    /** Validación de documentos (NIT, cédula, placa). */
    format: z.enum(FILE_IMPORT_FORMATS).optional(),
    /** Por qué este tipo, o por qué conviene descartarla (se muestra en la revisión). */
    reason: z.string().max(240).optional(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    /** La IA cambió algo de esta columna (la revisión lo marca). */
    ai: z.boolean().optional(),
});
export type FileImportField = z.infer<typeof fileImportFieldSchema>;

/** Una lista por hoja del archivo. */
export const fileImportListSchema = z.object({
    sheet: sheetIndex,
    key: slug.max(40),
    name: z.string().trim().min(1).max(80),
    icon: z.string().max(40).optional(),
    color: hex.optional(),
    /** `false` = esta hoja no se importa. */
    include: z.boolean(),
    /** La columna que hace de título de cada registro (tiene que ser de texto). */
    title_column: columnIndex,
    /** Saltear las filas repetidas idénticas. */
    skip_duplicates: z.boolean(),
    fields: z.array(fileImportFieldSchema).max(FILE_IMPORT_MAX_COLUMNS),
});
export type FileImportList = z.infer<typeof fileImportListSchema>;

/**
 * Una COSA distinta escondida en la hoja: la columna «Cliente» se repite y
 * arrastra sus datos (correo, teléfono, ciudad). Incluida, se separa en su
 * propia lista (un registro por valor distinto) y la hoja queda vinculada.
 * Las definiciones de esos campos siguen viviendo en la lista de la hoja.
 */
export const fileImportEntitySchema = z.object({
    key: slug.max(40),
    name: z.string().trim().min(1).max(80),
    icon: z.string().max(40).optional(),
    color: hex.optional(),
    sheet: sheetIndex,
    /** La columna que identifica cada registro de la entidad (su título). */
    key_column: columnIndex,
    /** Las columnas que se mudan a la entidad (sus datos). */
    columns: z.array(columnIndex).max(30),
    include: z.boolean(),
    /** Cómo se llama el campo vínculo en la lista de la hoja («Cliente»). */
    link_label: z.string().trim().min(1).max(80),
    link_slug: slug,
    reason: z.string().max(240).optional(),
    /** Informativo: cuántos registros nacerían (valores distintos). */
    records: z.number().int().min(0).default(0),
});
export type FileImportEntity = z.infer<typeof fileImportEntitySchema>;

/** Una columna de una hoja que nombra registros de OTRA hoja → vínculo. */
export const fileImportLinkSchema = z.object({
    sheet: sheetIndex,
    column: columnIndex,
    /** `key` de la lista de la otra hoja. */
    to: slug.max(40),
    include: z.boolean(),
    reason: z.string().max(240).optional(),
    /** Informativo: qué parte de los valores encontró su registro (0-1). */
    match: z.number().min(0).max(1).optional(),
});
export type FileImportLink = z.infer<typeof fileImportLinkSchema>;

export const fileImportPlanSchema = z.object({
    version: z.literal(1),
    kind: z.enum(FILE_IMPORT_DATA_KINDS),
    summary: z.string().max(400).default(''),
    folder_name: z.string().trim().max(80).optional(),
    ai_used: z.boolean().default(false),
    lists: z.array(fileImportListSchema).min(1).max(FILE_IMPORT_MAX_SHEETS),
    entities: z.array(fileImportEntitySchema).max(6).default([]),
    links: z.array(fileImportLinkSchema).max(10).default([]),
});
export type FileImportPlan = z.infer<typeof fileImportPlanSchema>;

export const fileImportApplySchema = z.object({
    /** El análisis del que salió el plan (para la bitácora y no crear dos veces). */
    analysis_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    plan: fileImportPlanSchema,
    file_name: z.string().trim().min(1).max(200),
    source: z.enum(['csv', 'xlsx']),
    sheets: sheetsInput,
    /**
     * Con el plan lleno: importar sólo hasta esta cantidad de registros (en el
     * orden del archivo). Sin valor, si no entra todo, se rechaza.
     */
    max_records: z.number().int().min(0).optional(),
    /** Crear dentro de esta carpeta (desde «Nueva lista» en una carpeta): no se arma otra. */
    group_id: z.number().int().positive().optional(),
});
export type FileImportApplyInput = z.infer<typeof fileImportApplySchema>;

// ── Lo que devuelve el análisis ────────────────────────────────────────────

export interface FileImportColumnProfile {
    index: number;
    header: string;
    /** Celdas con algo. */
    filled: number;
    /** Valores distintos (exactos). */
    distinct: number;
    /** Hasta 5 valores distintos tal cual (sólo para el navegador de quien sube). */
    samples: string[];
    /** Los más frecuentes cuando hay pocos distintos (sin acentos ni mayúsculas, con su forma más usada). */
    top: Array<{ value: string; count: number }> | null;
    /** Celdas con varias opciones separadas por coma: los pedazos más frecuentes. */
    token_top?: Array<{ value: string; count: number }>;
    /** El tipo que sugieren las reglas, y por qué. */
    detected: FileImportFieldType;
    reason: string;
    date_order?: FileImportDateOrder;
    number_format?: FileImportNumberFormat;
    /** Forma del dato, para enmascararlo antes de mandarlo a la IA. */
    shape?: 'email' | 'phone' | 'id' | 'url' | 'name' | 'free_text';
    /** Sugerencia de descarte (vacía, constante, repetida, número de fila, calculada). */
    discard?: string;
    /** Números: mínimo, máximo y si son todos enteros. */
    numeric?: { min: number; max: number; integers: boolean };
    /** Promedio de caracteres. */
    avg_length: number;
}

export interface FileImportSheetProfile {
    index: number;
    name: string;
    headers: string[];
    /** Filas de datos que entran (hasta el tope). */
    rows: number;
    /** Filas de datos de la hoja. */
    total_rows: number;
    truncated: boolean;
    /** Filas idénticas a una anterior. */
    duplicate_rows: number;
    columns: FileImportColumnProfile[];
    /** Columnas que pasaron del tope (se dejan afuera y se avisa). */
    extra_columns?: number;
    /** Las primeras filas tal cual, para la vista previa de quien sube el archivo (nunca van a la IA). */
    preview?: string[][];
}

export interface FileImportEntityCandidate {
    sheet: number;
    key_column: number;
    columns: number[];
    distinct: number;
}

export interface FileImportLimitInfo {
    /** Registros que todavía entran en el plan (`null` = sin límite). */
    remaining: number | null;
    /** Registros que crearía el plan tal como está. */
    planned: number;
}

export interface FileImportAiInfo {
    available: boolean;
    /** Por qué no (en lenguaje claro). */
    reason: string | null;
    /** Análisis con IA que quedan este mes con la clave de la plataforma (`null` = sin tope: clave propia). */
    remaining: number | null;
}

export interface FileImportAnalysis {
    id: string;
    file_name: string;
    source: 'csv' | 'xlsx';
    sheets: FileImportSheetProfile[];
    plan: FileImportPlan;
    ai: FileImportAiInfo;
    limit: FileImportLimitInfo;
    /** Moneda y país por defecto de la empresa (para cambiar un tipo en la revisión). */
    defaults: { currency: string; country: string };
}

export type FileImportAiStage = 'thinking' | 'checking' | 'fixing';

export interface FileImportAiJob {
    state: 'running' | 'done' | 'error';
    stage: FileImportAiStage | null;
    plan: FileImportPlan | null;
    error: { code: string; message: string } | null;
}

export const fileImportAiStartSchema = z.object({
    /** El consentimiento en línea: se manda un RESUMEN protegido del archivo al proveedor de IA. */
    consent: z.literal(true),
});
export type FileImportAiStartInput = z.infer<typeof fileImportAiStartSchema>;

export interface FileImportCellWarning {
    list: string;
    row: number;
    field: string;
    message: string;
}

export interface FileImportApplyResult {
    lists: Array<{ id: number; slug: string; name: string; key: string; records: number }>;
    group_id: number | null;
    imported: number;
    skipped_duplicates: number;
    /** Registros que no entraron por el límite del plan. */
    left_out: number;
    linked: number;
    unmatched_links: number;
    warnings: string[];
    cell_warnings: FileImportCellWarning[];
    cell_warnings_total: number;
}
