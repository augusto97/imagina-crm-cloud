/**
 * Acciones del log de actividad. El backend cloud las escribe con guion bajo
 * (`record_updated`); las variantes con punto son del plugin y se conservan
 * para no romper la lectura de entradas viejas.
 */
export type ActivityAction =
    | 'record_created'
    | 'record_updated'
    | 'record_deleted'
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
