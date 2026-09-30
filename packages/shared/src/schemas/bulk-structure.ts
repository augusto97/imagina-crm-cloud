import { z } from 'zod';
import { BULK_EDIT_MAX_TARGET, bulkEditTargetSchema } from './bulk-edit';
import { idSchema } from './common';

/**
 * Acciones masivas de ESTRUCTURA (v0.1.220): mover registros como subtareas
 * de otro (o sacarlos al primer nivel), duplicarlos y borrarlos — sobre la
 * selección o sobre TODO lo que coincide con los filtros de la vista, con
 * vista previa, aplicación en tandas con avance y DESHACER desde el historial
 * de ediciones masivas.
 */

export const BULK_STRUCTURE_ACTIONS = ['move', 'duplicate', 'delete'] as const;
export type BulkStructureAction = (typeof BULK_STRUCTURE_ACTIONS)[number];

/** Registros por pedido al aplicar. */
export const BULK_STRUCTURE_CHUNK = 200;
export const BULK_STRUCTURE_MAX_TARGET = BULK_EDIT_MAX_TARGET;

export const bulkStructurePreviewSchema = z
    .object({
        action: z.enum(BULK_STRUCTURE_ACTIONS),
        target: bulkEditTargetSchema,
        /** Mover: bajo qué registro (`null` = al primer nivel). */
        parent_id: idSchema.nullable().optional(),
        /** Duplicar: también sus subtareas. */
        include_subtasks: z.boolean().default(false),
    })
    .strict();
export type BulkStructurePreviewInput = z.infer<typeof bulkStructurePreviewSchema>;

export const bulkStructureApplySchema = z
    .object({
        action: z.enum(BULK_STRUCTURE_ACTIONS),
        ids: z.array(idSchema).min(1).max(BULK_STRUCTURE_CHUNK),
        parent_id: idSchema.nullable().optional(),
        include_subtasks: z.boolean().default(false),
        edit_id: idSchema.optional(),
    })
    .strict();
export type BulkStructureApplyInput = z.infer<typeof bulkStructureApplySchema>;

export interface BulkStructurePreview {
    /** Registros abarcados. */
    total: number;
    /** Los que efectivamente se tocan (lo que se aplica, en tandas). */
    ids: number[];
    unchanged: number;
    error_count: number;
    errors: Array<{ id: number; title: string; message: string }>;
    sample: Array<{ id: number; title: string }>;
    /** Subtareas que se van con ellos (borrar) o que también se copian (duplicar). */
    subtasks: number;
    /** Mover: a qué registro (su título). */
    parent_title: string | null;
}

export interface BulkStructureResult {
    succeeded: number[];
    unchanged: number[];
    failed: Array<{ id: number; message: string }>;
    /** Duplicar: registros creados (incluidas las subtareas copiadas). */
    created: number;
    edit_id: number | null;
}
