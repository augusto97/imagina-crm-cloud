import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    COMMENT_KINDS,
    isDataField,
    jsonbKeyForField,
    type CommentKind,
    type Field,
    type RecordDto,
} from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { fieldOptions, formatValue, parseInput } from '@/cloud/lib/fieldValue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Drawer de un record: edición inline de sus campos + hilo de comentarios +
 * timeline de actividad. Las mutaciones disparan realtime; el drawer también
 * refetchea local.
 */
export function RecordDrawer({
    listId,
    listSlug,
    fields,
    record,
    onClose,
}: {
    listId: number;
    listSlug: string;
    fields: Field[];
    record: RecordDto;
    onClose: () => void;
}): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const qc = useQueryClient();
    const dataFields = fields.filter((f) => isDataField(f.type));

    const invalidateRecords = () =>
        qc.invalidateQueries({ queryKey: ['records', tenantId, listId] });

    const saveField = useMutation({
        mutationFn: (payload: { key: string; value: unknown }) =>
            api.updateRecord(listId, record.id, { data: { [payload.key]: payload.value } }),
        onSuccess: () => void invalidateRecords(),
    });

    return (
        <div className="imcrm-fixed imcrm-inset-y-0 imcrm-right-0 imcrm-z-40 imcrm-flex imcrm-w-[420px] imcrm-max-w-full imcrm-flex-col imcrm-border-l imcrm-border-border imcrm-bg-card imcrm-shadow-xl">
            <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <span className="imcrm-text-sm imcrm-font-semibold">Registro #{record.id}</span>
                <button
                    onClick={onClose}
                    aria-label="Cerrar"
                    className="imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    ✕
                </button>
            </header>

            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-space-y-6 imcrm-overflow-auto imcrm-p-4">
                <section className="imcrm-space-y-3">
                    {dataFields.map((f) => (
                        <FieldEditor
                            key={f.id}
                            field={f}
                            value={record.data[jsonbKeyForField(f.id)]}
                            onSave={(value) => saveField.mutate({ key: jsonbKeyForField(f.id), value })}
                        />
                    ))}
                </section>

                <CommentsSection listSlug={listSlug} recordId={record.id} />
                <ActivitySection
                    listSlug={listSlug}
                    recordId={record.id}
                    fields={fields}
                />
            </div>
        </div>
    );
}

function FieldEditor({
    field,
    value,
    onSave,
}: {
    field: Field;
    value: unknown;
    onSave: (value: unknown) => void;
}): JSX.Element {
    const [draft, setDraft] = useState<string>(() => rawString(value));

    return (
        <label className="imcrm-block imcrm-space-y-1">
            <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                {field.label}
            </span>
            {field.type === 'select' ? (
                <select
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onSave(e.target.value || null)}
                    className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="">—</option>
                    {fieldOptions(field).map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            ) : field.type === 'checkbox' ? (
                <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => onSave(e.target.checked)}
                    className="imcrm-h-4 imcrm-w-4"
                />
            ) : (
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => onSave(parseInput(field, draft))}
                    placeholder={field.type}
                />
            )}
        </label>
    );
}

function CommentsSection({
    listSlug,
    recordId,
}: {
    listSlug: string;
    recordId: number;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [body, setBody] = useState('');
    const [kind, setKind] = useState<CommentKind>('note');

    const comments = useQuery({
        queryKey: ['comments', tenantId, recordId],
        queryFn: () => api.listComments(listSlug, recordId),
    });
    const add = useMutation({
        mutationFn: () => api.createComment(listSlug, recordId, { body, kind }),
        onSuccess: () => {
            setBody('');
            void qc.invalidateQueries({ queryKey: ['comments', tenantId, recordId] });
        },
    });

    return (
        <section className="imcrm-space-y-2">
            <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                Comentarios
            </h3>
            <ul className="imcrm-space-y-2">
                {comments.data?.map((c) => (
                    <li key={c.id} className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2 imcrm-text-sm">
                        <span className="imcrm-mr-2 imcrm-rounded imcrm-bg-accent imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-accent-foreground">
                            {c.kind}
                        </span>
                        {c.body}
                    </li>
                ))}
                {comments.data?.length === 0 && (
                    <li className="imcrm-text-sm imcrm-text-muted-foreground">Sin comentarios.</li>
                )}
            </ul>
            <form
                className="imcrm-flex imcrm-items-end imcrm-gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (body.trim()) add.mutate();
                }}
            >
                <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Comentar…" />
                <select
                    aria-label="Tipo"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as CommentKind)}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    {COMMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                            {k}
                        </option>
                    ))}
                </select>
                <Button type="submit" size="sm" disabled={!body.trim()}>
                    Enviar
                </Button>
            </form>
        </section>
    );
}

function ActivitySection({
    listSlug,
    recordId,
    fields,
}: {
    listSlug: string;
    recordId: number;
    fields: Field[];
}): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
    const activity = useQuery({
        queryKey: ['activity', tenantId, recordId],
        queryFn: () => api.recordActivity(listSlug, recordId),
    });

    return (
        <section className="imcrm-space-y-2">
            <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                Actividad
            </h3>
            <ul className="imcrm-space-y-1.5 imcrm-text-sm">
                {activity.data?.map((a) => (
                    <li key={a.id} className="imcrm-text-muted-foreground">
                        <span className="imcrm-font-medium imcrm-text-foreground">{label(a.action)}</span>{' '}
                        {summarizeDiff(a.diff, byKey)}
                    </li>
                ))}
                {activity.data?.length === 0 && <li className="imcrm-text-muted-foreground">Sin actividad.</li>}
            </ul>
        </section>
    );
}

function rawString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

function label(action: string): string {
    return action === 'record_created'
        ? 'Creado'
        : action === 'record_updated'
          ? 'Editado'
          : 'Eliminado';
}

function summarizeDiff(diff: Record<string, unknown>, byKey: Map<string, Field>): string {
    const parts: string[] = [];
    for (const [key, change] of Object.entries(diff)) {
        const field = byKey.get(key);
        if (!field || typeof change !== 'object' || change === null) continue;
        const { to } = change as { to?: unknown };
        parts.push(`${field.label} → ${formatValue(field, to)}`);
    }
    return parts.join('; ');
}
