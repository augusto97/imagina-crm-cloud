import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Log de actividad por record/lista con diffs (CONTRACT.md §1). Append-only:
 * lo escribe el backend en cada mutación de record. `diff` guarda el cambio
 * por clave JSONB (f{field_id}) con antes/después.
 */
export const ACTIVITY_ACTIONS = [
    'record_created',
    'record_updated',
    'record_deleted',
    // Papelera: volvió a la vida (con sus subtareas, vínculos y comentarios).
    'record_restored',
    // A8 — dependencias entre registros. El diff guarda
    // `{ dependency: { kind, record_id, title } }` desde el registro de la entrada.
    'dependency_added',
    'dependency_removed',
    // Campo «Botón»: alguien lo presionó. `diff.button` = {field_id, label, ok, actions}.
    'button_pressed',
] as const;
export const activityActionSchema = z.enum(ACTIVITY_ACTIONS);
export type ActivityAction = z.infer<typeof activityActionSchema>;

/** Diff por campo: `{ "f101": { from, to } }`. */
export const activityDiffSchema = z.record(
    z.string().regex(/^f\d+$/),
    z.object({ from: z.unknown(), to: z.unknown() }),
);
export type ActivityDiff = z.infer<typeof activityDiffSchema>;

export const activitySchema = z.object({
    id: idSchema,
    list_id: idSchema,
    record_id: idSchema.nullable(),
    user_id: idSchema.nullable(),
    /** Nombre de quien hizo el cambio (v0.1.149); null si lo hizo el sistema. */
    user_name: z.string().nullable().default(null),
    action: activityActionSchema,
    diff: z.record(z.unknown()),
    created_at: isoDateTimeSchema,
});
export type ActivityDto = z.infer<typeof activitySchema>;

/**
 * v0.1.291 — Historial de UN campo de un registro: cada cambio que tocó esa
 * clave del diff (`f{id}`), de lo más nuevo a lo más viejo, con quién y
 * cuándo. `from`/`to` son los valores CRUDOS guardados (la UI los formatea
 * como en la ficha y decide si se pueden restaurar).
 */
export const fieldHistoryEntrySchema = z.object({
    id: idSchema,
    user_id: idSchema.nullable(),
    user_name: z.string().nullable(),
    action: activityActionSchema,
    from: z.unknown(),
    to: z.unknown(),
    created_at: isoDateTimeSchema,
});
export type FieldHistoryEntry = z.infer<typeof fieldHistoryEntrySchema>;

export const fieldHistoryPageSchema = z.object({
    data: z.array(fieldHistoryEntrySchema),
    meta: z.object({ next_cursor: z.string().nullable() }),
});
export type FieldHistoryPage = z.infer<typeof fieldHistoryPageSchema>;

// --- v0.1.114: bitácora de acciones ADMINISTRATIVAS del workspace ---
// Distinta de `activity` (cambios de registros): aquí van las acciones que
// cambian la configuración o destruyen datos, incluidas las que no cuelgan
// de ninguna lista (miembros, plan, SMTP, dominio).
export const auditEntrySchema = z.object({
    id: z.number(),
    action: z.string(),
    target_type: z.string(),
    target_id: z.number().nullable(),
    target_label: z.string(),
    meta: z.record(z.unknown()),
    user_id: z.number().nullable(),
    user_name: z.string().nullable(),
    created_at: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditFeedSchema = z.object({
    data: z.array(auditEntrySchema),
    meta: z.object({ next_cursor: z.string().nullable() }),
});
export type AuditFeed = z.infer<typeof auditFeedSchema>;
