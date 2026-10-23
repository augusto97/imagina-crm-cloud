import { memo } from 'react';
import { Lock } from 'lucide-react';
import type { GanttBar, GanttDragMode } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { GANTT_BAR_H, GANTT_BAR_TOP, GANTT_BASELINE_H, GANTT_BASELINE_TOP, GANTT_MILESTONE } from './ganttModel';

export interface GanttBarItemProps {
    recordId: number;
    /** Posición en el lienzo (px desde el origen del lienzo). */
    left: number;
    width: number;
    bar: GanttBar;
    /** Corrimiento del lienzo en la fila (el ancho del panel izquierdo). */
    offset: number;
    label: string;
    tooltip: string;
    colorStyle: React.CSSProperties | undefined;
    blocked: boolean;
    baseline: { left: number; width: number; milestone: boolean } | null;
    /** Si se puede arrastrar/estirar (escritorio, permiso, columna que no bloquea la tienda). */
    draggable: boolean;
    /** Si se puede tirar una flecha desde el borde (crear dependencia). */
    linkable: boolean;
    dragging: boolean;
    onDragStart: (e: React.PointerEvent, recordId: number, mode: GanttDragMode) => void;
    onLinkStart: (e: React.PointerEvent, recordId: number) => void;
    onTap: (e: React.MouseEvent, recordId: number) => void;
    onMenu: (e: React.MouseEvent, recordId: number) => void;
}

/**
 * Una barra (o el rombo de un hito) del Gantt, con sus asas: los bordes
 * estiran, el centro mueve y el punto de la derecha tira una flecha hacia
 * otro registro para crear una dependencia («este bloquea a aquel»).
 */
export const GanttBarItem = memo(function GanttBarItem({
    recordId,
    left,
    width,
    bar,
    offset,
    label,
    tooltip,
    colorStyle,
    blocked,
    baseline,
    draggable,
    linkable,
    dragging,
    onDragStart,
    onLinkStart,
    onTap,
    onMenu,
}: GanttBarItemProps): JSX.Element {
    const labelInside = !bar.milestone && width >= 72;
    const tinted = colorStyle !== undefined;
    return (
        <>
            {baseline && (
                <div
                    aria-hidden
                    data-testid="gantt-baseline"
                    className={cn(
                        'imcrm-pointer-events-none imcrm-absolute imcrm-border imcrm-border-dashed imcrm-border-foreground/40 imcrm-bg-foreground/15',
                        baseline.milestone ? 'imcrm-rotate-45 imcrm-rounded-[2px]' : 'imcrm-rounded-full',
                    )}
                    style={
                        baseline.milestone
                            ? { left: offset + baseline.left + 3, top: GANTT_BASELINE_TOP - 3, width: 8, height: 8 }
                            : { left: offset + baseline.left, top: GANTT_BASELINE_TOP, width: baseline.width, height: GANTT_BASELINE_H }
                    }
                />
            )}
            <div
                data-gantt-bar
                data-gantt-record-id={recordId}
                data-testid={bar.milestone ? 'gantt-milestone' : 'gantt-bar'}
                title={tooltip}
                role="button"
                tabIndex={-1}
                className={cn(
                    'imcrm-group/bar imcrm-pointer-events-auto imcrm-absolute imcrm-select-none',
                    draggable ? 'imcrm-cursor-grab active:imcrm-cursor-grabbing' : 'imcrm-cursor-pointer',
                    dragging && 'imcrm-z-10',
                )}
                style={{ left: offset + left, top: bar.milestone ? GANTT_BAR_TOP + (GANTT_BAR_H - GANTT_MILESTONE) / 2 : GANTT_BAR_TOP, width, height: bar.milestone ? GANTT_MILESTONE : GANTT_BAR_H }}
                onPointerDown={draggable ? (e) => onDragStart(e, recordId, 'move') : undefined}
                onClick={(e) => onTap(e, recordId)}
                onContextMenu={(e) => onMenu(e, recordId)}
            >
                {bar.milestone ? (
                    <span
                        className={cn(
                            'imcrm-absolute imcrm-inset-0 imcrm-rotate-45 imcrm-rounded-[3px] imcrm-border imcrm-shadow-imcrm-sm',
                            !tinted && 'imcrm-border-primary imcrm-bg-primary',
                            dragging && 'imcrm-ring-2 imcrm-ring-ring',
                        )}
                        style={colorStyle}
                    />
                ) : (
                    <span
                        className={cn(
                            'imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-px-1.5 imcrm-text-[11.5px] imcrm-font-medium imcrm-shadow-imcrm-sm',
                            !tinted && 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground',
                            dragging && 'imcrm-ring-2 imcrm-ring-ring',
                        )}
                        style={colorStyle}
                    >
                        {labelInside && (
                            <>
                                {blocked && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />}
                                <span className="imcrm-truncate">{label}</span>
                            </>
                        )}
                    </span>
                )}
                {!labelInside && (
                    <span
                        className="imcrm-pointer-events-none imcrm-absolute imcrm-top-1/2 imcrm-flex imcrm-max-w-[16rem] imcrm--translate-y-1/2 imcrm-items-center imcrm-gap-1 imcrm-whitespace-nowrap imcrm-text-[11.5px] imcrm-text-foreground/80"
                        style={{ left: width + (linkable ? 16 : 6) }}
                    >
                        {blocked && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400" aria-hidden />}
                        <span className="imcrm-truncate">{label}</span>
                    </span>
                )}
                {draggable && !bar.milestone && (
                    <>
                        <span
                            aria-hidden
                            data-testid="gantt-resize-start"
                            className="imcrm-absolute imcrm-inset-y-0 imcrm--left-0.5 imcrm-w-2 imcrm-cursor-ew-resize imcrm-rounded-l-md hover:imcrm-bg-foreground/20"
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                onDragStart(e, recordId, 'start');
                            }}
                        />
                        <span
                            aria-hidden
                            data-testid="gantt-resize-end"
                            className="imcrm-absolute imcrm-inset-y-0 imcrm--right-0.5 imcrm-w-2 imcrm-cursor-ew-resize imcrm-rounded-r-md hover:imcrm-bg-foreground/20"
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                onDragStart(e, recordId, 'end');
                            }}
                        />
                    </>
                )}
                {linkable && (
                    <span
                        role="button"
                        aria-label={__('Crear una dependencia: suéltala sobre otro registro')}
                        data-testid="gantt-link-handle"
                        className="imcrm-absolute imcrm-top-1/2 imcrm-h-3 imcrm-w-3 imcrm--translate-y-1/2 imcrm-cursor-crosshair imcrm-rounded-full imcrm-border-2 imcrm-border-primary imcrm-bg-card imcrm-opacity-0 imcrm-transition-opacity group-hover/bar:imcrm-opacity-100"
                        style={{ left: width + 3 }}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            onLinkStart(e, recordId);
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
            </div>
        </>
    );
});
