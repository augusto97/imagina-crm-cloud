import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { jsonbKeyForField, type Field, type RecordDto } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { formatValue, parseInput } from '@/cloud/lib/fieldValue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Tabla de records con alta inline y apertura del drawer al click en fila. */
export function RecordsTable({
    listId,
    fields,
    records,
    onOpen,
}: {
    listId: number;
    fields: Field[];
    records: RecordDto[];
    onOpen: (record: RecordDto) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);

    const invalidate = () => qc.invalidateQueries({ queryKey: ['records', tenantId, listId] });

    const createRecord = useMutation({
        mutationFn: () => api.createRecord(listId, { data: buildData(fields, draft) }),
        onSuccess: () => {
            setDraft({});
            setError(null);
            void invalidate();
        },
        onError: (err) =>
            setError(err instanceof CloudApiError ? Object.values(err.errors)[0] ?? err.message : 'Error'),
    });
    const deleteRecord = useMutation({
        mutationFn: (id: number) => api.deleteRecord(listId, id),
        onSuccess: () => void invalidate(),
    });

    return (
        <div className="imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border">
            <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                <thead>
                    <tr className="imcrm-border-b imcrm-border-border imcrm-bg-muted/40">
                        {fields.map((f) => (
                            <th key={f.id} className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium">
                                {f.label}
                                <span className="imcrm-ml-1 imcrm-text-xs imcrm-text-muted-foreground">{f.type}</span>
                            </th>
                        ))}
                        <th className="imcrm-w-10" />
                    </tr>
                </thead>
                <tbody data-testid="records-body">
                    {records.map((r) => (
                        <tr
                            key={r.id}
                            onClick={() => onOpen(r)}
                            className="imcrm-cursor-pointer imcrm-border-b imcrm-border-border last:imcrm-border-0 hover:imcrm-bg-muted/30"
                        >
                            {fields.map((f) => (
                                <td key={f.id} className="imcrm-px-3 imcrm-py-2">
                                    {formatValue(f, r.data[jsonbKeyForField(f.id)])}
                                </td>
                            ))}
                            <td className="imcrm-px-2 imcrm-text-right">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteRecord.mutate(r.id);
                                    }}
                                    className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                    aria-label="Eliminar"
                                >
                                    ✕
                                </button>
                            </td>
                        </tr>
                    ))}
                    <tr className="imcrm-bg-muted/20">
                        {fields.map((f) => (
                            <td key={f.id} className="imcrm-px-2 imcrm-py-1.5">
                                <Input
                                    value={draft[jsonbKeyForField(f.id)] ?? ''}
                                    onChange={(e) =>
                                        setDraft({ ...draft, [jsonbKeyForField(f.id)]: e.target.value })
                                    }
                                    placeholder={f.label}
                                    aria-label={`Nuevo ${f.label}`}
                                    className="imcrm-h-8"
                                />
                            </td>
                        ))}
                        <td className="imcrm-px-2">
                            <Button
                                size="sm"
                                onClick={() => createRecord.mutate()}
                                disabled={createRecord.isPending}
                                aria-label="Agregar registro"
                            >
                                +
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
            {error && <p className="imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive">{error}</p>}
        </div>
    );
}

function buildData(fields: Field[], draft: Record<string, string>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
        const key = jsonbKeyForField(f.id);
        const raw = draft[key];
        if (raw === undefined || raw === '') continue;
        data[key] = parseInput(f, raw);
    }
    return data;
}
