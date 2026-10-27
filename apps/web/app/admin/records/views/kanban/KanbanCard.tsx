import { memo } from 'react';
import { ArrowRightLeft, ClipboardCheck, ExternalLink, ListTodo, Lock, MoreHorizontal, Rows3 } from 'lucide-react';

import { renderCellValue } from '@/admin/records/renderCellValue';
import { colorVar, type OptionColor } from '@/components/ui/color-picker';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { blockedTitle, checklistTitle } from '../RecordNameCell';
import { formatKanbanValue } from './kanbanModel';

export interface MoveTarget {
    key: string;
    label: string;
    color?: string;
}

interface KanbanCardProps {
    record: RecordEntity;
    titleField?: FieldEntity;
    metaFields: FieldEntity[];
    /** Campo de valor (el monto): se destaca al pie si no está entre los campos visibles. */
    valueField: FieldEntity | null;
    coverUrl: string | null;
    size: 'compact' | 'normal';
    columnColor?: string;
    isDragging: boolean;
    /** Si se puede arrastrar; con `lockReason` se explica por qué no. */
    draggable: boolean;
    lockReason: string | null;
    /** Callbacks ESTABLES (reciben el registro): la tarjeta va memoizada. */
    onDragStart: (record: RecordEntity, e: React.DragEvent) => void;
    onDragEnd: () => void;
    onOpen: (record: RecordEntity) => void;
    /** «Mover a…»: columnas (todas; se omite la suya) y carriles. */
    columnTargets: MoveTarget[];
    currentColumn: string;
    laneTargets: MoveTarget[] | null;
    currentLane: string | null;
    onMoveColumn: (record: RecordEntity, key: string) => void;
    onMoveLane: (record: RecordEntity, key: string) => void;
}

/**
 * Tarjeta del kanban. Los campos se muestran con su formato REAL
 * (`renderCellValue`: chips con el color de la opción, moneda, fecha, persona
 * con su avatar…). `content-visibility: auto` deja que el navegador no pinte
 * las tarjetas fuera de pantalla: con cientos por columna, el tablero no se
 * vuelve pesado.
 */
