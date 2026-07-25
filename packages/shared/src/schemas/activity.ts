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
    action: activityActionSchema,
    diff: z.record(z.unknown()),
    created_at: isoDateTimeSchema,
});
export type ActivityDto = z.infer<typeof activitySchema>;

// --- v0.1.114: bitácora de acciones ADMINISTRATIVAS del workspace ---
// Distinta de `activity` (cambios de registros): acá van las acciones que
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
