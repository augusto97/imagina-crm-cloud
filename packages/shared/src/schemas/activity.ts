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
    // C5 — aprobaciones. `diff.approval` = {event, request_id, flow, step,
    // steps, reason?, note?} (event: requested | approved_step | approved |
    // rejected | returned | cancelled).
    'approval',
    // A9 — checklists del registro. El diff guarda `{ checklist: {id, name} }`
    // y, según la acción, `item: {id, text}`, `items` (textos), `count`,
    // `changes` ({text|assignee_id|due|checklist: {from, to}}) o `subtask_id`.
    'checklist_created',
    'checklist_updated',
    'checklist_deleted',
    'checklist_items_added',
    'checklist_item_checked',
    'checklist_item_unchecked',
    'checklist_item_updated',
    'checklist_item_deleted',
    'checklist_item_to_subtask',
    // C6 — el registro (o sus subtareas) salió de una plantilla. `diff.template` = {id, name}.
    'record_template_applied',
    // D3 — WhatsApp oficial. `diff.whatsapp` = {event: received | sent, kind,
    // template?, language?, connection}. NUNCA el texto: la conversación vive
    // en WhatsApp; en el registro queda sólo el último mensaje.
    'whatsapp',
    // E6 — lo que hizo un agente de IA que no es un cambio de campos (una nota,
    // una propuesta, un correo). `diff.agent` = {event, agent_id, agent_name, …}.
    'ai_agent',
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
    /**
     * E6 — el agente de IA que hizo (o propuso) el cambio. Con `user_id`, una
     * persona aplicó lo que el agente propuso.
     */
    agent: z.object({ id: idSchema, name: z.string() }).nullable().optional(),
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
