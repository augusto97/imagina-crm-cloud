import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Loader2, Plus } from 'lucide-react';
import { readStoreListMarker, type LayoutBlock, type LayoutDataSource } from '@imagina-base/shared';

import { RecordCreateDialog } from '@/admin/records/RecordCreateDialog';
import { OptionChip, renderCellValue } from '@/admin/records/renderCellValue';
import { Button } from '@/components/ui/button';
import { useList } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { formatDateStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { optionsOf } from './FieldDisplay';
import { useLayoutCtx } from './LayoutContext';
import { tint } from './layoutTheme';
import { layoutDataKeys, relatedOf, type RelatedBlockData } from './useLayoutData';

type Row = RelatedBlockData['rows'][number];

const SKIP: ReadonlySet<string> = new Set(['long_text', 'file']);

/**
 * v0.1.230 — Los registros VINCULADOS a este registro (las facturas de un
 * cliente, las tareas de un proyecto) como tabla, lista, tarjetas, tablero
 * por estado, línea de tiempo o galería. Los datos llegan en el bundle de la
 * ficha, ya acotados al vínculo y con el ACL de quien mira.
 */
export function RelatedBlockView({ block }: { block: LayoutBlock }): JSX.Element {
    const ctx = useLayoutCtx();
    const { data, error } = relatedOf(ctx.data, block.id);
    const view = String(block.config.view ?? 'table');

    if (error) return <p className="imcrm-px-4 imcrm-pb-4 imcrm-text-sm imcrm-text-destructive">{error}</p>;
    if (!data) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-pb-4 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
            </div>
        );
    }
    const titleField = data.fields.find((f) => f.is_primary) ?? data.fields.find((f) => f.type === 'text');
    const chosen = Array.isArray(block.config.field_ids)
        ? (block.config.field_ids as unknown[]).map(Number).map((id) => data.fields.find((f) => f.id === id)).filter((f): f is FieldEntity => f !== undefined)
        : [];
    const columns = (chosen.length > 0 ? chosen : data.fields.filter((f) => !SKIP.has(f.type)).slice(0, 6)).filter((f) => f.id !== titleField?.id);
    const href = (row: Row): string => `/lists/${data.list.slug}/records/${row.id}`;
    const titleOf = (row: Row): string => {
        const v = titleField ? row.data[`f${titleField.id}`] : null;
        return typeof v === 'string' && v !== '' ? v : `#${row.id}`;
    };
    const props = { data, rows: data.rows, columns, titleField, titleOf, href, block };

    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
            <RelatedToolbar block={block} data={data} />
            {data.rows.length === 0 ? (
                <p className="imcrm-px-4 imcrm-pb-5 imcrm-pt-2 imcrm-text-sm imcrm-text-muted-foreground">
                    {sprintf(__('Todavía no hay registros de «%s» vinculados.'), data.list.name)}
                </p>
            ) : view === 'list' ? (
                <ListView {...props} />
            ) : view === 'cards' ? (
                <CardsView {...props} />
            ) : view === 'board' ? (
                <BoardView {...props} />
            ) : view === 'timeline' ? (
                <TimelineView {...props} />
            ) : view === 'gallery' ? (
                <GalleryView {...props} />
            ) : (
                <TableView {...props} />
            )}
            {data.total > data.rows.length && ctx.mode === 'portal' && (
                <p className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(__('Mostrando %1$s de %2$s'), formatNumber(data.rows.length), formatNumber(data.total))}
                </p>
            )}
            {data.total > data.rows.length && ctx.mode !== 'portal' && (
                <Link
                    to={`/lists/${data.list.slug}/records`}
                    className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    {sprintf(__('Mostrando %1$s de %2$s · Ver la lista'), formatNumber(data.rows.length), formatNumber(data.total))}
                </Link>
            )}
        </div>
    );
}

interface ViewProps {
    data: RelatedBlockData;
    rows: Row[];
    columns: FieldEntity[];
    titleField: FieldEntity | undefined;
    titleOf: (row: Row) => string;
    href: (row: Row) => string;
    block: LayoutBlock;
}

function valueOf(row: Row, f: FieldEntity): unknown {
    return f.type === 'relation' ? row.relations?.[`f${f.id}`] ?? [] : row.data[`f${f.id}`];
}

