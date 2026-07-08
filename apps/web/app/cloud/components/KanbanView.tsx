import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { jsonbKeyForField, type Field, type RecordDto } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { fieldOptions, formatValue } from '@/cloud/lib/fieldValue';

/**
 * Vista Kanban: agrupa records por un campo `select`. Mover una card a otra
 * columna = actualizar ese campo del record (el realtime lo refleja en las
 * otras pestañas). Botones ‹ › para mover (predecible; drag llega después).
 */
export function KanbanView({
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
    const selectFields = fields.filter((f) => f.type === 'select');
    const [groupFieldId, setGroupFieldId] = useState<number | null>(selectFields[0]?.id ?? null);
    const groupField = fields.find((f) => f.id === groupFieldId) ?? null;

    if (!groupField) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-min-h-32 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
                Agregá un campo de tipo <code className="imcrm-mx-1">select</code> para usar el Kanban.
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <span className="imcrm-text-muted-foreground">Agrupar por</span>
                <select
                    aria-label="Agrupar por"
                    value={groupField.id}
                    onChange={(e) => setGroupFieldId(Number(e.target.value))}
                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2"
                >
                    {selectFields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </select>
            </div>
            <Board
                listId={listId}
                groupField={groupField}
                fields={fields}
                records={records}
                onOpen={onOpen}
            />
        </div>
    );
}

function Board({
    listId,
    groupField,
    fields,
    records,
    onOpen,
}: {
    listId: number;
    groupField: Field;
    fields: Field[];
    records: RecordDto[];
    onOpen: (record: RecordDto) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const key = jsonbKeyForField(groupField.id);
    const options = fieldOptions(groupField);
    const titleField = fields.find((f) => f.type === 'text') ?? fields[0];

    const columns = useMemo(() => {
        const cols: Array<{ value: string | null; label: string; items: RecordDto[] }> = [
            ...options.map((o) => ({ value: o.value, label: o.label, items: [] as RecordDto[] })),
            { value: null, label: 'Sin valor', items: [] as RecordDto[] },
        ];
        const byValue = new Map(cols.map((c) => [c.value, c]));
        for (const r of records) {
            const v = r.data[key];
            const col = byValue.get(typeof v === 'string' ? v : null) ?? byValue.get(null)!;
            col.items.push(r);
        }
        return cols;
    }, [options, records, key]);

    const move = useMutation({
        mutationFn: (p: { id: number; value: string | null }) =>
            api.updateRecord(listId, p.id, { data: { [key]: p.value } }),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['records', tenantId, listId] }),
    });

    const orderedValues = columns.map((c) => c.value);

    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-gap-3 imcrm-overflow-x-auto imcrm-pb-2">
            {columns.map((col, colIdx) => (
                <div
                    key={col.value ?? '__none'}
                    className="imcrm-flex imcrm-w-64 imcrm-shrink-0 imcrm-flex-col imcrm-rounded-lg imcrm-bg-muted/30"
                >
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-font-medium">
                        <span>{col.label}</span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{col.items.length}</span>
                    </div>
                    <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2 imcrm-overflow-auto imcrm-p-2">
                        {col.items.map((r) => (
                            <div
                                key={r.id}
                                className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 imcrm-shadow-sm"
                            >
                                <button
                                    onClick={() => onOpen(r)}
                                    className="imcrm-block imcrm-w-full imcrm-truncate imcrm-text-left imcrm-text-sm"
                                >
                                    {titleField ? formatValue(titleField, r.data[jsonbKeyForField(titleField.id)]) || `#${r.id}` : `#${r.id}`}
                                </button>
                                <div className="imcrm-mt-1 imcrm-flex imcrm-justify-between imcrm-text-xs imcrm-text-muted-foreground">
                                    <button
                                        disabled={colIdx === 0}
                                        onClick={() => move.mutate({ id: r.id, value: orderedValues[colIdx - 1] ?? null })}
                                        className="disabled:imcrm-opacity-30"
                                        aria-label="Mover a la izquierda"
                                    >
                                        ‹
                                    </button>
                                    <button
                                        disabled={colIdx === columns.length - 1}
                                        onClick={() => move.mutate({ id: r.id, value: orderedValues[colIdx + 1] ?? null })}
                                        className="disabled:imcrm-opacity-30"
                                        aria-label="Mover a la derecha"
                                    >
                                        ›
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
