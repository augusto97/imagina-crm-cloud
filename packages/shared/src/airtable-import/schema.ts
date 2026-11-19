import { z } from 'zod';

/**
 * v0.1.458 (ADR-S1XX) — «Importar de Airtable»: una base completa —sus tablas,
 * campos con su tipo, opciones con color, vínculos entre tablas y adjuntos—
 * se convierte en listas de la app.
 *
 *   1. La persona pega un TOKEN PERSONAL de Airtable (permisos
 *      `data.records:read` y `schema.bases:read`). No se guarda en la base: vive
 *      cifrado en Redis mientras dura la importación y se borra al terminar.
 *   2. Elige la base. El servidor lee su esquema y la RECORRE una vez (cuenta
 *      los registros, mide los adjuntos y mira quiénes son los colaboradores)
 *      para avisar del límite del plan ANTES de crear nada.
 *   3. Revisa el PLAN (este schema: qué tablas, qué campos, con qué tipo y
 *      nombre) y confirma. La importación corre en segundo plano con progreso.
 *
 * El plan habla por los IDs de Airtable (`tbl…`, `fld…`): renombrar algo en
 * Airtable entre el análisis y la importación no lo rompe. La misma función
 * pura (`resolveAirtablePlan`) arma la vista previa del navegador y lo que
 * crea el servidor.
 */

/** La API de Airtable (en desarrollo y en los tests se apunta a un doble con `AIRTABLE_API_URL`). */
export const AIRTABLE_API_URL = 'https://api.airtable.com';
/** Donde la persona crea su token personal. */
export const AIRTABLE_TOKENS_URL = 'https://airtable.com/create/tokens';
/** Los permisos que necesita el token. */
export const AIRTABLE_REQUIRED_SCOPES = ['data.records:read', 'schema.bases:read'] as const;

/** Tablas que se importan de una vez. */
export const AIRTABLE_MAX_TABLES = 20;
/** Registros por base (entre todas sus tablas) que se recorren e importan. */
export const AIRTABLE_MAX_RECORDS = 100_000;
/** Campos incluidos por lista. */
export const AIRTABLE_MAX_FIELDS_PER_LIST = 60;
/** Un adjunto más pesado que esto no se baja (queda avisado). */
export const AIRTABLE_MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Cuánto vive una sesión de importación (el token incluido) sin actividad. */
export const AIRTABLE_SESSION_TTL_SECONDS = 2 * 60 * 60;

/** Los tipos de la app en que puede caer un campo de Airtable. */
export const AIRTABLE_TARGET_TYPES = [
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
    'user',
    'relation',
    'file',
    'autonumber',
] as const;
export type AirtableTargetType = (typeof AIRTABLE_TARGET_TYPES)[number];

