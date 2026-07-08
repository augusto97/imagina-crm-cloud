import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
    FIELD_TYPES,
    isDataField,
    type CreateFieldInput,
    type FieldType,
    type FilterCondition,
    type FilterGroup,
    type RecordDto,
} from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { AutomationsPanel } from '@/cloud/components/AutomationsPanel';
import { FilterBar } from '@/cloud/components/FilterBar';
import { ImportExport } from '@/cloud/components/ImportExport';
import { CalendarView } from '@/cloud/components/CalendarView';
import { CardsView } from '@/cloud/components/CardsView';
import { DashboardView } from '@/cloud/components/DashboardView';
import { KanbanView } from '@/cloud/components/KanbanView';
import { PortalTemplateEditor } from '@/cloud/components/PortalTemplateEditor';
import { ViewTabs } from '@/cloud/components/ViewTabs';
import { RecordDrawer } from '@/cloud/components/RecordDrawer';
import { RecordsTable } from '@/cloud/components/RecordsTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Mode =
    | 'table'
    | 'kanban'
    | 'cards'
    | 'calendar'
    | 'dashboard'
    | 'automations'
    | 'portal';
const MODES: Array<{ id: Mode; label: string }> = [
    { id: 'table', label: 'Tabla' },
    { id: 'kanban', label: 'Kanban' },
    { id: 'cards', label: 'Tarjetas' },
    { id: 'calendar', label: 'Calendario' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'automations', label: 'Automatizaciones' },
    { id: 'portal', label: 'Portal' },
];

/** Vista de una lista con switcher Tabla/Kanban/Dashboard + record drawer. */
export function ListView(): JSX.Element {
    const { listSlug = '' } = useParams();
    const tenantId = useSession((s) => s.activeTenantId);
    const [mode, setMode] = useState<Mode>('table');
    const [open, setOpen] = useState<RecordDto | null>(null);
    const [filters, setFilters] = useState<FilterCondition[]>([]);
    const filterTree: FilterGroup | undefined =
        filters.length > 0 ? { type: 'group', logic: 'and', children: filters } : undefined;

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
        // El filtro entra en la key → refetch al cambiar (realtime invalida
        // sólo ['records', tenant, listId], que hace prefix-match de todas).
        queryKey: ['records', tenantId, listId, filterTree],
        queryFn: () => api.listRecords(listId!, { limit: 200, filter_tree: filterTree }),
        enabled: listId !== undefined,
    });

    if (listQ.isError) return <Centered>Lista no encontrada.</Centered>;
    if (!listQ.data || !fieldsQ.data) return <Centered>Cargando…</Centered>;

    const list = listQ.data;
    const dataFields = fieldsQ.data.filter((f) => isDataField(f.type));
    const records = recordsQ.data?.data ?? [];
    // Mantiene el drawer sincronizado con el último fetch (realtime).
    const openRecord = open ? (records.find((r) => r.id === open.id) ?? open) : null;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-4">
                    <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">{list.name}</h1>
                    <div className="imcrm-flex imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5">
                        {MODES.map((m) => (
                            <button
                                key={m.id}
                                onClick={() => setMode(m.id)}
                                className={[
                                    'imcrm-rounded imcrm-px-2.5 imcrm-py-1 imcrm-text-sm',
                                    mode === m.id
                                        ? 'imcrm-bg-card imcrm-font-medium imcrm-shadow-sm'
                                        : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                ].join(' ')}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    {mode === 'table' && dataFields.length > 0 && (
                        <ImportExport listSlug={list.slug} listName={list.name} fields={dataFields} />
                    )}
                    <span className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="record-count">
                        {records.length} registro{records.length === 1 ? '' : 's'}
                    </span>
                </div>
            </div>

            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-auto imcrm-p-4">
                {mode !== 'dashboard' && mode !== 'automations' && mode !== 'portal' && (
                    <div className="imcrm-space-y-3">
                        <ViewTabs
                            listSlug={list.slug}
                            mode={mode}
                            filters={filters}
                            dataFields={dataFields}
                            onApply={(type, applied) => {
                                setMode(type);
                                setFilters(applied);
                            }}
                        />
                        <AddFieldForm listId={list.id} tenantId={tenantId} existing={fieldsQ.data.length} />
                        {dataFields.length > 0 && (
                            <FilterBar fields={dataFields} conditions={filters} onChange={setFilters} />
                        )}
                    </div>
                )}

                {mode === 'automations' ? (
                    <AutomationsPanel listSlug={list.slug} fields={dataFields} />
                ) : mode === 'portal' ? (
                    <PortalTemplateEditor list={list} />
                ) : dataFields.length === 0 ? (
                    <Centered>Agregá un campo para empezar.</Centered>
                ) : mode === 'table' ? (
                    <div className="imcrm-mt-4">
                        <RecordsTable listId={list.id} fields={dataFields} records={records} onOpen={setOpen} />
                    </div>
                ) : mode === 'kanban' ? (
                    <div className="imcrm-mt-4 imcrm-h-[calc(100%-3rem)]">
                        <KanbanView listId={list.id} fields={dataFields} records={records} onOpen={setOpen} />
                    </div>
                ) : mode === 'cards' ? (
                    <div className="imcrm-mt-4">
                        <CardsView fields={dataFields} records={records} onOpen={setOpen} />
                    </div>
                ) : mode === 'calendar' ? (
                    <div className="imcrm-mt-4 imcrm-h-[calc(100%-3rem)]">
                        <CalendarView fields={dataFields} records={records} onOpen={setOpen} />
                    </div>
                ) : (
                    <DashboardView listId={list.id} fields={dataFields} />
                )}
            </div>

            {openRecord && (
                <RecordDrawer
                    listId={list.id}
                    listSlug={list.slug}
                    fields={fieldsQ.data}
                    record={openRecord}
                    onClose={() => setOpen(null)}
                />
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

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-32 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
            {children}
        </div>
    );
}