/** Cantidad + alta de un vinculado (en el sentido que se puede: la relación vive del otro lado). */
function RelatedToolbar({ block, data }: { block: LayoutBlock; data: RelatedBlockData }): JSX.Element {
    const ctx = useLayoutCtx();
    const qc = useQueryClient();
    const [adding, setAdding] = useState(false);
    const source = block.config.source as LayoutDataSource | undefined;
    // En el portal no se consulta el admin ni se dan de alta registros.
    const otherList = useList(ctx.mode === 'portal' ? undefined : data.list.id);
    const relField = source?.kind === 'related' ? data.fields.find((f) => f.id === source.field_id) : undefined;
    // Sólo hacia adentro: el nuevo registro de la otra lista nace apuntando a éste.
    const canAdd = ctx.mode !== 'portal' && relField !== undefined && !ctx.preview && readStoreListMarker(otherList.data?.settings) === null;
    const initialValues = useMemo(() => (relField ? { [relField.slug]: [ctx.record.id] } : undefined), [relField, ctx.record.id]);
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-px-4 imcrm-pb-2">
            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                <span className="imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground" style={{ background: tint(ctx.theme.accent, 12) }}>
                    {formatNumber(data.total)}
                </span>
                {data.list.name}
            </span>
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                {canAdd && (
                    <Button variant="ghost" size="sm" className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs" onClick={() => setAdding(true)}>
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar')}
                    </Button>
                )}
            </span>
            {adding && otherList.data && (
                <RecordCreateDialog
                    listId={data.list.id}
                    listName={data.list.name}
                    fields={data.fields}
                    open={adding}
                    onOpenChange={(o) => {
                        setAdding(o);
                        if (!o) void qc.invalidateQueries({ queryKey: layoutDataKeys.all });
                    }}
                    initialValues={initialValues}
                />
            )}
        </div>
    );
}

