/**
 * Acciones del log de actividad. El backend cloud las escribe con guion bajo
 * (`record_updated`); las variantes con punto son del plugin y se conservan
 * para no romper la lectura de entradas viejas.
 */
export type ActivityAction =
    | 'record_created'
    | 'record_updated'
    | 'record_deleted'
    | 'record_restored'
    // A8 — dependencias: `changes.dependency = {kind, record_id, title}`.
    | 'dependency_added'
    | 'dependency_removed'
    // A9 — checklists: `changes = {checklist: {id, name}, item?, count?, changes?}`.
    | 'checklist_created'
    | 'checklist_updated'
    | 'checklist_deleted'
    | 'checklist_items_added'
    | 'checklist_item_checked'
    | 'checklist_item_unchecked'
    | 'checklist_item_updated'
    | 'checklist_item_deleted'
    | 'checklist_item_to_subtask'
    // C6 — `changes = {template: {id, name}, subtasks, checklists}`.
    | 'record_template_applied'
    | 'record.created'
    | 'record.updated'
    | 'record.deleted'
    | 'comment.created'
    | 'comment.updated'
    | 'comment.deleted'
    | 'automation.run'
    | string;

export interface ActivityEntity {
    id: number;
    list_id: number;
    record_id: number | null;
    user_id: number | null;
    /** Nombre de quien hizo el cambio (v0.1.149); null si fue el sistema. */
    user_name: string | null;
    action: ActivityAction;
    /**
     * Diff por campo: `{ "f101": { from, to } }` (el backend lo guarda por
     * clave JSONB — el id es la verdad). Se llama `changes` en el front por
     * herencia del plugin; el mapeo desde `diff` vive en `useActivity`.
     */
    changes: Record<string, unknown>;
    created_at: string;
}
