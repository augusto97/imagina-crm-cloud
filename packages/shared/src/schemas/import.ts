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