function TableView({ rows, columns, titleField, titleOf, href }: ViewProps): JSX.Element {
    return (
        <div className="imcrm-overflow-x-auto imcrm-border-t imcrm-border-border">
            <table className="imcrm-w-full imcrm-text-[13px]">
                <thead>
                    <tr className="imcrm-text-left imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                        <th className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-font-medium">{titleField?.label ?? __('Registro')}</th>
                        {columns.map((c) => (
                            <th key={c.id} className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-font-medium">{c.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} className="imcrm-group imcrm-border-t imcrm-border-border/70 hover:imcrm-bg-accent/40">
                            <td className="imcrm-max-w-[260px] imcrm-px-4 imcrm-py-2">
                                <RowLink to={href(r)} className="imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-foreground hover:imcrm-underline">
                                    <span className="imcrm-truncate">{titleOf(r)}</span>
                                    <ArrowUpRight className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-0 group-hover:imcrm-opacity-60" />
                                </RowLink>
                            </td>
                            {columns.map((c) => (
                                <td key={c.id} className="imcrm-max-w-[220px] imcrm-truncate imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2">
                                    {renderCellValue(c, valueOf(r, c))}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ListView({ rows, columns, titleOf, href }: ViewProps): JSX.Element {
    const meta = columns.slice(0, 3);
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-border-t imcrm-border-border">
            {rows.map((r) => (
                <li key={r.id} className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0">
                    <RowLink to={href(r)} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-2.5 hover:imcrm-bg-accent/40">
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-medium imcrm-text-foreground">{titleOf(r)}</span>
                        <span className="imcrm-hidden imcrm-min-w-0 imcrm-items-center imcrm-gap-3 imcrm-text-xs imcrm-text-muted-foreground sm:imcrm-flex">
                            {meta.map((c) => (
                                <span key={c.id} className="imcrm-max-w-[160px] imcrm-truncate">{renderCellValue(c, valueOf(r, c))}</span>
                            ))}
                        </span>
                    </RowLink>
                </li>
            ))}
        </ul>
    );
}

function CardsView({ rows, columns, titleOf, href }: ViewProps): JSX.Element {
    const ctx = useLayoutCtx();
    const meta = columns.slice(0, 4);
    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 imcrm-px-4 imcrm-pb-4 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
            {rows.map((r) => (
                <RowLink
                    key={r.id}
                    to={href(r)}
                    className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-transition-shadow hover:imcrm-shadow-imcrm-md"
                    style={{ borderTop: `3px solid ${ctx.theme.accent}` }}
                >
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">{titleOf(r)}</span>
                    <dl className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {meta.map((c) => (
                            <div key={c.id} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-xs">
                                <dt className="imcrm-truncate imcrm-text-muted-foreground">{c.label}</dt>
                                <dd className="imcrm-min-w-0 imcrm-truncate imcrm-text-right">{renderCellValue(c, valueOf(r, c))}</dd>
                            </div>
                        ))}
                    </dl>
                </RowLink>
            ))}
        </div>
    );
}

function BoardView({ data, rows, columns, titleOf, href, block }: ViewProps): JSX.Element {
    const group =
        data.fields.find((f) => f.id === Number(block.config.group_field_id)) ??
        data.fields.find((f) => f.type === 'select');
    if (!group) return <TableView data={data} rows={rows} columns={columns} titleField={undefined} titleOf={titleOf} href={href} block={block} />;
    const opts = optionsOf(group);
    const lanes = [...opts.map((o) => ({ key: o.value, opt: o })), { key: '', opt: undefined }];
    const meta = columns.filter((c) => c.id !== group.id).slice(0, 2);
    return (
        <div className="imcrm-flex imcrm-gap-3 imcrm-overflow-x-auto imcrm-px-4 imcrm-pb-4">
            {lanes.map((lane) => {
                const items = rows.filter((r) => (r.data[`f${group.id}`] ?? '') === lane.key);
                if (lane.key === '' && items.length === 0) return null;
                return (
                    <div key={lane.key || '__none'} className="imcrm-flex imcrm-w-[220px] imcrm-shrink-0 imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted/50 imcrm-p-2">
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-px-1">
                            {lane.opt ? <OptionChip opt={lane.opt} fallback={lane.key} /> : <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin valor')}</span>}
                            <span className="imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">{items.length}</span>
                        </div>
                        {items.map((r) => (
                            <RowLink key={r.id} to={href(r)} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 imcrm-shadow-imcrm-sm hover:imcrm-shadow-imcrm-md">
                                <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-medium">{titleOf(r)}</span>
                                {meta.map((c) => (
                                    <span key={c.id} className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{renderCellValue(c, valueOf(r, c))}</span>
                                ))}
                            </RowLink>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function TimelineView({ data, rows, columns, titleOf, href, block }: ViewProps): JSX.Element {
    const ctx = useLayoutCtx();
    const date =
        data.fields.find((f) => f.id === Number(block.config.date_field_id)) ??
        data.fields.find((f) => f.type === 'date' || f.type === 'datetime');
    const dateOf = (r: Row): string => {
        const v = date ? r.data[`f${date.id}`] : r.created_at;
        return typeof v === 'string' ? v : '';
    };
    const sorted = [...rows].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    const meta = columns.filter((c) => c.id !== date?.id).slice(0, 2);
    return (
        <ol className="imcrm-relative imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-px-4 imcrm-pb-4 imcrm-pl-8">
            <span className="imcrm-absolute imcrm-bottom-4 imcrm-left-[19px] imcrm-top-1 imcrm-w-px imcrm-bg-border" aria-hidden />
            {sorted.map((r) => (
                <li key={r.id} className="imcrm-relative">
                    <span className="imcrm-absolute imcrm--left-[17px] imcrm-top-1 imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-ring-4 imcrm-ring-card" style={{ background: ctx.theme.accent }} aria-hidden />
                    <span className="imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {dateOf(r) ? formatDateStr(dateOf(r).slice(0, 10)) : '—'}
                    </span>
                    <RowLink to={href(r)} className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium imcrm-text-foreground hover:imcrm-underline">
                        {titleOf(r)}
                    </RowLink>
                    {meta.length > 0 && (
                        <span className="imcrm-mt-0.5 imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-text-xs imcrm-text-muted-foreground">
                            {meta.map((c) => (
                                <span key={c.id}>{renderCellValue(c, valueOf(r, c))}</span>
                            ))}
                        </span>
                    )}
                </li>
            ))}
        </ol>
    );
}

function GalleryView({ data, rows, titleOf, href, block }: ViewProps): JSX.Element {
    const ctx = useLayoutCtx();
    const image =
        data.fields.find((f) => f.id === Number(block.config.image_field_id)) ??
        data.fields.find((f) => f.type === 'url' && (f.config as { display?: string }).display === 'image');
    return (
        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 imcrm-px-4 imcrm-pb-4 sm:imcrm-grid-cols-3 xl:imcrm-grid-cols-4">
            {rows.map((r) => {
                const src = image ? r.data[`f${image.id}`] : undefined;
                return (
                    <RowLink key={r.id} to={href(r)} className="imcrm-group imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <span
                            className={cn('imcrm-aspect-[4/3] imcrm-w-full imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border')}
                            style={{ background: tint(ctx.theme.accent, 10) }}
                        >
                            {typeof src === 'string' && src !== '' && (
                                <img src={src} alt="" className="imcrm-h-full imcrm-w-full imcrm-object-cover imcrm-transition-transform group-hover:imcrm-scale-[1.03]" />
                            )}
                        </span>
                        <span className="imcrm-truncate imcrm-text-xs imcrm-font-medium">{titleOf(r)}</span>
                    </RowLink>
                );
            })}
        </div>
    );
}

/** El enlace a la ficha de un vinculado; en el portal no hay a dónde ir. */
function RowLink({ to, className, style, children }: { to: string; className?: string; style?: CSSProperties; children: ReactNode }): JSX.Element {
    const ctx = useLayoutCtx();
    if (ctx.mode === 'portal' || ctx.preview) return <div className={className} style={style}>{children}</div>;
    return (
        <Link to={to} className={className} style={style}>
            {children}
        </Link>
    );
}
