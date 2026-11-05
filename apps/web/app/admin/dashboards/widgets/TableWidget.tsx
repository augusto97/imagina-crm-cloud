import { useContext, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { renderCellValue } from '@/admin/records/renderCellValue';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import { useWidgetData, WidgetDataOverrideContext } from '@/hooks/useDashboards';
import { fetchRelationTitles, relationIds, relationTarget, type RelationTitles } from '@/hooks/useRelationTitles';
import type { FieldEntity } from '@/types/field';
import type { WidgetSpec } from '@/types/dashboard';

import { WidgetError } from './WidgetError';
import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface TableWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

interface Column {
    label: string;
    slug: string;
    type: string;
    id?: number;
}

/**
 * Top N rows ordenados por un campo. Útil como "leaderboard" o
 * "últimos N records". El backend devuelve `{columns, rows}`.
 *
 * v0.1.286 — cada celda se pinta con el MISMO render de la tabla de
 * registros (`renderCellValue`): chips de opciones con su color (antes un
 * multi_select salía "promo,vip"), el NOMBRE de la persona y del archivo (no
 * su id), monedas/calculados/rollups con su formato, estrellas, porcentajes.
 */
export function TableWidget({ dashboardId, widget }: TableWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const subtitle = useWidgetSubtitle(widget);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <WidgetHeader title={widget.title || __('Top registros')} subtitle={subtitle} />

            <div className="imcrm-flex imcrm-flex-1 imcrm-min-h-0 imcrm-flex-col imcrm-overflow-auto imcrm-rounded-lg imcrm-border imcrm-border-border">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-py-6">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <WidgetError error={data.error} />
                ) : data.data && 'rows' in data.data ? (
                    <Body
                        columns={data.data.columns as Column[]}
                        rows={data.data.rows}
                        fields={fields.data ?? []}
                    />
                ) : null}
            </div>
        </div>
    );
}

function Body({
    columns,
    rows,
    fields,
}: {
    columns: Column[];
    rows: Array<{ id: number; fields: Record<string, unknown> }>;
    fields: FieldEntity[];
}): JSX.Element {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const titles = useRelationColumnTitles(columns, rows, fields);
    if (rows.length === 0) {
        return (
            <p className="imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                {__('Sin datos.')}
            </p>
        );
    }

    return (
        <table className="imcrm-w-full imcrm-text-sm">
            <thead className="imcrm-sticky imcrm-top-0 imcrm-z-[1] imcrm-bg-canvas">
                <tr className="imcrm-border-b imcrm-border-border">
                    {columns.map((col) => (
                        <th
                            key={col.slug}
                            scope="col"
                            className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground"
                        >
                            {col.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr
                        key={row.id}
                        className="imcrm-border-t imcrm-border-border/50 hover:imcrm-bg-accent/40"
                    >
                        {columns.map((col) => {
                            const field = (col.id !== undefined ? byId.get(col.id) : undefined) ?? bySlug.get(col.slug);
                            return (
                                <td
                                    key={col.slug}
                                    className="imcrm-max-w-[260px] imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-1.5 imcrm-align-middle imcrm-text-[13px]"
                                >
                                    <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-overflow-hidden">
                                        {cell(col, row.fields[col.slug], field, titles.get(col.slug))}
                                    </div>
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/**
 * v0.1.371 — Los títulos de los registros vinculados de las columnas de
 * relación (una consulta por columna, con todos los ids de la tabla), como en
 * la tabla de registros. Dentro de un tablero público, el portal o la ficha
 * (`WidgetDataOverrideContext`) no se piden: ahí no hay sesión del equipo.
 */
function useRelationColumnTitles(
    columns: Column[],
    rows: Array<{ id: number; fields: Record<string, unknown> }>,
    fields: FieldEntity[],
): Map<string, RelationTitles> {
    const qc = useQueryClient();
    const override = useContext(WidgetDataOverrideContext);
    const specs = useMemo(() => {
        if (override) return [];
        const out: Array<{ slug: string; target: number; ids: number[] }> = [];
        for (const col of columns) {
            if (col.type !== 'relation') continue;
            const f = fields.find((x) => (col.id !== undefined && x.id === col.id) || x.slug === col.slug);
            const target = f ? relationTarget(f) : null;
            if (!target) continue;
            const ids = new Set<number>();
            for (const r of rows) for (const id of relationIds(r.fields[col.slug])) ids.add(id);
            if (ids.size > 0) out.push({ slug: col.slug, target, ids: [...ids].sort((a, b) => a - b) });
        }
        return out;
    }, [columns, rows, fields, override]);
    const results = useQueries({
        queries: specs.map((s) => ({
            queryKey: ['relation-titles', String(s.target), s.ids.join(',')],
            queryFn: () => fetchRelationTitles(qc, s.target, s.ids),
            staleTime: 30_000,
        })),
    });
    const sig = results.map((r) => r.dataUpdatedAt).join(',');
    return useMemo(() => {
        const m = new Map<string, RelationTitles>();
        specs.forEach((s, i) => {
            const d = results[i]?.data;
            if (d) m.set(s.slug, d);
        });
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [specs, sig]);
}

function cell(col: Column, value: unknown, field: FieldEntity | undefined, titles?: RelationTitles): React.ReactNode {
    if (col.type === 'relation') {
        const ids = relationIds(value);
        const n = ids.length;
        if (n === 0) return <span className="imcrm-text-muted-foreground">—</span>;
        const names = titles ? ids.map((id) => titles[id]).filter((t): t is string => typeof t === 'string' && t !== '') : [];
        if (names.length > 0) {
            const shown = names.slice(0, 2).join(', ');
            return <span className="imcrm-truncate">{n > 2 ? `${shown} ${sprintf(__('+%d'), n - 2)}` : shown}</span>;
        }
        return n === 1 ? __('1 vinculado') : sprintf(__('%d vinculados'), n);
    }
    if (field) return renderCellValue(field, value);
    if (value === null || value === undefined || value === '') {
        return <span className="imcrm-text-muted-foreground">—</span>;
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
}
