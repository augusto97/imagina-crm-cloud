import { z } from 'zod';
import { idSchema } from './common';

/**
 * Import de filas a una lista existente (CONTRACT §11). El cliente parsea el
 * CSV/JSON y envía filas (columna→valor string) + un mapeo columna→field_id.
 * El backend valida cada valor con el validador compartido y hace bulk insert.
 */
export const importRowsSchema = z.object({
    /** Mapa columna del archivo → field_id destino. */
    mapping: z.record(z.string(), idSchema),
    /** Filas: cada una es columna → valor (string, como viene del CSV). */
    rows: z.array(z.record(z.string(), z.string())).min(1).max(10_000),
});
export type ImportRowsInput = z.infer<typeof importRowsSchema>;

export const importRowErrorSchema = z.object({
    row: z.number().int().nonnegative(),
    field: z.string(),
    message: z.string(),
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importResultSchema = z.object({
    imported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z.array(importRowErrorSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;

// --- Import CSV en dos pasos (preview + run), paridad con el plugin ---------
// El cliente sube el CSV inline en `body.csv` (no multipart — CSVs típicos
// < 2 MB, el `bodyLimit` de Fastify acota). El flujo es el del ImportDialog
// del fork: preview (cabeceras + muestra + sugerencias) → run (mapping por
// columna→slug + campos nuevos on-the-fly).

export const importCsvPreviewSchema = z.object({
    csv: z.string().min(1),
});
export type ImportCsvPreviewInput = z.infer<typeof importCsvPreviewSchema>;

/** Tipos que la UI permite crear on-the-fly durante un import. */
export const IMPORT_CREATABLE_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'url',
    'email',
] as const;

export const importCsvNewFieldSchema = z.object({
    csv_column_index: z.number().int().nonnegative(),
    label: z.string().trim().min(1).max(190),
    type: z.enum(IMPORT_CREATABLE_TYPES),
});
export type ImportCsvNewField = z.infer<typeof importCsvNewFieldSchema>;

export const importCsvRunSchema = z.object({
    csv: z.string().min(1),
    /** Mapa índice de columna (como string JSON) → slug del campo destino. */
    mapping: z.record(z.string(), z.string().min(1)),
    new_fields: z.array(importCsvNewFieldSchema).max(100).default([]),
});
export type ImportCsvRunInput = z.infer<typeof importCsvRunSchema>;

export interface ImportCsvPreviewResult {
    headers: string[];
    sample: string[][];
    total_rows: number;
    /** índice de columna (string) → slug sugerido. */
    suggested_mapping: Record<string, string>;
    /** índice de columna (string) → tipo de campo inferido de la muestra. */
    suggested_types: Record<string, string>;
    fields: Array<{ id: number; slug: string; label: string; type: string; is_required: boolean }>;
}

export interface ImportCsvCellWarning {
    row: number;
    column_index: number;
    header: string;
    field_slug: string;
    field_label: string;
    field_type: string;
    raw: string;
    reason: 'coerce_empty';
}

export interface ImportCsvUnmappedColumn {
    column_index: number;
    header: string;
    rows_with_data: number;
    sample: string;
}

export interface ImportCsvRunResult {
    imported: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
    truncated: boolean;
    created_fields: Array<{ slug: string; label: string; type: string }>;
    /** slug del campo → opciones añadidas automáticamente al select. */
    expanded_options: Record<string, Array<{ value: string; label: string }>>;
    cell_warnings: ImportCsvCellWarning[];
    unmapped_columns_with_data: ImportCsvUnmappedColumn[];
}
