import { useQuery } from '@tanstack/react-query';
import { type AggregateRequest, type Field } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { fieldOptions } from '@/cloud/lib/fieldValue';

/**
 * Dashboard mínimo sobre el motor de agregaciones: un KPI de total, y por
 * cada campo select un desglose (sum del primer number/currency, o count) en
 * barras. Demuestra POST /aggregate con group_by.
 */
export function DashboardView({
    listId,
    fields,
}: {
    listId: number;
    fields: Field[];
}): JSX.Element {
    const numberField = fields.find((f) => f.type === 'number' || f.type === 'currency');
    const selectFields = fields.filter((f) => f.type === 'select');

    return (
        <div className="imcrm-space-y-6">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-4">
                <Kpi listId={listId} title="Registros" req={{ metric: 'count' }} />
                {numberField && (
                    <Kpi
                        listId={listId}
                        title={`Σ ${numberField.label}`}
                        req={{ metric: 'sum', field_id: numberField.id }}
                    />
                )}
            </div>

            {selectFields.map((sf) => (
                <GroupedBars
                    key={sf.id}
                    listId={listId}
                    field={sf}
                    metric={numberField ? { metric: 'sum', field_id: numberField.id } : { metric: 'count' }}
                    metricLabel={numberField ? `Σ ${numberField.label}` : 'Cantidad'}
                />
            ))}
        </div>
    );
}

function Kpi({
    listId,
    title,
    req,
}: {
    listId: number;
    title: string;
    req: AggregateRequest;
}): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const q = useQuery({
        queryKey: ['agg', tenantId, listId, req],
        queryFn: () => api.aggregate(listId, req),
    });
    return (
        <div className="imcrm-min-w-40 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
            <div className="imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
            </div>
            <div className="imcrm-mt-1 imcrm-text-3xl imcrm-font-semibold imcrm-tabular-nums">
                {q.data ? formatNum(q.data.value) : '—'}
            </div>
        </div>
    );
}

function GroupedBars({
    listId,
    field,
    metric,
    metricLabel,
}: {
    listId: number;
    field: Field;
    metric: AggregateRequest;
    metricLabel: string;
}): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const q = useQuery({
        queryKey: ['agg', tenantId, listId, field.id, metric],
        queryFn: () => api.aggregate(listId, { ...metric, group_by_field_id: field.id }),
    });
    const opts = fieldOptions(field);
    const groups = q.data?.groups ?? [];
    const max = Math.max(1, ...groups.map((g) => num(g.value)));

    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
            <div className="imcrm-mb-3 imcrm-text-sm imcrm-font-medium">
                {metricLabel} por {field.label}
            </div>
            <div className="imcrm-space-y-2">
                {groups.map((g) => {
                    const label = opts.find((o) => o.value === g.group)?.label ?? g.group ?? 'Sin valor';
                    const value = num(g.value);
                    return (
                        <div key={g.group ?? '__none'} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <span className="imcrm-w-28 imcrm-shrink-0 imcrm-truncate">{label}</span>
                            <div className="imcrm-h-4 imcrm-flex-1 imcrm-rounded imcrm-bg-muted">
                                <div
                                    className="imcrm-h-4 imcrm-rounded imcrm-bg-primary"
                                    style={{ width: `${(value / max) * 100}%` }}
                                />
                            </div>
                            <span className="imcrm-w-16 imcrm-shrink-0 imcrm-text-right imcrm-tabular-nums">
                                {formatNum(g.value)}
                            </span>
                        </div>
                    );
                })}
                {groups.length === 0 && <p className="imcrm-text-sm imcrm-text-muted-foreground">Sin datos.</p>}
            </div>
        </div>
    );
}

function num(v: number | string | null): number {
    return typeof v === 'number' ? v : 0;
}
function formatNum(v: number | string | null): string {
    if (v === null) return '0';
    return typeof v === 'number' ? new Intl.NumberFormat('es').format(v) : v;
}
