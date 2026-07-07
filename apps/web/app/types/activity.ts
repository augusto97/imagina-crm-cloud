export type ActivityAction =
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
    action: ActivityAction;
    changes: Record<string, unknown>;
    created_at: string;
}
