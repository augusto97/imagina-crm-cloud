export type CommentKind = 'note' | 'call' | 'email' | 'meeting';

/**
 * Metadata del composer multi-modo (0.33.0+). Cada `kind` tiene
 * campos extra distintos. El backend no inspecciona el shape — sólo
 * persiste el JSON. La UI rendera condicional según `kind`.
 */
export interface CommentMetadata {
    kind?: CommentKind;
    /** call: minutos. */
    duration_minutes?: number;
    /** call: 'connected' | 'voicemail' | 'no_answer' | 'busy'. */
    outcome?: string;
    /** email: destinatario(s). */
    to?: string;
    /** email: asunto. */
    subject?: string;
    /** meeting: lista de asistentes (texto libre, separados por coma). */
    attendees?: string;
    /** meeting: cuándo fue (ISO date string). */
    occurred_at?: string;
}

export interface CommentEntity {
    id: number;
    list_id: number;
    record_id: number;
    user_id: number;
    parent_id: number | null;
    content: string;
    metadata: CommentMetadata;
    created_at: string;
    updated_at: string;
}

export interface CreateCommentInput {
    content: string;
    parent_id?: number | null;
    metadata?: CommentMetadata;
}