function KanbanCardImpl({
    record,
    titleField,
    metaFields,
    valueField,
    coverUrl,
    size,
    columnColor,
    isDragging,
    draggable,
    lockReason,
    onDragStart,
    onDragEnd,
    onOpen,
    columnTargets: allColumns,
    currentColumn,
    laneTargets: allLanes,
    currentLane,
    onMoveColumn,
    onMoveLane,
}: KanbanCardProps): JSX.Element {
    const columnTargets = allColumns.filter((t) => t.key !== currentColumn);
    const laneTargets = allLanes ? allLanes.filter((t) => t.key !== currentLane) : null;
    const titleValue = titleField ? record.fields[titleField.slug] : undefined;
    const title =
        typeof titleValue === 'string' && titleValue.trim() !== ''
            ? titleValue
            : titleValue !== undefined && titleValue !== null && titleValue !== ''
                ? String(titleValue)
                : sprintf(
                      /* translators: %d: record id */
                      __('Registro #%d'),
                      record.id,
                  );
    const compact = size === 'compact';
    const rows = metaFields.filter((f) => !isEmpty(record.fields[f.slug]));
    const amount = valueField && !metaFields.some((f) => f.id === valueField.id) ? record.fields[valueField.slug] : undefined;
    const amountNum = typeof amount === 'number' ? amount : amount !== undefined && amount !== null && amount !== '' ? Number(amount) : NaN;
    const canMove = (columnTargets.length > 0 || (laneTargets?.length ?? 0) > 0) && lockReason === null;

    return (
        <article
            draggable={draggable}
            onDragStart={(e) => onDragStart(record, e)}
            onDragEnd={onDragEnd}
            onClick={() => onOpen(record)}
            data-testid="imcrm-kanban-card"
            data-record-id={record.id}
            data-tour="records-row"
            style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? 'auto 64px' : 'auto 110px' }}
            className={cn(
                'imcrm-group imcrm-relative imcrm-cursor-pointer imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-transition-[box-shadow,border-color,opacity] imcrm-duration-150',
                'hover:imcrm-shadow-imcrm-md hover:imcrm-border-foreground/20',
                isDragging && 'imcrm-opacity-40',
            )}
        >
            {columnColor !== undefined && (
                <span
                    aria-hidden
                    className="imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-h-full imcrm-w-1"
                    style={{ backgroundColor: colorVar(columnColor as OptionColor) ?? columnColor }}
                />
            )}
            {coverUrl && (
                <div
                    className={cn('imcrm-w-full imcrm-bg-muted', compact ? 'imcrm-h-20' : 'imcrm-h-28')}
                    style={{ backgroundImage: `url("${coverUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    aria-hidden
                    data-testid="imcrm-kanban-card-cover"
                />
            )}

            <div className={cn('imcrm-flex imcrm-flex-col', compact ? 'imcrm-gap-1 imcrm-px-2.5 imcrm-py-2 imcrm-pl-3' : 'imcrm-gap-2 imcrm-p-3 imcrm-pl-3.5')}>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-1.5">
                    <h4
                        className={cn(
                            'imcrm-flex-1 imcrm-font-semibold imcrm-leading-snug imcrm-text-foreground',
                            compact ? 'imcrm-line-clamp-1 imcrm-text-[13px]' : 'imcrm-line-clamp-2 imcrm-text-sm',
                        )}
                        data-testid="imcrm-kanban-card-title"
                    >
                        {title}
                    </h4>
                    {/* A8 — bloqueado por registros abiertos (viaja en el bundle). */}
                    {(record.blocked_by_open ?? 0) > 0 && (
                        <span
                            role="img"
                            title={blockedTitle(record.blocked_by_open ?? 0)}
                            aria-label={blockedTitle(record.blocked_by_open ?? 0)}
                            className="imcrm-mt-0.5 imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400"
                            data-testid="imcrm-kanban-card-blocked"
                        >
                            <Lock className="imcrm-h-3.5 imcrm-w-3.5" />
                        </span>
                    )}
                    {/* C5 — aprobación pendiente. */}
                    {(record.approval_pending ?? 0) > 0 && (
                        <span
                            role="img"
                            title={__('Aprobación pendiente')}
                            aria-label={__('Aprobación pendiente')}
                            className="imcrm-mt-0.5 imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400"
                            data-testid="imcrm-kanban-card-approval"
                        >
                            <ClipboardCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                        </span>
                    )}
                    {/* A9 — progreso de los checklists. */}
                    {record.checklist && record.checklist.total > 0 && (
                        <span
                            title={checklistTitle(record.checklist.done, record.checklist.total)}
                            className={cn(
                                'imcrm-mt-0.5 imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums',
                                record.checklist.done === record.checklist.total ? 'imcrm-text-emerald-600 dark:imcrm-text-emerald-400' : 'imcrm-text-muted-foreground',
                            )}
                            data-testid="imcrm-kanban-card-checklist"
                        >
                            <ListTodo className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {record.checklist.done}/{record.checklist.total}
                        </span>
                    )}
                    {lockReason !== null && (
                        <span title={lockReason} className="imcrm-mt-0.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-label={lockReason}>
                            <Lock className="imcrm-h-3.5 imcrm-w-3.5" />
                        </span>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={sprintf(__('Acciones de «%s»'), title)}
                                className="imcrm--mr-1 imcrm--mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground imcrm-opacity-60 hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover:imcrm-opacity-100 [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 focus-visible:imcrm-opacity-100"
                                data-testid="imcrm-kanban-card-menu"
                            >
                                <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="imcrm-max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] imcrm-overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <DropdownMenuItem onSelect={() => onOpen(record)}>
                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Abrir')}
                            </DropdownMenuItem>
                            {lockReason !== null && (
                                <p className="imcrm-max-w-[240px] imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">{lockReason}</p>
                            )}
                            {canMove && columnTargets.length > 0 && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                        <ArrowRightLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Mover a…')}
                                    </DropdownMenuLabel>
                                    {columnTargets.map((t) => (
                                        <DropdownMenuItem key={t.key} onSelect={() => onMoveColumn(record, t.key)}>
                                            <Dot color={t.color} />
                                            {t.label}
                                        </DropdownMenuItem>
                                    ))}
                                </>
                            )}
                            {canMove && laneTargets && laneTargets.length > 0 && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                        <Rows3 className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Mover a carril…')}
                                    </DropdownMenuLabel>
                                    {laneTargets.map((t) => (
                                        <DropdownMenuItem key={t.key} onSelect={() => onMoveLane(record, t.key)}>
                                            <Dot color={t.color} />
                                            {t.label}
                                        </DropdownMenuItem>
                                    ))}
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {rows.length > 0 &&
                    (compact ? (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-xs imcrm-text-foreground">
                            {rows.map((field) => (
                                <span key={field.id} className="imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center" title={field.label}>
                                    {renderCellValue(field, record.fields[field.slug])}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <dl className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            {rows.map((field) => (
                                <div key={field.id} className="imcrm-flex imcrm-min-h-[20px] imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                    <dt className="imcrm-w-[38%] imcrm-shrink-0 imcrm-truncate imcrm-text-muted-foreground">{field.label}</dt>
                                    <dd className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-foreground">
                                        {renderCellValue(field, record.fields[field.slug])}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    ))}

                {valueField && Number.isFinite(amountNum) && (
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-end">
                        <span className="imcrm-text-sm imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground" data-testid="imcrm-kanban-card-value">
                            {formatKanbanValue(valueField, amountNum)}
                        </span>
                    </div>
                )}
            </div>
        </article>
    );
}

function Dot({ color }: { color?: string }): JSX.Element {
    return (
        <span
            aria-hidden
            className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full"
            style={{ backgroundColor: colorVar(color as OptionColor | undefined) ?? 'hsl(var(--imcrm-muted-foreground) / 0.4)' }}
        />
    );
}

function isEmpty(v: unknown): boolean {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

export const KanbanCard = memo(KanbanCardImpl);
