import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
    FIELD_TYPES,
    isDataField,
    jsonbKeyForField,
    type CreateFieldInput,
    type Field,
    type FieldType,
    type RecordDto,
} from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Vista de una lista: tabla de records + alta de campos y registros. */
export function ListView(): JSX.Element {
    const { listSlug = '' } = useParams();
    const tenantId = useSession((s) => s.activeTenantId);

    const listQ = useQuery({
        queryKey: ['list', tenantId, listSlug],
        queryFn: () => api.getList(listSlug),
        enabled: !!listSlug,
    });
    const listId = listQ.data?.id;

    const fieldsQ = useQuery({
        queryKey: ['fields', tenantId, listId],
        queryFn: () => api.listFields(listId!),
        enabled: listId !== undefined,
    });
    const recordsQ = useQuery({
        queryKey: ['records', tenantId, listId],
        queryFn: () => api.listRecords(listId!, { limit: 50 }),
        enabled: listId !== undefined,
    });

    if (listQ.isError) {
        return <Centered>Lista no encontrada.</Centered>;
    }
    if (!listQ.data || !fieldsQ.data) {
        return <Centered>Cargando…</Centered>;
    }

    const dataFields = fieldsQ.data.filter((f) => isDataField(f.type));
    const records = recordsQ.data?.data ?? [];

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">
                    {listQ.data.name}
                </h1>
                <span className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="record-count">
                    {records.length} registro{records.length === 1 ? '' : 's'}
                </span>
            </div>

            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-auto imcrm-p-4">
                <AddFieldForm listId={listQ.data.id} tenantId={tenantId} existing={fieldsQ.data.length} />

                {dataFields.length === 0 ? (
                    <Centered>Agregá un campo para empezar a cargar registros.</Centered>
                ) : (
                    <RecordsTable
                        listId={listQ.data.id}
                        tenantId={tenantId}
                        fields={dataFields}
                        records={records}
                    />
                )}
            </div>
        </div>
    );
}

function RecordsTable({
    listId,
    tenantId,
    fields,
    records,
}: {
    listId: number;
    tenantId: number | null;
    fields: Field[];
    records: RecordDto[];
}): JSX.Element {
    const qc = useQueryClient();
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);

    const invalidate = () =>
        qc.invalidateQueries({ queryKey: ['records', tenantId, listId] });

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
        <div className="imcrm-mt-4 imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border">
            <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                <thead>
                    <tr className="imcrm-border-b imcrm-border-border imcrm-bg-muted/40">
                        {fields.map((f) => (
                            <th
                                key={f.id}
                                className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium"
                            >
                                {f.label}
                                <span className="imcrm-ml-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    {f.type}
                                </span>
                            </th>
                        ))}
                        <th className="imcrm-w-10" />
                    </tr>
                </thead>
                <tbody data-testid="records-body">
                    {records.map((r) => (
                        <tr key={r.id} className="imcrm-border-b imcrm-border-border last:imcrm-border-0">
                            {fields.map((f) => (
                                <td key={f.id} className="imcrm-px-3 imcrm-py-2">
                                    {formatValue(r.data[jsonbKeyForField(f.id)])}
                                </td>
                            ))}
                            <td className="imcrm-px-2 imcrm-text-right">
                                <button
                                    onClick={() => deleteRecord.mutate(r.id)}
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
            {error && (
                <p className="imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive">{error}</p>
            )}
        </div>
    );
}

function AddFieldForm({
    listId,
    tenantId,
    existing,
}: {
    listId: number;
    tenantId: number | null;
    existing: number;
}): JSX.Element {
    const qc = useQueryClient();
    const [label, setLabel] = useState('');
    const [type, setType] = useState<FieldType>('text');

    const createField = useMutation({
        mutationFn: (input: CreateFieldInput) => api.createField(listId, input),
        onSuccess: () => {
            setLabel('');
            void qc.invalidateQueries({ queryKey: ['fields', tenantId, listId] });
        },
    });

    return (
        <form
            className="imcrm-flex imcrm-items-end imcrm-gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                if (label.trim()) createField.mutate({ label: label.trim(), type });
            }}
        >
            <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={existing === 0 ? 'Nombre del primer campo…' : 'Nuevo campo…'}
                aria-label="Nuevo campo"
                className="imcrm-max-w-xs"
            />
            <select
                aria-label="Tipo de campo"
                value={type}
                onChange={(e) => setType(e.target.value as FieldType)}
                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-text-sm"
            >
                {FIELD_TYPES.filter(isDataField).map((t) => (
                    <option key={t} value={t}>
                        {t}
                    </option>
                ))}
            </select>
            <Button type="submit" variant="secondary" size="sm" disabled={!label.trim()}>
                + Campo
            </Button>
        </form>
    );
}

function buildData(fields: Field[], draft: Record<string, string>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
        const key = jsonbKeyForField(f.id);
        const raw = draft[key];
        if (raw === undefined || raw === '') continue;
        if (f.type === 'number' || f.type === 'currency') data[key] = Number(raw);
        else if (f.type === 'checkbox') data[key] = raw === 'true' || raw === '1';
        else if (f.type === 'multi_select') data[key] = raw.split(',').map((s) => s.trim());
        else data[key] = raw;
    }
    return data;
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-32 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
            {children}
        </div>
    );
}
