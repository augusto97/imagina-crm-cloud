import { CheckCircle2, GripVertical, Lock, X } from 'lucide-react';
import { WORKLOAD_UNASSIGNED, type WorkloadBucket, type WorkloadItem, type WorkloadPerson } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { formatUsage, formatWorkloadValue, LEVEL_CLASSES, shortDate, usagePercent } from './workloadModel';
import type { WorkloadLevel, WorkloadMetric } from '@imagina-base/shared';

export interface WorkloadPanelProps {
    person: WorkloadPerson;
    /** La columna elegida (o `null` = todo el período visible). */
    bucket: WorkloadBucket | null;
    periodLabel: string;
    metric: WorkloadMetric;
    usage: { value: number; capacity: number; level: WorkloadLevel };
    items: WorkloadItem[];
    /** Hay registros de esta celda que no viajaron (más que el tope). */
    missing: number;
    /** Personas a las que se puede reasignar (del equipo y que ven la lista). */
    targets: WorkloadPerson[];
    /** Por qué no se puede reasignar este registro (null = se puede). */
    lockReason: (item: WorkloadItem) => string | null;
    dragEnabled: boolean;
    onReassign: (item: WorkloadItem, toKey: string) => void;
    onOpenRecord: (id: number) => void;
    onDragStart?: (item: WorkloadItem, e: React.DragEvent) => void;
    onDragEnd?: () => void;
    onClose: () => void;
    /**
     * Reemplaza la X propia (en el teléfono, el panel lateral ya dibuja la
     * suya: así no hay dos). Sin él, un botón que llama a `onClose`.
     */
    closeControl?: React.ReactNode;
    className?: string;
}

/**
 * B2 — Los registros de una persona en un período (una celda de la carga, o
 * todo lo visible). Cada registro se abre con un clic, se ARRASTRA a la fila
 * de otra persona (escritorio) o se reasigna con «Reasignar a…» (también en
 * el teléfono y con el teclado).
 */
export function WorkloadPanel({
    person,
    bucket,
    periodLabel,
    metric,
    usage,
    items,
    missing,
    targets,
    lockReason,
    dragEnabled,
    onReassign,
    onOpenRecord,
    onDragStart,
    onDragEnd,
    onClose,
    closeControl,
    className,
}: WorkloadPanelProps): JSX.Element {
    const unassigned = person.key === WORKLOAD_UNASSIGNED;
    const pct = usagePercent(usage.value, usage.capacity);
    return (
        <aside
            className={cn('imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-bg-card', className)}
            aria-label={sprintf(__('Registros de %1$s · %2$s'), person.name, periodLabel)}
            data-testid="workload-panel"
        >
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-semibold" data-testid="workload-panel-person">
                        {person.name}
                    </p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{periodLabel}</p>
                    <p className={cn('imcrm-mt-1 imcrm-text-xs imcrm-font-medium', LEVEL_CLASSES[usage.level].text)} data-testid="workload-panel-usage">
                        {unassigned
                            ? sprintf(__('%s sin asignar'), formatWorkloadValue(usage.value, metric))
                            : `${formatUsage(usage.value, usage.capacity, metric)}${usage.capacity > 0 ? ` (${pct} %)` : ''}`}
                    </p>
                </div>
                {closeControl ?? (
                    <Button variant="ghost" size="icon" className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0" onClick={onClose} aria-label={__('Cerrar')}>
                        <X className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                )}
            </header>
            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-2">
                {items.length === 0 ? (
                    <p className="imcrm-px-2 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {__('No hay registros en este período.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {items.map((item) => {
                            const reason = lockReason(item);
                            const share = bucket ? item.load[bucket.key] ?? 0 : Object.values(item.load).reduce((a, b) => a + b, 0);
                            const draggable = dragEnabled && reason === null;
                            return (
                                <li
                                    key={`${item.id}:${item.person}`}
                                    className="imcrm-group imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-py-2"
                                    draggable={draggable}
                                    onDragStart={draggable && onDragStart ? (e) => onDragStart(item, e) : undefined}
                                    onDragEnd={onDragEnd}
                                    data-testid={`workload-item-${item.id}`}
                                >
                                    <span
                                        className={cn(
                                            'imcrm-mt-0.5 imcrm-shrink-0 imcrm-text-muted-foreground',
                                            draggable ? 'imcrm-cursor-grab' : 'imcrm-opacity-40',
                                        )}
                                        title={reason ?? (dragEnabled ? __('Arrastra a la fila de otra persona para reasignar') : undefined)}
                                        aria-hidden
                                    >
                                        {reason ? <Lock className="imcrm-h-3.5 imcrm-w-3.5" /> : <GripVertical className="imcrm-h-3.5 imcrm-w-3.5" />}
                                    </span>
                                    <div className="imcrm-min-w-0 imcrm-flex-1">
                                        <button
                                            type="button"
                                            className="imcrm-block imcrm-w-full imcrm-truncate imcrm-text-left imcrm-text-sm imcrm-font-medium hover:imcrm-underline"
                                            onClick={() => onOpenRecord(item.id)}
                                        >
                                            {item.title ?? sprintf(__('Registro #%d'), item.id)}
                                        </button>
                                        <p className="imcrm-mt-0.5 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {item.start && (
                                                <span>
                                                    {item.end && item.end !== item.start
                                                        ? `${shortDate(item.start)} → ${shortDate(item.end)}`
                                                        : shortDate(item.start)}
                                                </span>
                                            )}
                                            {metric !== 'count' && (
                                                <span className="imcrm-font-medium imcrm-text-foreground">
                                                    {metric === 'time'
                                                        ? sprintf(__('%s registradas'), formatWorkloadValue(share, metric))
                                                        : item.estimate_minutes === null
                                                          ? __('sin estimación')
                                                          : bucket
                                                            ? sprintf(__('%1$s de %2$s'), formatWorkloadValue(share, metric), formatWorkloadValue(item.estimate_minutes, metric))
                                                            : sprintf(__('%s en el período'), formatWorkloadValue(share, metric))}
                                                </span>
                                            )}
                                            {item.done && (
                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-success">
                                                    <CheckCircle2 className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {__('Terminado')}
                                                </span>
                                            )}
                                        </p>
                                        {metric !== 'time' && reason === null && targets.length > 0 && (
                                            <Select
                                                aria-label={sprintf(__('Reasignar «%s» a…'), item.title ?? `#${item.id}`)}
                                                className="imcrm-mt-1.5 imcrm-h-7 imcrm-text-xs"
                                                value=""
                                                onChange={(e) => {
                                                    if (e.target.value !== '') onReassign(item, e.target.value);
                                                }}
                                                data-testid={`workload-reassign-${item.id}`}
                                            >
                                                <option value="">{__('Reasignar a…')}</option>
                                                {targets
                                                    .filter((t) => t.key !== item.person)
                                                    .map((t) => (
                                                        <option key={t.key} value={t.key}>
                                                            {t.name}
                                                        </option>
                                                    ))}
                                            </Select>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {missing > 0 && (
                    <p className="imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {sprintf(__('Y %d registro(s) más que no se cargaron: acota la vista con filtros para verlos.'), missing)}
                    </p>
                )}
                {metric === 'time' && items.length > 0 && (
                    <p className="imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('En «Tiempo registrado» la fila es de quien cargó el tiempo: para reasignar, cambia a «Registros» o «Esfuerzo».')}
                    </p>
                )}
            </div>
        </aside>
    );
}
