import { useRecordActivity } from '@/hooks/useActivity';
import { useComments } from '@/hooks/useComments';
import { __, sprintf } from '@/lib/i18n';
import { parseUtcDate } from '@/lib/utcDate';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { FieldDisplay } from './FieldDisplay';

type AutoMetric = 'days_in_system' | 'days_since_changes' | 'comments' | 'changes';
type StatsItem = { kind: 'auto'; metric: AutoMetric } | { kind: 'field'; field_id?: number; field_slug?: string; label?: string };

/**
 * v0.1.234 — El bloque «Resumen» de la ficha: una fila de cifras chicas, sin
 * cajas dentro de la caja (antes eran cuatro recuadros en mayúsculas que
 * ocupaban media pantalla para decir "0"). Las fechas se dicen como se dicen
 * ("Hoy", "hace 3 días") y en columnas angostas pasan a 2 × 2 solas.
 */
export function RecordStatsView({
    listId,
    record,
    items,
    fieldsById,
    values,
}: {
    listId: number;
    record: RecordEntity;
    items: StatsItem[];
    fieldsById: Map<number, FieldEntity>;
    values: Record<string, unknown>;
}): JSX.Element {
    const comments = useComments(listId, record.id);
    const activity = useRecordActivity(listId, record.id);
    const effective: StatsItem[] =
        items.length > 0
            ? items
            : (['days_in_system', 'days_since_changes', 'comments', 'changes'] as const).map((metric) => ({ kind: 'auto' as const, metric }));

    return (
        <dl className="imcrm-grid imcrm-gap-x-4 imcrm-gap-y-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))' }} data-testid="imcrm-record-stats">
            {effective.map((it, i) => {
                if (it.kind === 'auto') {
                    const { label, value } = autoMetric(it.metric, record, comments.data?.length, activity.data);
                    return <Stat key={i} label={label} value={value} />;
                }
                // Los diseños convertidos del editor anterior guardan el slug.
                const field =
                    (it.field_id !== undefined ? fieldsById.get(Number(it.field_id)) : undefined) ??
                    [...fieldsById.values()].find((f) => f.slug === it.field_slug);
                if (!field) return null;
                return <Stat key={i} label={it.label || field.label} value={<FieldDisplay field={field} value={values[field.slug]} />} />;
            })}
        </dl>
    );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
            <dt className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{label}</dt>
            <dd className="imcrm-truncate imcrm-text-base imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">{value}</dd>
        </div>
    );
}

function autoMetric(
    metric: AutoMetric,
    record: RecordEntity,
    commentCount: number | undefined,
    activity: Array<{ action: string }> | undefined,
): { label: string; value: string } {
    switch (metric) {
        case 'days_in_system': {
            const d = daysSince(record.created_at);
            return { label: __('En el sistema'), value: d === null ? '—' : d === 0 ? __('Desde hoy') : sprintf(d === 1 ? __('%d día') : __('%d días'), d) };
        }
        case 'days_since_changes': {
            const d = daysSince(record.updated_at);
            return { label: __('Último cambio'), value: d === null ? '—' : d === 0 ? __('Hoy') : d === 1 ? __('Ayer') : sprintf(__('Hace %d días'), d) };
        }
        case 'comments':
            return { label: __('Comentarios'), value: commentCount === undefined ? '…' : String(commentCount) };
        case 'changes':
            return {
                label: __('Cambios'),
                value: activity === undefined ? '…' : String(activity.filter((a) => !a.action.startsWith('comment.')).length),
            };
    }
}

function daysSince(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const t = parseUtcDate(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