const airtableId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[A-Za-z0-9]{3,40}$`), 'Identificador de Airtable inválido');

// ── Lo que manda el navegador ──────────────────────────────────────────────

export const airtableConnectSchema = z.object({
    token: z
        .string()
        .trim()
        .min(20, 'El token es más largo: cópialo completo.')
        .max(400)
        .regex(/^\S+$/, 'El token no lleva espacios.'),
});
export type AirtableConnectInput = z.infer<typeof airtableConnectSchema>;

export const airtableChooseBaseSchema = z.object({ base_id: airtableId('app') });
export type AirtableChooseBaseInput = z.infer<typeof airtableChooseBaseSchema>;

export const airtablePlanFieldSchema = z.object({
    field_id: airtableId('fld'),
    include: z.boolean(),
    label: z.string().trim().min(1).max(80),
    type: z.enum(AIRTABLE_TARGET_TYPES),
});
export type AirtablePlanField = z.infer<typeof airtablePlanFieldSchema>;

export const airtablePlanTableSchema = z.object({
    table_id: airtableId('tbl'),
    include: z.boolean(),
    name: z.string().trim().min(1).max(80),
    /** El campo de Airtable que hace de título de cada registro (tiene que quedar como texto). */
    title_field_id: airtableId('fld'),
    fields: z.array(airtablePlanFieldSchema).max(500),
});
export type AirtablePlanTable = z.infer<typeof airtablePlanTableSchema>;

export const airtablePlanSchema = z.object({
    tables: z.array(airtablePlanTableSchema).min(1).max(200),
    folder_name: z.string().trim().max(80).optional(),
    /** Bajar los adjuntos (cuentan para el almacenamiento del plan). */
    attachments: z.boolean(),
});
export type AirtablePlan = z.infer<typeof airtablePlanSchema>;

export const airtableApplySchema = z.object({
    plan: airtablePlanSchema,
    /** Si no entra todo en el plan: importar sólo esta cantidad de registros (en orden). */
    max_records: z.number().int().min(0).optional(),
    /** Crear dentro de esta carpeta (desde «Nueva lista» en una carpeta). */
    group_id: z.number().int().positive().optional(),
});
export type AirtableApplyInput = z.infer<typeof airtableApplySchema>;

// ── El esquema de Airtable (lo que usa la app de su API de metadatos) ───────

export interface AirtableFieldSchema {
    id: string;
    name: string;
    type: string;
    description?: string;
    options?: Record<string, unknown>;
}

export interface AirtableTableSchema {
    id: string;
    name: string;
    primaryFieldId: string;
    description?: string;
    fields: AirtableFieldSchema[];
}

export interface AirtableBaseInfo {
    id: string;
    name: string;
}

// ── El recorrido (scan) de la base ─────────────────────────────────────────

export interface AirtableAttachmentStats {
    files: number;
    bytes: number;
    /** Archivos que pasan del tope (`AIRTABLE_MAX_FILE_BYTES`): no se bajan. */
    too_big: number;
}

export interface AirtablePersonSeen {
    /** Sólo si es miembro del equipo de la empresa (nunca se manda el correo de alguien de afuera). */
    email: string | null;
    name: string;
    member: boolean;
}

export interface AirtableTableScan {
    table_id: string;
    records: number;
    /** Se dejó de contar al llegar al tope de la base. */
    truncated: boolean;
    /** Por campo de adjuntos. */
    attachments: Record<string, AirtableAttachmentStats>;
    /** Por campo de personas (colaboradores, «creado por»): quiénes aparecen. */
    people: Record<string, AirtablePersonSeen[]>;
    /** Por campo de número automático: el mayor. */
    autonumber_max: Record<string, number>;
}

// ── El estado de una importación (lo que la pantalla pregunta) ─────────────

export type AirtableImportStage = 'connected' | 'scanning' | 'ready' | 'importing' | 'done' | 'error' | 'cancelled';

export interface AirtableImportProgress {
    /** Tabla que se está leyendo ahora (nombre). */
    table: string | null;
    /** Registros listos de la tabla actual. */
    table_done: number;
    table_total: number;
    /** Registros listos en total. */
    done: number;
    total: number;
    /** Adjuntos bajados (sólo al importar). */
    files_done: number;
    files_total: number;
    /** «Armando los vínculos» (la segunda pasada). */
    linking: boolean;
}

export interface AirtableImportListResult {
    id: number;
    slug: string;
    name: string;
    table_id: string;
    records: number;
}

export interface AirtableCellWarning {
    list: string;
    record: string;
    field: string;
    message: string;
}

export interface AirtableImportResult {
    lists: AirtableImportListResult[];
    group_id: number | null;
    imported: number;
    /** Registros que no entraron por el límite del plan. */
    left_out: number;
    linked: number;
    unmatched_links: number;
    files: number;
    files_bytes: number;
    files_skipped: number;
    warnings: string[];
    cell_warnings: AirtableCellWarning[];
    cell_warnings_total: number;
}

export interface AirtableLimitInfo {
    /** Registros que todavía entran en el plan (`null` = sin límite). */
    records_remaining: number | null;
    /** Bytes que todavía entran en el almacenamiento del plan (`null` = sin límite). */
    storage_room: number | null;
    /** Los archivos van al almacenamiento propio de la empresa (no cuentan para el plan). */
    storage_external: boolean;
}

export interface AirtableImportStatus {
    id: string;
    stage: AirtableImportStage;
    /** Bases a las que el token tiene acceso. */
    bases: AirtableBaseInfo[];
    base: AirtableBaseInfo | null;
    /** El esquema de la base elegida (sólo lo que usa la revisión). */
    tables: AirtableTableSchema[];
    scan: AirtableTableScan[];
    /** El borrador del plan (las reglas; la persona lo cambia en la revisión). */
    plan: AirtablePlan | null;
    limit: AirtableLimitInfo | null;
    /** Moneda y país por defecto de la empresa. */
    defaults: { currency: string; country: string; time_zone: string | null };
    progress: AirtableImportProgress | null;
    result: AirtableImportResult | null;
    error: { code: string; message: string } | null;
    /** Última vez que la importación dio señales de vida (ISO). */
    updated_at: string;
}
